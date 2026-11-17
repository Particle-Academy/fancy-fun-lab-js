import type { Row } from "./store";

/** Who receives XP, achievements and prizes: an awardable type ("user", "team") and its id. */
export interface Subject {
  type: string;
  id: number | string;
}

export interface XpAwardedEvent {
  profile: Row;
  profileMetric: Row;
  metric: Row;
  subject: Subject;
  amount: number;
  reason: string | null;
  source: string | null;
  meta: Record<string, unknown>;
}

export interface MetricLevelReachedEvent {
  profile: Row;
  profileMetric: Row;
  metric: Row;
  /** The level crossed. One event per level, in ascending order. */
  level: Row;
  subject: Subject;
  /** The achievements this crossing granted, not ones already held. */
  achievements: Row[];
  totalXp: number;
}

export interface AchievementUnlockedEvent {
  subject: Subject;
  achievement: Row;
  grant: Row;
  reason: string | null;
  source: string | null;
}

export interface PrizeAwardedEvent {
  subject: Subject;
  prize: Row;
  grant: Row;
  reason: string | null;
  source: string | null;
  meta: Record<string, unknown>;
}

export interface AwardGrantedEvent {
  type: "achievement" | "prize";
  subject: Subject;
  grant: Row;
}

export interface CatalogMutatedEvent {
  entityType: string;
  model: Row;
  created: boolean;
}

export interface FunLabEvents {
  "xp.awarded": XpAwardedEvent;
  "metric.level-reached": MetricLevelReachedEvent;
  "achievement.unlocked": AchievementUnlockedEvent;
  "prize.awarded": PrizeAwardedEvent;
  "award.granted": AwardGrantedEvent;
  "catalog.mutated": CatalogMutatedEvent;
}

export type FunLabEventName = keyof FunLabEvents;

type Listener<E> = (event: E) => void;

/** A minimal synchronous emitter. Listeners run in registration order, inside the call that emitted. */
export class Emitter {
  private readonly listeners = new Map<string, Listener<never>[]>();

  on<K extends FunLabEventName>(name: K, fn: Listener<FunLabEvents[K]>): () => void {
    const list = this.listeners.get(name) ?? [];
    list.push(fn as Listener<never>);
    this.listeners.set(name, list);
    return () => {
      const at = list.indexOf(fn as Listener<never>);
      if (at >= 0) list.splice(at, 1);
    };
  }

  emit<K extends FunLabEventName>(name: K, event: FunLabEvents[K]): void {
    for (const fn of [...(this.listeners.get(name) ?? [])]) (fn as Listener<FunLabEvents[K]>)(event);
  }
}
