/**
 * The fun-lab/* scenario adapter: one scenario through THIS engine's public API.
 *
 * It mirrors laravel-fun-lab's tests/Conformance/ScenarioRunner.php step for
 * step, because the goldens are what that runner returned. Subjects are named,
 * get ids 1, 2, 3 in the order listed, and keep their scenario type names
 * ("user", "team") as their awardable type, which is exactly what a twin
 * stores natively. Keyed results are lists sorted by key, because PHP encodes
 * an empty map as [] and the goldens follow it.
 */
import {
  FunLab,
  InvalidArgumentError,
  AwardRejectedError,
  slug,
  headline,
  type Store,
  type Subject,
  type FunLabEventName,
} from "../src/index";

type Step = Record<string, unknown> & { op: string };

const EVENTS: FunLabEventName[] = [
  "xp.awarded",
  "metric.level-reached",
  "achievement.unlocked",
  "prize.awarded",
  "award.granted",
  "catalog.mutated",
];

/** The events laravel-fun-lab broadcasts; the fun-lab/events table pins their payloads. */
const BROADCASTS: FunLabEventName[] = ["xp.awarded", "metric.level-reached", "achievement.unlocked", "prize.awarded"];

/**
 * `broadcasts: false` is fun-lab/progression's `scenario` (contract fields per
 * event); `true` is fun-lab/events' `broadcasts`: each broadcastable event's
 * `payload`, the field a host relays to Echo listeners as is.
 */
