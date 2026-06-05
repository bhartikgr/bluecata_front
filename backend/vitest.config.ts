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
    include: [
      "packages/*/test/**/*.test.ts",
      "client/src/**/*.test.ts",
      "shared/**/*.test.ts",
      "server/**/*.test.ts",
    ],
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
