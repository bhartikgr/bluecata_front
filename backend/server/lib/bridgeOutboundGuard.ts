/**
 * server/lib/bridgeOutboundGuard.ts — v25.48.2 Q1 (Ozan).
 *
 * PARALLEL route-layer guard for the LEGACY outbound bridge. The Sacred
 * `server/lib/bridgeRuntime.ts` (HMAC / chain / outbox math + the
 * `/api/bridge/drain` route) is NOT modified. Instead we register a guard on
 * the drain trigger paths that is mounted BEFORE the real bridge routes, so
 * Express matches it first and short-circuits.
 *
 * WHY (Q1 root cause): the automatic drain worker is already gated OFF in
 * production (see server/index.ts + isBridgeEnabled()). The residual exposure
 * is the two ADMIN-triggered drain endpoints:
 *   - POST /api/bridge/drain        (Sacred bridgeRuntime — calls deliverOnce())
 *   - POST /api/admin/bridge/drain  (bridgeStore — posts to the mock receiver)
 * In production with NO real receiver configured, deliverOnce() returns 501 and
 * the envelope dead-letters, producing the 501 storm + DLQ pileup Avi sees. The
 * legacy `BRIDGE_OUTBOUND_URL` env is a red herring — it is not consumed
 * anywhere in the tree; the real trigger is any outbound SEND while the bridge
 * is disabled/without a real receiver.
 *
 * The guard fires when EITHER:
 *   (a) the bridge is disabled via isBridgeEnabled() (default OFF in prod), OR
 *   (b) no COMPLETE real receiver is configured (COLLECTIVE_WEBHOOK_URL +
 *       COLLECTIVE_WEBHOOK_SECRET). Requiring a real receiver means we never
 *       attempt an outbound send into the void even if someone flips
 *       BRIDGE_ENABLED=1 without wiring a receiver.
 * On fire it responds 200 `{ ok: true, disabled: true, delivered: 0 }` — NO
 * 501, NO dead-letter — so the admin UI reports "disabled" cleanly.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { isBridgeEnabled, bridgeDisabledReason } from "./bridgeEnabled";

/**
 * v25.48.2 MF1 — a non-empty secret is NOT enough. Deploy templates ship
 * obvious placeholders (`YOUR_STRONG_SECRET`, `changeme`, …); treating those as
 * "real" would let the worker POST to the receiver with a bogus HMAC key. Reject
 * any secret that matches a known-placeholder pattern (case-insensitive).
 */
export function isPlaceholderSecret(secret: string | undefined | null): boolean {
  const s = (secret ?? "").trim();
  if (!s) return true;
  return /your.?strong.?secret|changeme|placeholder|todo|example/i.test(s);
}

/** True when a COMPLETE real external receiver is configured (real URL + real, non-placeholder secret). */
export function hasRealReceiver(): boolean {
  const url = (process.env.COLLECTIVE_WEBHOOK_URL || "").trim();
  const secret = (process.env.COLLECTIVE_WEBHOOK_SECRET || "").trim();
  return Boolean(url) && !isPlaceholderSecret(secret);
}

/**
 * v25.48.2 MF1 — the ONE centralized predicate. The outbound bridge may send
 * ONLY when it is enabled AND a complete real receiver (real URL + real,
 * non-placeholder secret) is configured. Used by the Express drain guard, the
 * bridge worker startup + each tick, and the index.ts worker-start decision, so
 * no code path can bypass the check.
 */
export function maySendOutboundBridge(): boolean {
  return isBridgeEnabled() && hasRealReceiver();
}

/** Reason the outbound bridge is neutralized, or null when it may send. */
function outboundBlockedReason(): string | null {
  if (!isBridgeEnabled()) return bridgeDisabledReason();
  if (!hasRealReceiver()) {
    return "no real receiver configured (COLLECTIVE_WEBHOOK_URL missing or COLLECTIVE_WEBHOOK_SECRET missing/placeholder)";
  }
  return null;
}

function guard(_req: Request, res: Response, next: NextFunction): void {
  const reason = outboundBlockedReason();
  if (reason) {
    res.status(200).json({
      ok: true,
      disabled: true,
      delivered: 0,
      deadLettered: 0,
      reason: `outbound bridge neutralized: ${reason}`,
    });
    return;
  }
  next();
}

/**
 * Register the parallel guard. MUST be called BEFORE registerBridgeRoutes /
 * registerBridgeRuntimeRoutes so the guard's handlers match ahead of the real
 * (incl. Sacred) drain routes.
 */
export function registerBridgeOutboundGuard(app: Express): void {
  app.post("/api/bridge/drain", guard);
  app.post("/api/admin/bridge/drain", guard);
}
