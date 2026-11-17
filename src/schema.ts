/**
 * The tables, with laravel-fun-lab's migration layout: the same names (before
 * the configurable prefix, `lfl_` by default) and the same columns. Both stores
 * read this, and the SQLite store creates exactly these, so a Laravel app's
 * database and this package's are interchangeable.
 *
 * Column kinds decide how a value is stored and read back:
 * - `int`, `decimal`: numbers (`decimal` columns hold two places).
 * - `text`: strings.
 * - `bool`: booleans (0/1 in SQLite).
 * - `json`: any JSON value (TEXT in SQLite).
 * - `datetime`: `Y-m-d H:i:s` strings in UTC.
 */
export type ColumnKind = "int" | "decimal" | "text" | "bool" | "json" | "datetime";

export type TableName =
  | "gamed_metrics"
  | "metric_levels"
  | "metric_level_groups"
  | "metric_level_group_levels"
  | "metric_level_group_metrics"
  | "achievements"
  | "prizes"
  | "achievement_metric_levels"
  | "achievement_metric_level_group_levels"
  | "achievement_prizes"
  | "profiles"
  | "profile_metrics"
  | "profile_metric_groups"
  | "achievement_grants"
  | "prize_grants"
  | "event_logs";

const ts = { created_at: "datetime", updated_at: "datetime" } as const;

export const SCHEMA: Record<TableName, Record<string, ColumnKind>> = {
  gamed_metrics: { slug: "text", name: "text", description: "text", icon: "text", active: "bool", ...ts },
  metric_levels: {
    gamed_metric_id: "int",
    level: "int",
    xp_threshold: "int",
    name: "text",
    description: "text",
    ...ts,
  },
  metric_level_groups: { slug: "text", name: "text", description: "text", ...ts },
  metric_level_group_levels: {
    metric_level_group_id: "int",
    level: "int",
    xp_threshold: "int",
    name: "text",
    description: "text",
    ...ts,
  },
  metric_level_group_metrics: { metric_level_group_id: "int", gamed_metric_id: "int", weight: "decimal", ...ts },
  achievements: {
    slug: "text",
    name: "text",
    description: "text",
    icon: "text",
    awardable_type: "text",
    meta: "json",
    is_active: "bool",
    is_hidden: "bool",
    sort_order: "int",
    ...ts,
  },
  prizes: {
    slug: "text",
    name: "text",
    description: "text",
    type: "text",
    cost_in_points: "decimal",
    inventory_quantity: "int",
    meta: "json",
    is_active: "bool",
    sort_order: "int",
    ...ts,
  },
  achievement_metric_levels: { achievement_id: "int", metric_level_id: "int", ...ts },
  achievement_metric_level_group_levels: { achievement_id: "int", metric_level_group_level_id: "int", ...ts },
  achievement_prizes: { achievement_id: "int", prize_id: "int", ...ts },
  profiles: {
    awardable_type: "text",
    awardable_id: "int",
    is_opted_in: "bool",
    display_preferences: "json",
    visibility_settings: "json",
    total_xp: "int",
    achievement_count: "int",
    prize_count: "int",
    last_activity_at: "datetime",
    ...ts,
  },
  profile_metrics: { profile_id: "int", gamed_metric_id: "int", total_xp: "int", current_level: "int", ...ts },
  profile_metric_groups: { profile_id: "int", metric_level_group_id: "int", current_level: "int", ...ts },
  achievement_grants: {
    profile_id: "int",
    achievement_id: "int",
    reason: "text",
    source: "text",
    meta: "json",
    granted_at: "datetime",
    ...ts,
  },
  prize_grants: {
    profile_id: "int",
    prize_id: "int",
    reason: "text",
    source: "text",
    status: "text",
    granted_at: "datetime",
    claimed_at: "datetime",
    fulfilled_at: "datetime",
    meta: "json",
    ...ts,
  },
  event_logs: {
    event_type: "text",
    award_type: "text",
    awardable_type: "text",
    awardable_id: "int",
    award_id: "int",
    achievement_slug: "text",
    amount: "decimal",
    reason: "text",
    source: "text",
    context: "json",
    occurred_at: "datetime",
    created_at: "datetime",
  },
};

/** Unique keys, as in the migrations. The SQLite store creates them as indexes. */
export const UNIQUE: Partial<Record<TableName, string[][]>> = {
  gamed_metrics: [["slug"]],
  metric_levels: [["gamed_metric_id", "level"]],
  metric_level_groups: [["slug"]],
  metric_level_group_levels: [["metric_level_group_id", "level"]],
  metric_level_group_metrics: [["metric_level_group_id", "gamed_metric_id"]],
  achievements: [["slug"]],
  prizes: [["slug"]],
  achievement_metric_levels: [["achievement_id", "metric_level_id"]],
  achievement_metric_level_group_levels: [["achievement_id", "metric_level_group_level_id"]],
  achievement_prizes: [["achievement_id", "prize_id"]],
  profiles: [["awardable_type", "awardable_id"]],
  profile_metrics: [["profile_id", "gamed_metric_id"]],
  profile_metric_groups: [["profile_id", "metric_level_group_id"]],
  achievement_grants: [["profile_id", "achievement_id"]],
};
