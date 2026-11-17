/**
 * @particle-academy/fancy-fun-lab: a headless gamification engine, the
 * Node/TypeScript twin of particle-academy/laravel-fun-lab.
 *
 * The SQLite store is on the `./sqlite` subpath, so this entry never imports
 * `node:sqlite`.
 */
export {
  FunLab,
  AwardXpBuilder,
  GrantBuilder,
  type FunLabConfig,
  type FunLabOptions,
  type GrantResult,
  type LevelInfo,
  type LevelTarget,
  type ValidationContext,
  type ValidationStep,
} from "./engine";
export { Leaderboard, type LeaderboardPage } from "./leaderboard";
export { Analytics, type SeriesPoint } from "./analytics";
export {
  Emitter,
  type Subject,
  type FunLabEvents,
  type FunLabEventName,
  type XpAwardedEvent,
  type MetricLevelReachedEvent,
  type AchievementUnlockedEvent,
  type PrizeAwardedEvent,
  type AwardGrantedEvent,
  type CatalogMutatedEvent,
} from "./events";
export { InvalidArgumentError, AwardRejectedError, PeriodLeaderboardUnavailableError } from "./errors";
export { InMemoryStore, type Store, type Row } from "./store";
export { SCHEMA, UNIQUE, type TableName, type ColumnKind } from "./schema";
export { slug, headline, ascii, title } from "./strings";
export {
  profileResource,
  profileMetricResource,
  gamedMetricResource,
  metricLevelResource,
  achievementResource,
  prizeResource,
  achievementGrantResource,
  prizeGrantResource,
  leaderboardEntryResource,
} from "./resources";
