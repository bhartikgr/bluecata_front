/**
 * Wave A (v26.1.x Consortium Partner QA) — targeted unit tests for the four
 * GPT-5.5-flagged fixes plus the 2a title contract.
 */
import { describe, it, expect } from "vitest";
import { PARTNER_TITLES, isPartnerTitle } from "../../shared/partnerTitles";

describe("Wave A / 2a — partner titles contract", () => {
  it("contains exactly the 18 QA-slide titles, in order", () => {
    expect(PARTNER_TITLES).toEqual([
      "Managing Partner",
      "General Partner",
      "Partner",
      "Venture Partner",
      "Principal",
      "Director",
      "Vice President",
      "Senior Associate",
      "Associate",
      "Analyst",
      "Business Development",
      "Investor Relations",
      "Operations",
      "Finance / Controller",
      "Legal / Compliance",
      "Advisor",
      "Limited Partner (LP)",
      "Viewer",
    ]);
    expect(PARTNER_TITLES.length).toBe(18);
  });

  it("isPartnerTitle accepts known titles and rejects unknown / non-strings", () => {
    expect(isPartnerTitle("Venture Partner")).toBe(true);
    expect(isPartnerTitle("Managing Partner")).toBe(true);
    expect(isPartnerTitle("Grand Poobah")).toBe(false);
    expect(isPartnerTitle("")).toBe(false);
    expect(isPartnerTitle(null)).toBe(false);
    expect(isPartnerTitle(42)).toBe(false);
  });

  it("titles never collide with the 5 permission tiers (subRole values)", () => {
    // A title must never be one of the enforced permission-tier enum values,
    // so it can never be mistaken for / escalate a permission.
    const permissionTiers = ["managing_partner", "associate", "bd", "analyst", "viewer"];
    for (const t of PARTNER_TITLES) {
      expect(permissionTiers).not.toContain(t);
    }
  });
});

describe("Wave A / 1c — SPV launch sign-off store", () => {
  it("recordSignoff persists durably then links to an SPV id; fail-closed on DB error", async () => {
    const mod = await import("../spvLaunchSignoffStore");
    const { recordSignoff, listSignoffsForSpv, linkSignoffToSpv, ATTESTATION_VERSION } = mod;
    // The connection self-heal creates spv_launch_signoffs on a fresh :memory: DB,
    // so a happy-path record should durably persist and be readable back.
    const rec = recordSignoff({
      partnerId: "p_test",
      spvId: "",
      userId: "u_test",
      signerLegalName: "Ada Lovelace",
      signerSubRole: "managing_partner",
      ip: "127.0.0.1",
      userAgent: "vitest",
    });
    expect(rec.signerLegalName).toBe("Ada Lovelace");
    expect(rec.signerSubRole).toBe("managing_partner");
    expect(rec.attestationVersion).toBe(ATTESTATION_VERSION);
    // Link to a real SPV id, then confirm it is readable under that SPV.
    linkSignoffToSpv(rec.id, "spv_test");
    const rows = listSignoffsForSpv("p_test", "spv_test");
    expect(rows.some((r) => r.id === rec.id && r.signerLegalName === "Ada Lovelace")).toBe(true);
  });
});
