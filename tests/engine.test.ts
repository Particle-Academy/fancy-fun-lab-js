import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  AwardRejectedError,
  FunLab,
  InMemoryStore,
  InvalidArgumentError,
  PeriodLeaderboardUnavailableError,
  achievementUnlockedPayload,
  levelReachedPayload,
  prizeAwardedPayload,
  xpAwardedPayload,
  type FunLabEventName,
  type Store,
} from "../src/index";
import { SqliteStore } from "../src/sqlite";

const clock = () => new Date("2026-11-18T12:00:00Z");
const ada = { type: "user", id: 1 };
const tmp: string[] = [];

afterEach(() => {
  for (const dir of tmp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "fun-lab-"));
  tmp.push(dir);
  return join(dir, "lab.sqlite");
}

const stores: Record<string, () => Store> = {
  memory: () => new InMemoryStore(),
  sqlite: () => new SqliteStore(":memory:"),
};

for (const [name, make] of Object.entries(stores)) {
  describe(`the ${name} store contract`, () => {
    it("assigns ids 1, 2, 3 per table and returns copies", () => {
      const s = make();
      const a = s.insert("gamed_metrics", { slug: "a", name: "A", active: true });
      const b = s.insert("gamed_metrics", { slug: "b", name: "B", active: false });
      const c = s.insert("metric_level_groups", { slug: "g", name: "G" });
      expect([a.id, b.id, c.id]).toEqual([1, 2, 1]);
      a.name = "mutated";
      expect(s.find("gamed_metrics", 1)!.name).toBe("A");
      expect(s.find("gamed_metrics", 2)!.active).toBe(false);
    });

    it("selects on equality, with null matching null, in id order", () => {
      const s = make();
      s.insert("achievements", { slug: "x", name: "X", awardable_type: null, is_active: true });
      s.insert("achievements", { slug: "y", name: "Y", awardable_type: "team", is_active: true });
      s.insert("achievements", { slug: "z", name: "Z", awardable_type: null, is_active: false });
      expect(s.select("achievements", { awardable_type: null }).map((r) => r.slug)).toEqual(["x", "z"]);
      expect(s.select("achievements", { awardable_type: null, is_active: true }).map((r) => r.slug)).toEqual(["x"]);
    });

    it("compareAndSet moves a row only from the value the caller read", () => {
      const s = make();
      const pm = s.insert("profile_metrics", { profile_id: 1, gamed_metric_id: 1, total_xp: 300, current_level: 1 });
      expect(s.compareAndSet("profile_metrics", pm.id, "current_level", 1, { current_level: 3 })).toBe(true);
      // A second caller that read level 1 too: refused, the level stays 3.
      expect(s.compareAndSet("profile_metrics", pm.id, "current_level", 1, { current_level: 3 })).toBe(false);
      expect(s.find("profile_metrics", pm.id)!.current_level).toBe(3);
    });

    it("increments and sets in one write", () => {
      const s = make();
      const p = s.insert("profiles", { awardable_type: "user", awardable_id: 1, total_xp: 5 });
      s.increment("profiles", p.id, "total_xp", 7, { updated_at: "2026-11-18 12:00:00" });
      expect(s.find("profiles", p.id)).toMatchObject({ total_xp: 12, updated_at: "2026-11-18 12:00:00" });
    });

    it("JSON columns keep [] and objects apart", () => {
      const s = make();
      const a = s.insert("event_logs", { event_type: "x", context: { meta: [] } });
      const b = s.insert("event_logs", { event_type: "y", context: { meta: { a: 1 } } });
      expect(s.find("event_logs", a.id)!.context).toEqual({ meta: [] });
      expect(s.find("event_logs", b.id)!.context).toEqual({ meta: { a: 1 } });
    });
  });
}

