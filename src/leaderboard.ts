import type { FunLab } from "./engine";
import { InvalidArgumentError, PeriodLeaderboardUnavailableError } from "./errors";
import { leaderboardEntryResource } from "./resources";
import type { Row } from "./store";
import { startOfDay, startOfMonth, startOfWeek, toDb } from "./time";

export interface LeaderboardPage {
  total: number;
  page: number;
  perPage: number;
  items: Record<string, unknown>[];
}

type Candidate = { profile: Row; metricXp?: number; metricLevel?: number; periodXp?: number };

/**
 * A ranked board, as LeaderboardBuilder.
 *
 * - All-time boards rank on the profile totals.
 * - A `daily`, `weekly` (from Monday) or `monthly` board ranks on the XP EARNED
 *   in the period, summed from the event log, and lists only profiles that
 *   earned some. With the log off it is refused.
 * - A metric board ranks on that one metric; with a period, on that metric's
 *   XP earned in the period.
 * - Opted-out profiles are excluded unless asked; ties break on profile id.
 */
export class Leaderboard {
  private awardableType: string | null = null;
  private sortBy = "xp";
  private periodName: string | null = null;
  private perPageCount = 15;
  private pageNumber: number | null = null;
  private excluding = true;
  private metricSlug: string | null = null;

  constructor(private readonly lab: FunLab) {}

  /** Only rank subjects of this type. */
  for(type: string): this {
    this.awardableType = type;
    return this;
  }
  /** `xp` (default; `points` is an alias), `achievements` or `prizes`. */
  by(sort: string): this {
    this.sortBy = sort === "points" ? "xp" : sort;
    return this;
  }
  /** `daily`, `weekly`, `monthly` or `all-time` / null. */
  period(period: string | null = null): this {
    this.periodName = period;
    return this;
  }
  /** Rank on one gamed metric. */
  metric(slug: string | null): this {
    this.metricSlug = slug;
    return this;
  }
  excludeOptedOut(exclude = true): this {
    this.excluding = exclude;
    return this;
  }
  perPage(n: number): this {
    this.perPageCount = n;
    return this;
  }
  page(n: number): this {
    this.pageNumber = n;
    return this;
  }

  /** Every entry, ranked from 1. */
  get(): Record<string, unknown>[] {
    return this.entries(this.build(), 0);
  }

  /** The top `limit` entries. */
  take(limit: number): Record<string, unknown>[] {
    return this.entries(this.build().slice(0, limit), 0);
  }

  /** One page, ranked from the page's offset. */
  paginate(): LeaderboardPage {
    const all = this.build();
    const page = Math.max(1, this.pageNumber ?? 1);
    const offset = (page - 1) * this.perPageCount;
    return {
      total: all.length,
      page,
      perPage: this.perPageCount,
      items: this.entries(all.slice(offset, offset + this.perPageCount), offset),
    };
  }

  private entries(rows: Candidate[], offset: number): Record<string, unknown>[] {
    return rows.map((c, i) =>
      leaderboardEntryResource(c.profile, offset + i + 1, {
        ...(this.metricSlug !== null
          ? { metric: { slug: this.metricSlug, total_xp: c.metricXp ?? 0, current_level: c.metricLevel ?? 0 } }
          : {}),
        ...(c.periodXp !== undefined ? { period_xp: c.periodXp } : {}),
      }),
    );
  }

  private start(): Date | null {
    const now = this.lab.now();
    switch (this.periodName) {
      case "daily":
        return startOfDay(now);
      case "weekly":
        return startOfWeek(now);
      case "monthly":
        return startOfMonth(now);
      default:
        return null;
    }
  }

  private build(): Candidate[] {
    const store = this.lab.store;
    let profiles = store.select("profiles");
    if (this.awardableType !== null) profiles = profiles.filter((p) => p.awardable_type === this.awardableType);
    if (this.excluding) profiles = profiles.filter((p) => p.is_opted_in === true);

    let metric: Row | undefined;
    if (this.metricSlug !== null) {
      metric = this.lab.findBySlug("gamed_metrics", this.metricSlug);
      if (!metric) throw new InvalidArgumentError(`GamedMetric '${this.metricSlug}' not found.`);
    }
    const start = this.start();

    let rows: Candidate[] = profiles.map((profile) => ({ profile }));
    if (metric) {
      const pms = new Map(store.select("profile_metrics", { gamed_metric_id: metric.id }).map((pm) => [Number(pm.profile_id), pm]));
      rows = rows
        .filter((c) => pms.has(c.profile.id))
        .map((c) => {
          const pm = pms.get(c.profile.id)!;
          return { ...c, metricXp: Number(pm.total_xp), metricLevel: Number(pm.current_level) };
        });
    }
    if (start !== null) {
      const earned = this.earned(start, metric);
      rows = rows
        .filter((c) => earned.has(key(c.profile.awardable_type, c.profile.awardable_id)))
        .map((c) => ({ ...c, periodXp: earned.get(key(c.profile.awardable_type, c.profile.awardable_id))! }));
    }

    const order = this.orderKeys(metric !== undefined, start !== null);
    return rows.sort((a, b) => {
      for (const k of order) {
        const d = k(b) - k(a);
        if (d !== 0) return d;
      }
      return a.profile.id - b.profile.id;
    });
  }

  private orderKeys(isMetric: boolean, isPeriod: boolean): ((c: Candidate) => number)[] {
    const achievements = (c: Candidate) => Number(c.profile.achievement_count);
    const prizes = (c: Candidate) => Number(c.profile.prize_count);
    if (isMetric) {
      const xp = (c: Candidate) => (isPeriod ? (c.periodXp ?? 0) : (c.metricXp ?? 0));
      if (this.sortBy === "achievements") return [achievements, xp];
      if (this.sortBy === "prizes") return [prizes, xp];
      return [xp];
    }
    if (isPeriod) {
      if (this.sortBy === "achievements") return [achievements];
      if (this.sortBy === "prizes") return [prizes];
      return [(c) => c.periodXp ?? 0];
    }
    if (this.sortBy === "achievements") return [achievements];
    if (this.sortBy === "prizes") return [prizes];
    return [(c) => Number(c.profile.total_xp)];
  }

  /** XP earned since `start` per subject, from the log; only positive sums. */
  private earned(start: Date, metric: Row | undefined): Map<string, number> {
    if (!this.lab.config.logToDatabase || !this.lab.config.dispatch) {
      throw new PeriodLeaderboardUnavailableError(
        "A period leaderboard is computed from the event log, which is off. Use an all-time board, or turn the event log on.",
      );
    }
    const from = toDb(start);
    const sums = new Map<string, number>();
    for (const log of this.lab.store.select("event_logs", { event_type: "xp_awarded" })) {
      if (String(log.occurred_at) < from) continue;
      if (metric && (log.context as Record<string, unknown> | null)?.gamed_metric_slug !== metric.slug) continue;
      const k = key(log.awardable_type, log.awardable_id);
      sums.set(k, (sums.get(k) ?? 0) + Number(log.amount ?? 0));
    }
    for (const [k, v] of sums) if (!(v > 0)) sums.delete(k);
    return sums;
  }
}

const key = (type: unknown, id: unknown): string => `${String(type)}\u0000${String(id)}`;
