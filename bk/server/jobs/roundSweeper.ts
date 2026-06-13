/**
 * server/jobs/roundSweeper.ts — v17 Phase C.
 *
 * Periodic round-close sweeper. Started by `server/index.ts` (or any
 * boot harness) in production (NODE_ENV === "production") and gated
 * behind COLLECTIVE_ENABLED=1.
 *
 * Runs every 60s. Idempotent. Sequential per sweep — does not parallelize
 * cascades.
 *
 * Test environment guard:
 *   - NODE_ENV === "test"  → start() is a NO-OP (returns null)
 *     so vitest runs do not spawn background timers (they would interfere
 *     with the vitest worker lifecycle and the `process.exit()` shutdown).
 *
 * To drive the sweeper in a test, import `sweepClosedRounds` directly from
 * `server/lib/roundCloseCascade.ts` and call it synchronously.
 */

import { sweepClosedRounds } from "../lib/roundCloseCascade";
import { log } from "../lib/logger";

/** Interval handle for stop(). Null when not running. */
let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Start the sweeper. Returns the interval handle (for tests / shutdown
 * hooks), or null when the sweeper was intentionally skipped.
 *
 * Skip conditions:
 *   - NODE_ENV === "test"  (vitest)
 *   - COLLECTIVE_ENABLED !== "1"  (feature flag off)
 *   - already started (idempotent — returns the existing handle)
 */
export function startRoundSweeper(opts: { intervalMs?: number } = {}): NodeJS.Timeout | null {
  if (intervalHandle) return intervalHandle;
  if (process.env.NODE_ENV === "test") return null;
  if (process.env.COLLECTIVE_ENABLED !== "1") return null;

  const intervalMs = opts.intervalMs ?? 60_000;

  // First tick runs after `intervalMs` — by design, we don't sweep eagerly
  // at boot to avoid racing the hydrators.
  intervalHandle = setInterval(() => {
    try {
      const result = sweepClosedRounds();
      if (result.closed > 0 || result.totalOffersLapsed > 0) {
        log.info(
          `[roundSweeper] scanned=${result.scanned} closed=${result.closed} offers_lapsed=${result.totalOffersLapsed}`,
        );
      }
    } catch (err) {
      log.warn("[roundSweeper] tick failed:", (err as Error).message);
    }
  }, intervalMs);

  // Don't keep the event loop alive on process shutdown.
  if (intervalHandle.unref) intervalHandle.unref();

  return intervalHandle;
}

/** Stop the sweeper. Safe to call multiple times. */
export function stopRoundSweeper(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/** Test helper — drive a single sweep without the interval timer. */
export function _testTick(): ReturnType<typeof sweepClosedRounds> {
  return sweepClosedRounds();
}
