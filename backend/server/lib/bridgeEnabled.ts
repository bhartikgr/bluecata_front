/**
 * server/lib/bridgeEnabled.ts — v25.48 HIGH-8.
 *
 * Route/boot-layer feature flag for the LEGACY outbound "bridge" (the
 * server-to-server sync to an EXTERNAL "Collective" system via
 * COLLECTIVE_WEBHOOK_URL + COLLECTIVE_WEBHOOK_SECRET). The bridge is
 * UNUSED/legacy; in production with no webhook configured it returns 501 and
 * dead-letters every event, producing a 501 storm + DLQ pileup.
 *
 * Ozan decision (locked): DISABLE the outbound bridge in production. This is a
 * PARALLEL guard — the Sacred `server/lib/bridgeRuntime.ts` (HMAC / chain /
 * outbox math) is NOT modified. We simply refuse to start the outbound drain
 * worker (and short-circuit the outbound runtime routes) when the bridge is
 * disabled, so no 501 is ever emitted and nothing accumulates in the DLQ.
 *
 * Flag semantics (BRIDGE_ENABLED):
 *   - Explicit  "1"/"true"  → ENABLED  (opt-in; e.g. a real external receiver).
 *   - Explicit  "0"/"false" → DISABLED.
 *   - UNSET in production    → DISABLED (default OFF in prod — the fix).
 *   - UNSET in dev/test      → ENABLED  (preserves existing dev/test behavior,
 *                              so the in-process mock receiver + existing e2e
 *                              drain tests are unchanged).
 *
 * NOTE: the pre-existing BRIDGE_WORKER_ENABLED=false env (per DEPLOY_HANDOFF.md,
 * for horizontal scaling) still disables the worker independently; this flag is
 * an ADDITIONAL production lockdown that also defaults the worker off in prod.
 */

/** True when the legacy outbound bridge should be active in this process. */
export function isBridgeEnabled(): boolean {
  const raw = (process.env.BRIDGE_ENABLED ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  // Unset → default OFF in production, ON elsewhere.
  return process.env.NODE_ENV !== "production";
}

/** Human-readable reason for logs. */
export function bridgeDisabledReason(): string {
  const raw = (process.env.BRIDGE_ENABLED ?? "").trim();
  if (raw) return `BRIDGE_ENABLED=${raw}`;
  return "BRIDGE_ENABLED unset (default OFF in production)";
}
