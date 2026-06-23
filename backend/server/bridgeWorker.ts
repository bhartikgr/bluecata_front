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

import { deliverOnce } from "./lib/bridgeRuntime";
import { log } from "./lib/logger";

let workerInterval: ReturnType<typeof setInterval> | null = null;

const DRAIN_INTERVAL_MS = 5_000;

/**
 * v25.16 NC1 (cross-comp) — the worker previously called drainOutbox() with a
 * hardcoded stub that returned { ok: true, status: 200 } and never actually
 * POSTed to the Collective webhook. Now we delegate to deliverOnce() in
 * lib/bridgeRuntime, which performs the real HTTP POST when
 * COLLECTIVE_WEBHOOK_URL is set, falls back to the in-process mock receiver in
 * non-production, and returns { ok: false, status: 501 } in production when
 * the env var is missing (so we don't pretend events were delivered).
 */

/** Start the worker. Safe to call multiple times — only one interval runs at a time. */
export function startBridgeWorker(): void {
  if (workerInterval !== null) {
    log.info("[bridge-worker] already running, skipping start");
    return;
  }
  log.info(`[bridge-worker] starting — drain interval ${DRAIN_INTERVAL_MS}ms`);
  workerInterval = setInterval(async () => {
    try {
      const result = await deliverOnce();
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
  return deliverOnce();
}
