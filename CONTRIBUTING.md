# Contributing

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

This file describes **this package's code**. Process rules (publishing,
versioning, backports) live in the envelope's rules and are deliberately not
repeated here.

## What this package is

A **port** of `particle-academy/laravel-fun-lab`, not a redesign. Behaviour is
settled by the shared `fun-lab/*` tables in `fancy-conformance`, whose goldens
are exported from the PHP engine; where a table is silent, the PHP engine's
source is the reference (`src/Services/*`, `src/Builders/*`,
`src/Http/Resources/*`). The Python twin `fancy-fun-lab` is a port of the same
thing with the same shape.

## Layout

| file | what |
|---|---|
| `src/engine.ts` | `FunLab`: setup, awards, grants, metric and group progression, profiles, levels |
| `src/leaderboard.ts`, `src/analytics.ts` | the read builders |
| `src/resources.ts` | rows as the PHP Http/Resources serialise them |
| `src/store.ts`, `src/schema.ts` | the store contract, `InMemoryStore`, the table layout |
| `src/sqlite.ts` | `SqliteStore`, the `./sqlite` subpath, the ONLY importer of `node:sqlite` |
| `src/strings.ts` | `slug()` / `headline()`, Laravel's `Str` |
| `tests/scenario.ts` | the conformance adapter, a mirror of laravel-fun-lab's `tests/Conformance/ScenarioRunner.php` |

## Testing

```bash
npm test            # vitest: the fun-lab/* tables on BOTH stores, plus unit tests
npm run lint        # tsc --noEmit
npm run build && npm run check:dist   # load the BUILT package, ESM and CJS
```

The conformance test asserts every row ran, not just that none failed, and pins
the fixture version (`PINNED_SUITE_VERSION`). Moving the pin is a deliberate
commit: re-run the tables against the new version first.

## Invariants

- **Zero runtime dependencies.** Anything new needs the owner's approval.
- **Levels are claimed with `Store.compareAndSet`**, metric and group alike. A
  claim that reads, decides and writes lets two awards announce the same level.
- **Event order is the reference's**: within an award, each level's
  `achievement.unlocked` / `award.granted` come before its
  `metric.level-reached`, group grants after all metric levels, and
  `xp.awarded` last. The tables compare the order.
- **Log rows are the reference's byte for byte**: `context.meta` is `[]` when
  empty, `entity_model` names the PHP model class, a catalog row's slug is in
  `achievement_slug`, and its awardable is `system` / `0`. A log shared with a
  Laravel app must read the same in both.
- **`updated_at` moves only when Eloquent's would**: an upsert that changes
  nothing touches nothing; increments and claims touch the row.
- **Refusal messages are the reference's word for word**, PHP-isms included
  (`Use ->to($user)`). The tables compare them.

## Traps

- **tsup strips `node:` from imports by default.** For `node:sqlite` that
  produces an import of an npm package called `sqlite`; `removeNodeProtocol:
  false` is set on the sqlite entry, and `check:dist` fails if it regresses.
  The source tests cannot see this.
- **`deepEquals` in the conformance loader counts keys, including ones whose
  value is `undefined`, and tells `-0` from `0`.** The adapter JSON-round-trips
  its output for that reason; keep it.
- **A JS number cannot say "float".** The PHP validator refuses `xp: 100.0`
  (a float) where an int is required; this port sees `100` and accepts it.
