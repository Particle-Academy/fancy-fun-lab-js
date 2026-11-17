import type { FunLab } from "./engine";
import type { Subject } from "./events";
import type { Row } from "./store";
import { sameValue } from "./store";
import { startOfDay, startOfMonth, startOfWeek, startOfYear, toDate, toDb, toIso } from "./time";

export interface SeriesPoint {
  period: string;
  count: number;
  total: number;
}

/**
 * Reads over the event log, as AnalyticsBuilder. Filters combine; the date
 * bounds are inclusive. Rows logged in the same instant export newest first by
 * id.
 */
export class Analytics {
  private awardType: string | null = null;
  private awardableType: string | null = null;
  private awardableId: number | string | null = null;
  private achievementSlug: string | null = null;
  private sourceName: string | null = null;
  private startDate: string | null = null;
  private endDate: string | null = null;

  constructor(private readonly lab: FunLab) {}

  /** `points` (XP), `achievement`, `prize`, or `system` (catalog changes). */
  byType(type: string): this {
    this.awardType = type;
    return this;
  }
  forAwardableType(type: string): this {
    this.awardableType = type;
    return this;
  }
  /** One subject: its type AND id. */
  forAwardable(subject: Subject): this {
    this.awardableType = subject.type;
    this.awardableId = subject.id;
    return this;
  }
  fromSource(source: string): this {
    this.sourceName = source;
    return this;
  }
  forAchievement(slug: string): this {
    this.achievementSlug = slug;
    return this;
  }
  /** `daily`, `weekly`, `monthly`, `yearly` (up to now), or `all-time` / null. */
  period(period: string | null = null): this {
    if (period === null || period === "all-time") {
      this.startDate = null;
      this.endDate = null;
      return this;
    }
    const now = this.lab.now();
    this.endDate = toDb(now);
    const start =
      period === "daily"
        ? startOfDay(now)
        : period === "weekly"
          ? startOfWeek(now)
          : period === "monthly"
            ? startOfMonth(now)
            : period === "yearly"
              ? startOfYear(now)
              : null;
    this.startDate = start ? toDb(start) : null;
    return this;
  }
  between(start: Date | string, end: Date | string | null = null): this {
    this.startDate = toDb(toDate(start));
    this.endDate = toDb(end === null ? this.lab.now() : toDate(end));
    return this;
  }
  since(date: Date | string): this {
    this.startDate = toDb(toDate(date));
    this.endDate = toDb(this.lab.now());
    return this;
  }
  until(date: Date | string): this {
    this.endDate = toDb(toDate(date));
    return this;
  }

  count(): number {
    return this.rows().length;
  }
  total(): number {
    return this.amounts().reduce((a, b) => a + b, 0);
  }
  average(): number {
    const a = this.amounts();
    return a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length;
  }
  min(): number | null {
    const a = this.amounts();
    return a.length === 0 ? null : Math.min(...a);
  }
  max(): number | null {
    const a = this.amounts();
    return a.length === 0 ? null : Math.max(...a);
  }

  /** Distinct subjects (type and id) with a matching row. */
  activeUsers(): number {
    return distinctSubjects(this.rows());
  }

  /**
   * The share (0-100) of active subjects who earned the achievement, among the
   * rows the other filters select. 0 with no achievement named.
   */
  achievementCompletionRate(achievementSlug: string | null = null): number {
    if (achievementSlug !== null) this.achievementSlug = achievementSlug;
    if (this.achievementSlug === null) return 0;
    const eligible = distinctSubjects(this.rows(false));
    if (eligible === 0) return 0;
    const completed = distinctSubjects(this.rows().filter((r) => r.achievement_slug === this.achievementSlug));
    return (completed / eligible) * 100;
  }

  /**
   * Counts and totals per `hour`, `day`, `month` or `year`, oldest first.
   * `week` follows SQLite's `%Y-%W` (Monday-start weeks from 00), which is
   * what the reference gives on SQLite and MySQL but not on Postgres, so it is
   * not part of the shared contract.
   */
  timeSeries(interval = "day"): SeriesPoint[] {
    const groups = new Map<string, { count: number; total: number }>();
    for (const r of this.rows()) {
      const at = String(r.occurred_at);
      const k = bucket(at, interval);
      const g = groups.get(k) ?? { count: 0, total: 0 };
      g.count++;
      g.total += Number(r.amount ?? 0);
      groups.set(k, g);
    }
    return [...groups.keys()].sort().map((period) => ({ period, ...groups.get(period)! }));
  }

