import { Analytics } from "./analytics";
import { AwardRejectedError, InvalidArgumentError } from "./errors";
import {
  Emitter,
  type FunLabEventName,
  type FunLabEvents,
  type Subject,
} from "./events";
import { Leaderboard } from "./leaderboard";
import {
  achievementUnlockedPayload,
  levelReachedPayload,
  prizeAwardedPayload,
  xpAwardedPayload,
} from "./payloads";
import {
  achievementGrantResource,
  achievementResource,
  gamedMetricResource,
  metricLevelResource,
  prizeGrantResource,
  prizeResource,
  profileMetricResource,
  profileResource,
} from "./resources";
import { SCHEMA, type TableName } from "./schema";
import { InMemoryStore, sameValue, type Row, type Store } from "./store";
import { headline, slug as toSlug } from "./strings";
import { toDb } from "./time";

export interface FunLabConfig {
  /** Largest XP one award may carry. 0 turns the cap off. Default 10000, as `lfl.defaults.max_points_per_action`. */
  maxPointsPerAction: number;
  /** Write events to the event log. Default true, as `lfl.events.log_to_database`. */
  logToDatabase: boolean;
  /** Emit events at all (nothing is logged when false). Default true, as `lfl.events.dispatch`. */
  dispatch: boolean;
}

export interface FunLabOptions {
  store?: Store;
  /** The current time. Inject a frozen clock in tests; periods are computed from it in UTC. */
  clock?: () => Date;
  config?: Partial<FunLabConfig>;
}

/** What a validation step sees. Return `false` or `{ valid: false, message }` to refuse. */
export interface ValidationContext {
  subject: Subject;
  type: "points" | "achievement" | "prize";
  amount: number;
  reason: string | null;
  source: string | null;
  meta: Record<string, unknown>;
}
export type ValidationStep = (
  ctx: ValidationContext,
) => boolean | void | undefined | { valid: boolean; message?: string };

/** The outcome of a grant: a refusal is a result with a message, never an exception. */
export interface GrantResult {
  success: boolean;
  message: string;
  grant: Row | null;
}

export type LevelTarget = { metric: string; group?: undefined } | { group: string; metric?: undefined };

export interface LevelInfo {
  current_level: number;
  total_xp: number;
  next_level_threshold: number | null;
  progress_percentage: number;
}

/** The setup types, their aliases and their fields, as laravel-fun-lab's SetupValidator. */
const SETUP_TYPES: Record<string, string[]> = {
  achievement: ["achievement"],
  "gamed-metric": ["gamed-metric", "metric"],
  "metric-level": ["metric-level", "level"],
  "metric-level-group": ["metric-level-group", "group"],
  "metric-level-group-level": ["metric-level-group-level", "group-level"],
  "metric-level-group-metric": ["metric-level-group-metric", "group-metric"],
  prize: ["prize"],
};

type Rule = { required: boolean; type: string };
const r = (required: boolean, type: string): Rule => ({ required, type });
const SETUP_RULES: Record<string, Record<string, Rule>> = {
  achievement: {
    slug: r(true, "string"),
    name: r(false, "string"),
    description: r(false, "string"),
    icon: r(false, "string"),
    for: r(false, "string"),
    metadata: r(false, "array"),
    active: r(false, "bool"),
    hidden: r(false, "bool"),
    order: r(false, "int"),
  },
  "gamed-metric": {
    slug: r(true, "string"),
    name: r(false, "string"),
    description: r(false, "string"),
    icon: r(false, "string"),
    active: r(false, "bool"),
  },
  "metric-level": {
    metric: r(true, "string"),
    level: r(true, "int"),
    xp: r(true, "int"),
    name: r(false, "string"),
    description: r(false, "string"),
  },
  "metric-level-group": { slug: r(true, "string"), name: r(false, "string"), description: r(false, "string") },
  "metric-level-group-level": {
    group: r(true, "string"),
    level: r(true, "int"),
    xp: r(true, "int"),
    name: r(false, "string"),
    description: r(false, "string"),
  },
  "metric-level-group-metric": { group: r(true, "string"), metric: r(true, "string"), weight: r(false, "float") },
  prize: {
    slug: r(true, "string"),
    name: r(false, "string"),
    description: r(false, "string"),
    type: r(false, "string"),
    cost: r(false, "int|float"),
    inventory: r(false, "int"),
    metadata: r(false, "array"),
    active: r(false, "bool"),
    order: r(false, "int"),
  },
};

/** The PHP model each setup type writes, named in the event log so a shared log reads the same. */
const ENTITY_MODEL: Record<string, string> = {
  "gamed-metric": "LaravelFunLab\\Models\\GamedMetric",
  "metric-level": "LaravelFunLab\\Models\\MetricLevel",
  "metric-level-group": "LaravelFunLab\\Models\\MetricLevelGroup",
  "metric-level-group-level": "LaravelFunLab\\Models\\MetricLevelGroupLevel",
  "metric-level-group-metric": "LaravelFunLab\\Models\\MetricLevelGroupMetric",
  achievement: "LaravelFunLab\\Models\\Achievement",
  prize: "LaravelFunLab\\Models\\Prize",
};

const SETUP_TABLE: Record<string, TableName> = {
  "gamed-metric": "gamed_metrics",
  "metric-level": "metric_levels",
  "metric-level-group": "metric_level_groups",
  "metric-level-group-level": "metric_level_group_levels",
  "metric-level-group-metric": "metric_level_group_metrics",
  achievement: "achievements",
  prize: "prizes",
};

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : typeof v === "object" && Object.keys(v).length === 0);

