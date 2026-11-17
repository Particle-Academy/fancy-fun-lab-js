import { describe, expect, it } from "vitest";

import {
  formatSummary,
  loadSuite,
  runTable,
  suiteVersion,
  type ConformanceCase,
} from "@particle-academy/fancy-conformance";

import { InMemoryStore, type Store } from "../src/index";
import { SqliteStore } from "../src/sqlite";
import { runScenario, runStringCase } from "./scenario";

/**
 * The fun-lab/* tables, run against THIS side, on BOTH stores.
 *
 * laravel-fun-lab (the reference the goldens were exported from) and the
 * Python twin fancy-fun-lab run the identical rows from the identical files.
 * Three runtimes read one table, so a divergence is a red build in whichever
 * one drifted.
 *
 * Loaded from the INSTALLED package, never a relative path to a sibling
 * checkout: a harness that hard-codes ../../<repo>/ works in exactly one
 * directory layout and silently no-ops everywhere else, CI included.
 */

/** Moved deliberately, never automatically. A pin that follows disk asserts nothing. */
const PINNED_SUITE_VERSION = "0.50.0";

const SUITES: Record<string, number> = {
  "fun-lab/strings": 21,
  "fun-lab/progression": 17,
  "fun-lab/grants": 10,
  "fun-lab/leaderboard": 11,
  "fun-lab/analytics": 8,
  "fun-lab/events": 9,
};

const STORES: Record<string, () => Store> = {
  memory: () => new InMemoryStore(),
  sqlite: () => new SqliteStore(":memory:"),
};

function runCase(c: ConformanceCase, makeStore: () => Store): unknown {
  if (c.fn === "slug" || c.fn === "headline") return runStringCase(c.fn, String(c.input.value));
  if (c.fn === "scenario") return runScenario(c.input, makeStore);
  if (c.fn === "broadcasts") return runScenario(c.input, makeStore, true);
  throw new Error(`case ${c.id} calls unimplemented fn ${String(c.fn)}`);
}

it("pins the fixture version and finds every row", () => {
  // The vacuity guard: a suite that resolves, returns nothing and reports
  // "0 failed" reads exactly like full coverage.
  expect(suiteVersion()).toBe(PINNED_SUITE_VERSION);
  for (const [suite, rows] of Object.entries(SUITES)) {
    expect(loadSuite(suite).cases.length, suite).toBeGreaterThanOrEqual(rows);
  }
});

for (const [storeName, makeStore] of Object.entries(STORES)) {
  describe(`on the ${storeName} store`, () => {
    for (const suite of Object.keys(SUITES)) {
      it(`agrees with ${suite}`, () => {
        const summary = runTable(suite, (c) => runCase(c, makeStore), { language: "node" });
        // Printed unconditionally, pass or fail. A summary shown only on
        // failure cannot tell anyone the suite ran at all.
        console.info(`\n[${storeName}] ${formatSummary(summary)}`);
        expect(summary.ok, formatSummary(summary)).toBe(true);
        // Every row RAN and passed: "ok" over zero rows would also be true.
        expect(summary.passed, formatSummary(summary)).toBe(SUITES[suite]);
      });
    }
  });
}
