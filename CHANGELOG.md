# Changelog

All notable changes to this package are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Pre-1.0, breaking changes land in MINOR releases.** The version number is not
promising otherwise until 1.0.

## [Unreleased]

### Changed

- **CI: the lab-certificate gate verifies against the lab's rotated key list.**
  The lab's first signing key is retired: certificates it already issued still
  verify, and nothing new it signs ever can. Consumers do nothing.

## [0.1.1] - 2026-11-17

### Fixed

- **The broadcastable events now carry the payload laravel-fun-lab broadcasts.** `xp.awarded`, `metric.level-reached`, `achievement.unlocked` and `prize.awarded` events gain a `payload` field: the flat object PHP's `broadcastWith()` returns, key for key (`{id, profile_id, gamed_metric_id, gamed_metric_slug, gamed_metric_name, amount, total_xp, current_level, reason, source, occurred_at}` for `xp.awarded`; `{profile_id, gamed_metric_id, gamed_metric_slug, gamed_metric_name, level, level_name, xp_threshold, total_xp, achievements: [{id, slug, name, icon}], occurred_at}` for `metric.level-reached`; the grant payloads for the other two). In 0.1.0 a host could only relay the raw event, whose rows are nested, so `@particle-academy/fancy-fun-lab-ui` rendered `+5 XP in {metric}` and `FunLabLevelUp` the same way. **Consumer action:** if you relay events to a browser, send `event.payload` instead of the event (or your own mapping, which you can now delete). Nothing else changes: every field the events had is still there.
- `xp.awarded` and `metric.level-reached` events gain `occurredAt` (Carbon's ISO form, at emission).

### Added

- `xpAwardedPayload`, `levelReachedPayload`, `achievementUnlockedPayload`, `prizeAwardedPayload` and their types (`XpAwardedPayload`, ...): the serializers `event.payload` uses, for a host that builds or stores events itself.
- Runs the new `fun-lab/events` table (fancy-conformance 0.50.0, 9 rows, goldens exported from the PHP event classes' `broadcastWith()`), on both stores. Test-only.

### Changed

- **Docs:** the README gives the install line (`npm install @particle-academy/fancy-fun-lab`) instead of saying the package is not yet published; 0.1.0 is on npm. No code changed; nothing to do.

## [0.1.0] - 2026-11-17

### Added

- **The engine**, a port of `particle-academy/laravel-fun-lab` 0.8.0: catalog setup with laravel-fun-lab's validation, aliases and upsert-by-slug; XP awards to gamed metrics with the per-action cap, validation steps and opt-out; metric and weighted group levels, each claimed exactly once with a compare-and-set and announced in ascending order, granting the achievements attached to them; achievements held once and prizes until their inventory runs out, with claim and fulfil; `hasLevel` and `levelInfo` (progress from the current level's floor, clamped to 0-100); leaderboards (all-time, daily, weekly, monthly on XP earned in the period, per metric, paged, ties on profile id); analytics over the event log; events; and serialisers producing the PHP API's JSON shapes, so `@particle-academy/fancy-fun-lab-ui` renders either backend.
- **Two stores.** `InMemoryStore`, and `SqliteStore` on Node's built-in `node:sqlite` at `@particle-academy/fancy-fun-lab/sqlite`, in laravel-fun-lab's table layout (`lfl_` prefix, configurable), so a Laravel app's SQLite file and this package's are interchangeable. The package root never imports `node:sqlite`.
- **`slug()` and `headline()`**, Laravel's `Str` as the shared tables pin it.
- **Held to the PHP engine by the shared tables**: all 67 rows of fancy-conformance 0.49.0's `fun-lab/*` suites pass on both stores, on every push.
- Zero runtime dependencies. Node 22+; the SQLite store needs 22.13+.