/** PHP's `$meta` in a log context: [] when empty (that is what the reference writes). */
const logMeta = (m: Record<string, unknown>): unknown => (isEmpty(m) ? [] : m);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** An event object with its flat wire payload attached, so a listener can relay `event.payload` as is. */
function withPayload<E extends object, P>(event: E, serialize: (e: E) => P): E & { payload: P } {
  return Object.assign(event, { payload: serialize(event) });
}

function valueType(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "string") return "string";
  if (v === null) return "null";
  if (typeof v === "object") return "array";
  return typeof v;
}

function typeCompatible(actual: string, expected: string): boolean {
  if (expected.includes("|")) return expected.split("|").some((e) => typeCompatible(actual, e.trim()));
  if (actual === expected) return true;
  return expected === "float" && actual === "int";
}

/**
 * The gamification engine: catalog setup, XP awards, level and group
 * progression, grants, profiles, leaderboards and analytics over one store.
 *
 * Behaviour is laravel-fun-lab's, held to it by the shared `fun-lab/*` tables.
 */
export class FunLab {
  readonly store: Store;
  readonly config: FunLabConfig;
  private readonly clock: () => Date;
  private readonly emitter = new Emitter();
  private readonly validationSteps: ValidationStep[] = [];

  constructor(options: FunLabOptions = {}) {
    this.store = options.store ?? new InMemoryStore();
    this.clock = options.clock ?? (() => new Date());
    this.config = { maxPointsPerAction: 10000, logToDatabase: true, dispatch: true, ...options.config };
  }

  /** The current time, from the injected clock. */
  now(): Date {
    return this.clock();
  }

  /** Listen for an engine event. Returns a function that removes the listener. */
  on<K extends FunLabEventName>(name: K, fn: (event: FunLabEvents[K]) => void): () => void {
    return this.emitter.on(name, fn);
  }

  /** Add a step every award and grant passes through, as AwardValidationPipeline::addStep. */
  addValidationStep(step: ValidationStep): void {
    this.validationSteps.push(step);
  }

  // ===========================================================================
  // Catalog setup
  // ===========================================================================

  /**
   * Create or update a catalog entity, matched on its slug (or metric and level
   * for levels). `a` is `gamed-metric`, `metric-level`, `metric-level-group`,
   * `metric-level-group-level`, `metric-level-group-metric`, `achievement` or
   * `prize` (or an alias). A missing name defaults to the headline of the slug
   * AS GIVEN, so `"Combat XP"` is named "Combat Xp".
   */
  setup(a: string, values: Record<string, unknown> = {}): Row {
    const type = this.validateSetup(a, values);
    const { row, created } = this.dispatchSetup(type, values);
    if (this.config.dispatch) {
      this.event(
        "catalog.mutated",
        { entityType: type, model: row, created },
        {
          event_type: "catalog_mutated",
          entity_type: type,
          entity_model: ENTITY_MODEL[type],
          entity_id: row.id,
          entity_slug: (row.slug as string | undefined) ?? null,
          was_created: created,
          actor_type: null,
          actor_id: null,
          occurred_at: this.iso(),
        },
      );
    }
    return row;
  }

  private validateSetup(a: string, values: Record<string, unknown>): string {
    const type = Object.entries(SETUP_TYPES).find(([canonical, aliases]) => canonical === a || aliases.includes(a))?.[0];
    if (type === undefined) {
      throw new InvalidArgumentError(`Unknown entity type '${a}'. Valid types: ${Object.keys(SETUP_TYPES).join(", ")}`);
    }
    const rules = SETUP_RULES[type]!;
    const unknown = Object.keys(values).filter((k) => !(k in rules));
    if (unknown.length > 0) {
      throw new InvalidArgumentError(
        `LFL::setup('${type}'): Unknown field(s): ${unknown.join(", ")}. Valid fields: ${Object.keys(rules).join(", ")}`,
      );
    }
    for (const [field, rule] of Object.entries(rules)) {
      if (rule.required && !(field in values)) {
        throw new InvalidArgumentError(`LFL::setup('${type}') requires '${field}' in the 'with' array`);
      }
    }
    for (const [field, value] of Object.entries(values)) {
      const rule = rules[field]!;
      if (value === null && !rule.required) continue;
      const actual = valueType(value);
      if (!typeCompatible(actual, rule.type)) {
        throw new InvalidArgumentError(`LFL::setup('${type}'): '${field}' must be ${rule.type}, ${actual} given`);
      }
    }
    return type;
  }

