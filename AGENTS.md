# Using @particle-academy/fancy-fun-lab

A headless gamification engine for Node: XP, levels, achievements, prizes,
leaderboards and an event log. The Node twin of the PHP
`particle-academy/laravel-fun-lab`; both run the same `fun-lab/*` conformance
tables, so the same calls give the same answers in either runtime.

## Install

```bash
npm install @particle-academy/fancy-fun-lab
```

Zero runtime dependencies. Node 22+; the SQLite store needs Node 22.13+
(`node:sqlite`, which prints an ExperimentalWarning on Node 22).

**Finding it on the Fancy MCP catalog server.** Every Fancy package is listed
at `https://ui.particle.academy/mcp` (streamable HTTP, no API key, MCP id
`fancy-ui`). Search the backend packages for "gamification" to find this
package, its PHP and Python twins, and `@particle-academy/fancy-fun-lab-ui`,
the React surfaces that render this package's JSON. (Pre-release: the listing
appears when 0.1.0 is published.)

## Essentials

```ts
import { FunLab, InMemoryStore } from "@particle-academy/fancy-fun-lab";
import { SqliteStore } from "@particle-academy/fancy-fun-lab/sqlite";

const lab = new FunLab({
  store: new SqliteStore("game.sqlite"), // default: new InMemoryStore()
  clock: () => new Date(),               // inject a frozen clock in tests
  config: { maxPointsPerAction: 10000, logToDatabase: true, dispatch: true },
});
```

A **subject** is whoever earns: `{ type: "user", id: 42 }`. The engine never
looks one up; the type is a label (it is stored as the awardable type).

**Catalog**, upserted by slug (a second call updates in place):

```ts
lab.setup("gamed-metric", { slug: "combat-xp", name: "Combat XP" });
lab.setup("metric-level", { metric: "combat-xp", level: 2, xp: 100, name: "Apprentice" });
lab.setup("metric-level-group", { slug: "power" });
lab.setup("metric-level-group-metric", { group: "power", metric: "combat-xp", weight: 0.5 });
lab.setup("metric-level-group-level", { group: "power", level: 2, xp: 50 });
lab.setup("achievement", { slug: "apprentice", for: "user", hidden: false, metadata: { tier: 1 } });
lab.setup("prize", { slug: "free-month", type: "feature_unlock", cost: 500, inventory: 100 });
lab.attachAchievement("apprentice", { metric: "combat-xp", level: 2 }); // or { group, level }
```

Aliases: `metric`, `level`, `group`, `group-level`, `group-metric`. Unknown
types, unknown fields and wrong types throw `InvalidArgumentError`.

**XP** (the only way to give XP is to a gamed metric):

```ts
const row = lab.award("combat-xp").to(ada).amount(50).because("quest").from("quests").withMeta({ quest: 7 }).save();
row.total_xp; row.current_level;
```

Refusals throw: `InvalidArgumentError` for an amount of 0 or less, an unknown
or inactive metric; `AwardRejectedError` with `kind` `cap_exceeded`,
`pipeline_rejected` or `opted_out`.

**Grants** return a result and never throw for a refusal:

```ts
lab.grant("apprentice").to(ada).because("welcome").save(); // { success, message, grant }
lab.claimPrize(grantId); lab.fulfillPrize(grantId);
```

**Reads:**

```ts
lab.hasLevel(ada, 2, { metric: "combat-xp" });
lab.levelInfo(ada, { metric: "combat-xp" }); // { current_level, total_xp, next_level_threshold, progress_percentage }
lab.hasAchievement(ada, "apprentice");
lab.leaderboard().for("user").by("xp").period("weekly").metric("combat-xp").perPage(20).page(1).paginate();
lab.analytics().byType("points").period("monthly").total();
lab.profileResource(ada); lab.catalogResources();   // the PHP API's JSON shapes
lab.on("metric.level-reached", (e) => { /* e.level, e.achievements, e.subject */ });
lab.addValidationStep((ctx) => ctx.amount > 500 ? { valid: false, message: "too much" } : undefined);
```

Events: `xp.awarded`, `metric.level-reached` (once per level crossed,
ascending), `achievement.unlocked`, `prize.awarded`, `award.granted`,
`catalog.mutated`.

**Relay `event.payload`, not the event.** The four broadcastable events
(`xp.awarded`, `metric.level-reached`, `achievement.unlocked`, `prize.awarded`)
carry `payload`: the flat object laravel-fun-lab broadcasts over Echo, which
`@particle-academy/fancy-fun-lab-ui` reads (`feedItemFromEcho`, `FunLabXpFeed`,
`FunLabLevelUp`). The event's other fields are raw rows; sending those makes
the UI render `+5 XP in {metric}`.

```ts
lab.on("xp.awarded", (e) => socket.emit("xp.awarded", e.payload));
```

The same serializers are exported: `xpAwardedPayload(e)`,
`levelReachedPayload(e)`, `achievementUnlockedPayload(e)`,
`prizeAwardedPayload(e)`, with their types.

## Traps

- **Period boards need the event log.** `period("weekly")` ranks on XP earned
  since Monday 00:00 UTC, read from the log. With `logToDatabase` or
  `dispatch` false it throws `PeriodLeaderboardUnavailableError` rather than
  returning an empty board. All-time boards need no log.
- **Default names keep Laravel's quirks.** A missing `name` is the headline of
  the slug as given: `"Combat XP"` becomes "Combat Xp", `"XPBoost"` becomes
  "X P Boost". Pass `name` when it matters. Slugs drop non-Latin scripts
  entirely (`"日本語"` slugs to `""`), so give such entities an ASCII slug.
- **Lookups are exact; setup normalises.** `setup` stores `"Combat XP"` as
  `combat-xp`, and every later call must use `combat-xp`.
- **A setup call replaces the optional fields it omits.** Setting up an
  existing metric without `description` clears its description, as the PHP
  engine's `updateOrCreate` does.
- **Group XP truncates per metric.** Two metrics at weight 0.5 with 7 XP each
  give 6 (3 + 3), not 7. Weights are stored to two decimal places.
- **`hasLevel` creates the subject's profile** if it has none, as the reference
  does; `levelInfo` and the resources never do.
- **A level 1 above zero** still starts a new profile at level 1; progress
  below that floor reads 0%.
- **`timeSeries("week")`** follows SQLite's `%Y-%W` and is not part of the
  shared contract (the PHP engine gives a different week on Postgres).
- **Times are UTC.** Periods, and every stored datetime (`Y-m-d H:i:s`).
