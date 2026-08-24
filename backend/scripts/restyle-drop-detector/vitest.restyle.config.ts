import { defineConfig } from "vitest/config";

/**
 * WAVE 119 — dedicated vitest config for the restyle-drop-detector's own tests.
 *
 * Mirrors scripts/silent-drop-guard/vitest.guard.config.ts exactly, and for the
 * same reason: the repo's root vitest.config.ts restricts `include` to server/,
 * client/src/, shared/ and packages/, so a test under scripts/ is invisible to
 * `npm test`. This additive config runs ONLY the detector's tests, in a plain
 * node environment, so it stays fast and isolated.
 *
 * Run:
 *   npx vitest run --config scripts/restyle-drop-detector/vitest.restyle.config.ts
 *
 * NOTE FOR THE OWNER — this wave deliberately did NOT edit package.json (no
 * application/config file was touched). To make this suite a preflight gate,
 * add one script and one link in the preflight chain:
 *   "drop:restyle:test": "vitest run --config scripts/restyle-drop-detector/vitest.restyle.config.ts"
 *   … && npm run drop:restyle:test && npm run drop:restyle
 */
export default defineConfig({
  test: {
    include: ["scripts/restyle-drop-detector/__tests__/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