  private dispatchSetup(type: string, w: Record<string, unknown>): { row: Row; created: boolean } {
    const str = (k: string): string | null => (w[k] === undefined || w[k] === null ? null : String(w[k]));
    switch (type) {
      case "gamed-metric": {
        const raw = String(w.slug);
        return this.upsert("gamed_metrics", { slug: toSlug(raw) }, {
          name: str("name") ?? headline(raw),
          description: str("description"),
          icon: str("icon"),
          active: w.active ?? true,
        });
      }
      case "metric-level": {
        const metric = this.findBySlug("gamed_metrics", String(w.metric));
        if (!metric) throw new InvalidArgumentError(`GamedMetric '${String(w.metric)}' not found`);
        return this.upsert("metric_levels", { gamed_metric_id: metric.id, level: Number(w.level) }, {
          xp_threshold: Number(w.xp),
          name: str("name") ?? `Level ${String(w.level)}`,
          description: str("description"),
        });
      }
      case "metric-level-group": {
        const raw = String(w.slug);
        return this.upsert("metric_level_groups", { slug: toSlug(raw) }, {
          name: str("name") ?? headline(raw),
          description: str("description"),
        });
      }
      case "metric-level-group-level": {
        const group = this.findBySlug("metric_level_groups", String(w.group));
        if (!group) throw new InvalidArgumentError(`MetricLevelGroup '${String(w.group)}' not found`);
        return this.upsert("metric_level_group_levels", { metric_level_group_id: group.id, level: Number(w.level) }, {
          xp_threshold: Number(w.xp),
          name: str("name") ?? `Level ${String(w.level)}`,
          description: str("description"),
        });
      }
      case "metric-level-group-metric": {
        const group = this.findBySlug("metric_level_groups", String(w.group));
        if (!group) throw new InvalidArgumentError(`MetricLevelGroup '${String(w.group)}' not found`);
        const metric = this.findBySlug("gamed_metrics", String(w.metric));
        if (!metric) throw new InvalidArgumentError(`GamedMetric '${String(w.metric)}' not found`);
        return this.upsert(
          "metric_level_group_metrics",
          { metric_level_group_id: group.id, gamed_metric_id: metric.id },
          { weight: round2(Number(w.weight ?? 1.0)) },
        );
      }
      case "achievement": {
        const raw = String(w.slug);
        return this.upsert("achievements", { slug: toSlug(raw) }, {
          name: str("name") ?? headline(raw),
          description: str("description"),
          icon: str("icon"),
          awardable_type: str("for"),
          meta: isEmpty(w.metadata) ? null : w.metadata,
          is_active: w.active ?? true,
          is_hidden: w.hidden ?? false,
          sort_order: Number(w.order ?? 0),
        });
      }
      case "prize": {
        const raw = String(w.slug);
        return this.upsert("prizes", { slug: toSlug(raw) }, {
          name: str("name") ?? headline(raw),
          description: str("description"),
          type: str("type") ?? "virtual",
          cost_in_points: round2(Number(w.cost ?? 0)),
          inventory_quantity: w.inventory === undefined || w.inventory === null ? null : Number(w.inventory),
          meta: isEmpty(w.metadata) ? null : w.metadata,
          is_active: w.active ?? true,
          sort_order: Number(w.order ?? 0),
        });
      }
    }
    throw new InvalidArgumentError(`Unknown entity type '${type}'`);
  }

