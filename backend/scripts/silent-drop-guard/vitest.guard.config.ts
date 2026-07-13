import { defineConfig } from "vitest/config";

/**
 * Dedicated vitest config for the anti-silent-drop guard tests.
 *
 * The repo's root vitest.config.ts restricts `include` to server/, client/src/,
 * shared/, and packages/, so the guard test under scripts/ is not picked up by
 * `npm run test`. This additive config runs ONLY the guard test suite in a
 * plain node environment (no jsdom, no demo-seed) so it stays fast and isolated.
 *
 * Run:
 *   npx vitest run --config scripts/silent-drop-guard/vitest.guard.config.ts
 */
export default defineConfig({
  test: {
    include: ["scripts/silent-drop-guard/__tests__/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
  },
});
