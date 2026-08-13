/**
 * WAVE 35 · F4 — the promotion of an email-only partner referral into a real
 * `partnerAttribution` row.
 *
 * THE DEFECT REVIEW A FOUND. `server/lib/authRoutes.ts:401` did
 *
 *     const partnerAttributionStore = require("../partnerAttributionStore");
 *
 * `server/partnerAttributionStore.ts` **has never existed** in this repository.
 * `partnerAttributionStore` is a NAMED EXPORT of `server/partnerWorkspaceStore.ts`.
 * Because the `require` sat inside a `try { ... } catch { /* non-fatal *\/ }`,
 * the MODULE_NOT_FOUND threw on the first line of the block and every
 * subsequent statement — including the attribution write — was skipped in
 * total silence. Dead in dev, dead in tests, dead in the bundled production
 * build. Partners who referred a founder by email never received credit, and
 * nothing anywhere reported it.
 *
 * THE SECOND DEFECT, WHICH THE REQUIRE WAS HIDING. Even with the import
 * corrected, the shipped call passed `null` as `companyId`:
 *
 *     partnerAttributionStore.create(row.partnerId, null, userId, ...)
 *
 * and its comment asserted "the partnerAttributionStore accepts null". It does
 * not. `create()` begins `if (!companyId) throw new Error("COMPANY_ID_REQUIRED")`.
 * So the naive one-line fix — swap the require for a static import — would have
 * traded a silent MODULE_NOT_FOUND for a silent COMPANY_ID_REQUIRED and the
 * partner would STILL get no credit, while the provisional row was
 * soft-deleted on the way out and the claim destroyed for good.
 *
 * THE FIX. Attribution is (partner, company). At signup there is no company
 * yet, so signup cannot be the sink. This module is the single sink for both
 * moments:
 *
 *   • at signup  — no company: the provisional row is NOT deleted. It is
 *     stamped with the founder's `userId` so the later drain knows who it
 *     belongs to without re-matching on email.
 *   • at company creation — the company is known: the real attribution is
 *     written and only THEN is the provisional row soft-deleted.
 *
 * Nothing is dropped at either moment, and the claim survives a restart
 * because the provisional row is durable.
 *
 * Static imports only (that is the entire lesson of F4).
 */
import { hydrateEntries, persistEntry, softDeleteEntry } from "./storePersistenceShim";
import { log } from "./logger";
import { partnerAttributionStore } from "../partnerWorkspaceStore";

const STORE = "provisionalPartnerAttributions";

export interface ProvisionalRow {
  email: string;
  partnerId: string;
  promotionId: string;
  source?: string;
  approvedBy?: string;
  approvedAt?: string;
  /** Stamped by `claimProvisionalAttributionsAtSignup`. */
  founderUserId?: string;
  claimedAt?: string;
}

/** Every live provisional row, `[key, row]`. */
export function listProvisional(): Array<[string, ProvisionalRow]> {
  return hydrateEntries<ProvisionalRow>(STORE);
}

/** `attributionSource` is a closed union; anything else is adjudicated manually. */
function normalizeSource(s: string | undefined): "admin_manual" | "referral_code" | "partner_claim" {
  return s === "referral_code" || s === "partner_claim" || s === "admin_manual"
    ? s
    : "partner_claim";
}

/**
 * SIGNUP MOMENT. Bind every provisional row for `email` to the new `userId`.
 * The row is deliberately KEPT — there is no company yet, so no attribution
 * can be written, and deleting the row here is what would destroy the claim.
 *
 * @returns the number of rows claimed.
 */
export function claimProvisionalAttributionsAtSignup(email: string, userId: string): number {
  const target = String(email ?? "").trim().toLowerCase();
  if (!target || !userId) return 0;
  let claimed = 0;
  for (const [key, row] of listProvisional()) {
    if (!row || String(row.email ?? "").toLowerCase() !== target) continue;
    if (row.founderUserId === userId) { claimed++; continue; } // idempotent
    try {
      persistEntry(STORE, key, {
        ...row,
        founderUserId: userId,
        claimedAt: new Date().toISOString(),
      });
      claimed++;
    } catch (err) {
      log.warn({
        route: "provisionalPartnerAttribution.claimAtSignup",
        message: `${key}: could not stamp founderUserId: ${(err as Error).message}`,
      });
    }
  }
  return claimed;
}

/**
 * COMPANY MOMENT. The company now exists, so the attribution can finally be
 * written. Matches on the stamped `founderUserId` first and falls back to
 * `email` (a row approved AFTER signup never went through the signup path).
 *
 * The provisional row is soft-deleted ONLY after `create()` returns — a throw
 * leaves the claim in place for the next attempt.
 *
 * @returns counts, so callers and tests can assert rather than assume.
 */
export function drainProvisionalAttributionsForCompany(input: {
  userId: string;
  companyId: string;
  email?: string | null;
}): { attributed: number; failed: number } {
  const { userId, companyId } = input;
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!userId || !companyId) return { attributed: 0, failed: 0 };

  let attributed = 0;
  let failed = 0;
  for (const [key, row] of listProvisional()) {
    if (!row) continue;
    const matches =
      row.founderUserId === userId ||
      (!!email && String(row.email ?? "").toLowerCase() === email);
    if (!matches) continue;

    try {
      partnerAttributionStore.create(
        row.partnerId,
        companyId,
        userId,
        normalizeSource(row.source),
        `Provisional referral promotion ${row.promotionId} promoted on first company creation (WAVE 35 F4).`,
      );
      attributed++;
      // Only now is the claim safe to retire.
      softDeleteEntry(STORE, key);
    } catch (err) {
      failed++;
      // KEPT, not deleted. A partner's revenue-bearing claim is never discarded
      // because one write failed; it will be retried on the next company.
      log.warn({
        route: "provisionalPartnerAttribution.drainForCompany",
        message:
          `${key}: attribution write failed for partner=${row.partnerId} company=${companyId}: ` +
          `${(err as Error).message}. Provisional row retained.`,
      });
    }
  }
  return { attributed, failed };
}