  /**
   * Eloquent's updateOrCreate: insert, or update only the columns that changed
   * (comparing as each column's cast reads them), touching `updated_at` only
   * when something did.
   */
  private upsert(table: TableName, keys: Record<string, unknown>, values: Record<string, unknown>): { row: Row; created: boolean } {
    const now = this.db();
    const existing = this.store.select(table, keys)[0];
    if (!existing) {
      return { row: this.store.insert(table, { ...keys, ...values, created_at: now, updated_at: now }), created: true };
    }
    const kinds = SCHEMA[table];
    const dirty: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!equivalent(kinds[k], existing[k], v)) dirty[k] = v;
    }
    if (Object.keys(dirty).length > 0) this.store.update(table, existing.id, { ...dirty, updated_at: now });
    return { row: this.store.find(table, existing.id)!, created: false };
  }

  /**
   * Attach an achievement to a metric level or a group level: reaching that
   * level grants it. (In PHP this is the level's `achievements()` relation.)
   */
  attachAchievement(achievementSlug: string, target: { metric: string; level: number } | { group: string; level: number }): void {
    const achievement = this.findBySlug("achievements", achievementSlug);
    if (!achievement) throw new InvalidArgumentError(`Achievement '${achievementSlug}' not found`);
    const now = this.db();
    if ("metric" in target) {
      const metric = this.findBySlug("gamed_metrics", target.metric);
      if (!metric) throw new InvalidArgumentError(`GamedMetric '${target.metric}' not found`);
      const level = this.store.select("metric_levels", { gamed_metric_id: metric.id, level: target.level })[0];
      if (!level) throw new InvalidArgumentError("Metric level not found");
      if (this.store.select("achievement_metric_levels", { achievement_id: achievement.id, metric_level_id: level.id }).length === 0) {
        this.store.insert("achievement_metric_levels", {
          achievement_id: achievement.id,
          metric_level_id: level.id,
          created_at: now,
          updated_at: now,
        });
      }
    } else {
      const group = this.findBySlug("metric_level_groups", target.group);
      if (!group) throw new InvalidArgumentError(`MetricLevelGroup '${target.group}' not found`);
      const level = this.store.select("metric_level_group_levels", { metric_level_group_id: group.id, level: target.level })[0];
      if (!level) throw new InvalidArgumentError("Group level not found");
      if (
        this.store.select("achievement_metric_level_group_levels", {
          achievement_id: achievement.id,
          metric_level_group_level_id: level.id,
        }).length === 0
      ) {
        this.store.insert("achievement_metric_level_group_levels", {
          achievement_id: achievement.id,
          metric_level_group_level_id: level.id,
          created_at: now,
          updated_at: now,
        });
      }
    }
  }

  // ===========================================================================
  // Awards and grants
  // ===========================================================================

  /** Start an XP award to a gamed metric. All XP flows through gamed metrics. */
  award(metricSlug: string): AwardXpBuilder {
    return new AwardXpBuilder(this, metricSlug);
  }

  /** Start a grant of an achievement or a prize, by slug (an achievement wins a tie). */
  grant(slug: string): GrantBuilder {
    return new GrantBuilder(this, slug);
  }

  /** @internal The validation pipeline. */
  validate(ctx: ValidationContext): { valid: boolean; message?: string } {
    for (const step of this.validationSteps) {
      const out = step(ctx);
      if (out === false) return { valid: false };
      if (out && typeof out === "object" && out.valid === false) return out;
    }
    return { valid: true };
  }

  /** @internal GamedMetricService::awardXp. */
  awardXp(subject: Subject, metricSlug: string, amount: number, reason: string | null, source: string | null, meta: Record<string, unknown>): Row {
    const metric = this.findBySlug("gamed_metrics", metricSlug);
    if (!metric) throw new InvalidArgumentError(`GamedMetric '${metricSlug}' not found.`);
    if (!metric.active) throw new InvalidArgumentError(`GamedMetric '${String(metric.slug)}' is not active.`);

    const existing = this.findProfile(subject);
    if (existing && !existing.is_opted_in) {
      throw new AwardRejectedError("Recipient has opted out of gamification.", "opted_out");
    }

    const profile = this.getProfile(subject);
    const now = this.db();
    let pm = this.store.select("profile_metrics", { profile_id: profile.id, gamed_metric_id: metric.id })[0];
    if (!pm) {
      pm = this.store.insert("profile_metrics", {
        profile_id: profile.id,
        gamed_metric_id: metric.id,
        total_xp: 0,
        current_level: 1,
        created_at: now,
        updated_at: now,
      });
    }
    this.store.increment("profile_metrics", pm.id, "total_xp", amount, { updated_at: now });
    pm = this.store.find("profile_metrics", pm.id)!;

    this.store.increment("profiles", profile.id, "total_xp", amount, { updated_at: now });
    this.store.update("profiles", profile.id, { last_activity_at: now, updated_at: now });

    pm = this.checkMetricProgression(subject, pm, metric);
    this.checkGroupProgression(subject, metric);

    if (this.config.dispatch) {
      this.event(
        "xp.awarded",
        withPayload(
          {
            profile: this.store.find("profiles", profile.id)!,
            profileMetric: pm,
            metric,
            subject,
            amount,
            reason,
            source,
            meta,
            occurredAt: this.iso(),
          },
          xpAwardedPayload,
        ),
        {
          event_type: "xp_awarded",
          award_type: "points",
          recipient_type: subject.type,
          recipient_id: subject.id,
          gamed_metric_id: metric.id,
          gamed_metric_slug: metric.slug,
          amount,
          total_xp: pm.total_xp,
          current_level: pm.current_level,
          reason,
          source,
          meta: logMeta(meta),
          occurred_at: this.iso(),
        },
      );
    }
    return pm;
  }

  /**
   * Claim the levels newly reached, exactly once, then grant each level's
   * achievements and announce it, in ascending order.
   */
  private checkMetricProgression(subject: Subject, pm: Row, metric: Row): Row {
    const levels = this.store
      .select("metric_levels", { gamed_metric_id: metric.id })
      .sort((a, b) => Number(a.level) - Number(b.level));
    const claim = this.claimLevels("profile_metrics", pm, levels, () => Number(pm.total_xp), (fresh) => (pm = fresh));
    if (claim === null) return pm;
    const profile = this.findProfile(subject)!;
    for (const level of claim) {
      const granted: Row[] = [];
      for (const achievement of this.levelAchievements("achievement_metric_levels", "metric_level_id", level.id)) {
        if (achievement.awardable_type !== null && achievement.awardable_type !== subject.type) continue;
        if (this.hasAchievement(subject, achievement.id)) continue;
        const result = this.grant(String(achievement.slug))
          .to(subject)
          .because(`Reached level ${String(level.level)}: ${String(level.name)}`)
          .from("metric-level-progression")
          .withMeta({ metric_level_id: level.id, gamed_metric_id: metric.id, level: level.level })
          .save();
        if (result.success) granted.push(achievement);
      }
      if (this.config.dispatch) {
        this.emitter.emit(
          "metric.level-reached",
          withPayload(
            {
              profile,
              profileMetric: pm,
              metric,
              level,
              subject,
              achievements: granted,
              totalXp: Number(pm.total_xp),
              occurredAt: this.iso(),
            },
            levelReachedPayload,
          ),
        );
      }
    }
    return pm;
  }

  private checkGroupProgression(subject: Subject, metric: Row): void {
    const groupIds = [
      ...new Set(this.store.select("metric_level_group_metrics", { gamed_metric_id: metric.id }).map((r) => Number(r.metric_level_group_id))),
    ].sort((a, b) => a - b);
    const profile = this.findProfile(subject)!;
    for (const groupId of groupIds) {
      const group = this.store.find("metric_level_groups", groupId);
      if (!group) continue;
      const now = this.db();
      let pmg = this.store.select("profile_metric_groups", { profile_id: profile.id, metric_level_group_id: group.id })[0];
      if (!pmg) {
        pmg = this.store.insert("profile_metric_groups", {
          profile_id: profile.id,
          metric_level_group_id: group.id,
          current_level: 1,
          created_at: now,
          updated_at: now,
        });
      }
      this.checkGroupLevels(subject, pmg, group);
    }
  }

  /** @internal Group progression for one group, a compare-and-set claim as for metrics. */
  checkGroupLevels(subject: Subject, pmg: Row, group: Row): { level_reached: boolean; new_level: number | null; levels_unlocked: Row[] } {
    const totalXp = this.groupTotalXp(subject, group);
    const levels = this.store
      .select("metric_level_group_levels", { metric_level_group_id: group.id })
      .sort((a, b) => Number(a.level) - Number(b.level));
    const claim = this.claimLevels("profile_metric_groups", pmg, levels, () => totalXp, (fresh) => (pmg = fresh));
    if (claim === null) return { level_reached: false, new_level: null, levels_unlocked: [] };
    for (const level of claim) {
      for (const achievement of this.levelAchievements(
        "achievement_metric_level_group_levels",
        "metric_level_group_level_id",
        level.id,
      )) {
        if (achievement.awardable_type !== null && achievement.awardable_type !== subject.type) continue;
        if (this.hasAchievement(subject, achievement.id)) continue;
        this.grant(String(achievement.slug))
          .to(subject)
          .because(`Reached level ${String(level.level)}: ${String(level.name)}`)
          .from("metric-level-group-progression")
          .withMeta({ metric_level_group_level_id: level.id, metric_level_group_id: group.id, level: level.level })
          .save();
      }
    }
    return { level_reached: true, new_level: Number(claim[claim.length - 1]!.level), levels_unlocked: claim };
  }

  /**
   * The compare-and-set claim. The row moves from the level this copy read to
   * the new one only if nobody moved it first; if someone did, the copy is
   * re-read and the levels recomputed from the stored level. A stale copy
   * therefore never re-claims a level already recorded.
   */
  private claimLevels(
    table: "profile_metrics" | "profile_metric_groups",
    row: Row,
    levels: Row[],
    totalXp: () => number,
    refresh: (fresh: Row) => void,
  ): Row[] | null {
    let current = row;
    for (let attempt = 0; attempt < 5; attempt++) {
      const from = Number(current.current_level);
      const xp = totalXp();
      const unlocked = levels.filter((l) => xp >= Number(l.xp_threshold) && Number(l.level) > from);
      if (unlocked.length === 0) return null;
      const to = Number(unlocked[unlocked.length - 1]!.level);
      if (this.store.compareAndSet(table, current.id, "current_level", from, { current_level: to, updated_at: this.db() })) {
        current = this.store.find(table, current.id)!;
        refresh(current);
        return unlocked;
      }
      current = this.store.find(table, current.id)!;
      refresh(current);
    }
    return null;
  }

  private levelAchievements(pivot: TableName, column: string, levelId: number): Row[] {
    const ids = new Set(this.store.select(pivot, { [column]: levelId }).map((p) => Number(p.achievement_id)));
    return this.store
      .select("achievements")
      .filter((a) => ids.has(a.id) && a.is_active === true)
      .sort((a, b) => a.id - b.id);
  }

  /** @internal AwardEngine::grantAchievementInternal. */
  grantAchievement(subject: Subject, slug: string, reason: string | null, source: string | null, meta: Record<string, unknown>): GrantResult {
    if (this.isOptedOut(subject)) return failure("Recipient has opted out of gamification");
    const achievement = this.findBySlug("achievements", slug);
    if (!achievement) return failure(`Achievement '${slug}' not found`);
    if (!achievement.is_active) return failure(`Achievement '${slug}' is not active`);
    const profile = this.getProfile(subject);
    if (this.store.select("achievement_grants", { profile_id: profile.id, achievement_id: achievement.id }).length > 0) {
      return failure(`Achievement '${slug}' already granted`);
    }
    const now = this.db();
    const grant = this.store.insert("achievement_grants", {
      profile_id: profile.id,
      achievement_id: achievement.id,
      reason,
      source,
      meta: isEmpty(meta) ? null : meta,
      granted_at: now,
      created_at: now,
      updated_at: now,
    });
    this.store.increment("profiles", profile.id, "achievement_count", 1, { updated_at: now });
    if (this.config.dispatch) {
      this.event(
        "achievement.unlocked",
        withPayload({ subject, achievement, grant, reason, source }, achievementUnlockedPayload),
        {
          event_type: "achievement_unlocked",
          award_type: "achievement",
          recipient_type: subject.type,
          recipient_id: subject.id,
          achievement_id: achievement.id,
          achievement_slug: achievement.slug,
          achievement_name: achievement.name,
          grant_id: grant.id,
          reason,
          source,
          occurred_at: this.iso(),
        },
      );
      this.emitter.emit("award.granted", { type: "achievement", subject, grant });
    }
    return { success: true, message: "Award granted successfully", grant };
  }

  /** @internal AwardEngine::grantPrizeInternal. */
  grantPrize(subject: Subject, slug: string, reason: string | null, source: string | null, meta: Record<string, unknown>): GrantResult {
    if (this.isOptedOut(subject)) return failure("Recipient has opted out of gamification");
    const prize = this.findBySlug("prizes", slug);
    if (!prize) return failure(`Prize '${slug}' not found`);
    if (!prize.is_active) return failure(`Prize '${slug}' is not active`);
    if (!this.prizeAvailable(prize)) return failure(`Prize '${slug}' is out of inventory`);
    const profile = this.getProfile(subject);
    const now = this.db();
    const grant = this.store.insert("prize_grants", {
      profile_id: profile.id,
      prize_id: prize.id,
      reason,
      source,
      status: "granted",
      granted_at: now,
      claimed_at: null,
      fulfilled_at: null,
      meta: isEmpty(meta) ? null : meta,
      created_at: now,
      updated_at: now,
    });
    this.store.increment("profiles", profile.id, "prize_count", 1, { updated_at: now });
    if (this.config.dispatch) {
      this.event(
        "prize.awarded",
        withPayload({ subject, prize, grant, reason, source, meta }, prizeAwardedPayload),
        {
          event_type: "prize_awarded",
          award_type: "prize",
          recipient_type: subject.type,
          recipient_id: subject.id,
          award_id: grant.id,
          reason,
          source,
          meta: logMeta(meta),
          occurred_at: this.iso(),
        },
      );
      this.emitter.emit("award.granted", { type: "prize", subject, grant });
    }
    return { success: true, message: "Award granted successfully", grant };
  }

  /** @internal Prize::isAvailable: unlimited, or fewer non-cancelled grants than the inventory. */
  prizeAvailable(prize: Row): boolean {
    const remaining = this.remainingInventory(prize);
    return remaining === null || remaining > 0;
  }

  /** @internal Prize::getRemainingInventory. */
  remainingInventory(prize: Row): number | null {
    if (prize.inventory_quantity === null || prize.inventory_quantity === undefined) return null;
    const granted = this.store.select("prize_grants", { prize_id: prize.id }).filter((g) => g.status !== "cancelled").length;
    return Math.max(0, Number(prize.inventory_quantity) - granted);
  }

  /** Move a prize grant to `claimed`. Returns its resource. */
  claimPrize(grantId: number): Record<string, unknown> {
    return this.redeem(grantId, { status: "claimed", claimed_at: this.db() });
  }

  /** Move a prize grant to `fulfilled`. Returns its resource. */
  fulfillPrize(grantId: number): Record<string, unknown> {
    return this.redeem(grantId, { status: "fulfilled", fulfilled_at: this.db() });
  }

  private redeem(grantId: number, values: Record<string, unknown>): Record<string, unknown> {
    if (!this.store.find("prize_grants", grantId)) throw new InvalidArgumentError(`Prize grant ${grantId} not found`);
    this.store.update("prize_grants", grantId, { ...values, updated_at: this.db() });
    return prizeGrantResource(this.store, this.store.find("prize_grants", grantId)!);
  }

  /** Whether the subject holds the achievement (by id or slug). */
  hasAchievement(subject: Subject, achievement: number | string): boolean {
    const profile = this.findProfile(subject);
    if (!profile) return false;
    const id = typeof achievement === "number" ? achievement : this.findBySlug("achievements", achievement)?.id;
    if (id === undefined) return false;
    return this.store.select("achievement_grants", { profile_id: profile.id, achievement_id: id }).length > 0;
  }

  // ===========================================================================
  // Profiles
  // ===========================================================================

  /** The subject's profile, or null if it has none yet. Never creates one. */
  findProfile(subject: Subject): Row | null {
    return this.store.select("profiles", { awardable_type: subject.type, awardable_id: subject.id })[0] ?? null;
  }

  /** The subject's profile, created (opted in) if it has none. */
  getProfile(subject: Subject): Row {
    const existing = this.findProfile(subject);
    if (existing) return existing;
    return this.createProfile(subject, true);
  }

  private createProfile(subject: Subject, optedIn: boolean): Row {
    const now = this.db();
    return this.store.insert("profiles", {
      awardable_type: subject.type,
      awardable_id: subject.id,
      is_opted_in: optedIn,
      display_preferences: null,
      visibility_settings: null,
      total_xp: 0,
      achievement_count: 0,
      prize_count: 0,
      last_activity_at: null,
      created_at: now,
      updated_at: now,
    });
  }

  isOptedOut(subject: Subject): boolean {
    const profile = this.findProfile(subject);
    return profile !== null && !profile.is_opted_in;
  }

  /** Opt the subject out of gamification. With no profile yet, creates an opted-out one. */
  optOut(subject: Subject): true {
    const profile = this.findProfile(subject);
    if (!profile) this.createProfile(subject, false);
    else if (profile.is_opted_in) this.store.update("profiles", profile.id, { is_opted_in: false, updated_at: this.db() });
    return true;
  }

  /** Opt the subject back in (creating its profile if needed). */
  optIn(subject: Subject): true {
    const profile = this.getProfile(subject);
    if (!profile.is_opted_in) this.store.update("profiles", profile.id, { is_opted_in: true, updated_at: this.db() });
    return true;
  }

  // ===========================================================================
  // Levels
  // ===========================================================================

  /**
   * Whether the subject has reached `level` in a metric or a group. Like the
   * reference, this creates the subject's profile if it has none.
   */
  hasLevel(subject: Subject, level: number, target: { metric?: string | undefined; group?: string | undefined }): boolean {
    if (target.metric === undefined && target.group === undefined) {
      throw new InvalidArgumentError("Either 'metric' or 'group' must be specified for hasLevel()");
    }
    if (target.metric !== undefined && target.group !== undefined) {
      throw new InvalidArgumentError("Only one of 'metric' or 'group' can be specified for hasLevel()");
    }
    const profile = this.getProfile(subject);
    if (target.metric !== undefined) {
      const metric = this.findBySlug("gamed_metrics", target.metric);
      if (!metric) return false;
      const pm = this.store.select("profile_metrics", { profile_id: profile.id, gamed_metric_id: metric.id })[0];
      if (!pm) return false;
      if (Number(pm.current_level) >= level) return true;
      const ml = this.store.select("metric_levels", { gamed_metric_id: metric.id, level })[0];
      if (!ml) return Number(pm.current_level) >= level;
      return Number(pm.total_xp) >= Number(ml.xp_threshold);
    }
    const group = this.findBySlug("metric_level_groups", target.group!);
    if (!group) return false;
    const xp = this.groupTotalXp(subject, group);
    const gl = this.store.select("metric_level_group_levels", { metric_level_group_id: group.id, level })[0];
    if (!gl) return false;
    return xp >= Number(gl.xp_threshold);
  }

  /**
   * Current level, XP, next threshold and progress toward it, for a metric or a
   * group. Progress is measured from the CURRENT level's floor and clamped to
   * 0-100: levels at 0, 100 and 300 put 200 XP at 50%, not 66.7%.
   */
  levelInfo(subject: Subject, target: LevelTarget): LevelInfo {
    if (target.group !== undefined) return this.groupLevelInfo(subject, target.group);
    const metric = this.findBySlug("gamed_metrics", target.metric);
    const profile = this.findProfile(subject);
    const pm =
      metric && profile ? this.store.select("profile_metrics", { profile_id: profile.id, gamed_metric_id: metric.id })[0] : undefined;
    if (!metric) return { current_level: 1, total_xp: 0, next_level_threshold: null, progress_percentage: 0 };
    const current = pm ? Number(pm.current_level) : 1;
    const levels = this.store.select("metric_levels", { gamed_metric_id: metric.id });
    const next = nextThreshold(levels, current);
    const xp = pm ? Number(pm.total_xp) : 0;
    const progress = profile && pm ? progressFrom(xp, levels, current, next) : 0;
    return { current_level: current, total_xp: xp, next_level_threshold: next, progress_percentage: progress };
  }

  private groupLevelInfo(subject: Subject, groupSlug: string): LevelInfo {
    const group = this.findBySlug("metric_level_groups", groupSlug);
    if (!group) return { current_level: 1, total_xp: 0, next_level_threshold: null, progress_percentage: 0 };
    const xp = this.groupTotalXp(subject, group);
    const levels = this.store.select("metric_level_group_levels", { metric_level_group_id: group.id });
    const current = this.groupCurrentLevel(subject, group, xp, levels);
    const next = nextThreshold(levels, current);
    return {
      current_level: current,
      total_xp: xp,
      next_level_threshold: next,
      progress_percentage: progressFrom(xp, levels, current, next),
    };
  }

  private groupCurrentLevel(subject: Subject, group: Row, xp: number, levels: Row[]): number {
    const profile = this.findProfile(subject);
    if (!profile) return 1;
    const pmg = this.store.select("profile_metric_groups", { profile_id: profile.id, metric_level_group_id: group.id })[0];
    if (pmg) return Number(pmg.current_level);
    // No stored record: computed, stopping at the first level not reached.
    let current = 1;
    for (const l of [...levels].sort((a, b) => Number(a.level) - Number(b.level))) {
      if (xp >= Number(l.xp_threshold)) current = Number(l.level);
      else break;
    }
    return current;
  }

  /** A group's XP: each metric's XP times its weight, TRUNCATED per metric, then summed. */
  groupTotalXp(subject: Subject, group: Row): number {
    const profile = this.findProfile(subject);
    if (!profile) return 0;
    let total = 0;
    for (const gm of this.store.select("metric_level_group_metrics", { metric_level_group_id: group.id })) {
      const pm = this.store.select("profile_metrics", { profile_id: profile.id, gamed_metric_id: gm.gamed_metric_id })[0];
      if (pm) total += Math.trunc(Number(pm.total_xp) * Number(gm.weight));
    }
    return total;
  }

  // ===========================================================================
  // Reads: boards, analytics, resources
  // ===========================================================================

  /** Start a leaderboard query. */
  leaderboard(): Leaderboard {
    return new Leaderboard(this);
  }

  /** Start an analytics query over the event log. */
  analytics(): Analytics {
    return new Analytics(this);
  }

  /** The subject's profile as the PHP ProfileResource, or null. */
  profileResource(subject: Subject): Record<string, unknown> | null {
    const p = this.findProfile(subject);
    return p ? profileResource(p) : null;
  }

  /** The subject's per-metric XP rows, as the PHP AwardResource. */
  profileMetricResources(subject: Subject): Record<string, unknown>[] {
    const p = this.findProfile(subject);
    return p ? this.store.select("profile_metrics", { profile_id: p.id }).map((m) => profileMetricResource(this.store, m)) : [];
  }

  /** The subject's achievement grants, as the PHP AwardGrantResource. */
  achievementGrantResources(subject: Subject): Record<string, unknown>[] {
    const p = this.findProfile(subject);
    return p ? this.store.select("achievement_grants", { profile_id: p.id }).map((g) => achievementGrantResource(this.store, g)) : [];
  }

  /** The subject's prize grants, as the PHP AwardGrantResource. */
  prizeGrantResources(subject: Subject): Record<string, unknown>[] {
    const p = this.findProfile(subject);
    return p ? this.store.select("prize_grants", { profile_id: p.id }).map((g) => prizeGrantResource(this.store, g)) : [];
  }

  /** The whole catalog, as the PHP resources. */
  catalogResources(): {
    metrics: Record<string, unknown>[];
    levels: Record<string, unknown>[];
    achievements: Record<string, unknown>[];
    prizes: Record<string, unknown>[];
  } {
    return {
      metrics: this.store.select("gamed_metrics").map(gamedMetricResource),
      levels: this.store.select("metric_levels").map((l) => metricLevelResource(this.store, l)),
      achievements: this.store.select("achievements").map(achievementResource),
      prizes: this.store.select("prizes").map((p) => prizeResource(p, this.remainingInventory(p))),
    };
  }

  /** Every group's slug, in id order. */
  groupSlugs(): string[] {
    return this.store.select("metric_level_groups").map((g) => String(g.slug));
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  /** @internal Lookup by slug, exactly as given (setup normalises; lookups do not). */
  findBySlug(table: TableName, slug: string): Row | undefined {
    return this.store.select(table, { slug })[0];
  }

  /** @internal The current time as a stored datetime. */
  db(): string {
    return toDb(this.now());
  }

  private iso(): string {
    return `${this.db().replace(" ", "T")}+00:00`;
  }

  /** Emit an event and, if the log is on, write its row the way EventLog::fromEvent does. */
  private event<K extends FunLabEventName>(name: K, payload: FunLabEvents[K], log: Record<string, unknown>): void {
    if (this.config.logToDatabase) this.writeLog(log);
    this.emitter.emit(name, payload);
  }

  private writeLog(l: Record<string, unknown>): void {
    const now = this.db();
    this.store.insert("event_logs", {
      event_type: l.event_type,
      award_type: l.award_type ?? "system",
      awardable_type: l.recipient_type ?? l.actor_type ?? "system",
      awardable_id: l.recipient_id ?? l.actor_id ?? 0,
      award_id: l.award_id ?? l.grant_id ?? l.entity_id ?? null,
      achievement_slug: l.achievement_slug ?? l.entity_slug ?? null,
      amount: l.amount ?? null,
      reason: l.reason ?? null,
      source: l.source ?? null,
      context: l,
      occurred_at: now,
      created_at: now,
    });
  }
}