describe("a level claimed from two connections", () => {
  it("is claimed once across two SqliteStores on one file", () => {
    const file = tempFile();
    const a = new SqliteStore(file);
    const b = new SqliteStore(file);
    const pm = a.insert("profile_metrics", { profile_id: 1, gamed_metric_id: 1, total_xp: 250, current_level: 1 });
    // Both read level 1; only the first claim lands.
    expect(a.compareAndSet("profile_metrics", pm.id, "current_level", 1, { current_level: 3 })).toBe(true);
    expect(b.compareAndSet("profile_metrics", pm.id, "current_level", 1, { current_level: 3 })).toBe(false);
    a.close();
    b.close();
  });

  for (const [name, make] of Object.entries(stores)) {
    it(`announces each level once when two engines share one ${name} store`, () => {
      const store = make();
      const one = new FunLab({ store, clock });
      const two = new FunLab({ store, clock });
      one.setup("gamed-metric", { slug: "combat" });
      for (const [level, xp] of [[2, 100], [3, 200]] as const) one.setup("metric-level", { metric: "combat", level, xp });
      const seen: number[] = [];
      for (const lab of [one, two]) lab.on("metric.level-reached", (e) => seen.push(Number(e.level.level)));

      one.award("combat").to(ada).amount(150).save();
      two.award("combat").to(ada).amount(10).save(); // still level 2: nothing to announce
      two.award("combat").to(ada).amount(50).save();
      one.award("combat").to(ada).amount(5).save();

      expect(seen).toEqual([2, 3]);
    });
  }
});

describe("events and the log", () => {
  const names: FunLabEventName[] = ["xp.awarded", "metric.level-reached", "catalog.mutated"];

  it("on() returns an unsubscribe", () => {
    const lab = new FunLab({ clock });
    const seen: string[] = [];
    const off = lab.on("catalog.mutated", () => seen.push("x"));
    lab.setup("gamed-metric", { slug: "a" });
    off();
    lab.setup("gamed-metric", { slug: "b" });
    expect(seen).toEqual(["x"]);
  });

  it("dispatch=false emits nothing and logs nothing, but the award lands", () => {
    const lab = new FunLab({ clock, config: { dispatch: false } });
    const seen: string[] = [];
    for (const n of names) lab.on(n, () => seen.push(n));
    lab.setup("gamed-metric", { slug: "combat" });
    lab.setup("metric-level", { metric: "combat", level: 2, xp: 10 });
    expect(lab.award("combat").to(ada).amount(20).save()).toMatchObject({ total_xp: 20, current_level: 2 });
    expect(seen).toEqual([]);
    expect(lab.analytics().count()).toBe(0);
    expect(() => lab.leaderboard().period("weekly").get()).toThrow(PeriodLeaderboardUnavailableError);
  });

  it("each broadcastable event keeps its raw rows and carries the flat payload its exported serializer produces", () => {
    const lab = new FunLab({ clock });
    const seen: Record<string, any> = {};
    for (const n of ["xp.awarded", "metric.level-reached", "achievement.unlocked", "prize.awarded"] as const) {
      lab.on(n, (e) => (seen[n] = e));
    }
    lab.setup("gamed-metric", { slug: "combat-xp", name: "Combat XP" });
    lab.setup("metric-level", { metric: "combat-xp", level: 2, xp: 5, name: "Two" });
    lab.setup("achievement", { slug: "two", icon: "star" });
    lab.setup("prize", { slug: "hat" });
    lab.attachAchievement("two", { metric: "combat-xp", level: 2 });
    lab.award("combat-xp").to(ada).amount(5).save();
    lab.grant("hat").to(ada).save();

    const xp = seen["xp.awarded"];
    expect(xp.metric.slug).toBe("combat-xp"); // additive: the raw rows are still there
    expect(xp.payload).toEqual(xpAwardedPayload(xp));
    expect(xp.payload).toMatchObject({ id: 1, gamed_metric_name: "Combat XP", amount: 5, current_level: 2 });
    expect(seen["metric.level-reached"].payload).toEqual(levelReachedPayload(seen["metric.level-reached"]));
    expect(seen["metric.level-reached"].payload.achievements).toEqual([{ id: 1, slug: "two", name: "Two", icon: "star" }]);
    expect(seen["achievement.unlocked"].payload).toEqual(achievementUnlockedPayload(seen["achievement.unlocked"]));
    expect(seen["prize.awarded"].payload).toEqual(prizeAwardedPayload(seen["prize.awarded"]));
    expect(seen["prize.awarded"].payload).toMatchObject({ grant_type: "prize", status: "granted" });
  });

  it("logToDatabase=false still emits", () => {
    const lab = new FunLab({ clock, config: { logToDatabase: false } });
    const seen: string[] = [];
    lab.on("xp.awarded", () => seen.push("xp"));
    lab.setup("gamed-metric", { slug: "combat" });
    lab.award("combat").to(ada).amount(1).save();
    expect(seen).toEqual(["xp"]);
    expect(lab.analytics().count()).toBe(0);
  });
});

