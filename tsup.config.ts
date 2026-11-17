import { defineConfig } from "tsup";

export default defineConfig([
  {
    // The engine: headless and framework-agnostic, zero runtime dependencies,
    // no Node or browser assumption.
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    platform: "neutral",
    treeshake: true,
  },
  {
    // The SQLite store, on its own subpath so the core never imports
    // `node:sqlite` (still experimental in Node 22).
    entry: ["src/sqlite.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    platform: "node",
    external: ["node:sqlite"],
    treeshake: true,
  },
]);
