import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Root vitest config — runs ALL tests across:
 *  - packages/cap-table-engine
 *  - packages/cap-table-engine-ref
 *  - packages/telemetry
 *  - packages/gating
 *  - client/src/lib (client-side schema + sync logic — pure TS)
 *
 * Per Sprint 8 mandate (146 -> 158+ tests): the client/src/lib tests for the
 * new profile schema modules are wired here. Existing per-package configs
 * remain untouched.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
      "@capavate/cap-table-engine": path.resolve(__dirname, "packages/cap-table-engine/src/index.ts"),
      "@capavate/cap-table-engine-ref": path.resolve(__dirname, "packages/cap-table-engine-ref/src/index.ts"),
      "@capavate/telemetry": path.resolve(__dirname, "packages/telemetry/src/index.ts"),
      "@capavate/math-fns": path.resolve(__dirname, "packages/math-fns/src/index.ts"),
      "@capavate/math-fns-ref": path.resolve(__dirname, "packages/math-fns-ref/src/index.ts"),
    },
  },
  test: {
    // v25.20 Lane 3 — test-infra isolation fix.
    //
    // Previously a bare `npx vitest run` (which the 62-gate verifier and most
    // contributors invoke) ran with NODE_ENV unset. server/db/connection.ts
    // only switches to an isolated `:memory:` SQLite DB when NODE_ENV === "test";
    // otherwise it opens the shared, persistent ./data.db. That meant the whole
    // suite ran against the polluted dev DB and cross-contaminated between files.
    //
    // Pinning NODE_ENV=test here guarantees every vitest invocation — bare or
    // via the `npm test` wrapper — gets a fresh in-memory DB per worker, and
    // ENABLE_DEMO_SEED=1 makes the canonical demo fixtures (co_novapay /
    // co_arboreal, see server/__tests__/_fixtures/testCompanies.ts) available to
    // the carry-forward / SAFE / cap-table suites that call seedDemoData().
    env: {
      NODE_ENV: "test",
      ENABLE_DEMO_SEED: "1",
      VITEST: "true",
    },
    include: [
      "packages/*/test/**/*.test.ts",
      "client/src/**/*.test.ts",
      "shared/**/*.test.ts",
      "server/**/*.test.ts",
    ],
    // v25.20 Lane 3 — see _fixtures/vitestRequireShim.ts. Teaches Node's CJS
    // require() resolver to find relative `.ts` modules used by lazy
    // require("./store") cycle-breakers, which Vitest otherwise can't resolve.
    setupFiles: ["./server/__tests__/_fixtures/vitestRequireShim.ts"],
    reporters: ["default"],
    // 23-May Fix — the test suite has grown past the 300s ceiling enforced by
    // the 62-gate verifier's hard-coded `timeout 300 npx vitest run`. Pinning
    // the thread pool keeps the wall-clock under that ceiling without skipping
    // any test (we still run every test — just in parallel workers instead of
    // a single forked process). This is the same default vitest used before
    // 1.x switched to forks, so behavior matches historical baselines.
    pool: "threads",
    poolOptions: {
      threads: {
        maxThreads: 4,
        minThreads: 1,
      },
    },
  },
});
