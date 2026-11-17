# Changelog

All notable changes to this package are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Pre-1.0, breaking changes land in MINOR releases.** The version number is not
promising otherwise until 1.0.

## [Unreleased]

## [0.1.0] - 2026-11-17

### Added

- **The engine**, a port of `particle-academy/laravel-fun-lab` 0.8.0: catalog setup with laravel-fun-lab's validation, aliases and upsert-by-slug; XP awards to gamed metrics with the per-action cap, validation steps and opt-out; metric and weighted group levels, each claimed exactly once with a compare-and-set and announced in ascending order, granting the achievements attached to them; achievements held once and prizes until their inventory runs out, with claim and fulfil; `hasLevel` and `levelInfo` (progress from the current level's floor, clamped to 0-100); leaderboards (all-time, daily, weekly, monthly on XP earned in the period, per metric, paged, ties on profile id); analytics over the event log; events; and serialisers producing the PHP API's JSON shapes, so `@particle-academy/fancy-fun-lab-ui` renders either backend.
- **Two stores.** `InMemoryStore`, and `SqliteStore` on Node's built-in `node:sqlite` at `@particle-academy/fancy-fun-lab/sqlite`, in laravel-fun-lab's table layout (`lfl_` prefix, configurable), so a Laravel app's SQLite file and this package's are interchangeable. The package root never imports `node:sqlite`.
- **`slug()` and `headline()`**, Laravel's `Str` as the shared tables pin it.
- **Held to the PHP engine by the shared tables**: all 67 rows of fancy-conformance 0.49.0's `fun-lab/*` suites pass on both stores, on every push.
- Zero runtime dependencies. Node 22+; the SQLite store needs 22.13+.
