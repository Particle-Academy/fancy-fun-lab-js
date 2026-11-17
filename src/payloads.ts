/**
 * The broadcast payloads: what laravel-fun-lab's `broadcastWith()` returns for
 * each broadcastable event, key for key and type for type. This is the JSON a
 * Laravel Echo listener receives and `@particle-academy/fancy-fun-lab-ui` reads
 * (`feedItemFromEcho`, `FunLabXpFeed`, `FunLabLevelUp`), so a host that relays
 * these over its own socket feeds the UI exactly as a Laravel backend would.
 *
 * Pinned by the shared `fun-lab/events` table. Every event object the engine
 * emits also carries its payload as `event.payload`; these functions are the
 * same serializers, for a host that builds or stores events itself.
 */
import type {
  AchievementUnlockedEvent,
  MetricLevelReachedEvent,
  PrizeAwardedEvent,
  XpAwardedEvent,
} from "./events";
import { toIso } from "./time";

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => toIso((v as string | null | undefined) ?? null);

/** `xp.awarded`, as `XpAwarded::broadcastWith()`. */
export interface XpAwardedPayload {
  /** The profile's row for this metric (the profile-metric id), the same on every award to it. */
  id: number;
  profile_id: number;
  gamed_metric_id: number;
  gamed_metric_slug: string;
  gamed_metric_name: string;
  amount: number;
  /** The metric's XP after this award. */
  total_xp: number;
  /** The metric's level after this award, levels crossed by it included. */
  current_level: number;
  reason: string | null;
  source: string | null;
  occurred_at: string;
}

/** `metric.level-reached`, as `MetricLevelReached::broadcastWith()`. */
export interface LevelReachedPayload {
  profile_id: number;
  gamed_metric_id: number;
  gamed_metric_slug: string;
  gamed_metric_name: string;
  level: number;
  level_name: string | null;
  xp_threshold: number;
  total_xp: number;
  /** What this crossing granted, not what the profile already held. Empty when nothing. */
  achievements: { id: number; slug: string; name: string; icon: string | null }[];
  occurred_at: string;
}

/** `achievement.unlocked`, as `AchievementUnlocked::broadcastWith()`. */
export interface AchievementUnlockedPayload {
  grant_type: "achievement";
  /** The achievement grant's id. */
  id: number;
  profile_id: number;
  achievement_id: number;
  achievement_slug: string;
  achievement_name: string;
  achievement_icon: string | null;
  reason: string | null;
  source: string | null;
  granted_at: string | null;
}

/** `prize.awarded`, as `PrizeAwarded::broadcastWith()`. */
export interface PrizeAwardedPayload {
  grant_type: "prize";
  /** The prize grant's id. */
  id: number;
  profile_id: number;
  prize_id: number;
  prize_slug: string;
  prize_name: string;
  status: string;
  reason: string | null;
  source: string | null;
  granted_at: string | null;
}

export function xpAwardedPayload(e: Omit<XpAwardedEvent, "payload">): XpAwardedPayload {
  return {
    id: num(e.profileMetric.id),
    profile_id: num(e.profileMetric.profile_id),
    gamed_metric_id: num(e.metric.id),
    gamed_metric_slug: String(e.metric.slug),
    gamed_metric_name: String(e.metric.name),
    amount: num(e.amount),
    total_xp: num(e.profileMetric.total_xp),
    current_level: num(e.profileMetric.current_level),
    reason: e.reason ?? null,
    source: e.source ?? null,
    occurred_at: e.occurredAt,
  };
}

export function levelReachedPayload(e: Omit<MetricLevelReachedEvent, "payload">): LevelReachedPayload {
  return {
    profile_id: num(e.profile.id),
    gamed_metric_id: num(e.metric.id),
    gamed_metric_slug: String(e.metric.slug),
    gamed_metric_name: String(e.metric.name),
    level: num(e.level.level),
    level_name: str(e.level.name),
    xp_threshold: num(e.level.xp_threshold),
    total_xp: num(e.totalXp),
    achievements: e.achievements.map((a) => ({
      id: num(a.id),
      slug: String(a.slug),
      name: String(a.name),
      icon: str(a.icon),
    })),
    occurred_at: e.occurredAt,
  };
}

export function achievementUnlockedPayload(e: Omit<AchievementUnlockedEvent, "payload">): AchievementUnlockedPayload {
  return {
    grant_type: "achievement",
    id: num(e.grant.id),
    profile_id: num(e.grant.profile_id),
    achievement_id: num(e.achievement.id),
    achievement_slug: String(e.achievement.slug),
    achievement_name: String(e.achievement.name),
    achievement_icon: str(e.achievement.icon),
    reason: e.reason ?? null,
    source: e.source ?? null,
    // PHP reads the grant's created_at here, not granted_at.
    granted_at: iso(e.grant.created_at),
  };
}

export function prizeAwardedPayload(e: Omit<PrizeAwardedEvent, "payload">): PrizeAwardedPayload {
  return {
    grant_type: "prize",
    id: num(e.grant.id),
    profile_id: num(e.grant.profile_id),
    prize_id: num(e.prize.id),
    prize_slug: String(e.prize.slug),
    prize_name: String(e.prize.name),
    status: String(e.grant.status),
    reason: e.reason ?? null,
    source: e.source ?? null,
    granted_at: iso(e.grant.granted_at),
  };
}
