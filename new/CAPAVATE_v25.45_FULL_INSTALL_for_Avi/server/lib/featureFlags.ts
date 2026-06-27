/**
 * v14 Tier-1 Fix 5 — feature flags.
 * v16 — adds COLLECTIVE_ENABLED (default OFF).
 *
 * Preview-only surfaces gated so we can ship a Saturday preview build without
 * exposing partially-built UX:
 *
 *   - PARTNER_WORKSPACE_ENABLED         → partner dashboard / workspace pages
 *   - COLLECTIVE_ADMIN_APPROVAL_ENABLED → collective admin approval flow
 *   - COLLECTIVE_ENABLED                → Collective subsystem (v16, default OFF)
 *
 * DEFAULTS:
 *   - PARTNER_WORKSPACE_ENABLED, COLLECTIVE_ADMIN_APPROVAL_ENABLED → TRUE
 *     unless env var set to literal "false".
 *   - COLLECTIVE_ENABLED → FALSE unless env var set to literal "1".
 *     (v16 honest posture: ship Saturday with the Collective subsystem
 *      hidden behind the invite-only waitlist; flip to "1" when chapters
 *      open and the Tier-1 fixes have been audited end-to-end.)
 *
 * Read-only. There is no `setFlag()` API — flags are a deploy-time decision.
 */

export const FEATURE_FLAGS = {
  PARTNER_WORKSPACE_ENABLED: process.env.FEATURE_PARTNER_WORKSPACE_ENABLED !== "false",
  COLLECTIVE_ADMIN_APPROVAL_ENABLED: process.env.FEATURE_COLLECTIVE_ADMIN_APPROVAL_ENABLED !== "false",
  /** v16 — Collective subsystem master switch. Default OFF; opt-in via env "1". */
  COLLECTIVE_ENABLED: process.env.COLLECTIVE_ENABLED === "1",
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

/** Check whether a named flag is currently enabled. */
export function flagEnabled(flag: FeatureFlagKey): boolean {
  return FEATURE_FLAGS[flag];
}

/**
 * v16 — express middleware: 503 if `COLLECTIVE_ENABLED` is off. Attach to
 * existing Collective application/nomination/promote write routes so they
 * politely refuse traffic in the default Saturday-ship posture.
 *
 * Read by env at request time (not import time) so vitest can flip the flag
 * mid-suite via `process.env.COLLECTIVE_ENABLED = "1"`.
 */
export function requireCollectiveEnabled(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any, res: any, next: any,
): void {
  if (process.env.COLLECTIVE_ENABLED === "1") return next();
  res.status(503).json({
    ok: false,
    error: "collective_not_available",
    message: "The Collective subsystem is in invite-only beta. Use /api/collective/waitlist/* to join the waitlist.",
  });
}
