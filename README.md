# @particle-academy/fancy-fun-lab

[![Fancified](art/fancified.svg)](https://particle.academy)

**A headless gamification engine for Node.** XP awarded to gamed metrics,
levels and weighted level groups, achievements, prizes with inventory,
leaderboards (all-time, daily, weekly, monthly and per metric) and an event log
with analytics, with **zero runtime dependencies**.

The Node/TypeScript twin of [`particle-academy/laravel-fun-lab`](https://github.com/Particle-Academy/laravel-fun-lab)
(PHP), with [`fancy-fun-lab`](https://github.com/Particle-Academy/fancy-fun-lab-py) (Python) beside it.
All three run the same `fun-lab/*` conformance tables from
[`fancy-conformance`](https://github.com/Particle-Academy/fancy-conformance) in
their own CI, so the same awards give the same levels, boards and log in every
runtime, and [`@particle-academy/fancy-fun-lab-ui`](https://github.com/Particle-Academy/fancy-fun-lab-ui)
renders the same JSON whichever backend produced it.

<!-- fancy-agents-note:start -->
> **For agents.** Every Fancy package, this one included, is listed on the
> Fancy MCP catalog server at `https://ui.particle.academy/mcp` (streamable HTTP, no API key;
> MCP id `fancy-ui`), with install commands and docs. How an agent installs
> and uses this package is in [AGENTS.md](https://github.com/Particle-Academy/fancy-fun-lab-js/blob/main/AGENTS.md).
<!-- fancy-agents-note:end -->

## What it does

- **XP to gamed metrics.** Every kind of XP (combat, crafting, reputation, coins) is a metric, with a per-award cap and opt-out.
- **Levels and weighted level groups.** Each level crossed is claimed exactly once, announced in ascending order, and grants the achievements attached to it.
- **Achievements and prizes.** Achievements are held once; prizes are repeatable until their inventory runs out, then claimed and fulfilled.
- **Leaderboards.** By XP, achievements or prizes; all-time, or daily, weekly and monthly on the XP *earned in the period*; per metric; paged.
- **An event log and analytics.** Counts, totals, active users, completion rates, time series and breakdowns.
- **Events** for every award, level, grant and catalog change, and **the PHP API's JSON shapes** for every entity.
- **Two stores:** in memory, and SQLite on Node's built-in `node:sqlite`, in laravel-fun-lab's own table layout, so a Laravel app's database file and this package's are interchangeable.

## Example

```ts
import { FunLab } from "@particle-academy/fancy-fun-lab";
import { SqliteStore } from "@particle-academy/fancy-fun-lab/sqlite";

const lab = new FunLab({ store: new SqliteStore("game.sqlite") });

lab.setup("gamed-metric", { slug: "combat-xp", name: "Combat XP" });
lab.setup("metric-level", { metric: "combat-xp", level: 2, xp: 100, name: "Apprentice" });
lab.setup("achievement", { slug: "apprentice" });
lab.attachAchievement("apprentice", { metric: "combat-xp", level: 2 });

const ada = { type: "user", id: 1 };
lab.award("combat-xp").to(ada).amount(150).because("defeated the boss").save();

lab.hasAchievement(ada, "apprentice");                 // true
lab.leaderboard().for("user").period("weekly").take(10); // ranked on XP earned this week
```

## Status

Pre-release: not yet published to npm. Node 22 or later; the SQLite store needs
22.13 or later, where `node:sqlite` needs no flag.

## License

MIT