describe("the validation pipeline", () => {
  it("refuses an award as pipeline_rejected and a grant as a failed result", () => {
    const lab = new FunLab({ clock });
    lab.setup("gamed-metric", { slug: "combat" });
    lab.setup("achievement", { slug: "hello" });
    lab.addValidationStep((ctx) => (ctx.subject.id === 1 ? { valid: false, message: "not today" } : undefined));

    let error: unknown;
    try {
      lab.award("combat").to(ada).amount(1).save();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AwardRejectedError);
    expect(error).toMatchObject({ kind: "pipeline_rejected", message: "not today" });
    expect(lab.grant("hello").to(ada).save()).toMatchObject({ success: false, message: "not today" });
    expect(lab.award("combat").to({ type: "user", id: 2 }).amount(1).save().total_xp).toBe(1);
  });
});

describe("prize redemption", () => {
  it("refuses an unknown grant id", () => {
    const lab = new FunLab({ clock });
    expect(() => lab.claimPrize(9)).toThrow(InvalidArgumentError);
  });
});

describe("the SQLite layout is laravel-fun-lab's", () => {
  it("uses the lfl_ tables, Laravel datetimes and 0/1 booleans", () => {
    const file = tempFile();
    const store = new SqliteStore(file);
    const lab = new FunLab({ store, clock });
    lab.setup("gamed-metric", { slug: "combat" });
    lab.award("combat").to(ada).amount(5).save();
    store.close();

    const db = new DatabaseSync(file);
    const tables = (db.prepare("select name from sqlite_master where type = 'table' and name like 'lfl_%' order by name").all() as {
      name: string;
    }[]).map((t) => t.name);
    expect(tables).toContain("lfl_profiles");
    expect(tables).toContain("lfl_event_logs");
    expect(tables).toContain("lfl_achievement_metric_level_group_levels");
    expect(db.prepare("select created_at, active from lfl_gamed_metrics").get()).toEqual({
      created_at: "2026-11-18 12:00:00",
      active: 1,
    });
    db.close();
  });

  it("takes a prefix", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteStore(db, { prefix: "game_" });
    const names = (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(names).toContain("game_profiles");
    expect(names.some((n) => n.startsWith("lfl_"))).toBe(false);
  });
});

describe("what the docs promise", () => {
  it("the README example works as written", () => {
    const lab = new FunLab({ store: new SqliteStore(":memory:"), clock });
    lab.setup("gamed-metric", { slug: "combat-xp", name: "Combat XP" });
    lab.setup("metric-level", { metric: "combat-xp", level: 2, xp: 100, name: "Apprentice" });
    lab.setup("achievement", { slug: "apprentice" });
    lab.attachAchievement("apprentice", { metric: "combat-xp", level: 2 });
    const ada = { type: "user", id: 1 };
    lab.award("combat-xp").to(ada).amount(150).because("defeated the boss").save();
    expect(lab.hasAchievement(ada, "apprentice")).toBe(true);
    expect(lab.leaderboard().for("user").period("weekly").take(10)).toMatchObject([{ rank: 1, period_xp: 150 }]);
  });

  it("AGENTS.md traps: default names, exact lookups, omitted fields cleared", () => {
    const lab = new FunLab({ clock });
    expect(lab.setup("gamed-metric", { slug: "Combat XP", description: "Fighting" })).toMatchObject({
      slug: "combat-xp",
      name: "Combat Xp",
      description: "Fighting",
    });
    expect(lab.setup("gamed-metric", { slug: "combat-xp" }).description).toBeNull();
    expect(() => lab.award("Combat XP").to(ada).amount(1).save()).toThrow("GamedMetric 'Combat XP' not found.");
  });
});

describe("the package root", () => {
  it("never imports node:sqlite outside src/sqlite.ts", () => {
    const dir = join(__dirname, "..", "src");
    for (const f of readdirSync(dir)) {
      if (f === "sqlite.ts") continue;
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/(from\s+|import\s*\(\s*|require\(\s*)["']node:sqlite["']/);
    }
  });
});