  byAwardType(): Record<string, { count: number; total: number }> {
    return this.group((r) => String(r.award_type));
  }

  byAwardableType(): Record<string, { count: number; total: number; unique_awardables: number }> {
    const out: Record<string, { count: number; total: number; unique_awardables: number }> = {};
    for (const [k, rows] of this.partition((r) => String(r.awardable_type))) {
      out[k] = {
        count: rows.length,
        total: sum(rows),
        unique_awardables: new Set(rows.map((r) => String(r.awardable_id))).size,
      };
    }
    return out;
  }

  /** Per source, with no source as `unknown`. */
  bySource(): Record<string, { count: number; total: number }> {
    return this.group((r) => (r.source === null || r.source === undefined ? "unknown" : String(r.source)));
  }

  /** The matching rows, newest first, as the reference exports them. */
  export(limit: number | null = null): Record<string, unknown>[] {
    const rows = this.rows().sort((a, b) => {
      const d = String(b.occurred_at).localeCompare(String(a.occurred_at));
      return d !== 0 ? d : b.id - a.id;
    });
    return (limit === null ? rows : rows.slice(0, limit)).map((r) => ({
      id: r.id,
      event_type: r.event_type,
      award_type: r.award_type,
      awardable_type: r.awardable_type,
      awardable_id: r.awardable_id,
      achievement_slug: r.achievement_slug ?? null,
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
      reason: r.reason ?? null,
      source: r.source ?? null,
      occurred_at: toIso(r.occurred_at as string | null),
      context: r.context ?? null,
    }));
  }

  private group(by: (r: Row) => string): Record<string, { count: number; total: number }> {
    const out: Record<string, { count: number; total: number }> = {};
    for (const [k, rows] of this.partition(by)) out[k] = { count: rows.length, total: sum(rows) };
    return out;
  }

  private partition(by: (r: Row) => string): Map<string, Row[]> {
    const m = new Map<string, Row[]>();
    for (const r of this.rows()) {
      const k = by(r);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }

  private amounts(): number[] {
    return this.rows()
      .filter((r) => r.amount !== null && r.amount !== undefined)
      .map((r) => Number(r.amount));
  }

  private rows(withAchievement = true): Row[] {
    return this.lab.store.select("event_logs").filter((r) => {
      if (this.awardType !== null && r.award_type !== this.awardType) return false;
      if (this.awardableType !== null && r.awardable_type !== this.awardableType) return false;
      if (this.awardableId !== null && !sameValue(r.awardable_id, this.awardableId)) return false;
      if (withAchievement && this.achievementSlug !== null && r.achievement_slug !== this.achievementSlug) return false;
      if (this.sourceName !== null && r.source !== this.sourceName) return false;
      const at = String(r.occurred_at);
      if (this.startDate !== null && at < this.startDate) return false;
      if (this.endDate !== null && at > this.endDate) return false;
      return true;
    });
  }
}

function sum(rows: Row[]): number {
  return rows.reduce((a, r) => a + Number(r.amount ?? 0), 0);
}

function distinctSubjects(rows: Row[]): number {
  return new Set(rows.map((r) => `${String(r.awardable_type)}-${String(r.awardable_id)}`)).size;
}

/** The period label for a stored datetime (`Y-m-d H:i:s`). */
function bucket(at: string, interval: string): string {
  switch (interval) {
    case "hour":
      return `${at.slice(0, 13)}:00:00`;
    case "month":
      return at.slice(0, 7);
    case "year":
      return at.slice(0, 4);
    case "week": {
      const d = new Date(`${at.replace(" ", "T")}Z`);
      const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
      const yday = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - jan1) / 86_400_000);
      const monday = (d.getUTCDay() + 6) % 7;
      const week = Math.floor((yday + 7 - monday) / 7);
      return `${at.slice(0, 4)}-${String(week).padStart(2, "0")}`;
    }
    default:
      return at.slice(0, 10);
  }
}