function failure(message: string): GrantResult {
  return { success: false, message, grant: null };
}

function nextThreshold(levels: Row[], current: number): number | null {
  const next = levels.filter((l) => Number(l.level) > current).sort((a, b) => Number(a.level) - Number(b.level))[0];
  return next ? Number(next.xp_threshold) : null;
}

function progressFrom(xp: number, levels: Row[], current: number, next: number | null): number {
  const floor = levels.find((l) => Number(l.level) === current);
  const floorXp = floor ? Number(floor.xp_threshold) : 0;
  if (next === null) return 100;
  const required = next - floorXp;
  if (required <= 0) return 100;
  return Math.max(0, Math.min(100, ((xp - floorXp) / required) * 100)) + 0;
}

function equivalent(kind: string | undefined, a: unknown, b: unknown): boolean {
  if (kind === "json") return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (kind === "bool") return (a === null || a === undefined) === (b === null || b === undefined) && Boolean(a) === Boolean(b);
  return sameValue(a, b);
}

/** Fluent XP award, as AwardXpBuilder. */
export class AwardXpBuilder {
  private subject: Subject | null = null;
  private xp = 0;
  private reason: string | null = null;
  private source: string | null = null;
  private meta: Record<string, unknown> = {};

  constructor(
    private readonly lab: FunLab,
    private readonly metricSlug: string,
  ) {}

