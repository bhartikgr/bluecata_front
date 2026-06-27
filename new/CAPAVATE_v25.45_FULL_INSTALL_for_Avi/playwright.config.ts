/**
 * Playwright config — Wave F3 E2E suite for Capavate v23.1.
 *
 * Drives 25 browser-level tests across 5 personas (founder, investor, admin,
 * partner, marketing/public). Chromium-only for now; multi-browser is a Wave F1
 * future item.
 *
 * Math-sacred is *not* touched by this file or anything under tests/e2e/.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // Vite's dev server keeps an HMR WebSocket open, so the default `load`
    // event never settles. Use the DOM-ready signal instead.
    // (Per-test waits still rely on `networkidle` opportunistically.)
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // When `E2E_EXTERNAL_SERVER=1`, the suite assumes a dev server is already
  // running on the configured port and Playwright does NOT spawn its own.
  // This is the mode used by `scripts/verify_e2e.sh` and by interactive
  // local debugging where you want the server to survive Playwright runs.
  // The CI default still spawns + tears down its own server for hermeticity.
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : {
        command: `cross-env ENABLE_DEMO_SEED=1 PORT=${PORT} NODE_ENV=development tsx server/index.ts`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