export function runScenario(input: Record<string, unknown>, makeStore: () => Store, broadcasts = false): unknown {
  let now = new Date(String(input.clock));
  const config = (input.config ?? {}) as Record<string, unknown>;
  const lab = new FunLab({
    store: makeStore(),
    clock: () => now,
    config: {
      maxPointsPerAction: Number(config.max_points_per_action ?? 10000),
      logToDatabase: Boolean(config.log_to_database ?? true),
      dispatch: Boolean(config.dispatch ?? true),
    },
  });

  let captured: Record<string, unknown>[] = [];
  for (const name of broadcasts ? BROADCASTS : EVENTS) {
    lab.on(name, (e: any) => {
      captured.push(broadcasts ? { event: name, payload: e.payload } : { event: name, ...eventFields(name, e) });
    });
  }

  const subjects = new Map<string, Subject>();
  let id = 0;
  for (const [name, type] of Object.entries((input.subjects ?? {}) as Record<string, string>)) {
    if (type !== "user" && type !== "team") throw new Error(`unknown subject type ${type}`);
    id++;
    subjects.set(name, { type, id });
  }
  const subject = (name: unknown): Subject => {
    const s = subjects.get(String(name));
    if (!s) throw new InvalidArgumentError(`unknown subject ${String(name)}`);
    return s;
  };

  const guard = (fn: () => unknown): unknown => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof AwardRejectedError) return { error: "rejected", kind: e.kind, message: e.message };
      if (e instanceof InvalidArgumentError) return { error: "invalid", message: e.message };
      throw e;
    }
  };

  const step = (s: Step): unknown => {
    switch (s.op) {
      case "clock":
        now = new Date(String(s.at));
        return null;
      case "setup":
        return guard(() => ({ id: lab.setup(String(s.a), (s.with ?? {}) as Record<string, unknown>).id }));
      case "attach":
        return guard(() => {
          if (s.metricLevel) {
            const t = s.metricLevel as { metric: string; level: number };
            lab.attachAchievement(String(s.achievement), { metric: t.metric, level: t.level });
          } else {
            const t = s.groupLevel as { group: string; level: number };
            lab.attachAchievement(String(s.achievement), { group: t.group, level: t.level });
          }
          return true;
        });
      case "award":
        return guard(() => {
          const b = lab.award(String(s.metric)).to(subject(s.to)).amount(Number(s.amount));
          if (s.reason !== undefined) b.because(String(s.reason));
          if (s.source !== undefined) b.from(String(s.source));
          if (s.meta !== undefined) b.withMeta(s.meta as Record<string, unknown>);
          const pm = b.save();
          return { total_xp: pm.total_xp, current_level: pm.current_level };
        });
      case "grant":
        return guard(() => {
          const b = lab.grant(String(s.slug)).to(subject(s.to));
          if (s.reason !== undefined) b.because(String(s.reason));
          if (s.source !== undefined) b.from(String(s.source));
          if (s.meta !== undefined) b.withMeta(s.meta as Record<string, unknown>);
          const r = b.save();
          return { success: r.success, message: r.message };
        });
      case "optOut":
        return lab.optOut(subject(s.who));
      case "optIn":
        return lab.optIn(subject(s.who));
      case "redeem":
        return guard(() =>
          s.to === "claimed" ? lab.claimPrize(Number(s.grant)) : lab.fulfillPrize(Number(s.grant)),
        );
      case "hasLevel":
        return guard(() =>
          lab.hasLevel(subject(s.who), Number(s.level), {
            metric: s.metric as string | undefined,
            group: s.group as string | undefined,
          }),
        );
      case "levelInfo":
        return s.group !== undefined
          ? lab.levelInfo(subject(s.who), { group: String(s.group) })
          : lab.levelInfo(subject(s.who), { metric: String(s.metric) });
      case "leaderboard":
        return guard(() => {
          const board = lab.leaderboard();
          if (s.for !== undefined) board.for(String(s.for));
          if (s.by !== undefined) board.by(String(s.by));
          if ("period" in s) board.period((s.period as string | null) ?? null);
          if (s.metric !== undefined) board.metric(String(s.metric));
          if (s.excludeOptedOut !== undefined) board.excludeOptedOut(Boolean(s.excludeOptedOut));
          if (s.page !== undefined) {
            const page = board.perPage(Number(s.perPage ?? 15)).page(Number(s.page)).paginate();
            return { total: page.total, entries: page.items };
          }
          return { entries: s.take !== undefined ? board.take(Number(s.take)) : board.get() };
        });
      case "profile": {
        const who = subject(s.who);
        const profile = lab.profileResource(who);
        if (profile === null) return { profile: null };
        return {
          profile,
          metrics: lab.profileMetricResources(who),
          achievements: lab.achievementGrantResources(who),
          prizes: lab.prizeGrantResources(who),
          groups: lab.groupSlugs().map((g) => ({ group: g, ...lab.levelInfo(who, { group: g }) })),
        };
      }
      case "catalog":
        return lab.catalogResources();
      case "analytics":
        return guard(() => {
          const q = lab.analytics();
          if (s.byType !== undefined) q.byType(String(s.byType));
          if (s.forType !== undefined) q.forAwardableType(String(s.forType));
          if (s.forSubject !== undefined) q.forAwardable(subject(s.forSubject));
          if (s.source !== undefined) q.fromSource(String(s.source));
          if (s.achievement !== undefined) q.forAchievement(String(s.achievement));
          if ("period" in s) q.period((s.period as string | null) ?? null);
          if (s.since !== undefined) q.since(String(s.since));
          if (s.until !== undefined) q.until(String(s.until));
          switch (s.agg) {
            case "count": return q.count();
            case "total": return q.total();
            case "average": return q.average();
            case "min": return q.min();
            case "max": return q.max();
            case "activeUsers": return q.activeUsers();
            case "completionRate": return q.achievementCompletionRate();
            case "timeSeries": return q.timeSeries(String(s.interval ?? "day"));
            case "byAwardType": return keyed(q.byAwardType());
            case "byAwardableType": return keyed(q.byAwardableType());
            case "bySource": return keyed(q.bySource());
            case "export": return q.export(s.limit !== undefined ? Number(s.limit) : null);
            default: throw new Error(`unknown agg ${String(s.agg)}`);
          }
        });
      default:
        throw new Error(`unknown op ${s.op}`);
    }
  };

  const steps: unknown[] = [];
  for (const s of input.steps as Step[]) {
    captured = [];
    const result = step(s);
    steps.push(broadcasts ? { result, broadcasts: captured } : { result, events: captured });
  }

  // JSON round trip: the golden is JSON, so an `undefined` key or a -0 must
  // not decide a comparison the PHP side could never have produced.
  return JSON.parse(JSON.stringify({ steps }));
}

function keyed(map: Record<string, Record<string, unknown>>): unknown[] {
  return Object.keys(map)
    .sort()
    .map((key) => ({ key, ...map[key] }));
}

function eventFields(name: FunLabEventName, e: any): Record<string, unknown> {
  switch (name) {
    case "xp.awarded":
      return { metric: e.metric.slug, amount: e.amount, total_xp: e.profileMetric.total_xp };
    case "metric.level-reached":
      return {
        metric: e.metric.slug,
        level: e.level.level,
        achievements: e.achievements.map((a: { slug: string }) => a.slug),
        total_xp: e.totalXp,
      };
    case "achievement.unlocked":
      return { achievement: e.achievement.slug, source: e.source };
    case "prize.awarded":
      return { prize: e.prize.slug, source: e.source };
    case "award.granted":
      return { type: e.type };
    case "catalog.mutated":
      return { entity: e.entityType, created: e.created };
  }
}

export function runStringCase(fn: string, value: string): string {
  if (fn === "slug") return slug(value);
  if (fn === "headline") return headline(value);
  throw new Error(`unknown fn ${fn}`);
}
