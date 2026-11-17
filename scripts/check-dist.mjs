// Load the BUILT package the way a consumer does, both entry points, ESM and
// CJS, and run one award through it. Run after `npm run build` (CI does).
//
// It exists because the source tests passed while the build was broken: tsup
// stripped `node:` from `node:sqlite`, so dist/sqlite imported an npm package
// called `sqlite` and failed for every consumer. Only loading dist catches that.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const fail = (m) => {
  console.error(`check-dist: ${m}`);
  process.exit(1);
};

for (const f of ["dist/index.js", "dist/index.cjs"]) {
  if (/["']node:sqlite["']/.test(readFileSync(f, "utf8"))) fail(`${f} imports node:sqlite; the root entry must not`);
}

const esm = await import(new URL("../dist/index.js", import.meta.url));
const esmSqlite = await import(new URL("../dist/sqlite.js", import.meta.url));
const require = createRequire(import.meta.url);
const cjs = require("../dist/index.cjs");
const cjsSqlite = require("../dist/sqlite.cjs");

for (const [label, root, sqlite] of [["esm", esm, esmSqlite], ["cjs", cjs, cjsSqlite]]) {
  const lab = new root.FunLab({ store: new sqlite.SqliteStore(":memory:"), clock: () => new Date("2026-11-18T12:00:00Z") });
  lab.setup("gamed-metric", { slug: "combat" });
  lab.setup("metric-level", { metric: "combat", level: 2, xp: 10 });
  const pm = lab.award("combat").to({ type: "user", id: 1 }).amount(15).save();
  if (pm.total_xp !== 15 || pm.current_level !== 2) fail(`${label}: award returned ${JSON.stringify(pm)}`);
  if (root.headline("Combat XP") !== "Combat Xp") fail(`${label}: headline`);
  console.log(`check-dist: ${label} OK`);
}
