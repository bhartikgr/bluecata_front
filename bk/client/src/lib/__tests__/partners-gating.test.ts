/**
 * Sprint 16 A3 — Consortium partner portfolio-gating rule.
 *
 * Test 3 cases:
 *   1) Partner with 0 Capavate cos in portfolio  → not visible
 *   2) Partner with 1+ Capavate cos             → visible
 *   3) Partner whose only co exits              → no longer visible
 */
import { describe, it, expect } from "vitest";
import { CONSORTIUM_PARTNERS, visiblePartners, visiblePartnersByRegion } from "../partners";

describe("Sprint 16 A3 — Partner portfolio gating", () => {
  it("partner with no portfolioCompanies is hidden", () => {
    const v = visiblePartners(["co_novapay", "co_arboreal", "co_kelvin", "co_quanta"]);
    const ids = v.map(p => p.id);
    // us-wsgr / us-latham have no portfolio array → must be hidden
    expect(ids).not.toContain("us-wsgr");
    expect(ids).not.toContain("us-latham");
    expect(ids).not.toContain("uk-tw");
  });

  it("partner with at least one active Capavate company is visible", () => {
    const v = visiblePartners(["co_novapay", "co_arboreal"]);
    const ids = v.map(p => p.id);
    // us-cooley → portfolio includes co_novapay
    expect(ids).toContain("us-cooley");
    // uk-bird → portfolio includes co_arboreal
    expect(ids).toContain("uk-bird");
  });

  it("partner whose only company exits falls off the directory", () => {
    // Cooley's only company is co_novapay. If novapay exits, cooley disappears.
    const beforeExit = visiblePartners(["co_novapay", "co_arboreal"]).map(p => p.id);
    expect(beforeExit).toContain("us-cooley");
    const afterExit = visiblePartners(["co_arboreal"]).map(p => p.id); // co_novapay exited
    expect(afterExit).not.toContain("us-cooley");
    // uk-bird should still be visible since co_arboreal is still active
    expect(afterExit).toContain("uk-bird");
  });

  it("only the 2 demo-seeded partners (cooley, bird) are visible across all 4 active cos", () => {
    const v = visiblePartners(["co_novapay", "co_arboreal", "co_kelvin", "co_quanta"]);
    const ids = v.map(p => p.id).sort();
    expect(ids).toEqual(["uk-bird", "us-cooley"]);
  });

  it("region filter respects gating", () => {
    const us = visiblePartnersByRegion("US", ["co_novapay"]);
    expect(us.map(p => p.id)).toEqual(["us-cooley"]);
    const uk = visiblePartnersByRegion("UK", ["co_arboreal"]);
    expect(uk.map(p => p.id)).toEqual(["uk-bird"]);
    // Region with no portfolio matches → empty
    const ca = visiblePartnersByRegion("CA", ["co_novapay"]);
    expect(ca).toEqual([]);
  });

  it("the registry still has all 27 partners (gating doesn't delete)", () => {
    expect(CONSORTIUM_PARTNERS.length).toBe(27);
  });
});
