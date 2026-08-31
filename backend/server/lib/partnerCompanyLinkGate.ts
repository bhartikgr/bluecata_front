/**
 * WAVE 179 · ITEM A · R151.1 — ONE PARTNER↔COMPANY RELATIONSHIP PREDICATE, SHARED.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * R151.1 asks for a "Create SPV for this managed client" affordance AND for the
 * fence that must come with it: "a partner must never attribute an SPV to a
 * client they do not manage."
 *
 * Wave 178 established that the backend already PERSISTS `spv.target_company_id`
 * (column `server/db/connection.ts:5200`, written in `persistSpv`
 * `server/spvEngineStore.ts:384-399`, read back at `:5018`, accepted by
 * `POST /api/partner/me/spv` `server/spvEngineRoutes.ts:541` and by
 * `POST /api/partner/me/spvs` `server/partnerRoutes.ts:2176-2250`). That claim is
 * true. What wave 178 did not say is that NOTHING CHECKED THE VALUE. A partner
 * could post any company id — including another partner's managed client — and it
 * persisted and rendered on the SPV detail surface as that vehicle's target.
 *
 * ── WHY IT IS AN EXTRACTION AND NOT A NEW PREDICATE ─────────────────────────
 * The tree already had exactly the right check, written for the portfolio routes:
 * `partnerCanAccessCompanyPortfolio`, formerly a local `const` inside
 * `registerPartnerRoutes` (`server/partnerRoutes.ts`, W1 H3/H4, v26.2.0). It was
 * unreachable from `spvEngineRoutes.ts`, and the wrong answer to that is to write
 * a second copy: a security predicate that exists twice drifts, and then the two
 * doors disagree about who may walk through. The body below is that function,
 * moved verbatim — same six proofs, same order, same comments — and
 * `partnerRoutes.ts` now delegates to it, so there is one derivation and both
 * doors are the same door.
 *
 * ── WHY THE GATE IS AT THE ROUTE AND NOT IN `createSpv` ─────────────────────
 * `spvEngineStore.createSpv` is also called by `seedDemoData`, by
 * `managedFounderStore`'s SPV-on-behalf path (which carries its OWN, stricter
 * gates: a live engagement plus delegated authority — see
 * `server/__tests__/wave154_k7_spv_on_behalf_signed_agreement.test.ts`) and by a
 * boot backfill. None of those is a partner-supplied identifier arriving over
 * HTTP, and refusing them would break correct behaviour to fix an unrelated hole.
 * The hole is at the boundary where an untrusted `targetCompanyId` enters, so the
 * gate is there.
 *
 * ── "FOLLOWING" IS STILL NOT A PROOF ────────────────────────────────────────
 * Kept from the original, deliberately: a member's personal interest in a company
 * does not make that company the partner's client.
 */
import { getPortfolioCompany } from "../partnerPortfolioStore";
import {
  partnerAttributionStore,
  partnerPipelineStore,
  partnerDealPromotionsStore,
} from "../partnerWorkspaceStore";
import { getConsortiumPartnerId } from "../consortiumLinkStore";
import { spvEngineStore } from "../spvEngineStore";

/**
 * Does this partner hold a DURABLE relationship to this company?
 *
 * Six independent proofs, any one of which suffices. Returns `false` for empty
 * inputs so a missing id can never pass. Callers return 404 rather than 403 so
 * the route cannot be used as an existence oracle for companies the caller has
 * no relationship with.
 */
export function partnerHasCompanyRelationship(partnerId: string, companyId: string): boolean {
  if (!partnerId || !companyId) return false;
  // 1) live partner-owned portfolio row
  if (getPortfolioCompany(partnerId, companyId)) return true;
  // 2) live attribution (listByPartner excludes revoked by default)
  if (partnerAttributionStore.listByPartner(partnerId).some((a) => a.companyId === companyId && !a.revokedAt)) return true;
  // 3) consortium sponsor link
  if (getConsortiumPartnerId(companyId) === partnerId) return true;
  // 4) partner pipeline deal
  if (partnerPipelineStore.listByPartner(partnerId).some((p) => p.companyId === companyId)) return true;
  // 5) live partner deal promotion (exclude terminal/negative states)
  if (partnerDealPromotionsStore.listByPartner(partnerId).some((p) =>
    p.companyId === companyId && !(["rejected", "withdrawn", "archived"] as string[]).includes(String(p.status)),
  )) return true;
  // 6) partner-sponsored SPV target company
  if (spvEngineStore.listByPartner(partnerId).some((s) => s.targetCompanyId === companyId && !s.archivedAt)) return true;
  return false;
}

/**
 * The machine code a refusal carries. Kept as a constant so the route, the
 * client and the negative-control tests all name the same thing, and so the
 * human-readable sentence below is never the thing tests assert on (R77 keeps
 * the two halves separate: a code for machines, a sentence for people).
 */
export const SPV_TARGET_COMPANY_NOT_YOURS = "SPV_TARGET_COMPANY_NOT_YOURS";

/** R77 — the human half. A sentence, not a code, and it says what to do next. */
export const SPV_TARGET_COMPANY_NOT_YOURS_MESSAGE =
  "You can only create a vehicle for a company you already work with on Capavate. This company is not one of your clients, so it was not linked and nothing was created. Add the company as a client first, or check the company you selected.";

/**
 * The gate itself, in the form the create routes want: given whatever the client
 * sent, decide whether it may be attributed.
 *
 * `null`/`undefined`/blank is ALLOWED and means "no target company" — R151.1 asks
 * for a fence on attribution, not for attribution to become mandatory. Every
 * vehicle that legitimately has no target company must still be creatable, and
 * the wizard's own field is optional today
 * (`targetCompanyId: w.targetCompanyId.trim() || null`).
 */
export function partnerMayAttributeSpvToCompany(
  partnerId: string,
  targetCompanyId: unknown,
): { ok: true; companyId: string | null } | { ok: false } {
  if (targetCompanyId === null || targetCompanyId === undefined) return { ok: true, companyId: null };
  if (typeof targetCompanyId !== "string") return { ok: false };
  const trimmed = targetCompanyId.trim();
  if (trimmed === "") return { ok: true, companyId: null };
  if (!partnerHasCompanyRelationship(partnerId, trimmed)) return { ok: false };
  return { ok: true, companyId: trimmed };
}