  to(subject: Subject): this {
    this.subject = subject;
    return this;
  }
  amount(amount: number): this {
    this.xp = amount;
    return this;
  }
  because(reason: string): this {
    this.reason = reason;
    return this;
  }
  /** Alias of because(). */
  for(reason: string): this {
    return this.because(reason);
  }
  from(source: string): this {
    this.source = source;
    return this;
  }
  withMeta(meta: Record<string, unknown>): this {
    this.meta = meta;
    return this;
  }

  /** Award it. Returns the subject's row for this metric (total_xp, current_level). */
  save(): Row {
    if (this.subject === null) throw new InvalidArgumentError("Recipient is required. Use ->to($user) to set the recipient.");
    if (!(this.xp > 0)) throw new InvalidArgumentError("Amount must be greater than 0. Use ->amount(50) to set the XP amount.");
    const cap = this.lab.config.maxPointsPerAction;
    if (cap > 0 && this.xp > cap) {
      throw new AwardRejectedError(`Award amount ${this.xp} exceeds the configured per-action cap of ${cap}.`, "cap_exceeded");
    }
    const v = this.lab.validate({
      subject: this.subject,
      type: "points",
      amount: this.xp,
      reason: this.reason,
      source: this.source,
      meta: this.meta,
    });
    if (!v.valid) throw new AwardRejectedError(v.message ?? "Award rejected by validation pipeline.", "pipeline_rejected");
    return this.lab.awardXp(this.subject, this.metricSlug, this.xp, this.reason, this.source, this.meta);
  }

