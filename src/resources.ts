/**
 * Rows as laravel-fun-lab's Http/Resources serialise them, key for key, so
 * `@particle-academy/fancy-fun-lab-ui` renders the same JSON whichever backend
 * produced it. These return data; nothing here serves HTTP.
 */
import type { Row, Store } from "./store";
import { toIso } from "./time";

type Json = Record<string, unknown>;
const iso = (v: unknown): string | null => toIso((v as string | null | undefined) ?? null);
const num = (v: unknown): number => Number(v ?? 0);

export function profileResource(p: Row): Json {
  return {
    id: p.id,
    awardable_type: p.awardable_type,
    awardable_id: p.awardable_id,
    is_opted_in: Boolean(p.is_opted_in),
    display_preferences: p.display_preferences ?? null,
    visibility_settings: p.visibility_settings ?? null,
    total_xp: num(p.total_xp),
    achievement_count: num(p.achievement_count),
    prize_count: num(p.prize_count),
    last_activity_at: iso(p.last_activity_at),
    created_at: iso(p.created_at),
    updated_at: iso(p.updated_at),
  };
}

/** A profile's row for one metric (PHP's AwardResource). */
export function profileMetricResource(store: Store, m: Row): Json {
  const metric = store.find("gamed_metrics", Number(m.gamed_metric_id));
  return {
    id: m.id,
    profile_id: m.profile_id,
    gamed_metric_id: m.gamed_metric_id,
    gamed_metric_slug: metric?.slug ?? null,
    gamed_metric_name: metric?.name ?? null,
    total_xp: num(m.total_xp),
    current_level: num(m.current_level),
    created_at: iso(m.created_at),
    updated_at: iso(m.updated_at),
  };
}

export function gamedMetricResource(m: Row): Json {
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    description: m.description ?? null,
    icon: m.icon ?? null,
    active: Boolean(m.active),
    created_at: iso(m.created_at),
    updated_at: iso(m.updated_at),
  };
}

export function metricLevelResource(store: Store, l: Row): Json {
  return {
    id: l.id,
    gamed_metric_id: l.gamed_metric_id,
    gamed_metric_slug: store.find("gamed_metrics", Number(l.gamed_metric_id))?.slug ?? null,
    level: num(l.level),
    xp_threshold: num(l.xp_threshold),
    name: l.name,
    description: l.description ?? null,
    created_at: iso(l.created_at),
    updated_at: iso(l.updated_at),
  };
}

export function achievementResource(a: Row): Json {
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    description: a.description ?? null,
    icon: a.icon ?? null,
    awardable_type: a.awardable_type ?? null,
    meta: a.meta ?? null,
    is_active: Boolean(a.is_active),
    sort_order: num(a.sort_order),
    created_at: iso(a.created_at),
    updated_at: iso(a.updated_at),
  };
}

export function prizeResource(p: Row, remaining: number | null): Json {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ?? null,
    type: p.type ?? null,
    cost_in_points: num(p.cost_in_points),
    inventory_quantity: p.inventory_quantity ?? null,
    remaining_inventory: remaining,
    meta: p.meta ?? null,
    is_active: Boolean(p.is_active),
    sort_order: num(p.sort_order),
    created_at: iso(p.created_at),
    updated_at: iso(p.updated_at),
  };
}

/** An achievement grant, as AwardGrantResource. `granted_at` is the row's created_at, as there. */
export function achievementGrantResource(store: Store, g: Row): Json {
  const a = store.find("achievements", Number(g.achievement_id));
  return {
    grant_type: "achievement",
    id: g.id,
    profile_id: g.profile_id,
    achievement_id: g.achievement_id,
    achievement_slug: a?.slug ?? null,
    achievement_name: a?.name ?? null,
    reason: g.reason ?? null,
    source: g.source ?? null,
    meta: g.meta ?? null,
    granted_at: iso(g.created_at),
  };
}

/** A prize grant, as AwardGrantResource. */
export function prizeGrantResource(store: Store, g: Row): Json {
  const p = store.find("prizes", Number(g.prize_id));
  return {
    grant_type: "prize",
    id: g.id,
    profile_id: g.profile_id,
    prize_id: g.prize_id,
    prize_slug: p?.slug ?? null,
    prize_name: p?.name ?? null,
    status: g.status,
    reason: g.reason ?? null,
    source: g.source ?? null,
    meta: g.meta ?? null,
    granted_at: iso(g.created_at),
  };
}

/** A ranked profile, as LeaderboardEntryResource. `metric` and `period_xp` appear only on those boards. */
export function leaderboardEntryResource(
  p: Row,
  rank: number,
  extra: { metric?: { slug: string; total_xp: number; current_level: number }; period_xp?: number },
): Json {
  const out: Json = {
    rank,
    id: p.id,
    awardable_type: p.awardable_type,
    awardable_id: p.awardable_id,
    total_xp: num(p.total_xp),
    achievement_count: num(p.achievement_count),
    prize_count: num(p.prize_count),
    last_activity_at: iso(p.last_activity_at),
  };
  if (extra.metric) out.metric = extra.metric;
  if (extra.period_xp !== undefined) out.period_xp = Math.trunc(extra.period_xp);
  return out;
}
