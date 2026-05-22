/**
 * Sprint 29 KL-05 — Bridge Outbox Auto-Drain Worker.
 *
 * Runs an interval (every 5 seconds) that calls drainOutbox().
 * Started automatically from server/index.ts when BRIDGE_WORKER_ENABLED !== "false".
 *
 * PRODUCTION DEPLOY NOTE (see DEPLOY_HANDOFF.md):
 *   - In the main API process, set BRIDGE_WORKER_ENABLED=false to disable this loop.
 *   - Run a dedicated PM2 process with BRIDGE_WORKER_ONLY=1 for the worker.
 *   - This ensures horizontal scaling without duplicate drains.
 */

import { drainOutbox } from "./bridgeStore";
import { log } from "./lib/logger";

let workerInterval: ReturnType<typeof setInterval> | null = null;

const DRAIN_INTERVAL_MS = 5_000;

/**
 * Default deliver function — in production, replace with HTTP call to the Collective endpoint.
 * In sandbox, it simulates a 200 OK for all events.
 */
async function defaultDeliver(_env: unknown, _hmac: string): Promise<{ ok: boolean; status: number }> {
  // In production this would POST to process.env.BRIDGE_ENDPOINT_URL
  return { ok: true, status: 200 };
}

/** Start the worker. Safe to call multiple times — only one interval runs at a time. */
export function startBridgeWorker(): void {
  if (workerInterval !== null) {
    log.info("[bridge-worker] already running, skipping start");
    return;
  }
  log.info(`[bridge-worker] starting — drain interval ${DRAIN_INTERVAL_MS}ms`);
  workerInterval = setInterval(async () => {
    try {
      const result = await drainOutbox(defaultDeliver);
      if (result.delivered > 0 || result.deadLettered > 0) {
        log.info(
          `[bridge-worker] drained ${result.delivered} events` +
          (result.deadLettered > 0 ? `, ${result.deadLettered} dead-lettered` : ""),
        );
      }
    } catch (err) {
      log.error("[bridge-worker] drain error:", err);
    }
  }, DRAIN_INTERVAL_MS);
}

/** Stop the worker (used in tests and graceful shutdown). */
export function stopBridgeWorker(): void {
  if (workerInterval !== null) {
    clearInterval(workerInterval);
    workerInterval = null;
    log.info("[bridge-worker] stopped");
  }
}

/** Returns whether the worker is currently running. */
export function isBridgeWorkerRunning(): boolean {
  return workerInterval !== null;
}

/** For tests: trigger a single drain tick synchronously. */
export async function tickBridgeWorker(): Promise<{ delivered: number; deadLettered: number }> {
  return drainOutbox(defaultDeliver);
}
