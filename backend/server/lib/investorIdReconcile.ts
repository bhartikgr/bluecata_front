/**
 * server/lib/investorIdReconcile.ts — W-KYC
 *
 * Shared, NON-SACRED resolver that maps an admin-facing investor id to the
 * canonical redeemer userId BEFORE any per-investor lookup 404s. Mirrors the
 * W2 Avi#2 reconciliation logic (reconcileInvestorProfileForAdmin in
 * adminPlatformStore.ts) but extracted so the KYC document admin routes can
 * resolve the SAME way — otherwise a KYC list for a synthetic
 * `derived_inv_<invitationId>` id returns empty even though the redeemer
 * uploaded documents under their real userId.
 *
 * Read-only: it only SELECTs round_invitations.redeemed_by_user_id. It never
 * writes, never imports the sacred profileStore, and fails soft (returns the
 * original id) on any error so it can never block a page.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

const DERIVED_PREFIX = "derived_inv_";

/**
 * Resolve an admin-facing investor id to the canonical redeemer userId.
 * - `derived_inv_<invitationId>` → the invitation's redeemed_by_user_id (when set).
 * - anything else → returned unchanged.
 * Fail-soft: returns the input id on any lookup error.
 */
export function resolveCanonicalInvestorId(rawId: string): string {
  if (typeof rawId !== "string" || !rawId.startsWith(DERIVED_PREFIX)) return rawId;
  try {
    const invId = rawId.slice(DERIVED_PREFIX.length);
    const inv = rawDb()
      .prepare("SELECT redeemed_by_user_id FROM round_invitations WHERE id = ?")
      .get(invId) as { redeemed_by_user_id: string | null } | undefined;
    if (inv?.redeemed_by_user_id) return inv.redeemed_by_user_id;
  } catch (err) {
    log.warn(
      "[investorIdReconcile] resolve failed (fail-soft, using raw id): " +
        (err as Error).message,
    );
  }
  return rawId;
}

/**
 * Return BOTH the resolved canonical id and the original, plus whether a
 * resolution actually happened. Useful when a caller wants to look up by both
 * (e.g. documents may have been stored under either id historically).
 */
export function resolveInvestorIdCandidates(rawId: string): {
  canonicalId: string;
  rawId: string;
  wasDerived: boolean;
} {
  const canonicalId = resolveCanonicalInvestorId(rawId);
  return { canonicalId, rawId, wasDerived: canonicalId !== rawId };
}