  /** Alias of save(). */
  grant(): Row {
    return this.save();
  }
}

/** Fluent grant of an achievement or a prize, as GrantBuilder. */
export class GrantBuilder {
  private subject: Subject | null = null;
  private reason: string | null = null;
  private source: string | null = null;
  private meta: Record<string, unknown> = {};
  private entity: "achievement" | "prize" | null;

  constructor(
    private readonly lab: FunLab,
    private readonly slug: string,
  ) {
    this.entity = this.detect();
  }

  private detect(): "achievement" | "prize" | null {
    if (this.lab.findBySlug("achievements", this.slug)) return "achievement";
    if (this.lab.findBySlug("prizes", this.slug)) return "prize";
    return null;
  }

  to(subject: Subject): this {
    this.subject = subject;
    return this;
  }
  because(reason: string): this {
    this.reason = reason;
    return this;
  }
  /** Alias of because(). */
  for(reason: string): this {
    return this.because(reason);
  }
  from(source: string): this {
    this.source = source;
    return this;
  }
  withMeta(meta: Record<string, unknown>): this {
    this.meta = meta;
    return this;
  }

  /** Grant it. A refusal is `{ success: false, message }`, never an exception. */
  save(): GrantResult {
    if (this.subject === null) throw new InvalidArgumentError("Recipient is required. Use ->to($user) to set the recipient.");
    this.entity ??= this.detect();
    if (this.entity === null) return failure(`No Achievement or Prize found with slug '${this.slug}'`);
    const v = this.lab.validate({
      subject: this.subject,
      type: this.entity,
      amount: 0,
      reason: this.reason,
      source: this.source,
      meta: this.meta,
    });
    if (!v.valid) return failure(v.message ?? "Validation failed");
    return this.entity === "achievement"
      ? this.lab.grantAchievement(this.subject, this.slug, this.reason, this.source, this.meta)
      : this.lab.grantPrize(this.subject, this.slug, this.reason, this.source, this.meta);
  }

  /** Alias of save(). */
  grant(): GrantResult {
    return this.save();
  }
}
