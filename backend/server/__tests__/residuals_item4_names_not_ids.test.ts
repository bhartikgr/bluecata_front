/**
 * ══════════════════════════════════════════════════════════════════════════════
 * RESIDUALS · ITEM 4 (server half) — A NAME SLOT NEVER HOLDS A STORAGE KEY.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * QA read the same identifier, `spv_e08dcbdd2921a89c`, in five investor-facing
 * name slots, and a sixth as a round: `Round spvlp_spv_e08dcbdd2921a89c`.
 *
 * TRACED, AND IT IS TWO LINES OF SOURCE, NOT SIX SCREENS.
 *
 *   (a) `investorPortfolioProjection.ts` built every position's `company` as
 *       `meta.name ?? a.companyId`, and `companyMeta` reads the `companies`
 *       table ONLY. An SPV-shaped id — which this ledger legitimately carries,
 *       because "an SPV is a company in the entity-agnostic ledger" — can never
 *       resolve there, so the fallback published the raw key AS A NAME. The
 *       portfolio H2 and breadcrumb, the dashboard M&A rollup, the M&A table's
 *       COMPANY column and "No co-members found for …" all render that ONE
 *       field. (The stray `s` in the breadcrumb is the thumbnail's initial,
 *       taken from the same string.)
 *
 *   (b) `routes.ts:4728` and `:4894` built an invitation's round name as
 *       `` `Round ${roundId}` `` when the `rounds` lookup missed. For an SPV LP
 *       invitation the lookup ALWAYS misses: the id is SYNTHETIC, minted as
 *       `spvlp_${spv.id}` at `spvEngineRoutes.ts:2691`, and no row is ever
 *       written for it. The fallback was certain to fire, every time.
 *
 * WHAT IS PROVED HERE — the two resolvers, at their poles. The client surfaces
 * are proved by rendering in
 * `client/src/pages/founder/__tests__/residuals_item4_founder_activity.test.tsx`
 * and the four investor surfaces read the single field pinned below.
 *
 * NOTHING IN THIS FILE WRITES TO THE DATABASE.
 */
import { describe, it, expect } from "vitest";
import { portfolioCompanyDisplayName } from "../lib/investorPortfolioProjection";
import { invitationRoundName, ROUND_NAME_NOT_RECORDED } from "../lib/invitationRoundName";
import { partyReferenceLabel } from "../../client/src/lib/partnerDisplay";

/** The exact identifiers QA read off the live screens. */
const LIVE_SPV_ID = "spv_e08dcbdd2921a89c";
const LIVE_ROUND_ID = "spvlp_spv_e08dcbdd2921a89c";

describe("RESIDUALS · Item 4 (a) — a portfolio position's company name", () => {
  it("CONTROL · the helper answers at all, and the matchers below can fail", () => {
    const out = portfolioCompanyDisplayName(LIVE_SPV_ID);
    expect(typeof out).toBe("string");
    expect(out.trim().length).toBeGreaterThan(0);
    /* If this matcher matched everything, every assertion in this file would be
       vacuous. It must not match a plainly different string. */
    expect("Northwind Series A").not.toContain(LIVE_SPV_ID);
  });

  it("the reported id NEVER comes back as a name — it becomes an honest reference", () => {
    const out = portfolioCompanyDisplayName(LIVE_SPV_ID);
    /* THE DEFECT, PINNED. */
    expect(out).not.toBe(LIVE_SPV_ID);
    expect(out).not.toContain("spv_");
    /* And what it IS: the platform's existing Wave 115 floor, so there is one
       label implementation and not a second copy. */
    expect(out).toBe(partyReferenceLabel(LIVE_SPV_ID));
    expect(out).toContain("Reference");
    /* STILL UNIQUE — two unnamed positions must not collapse into one another,
       or an LP loses the ability to tell his own holdings apart. */
    expect(out).not.toBe(portfolioCompanyDisplayName("spv_1111111111111111"));
  });

  it("nothing is fabricated — an empty id says so rather than inventing a company", () => {
    const out = portfolioCompanyDisplayName("");
    expect(out).toBe("Company not recorded");
    expect(out).not.toContain("Reference");
  });
});

describe("RESIDUALS · Item 4 (b) — an invitation's round name", () => {
  it("CONTROL · a REAL stored round name is returned untouched — the fix does not overwrite good data", () => {
    /* The pole that makes every assertion below non-vacuous: a resolver that
       replaced every round name with a reference would pass the next test and
       destroy the screen. */
    expect(invitationRoundName("rnd_real_1", "Series A")).toBe("Series A");
    expect(invitationRoundName(LIVE_ROUND_ID, "Seed Extension")).toBe("Seed Extension");
  });

  it("the reported string is gone — `Round spvlp_spv_e08dcbdd2921a89c` is never produced", () => {
    const out = invitationRoundName(LIVE_ROUND_ID, null);
    expect(out).not.toBe(`Round ${LIVE_ROUND_ID}`);
    expect(out).not.toContain(LIVE_ROUND_ID);
    expect(out).not.toContain("spvlp_");
    expect(out).not.toContain("spv_");
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it("an unresolvable synthetic id falls to a REFERENCE, never to the key and never to an invented name", () => {
    const out = invitationRoundName(LIVE_ROUND_ID, null);
    /* No SPV row exists for this id in this tree, so the vehicle-name branch
       cannot fire and the floor must hold. */
    expect(out).toContain("Reference");
    expect(out).toBe(partyReferenceLabel(LIVE_ROUND_ID));
    /* Unique, so two unnamed invitations are still tellable apart. */
    expect(out).not.toBe(invitationRoundName("spvlp_spv_2222222222222222", null));
  });

  it("an absent id says so — it never returns an empty string into a required name field", () => {
    expect(invitationRoundName("", null)).toBe(ROUND_NAME_NOT_RECORDED);
    expect(invitationRoundName(null, null)).toBe(ROUND_NAME_NOT_RECORDED);
    expect(invitationRoundName(undefined, undefined)).toBe(ROUND_NAME_NOT_RECORDED);
  });

  it("a whitespace-only stored name is not accepted as a name", () => {
    /* THE SILENT EMPTY: `round?.name` of `\"   \"` would previously have been
       truthy and rendered as a blank round name. */
    const out = invitationRoundName(LIVE_ROUND_ID, "   ");
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("Reference");
  });
});
