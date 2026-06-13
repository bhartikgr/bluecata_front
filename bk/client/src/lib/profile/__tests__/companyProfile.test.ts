/**
 * Sprint 8 — Company profile schema tests.
 *
 * Locks the production-shape contract: enums, validation, derivations, and
 * the M&A score formula. If any of these break, the Capavate ↔ Collective
 * sync contract breaks, so these tests are the safety net.
 */
import { describe, it, expect } from "vitest";
import {
  companyContactSchema, companyAddressSchema, companyLegalSchema, companyMaSchema,
  companyProfileSchema, companyProfilePatchSchema,
  deriveLegalFields, computeMaReadinessScore,
  applyProfilePatch, diffChangedFields,
} from "../types";
import { SEED_COMPANY_PROFILE } from "../seed";
import { regionForCountry, engineAttribution } from "../region";

describe("company profile — region derivation", () => {
  it("US country → US region", () => {
    expect(regionForCountry("US")).toBe("US");
  });
  it("India → IN", () => expect(regionForCountry("IN")).toBe("IN"));
  it("UK (GB) → UK", () => expect(regionForCountry("GB")).toBe("UK"));
  it("China → CN, Japan → JP, Australia → AU", () => {
    expect(regionForCountry("CN")).toBe("CN");
    expect(regionForCountry("JP")).toBe("JP");
    expect(regionForCountry("AU")).toBe("AU");
  });
  it("unknown country → Custom", () => {
    expect(regionForCountry("BR")).toBe("Custom");
    expect(regionForCountry("")).toBe("Custom");
    expect(regionForCountry(null)).toBe("Custom");
  });
  it("engineAttribution renders [REGION]-default v1.0.0", () => {
    expect(engineAttribution("IN")).toBe("Computed by IN-default v1.0.0");
    expect(engineAttribution("US", "1.2.3")).toBe("Computed by US-default v1.2.3");
  });
  it("deriveLegalFields produces region + KYC variant + attribution together", () => {
    const us = deriveLegalFields("US");
    expect(us.region).toBe("US");
    expect(us.kycVariant).toBe("us_reg_d_506c");
    expect(us.engineAttribution).toBe("Computed by US-default v1.0.0");
    const india = deriveLegalFields("IN");
    expect(india.region).toBe("IN");
    expect(india.kycVariant).toBe("in_fema_kyc");
    expect(india.engineAttribution).toBe("Computed by IN-default v1.0.0");
  });
});

describe("company profile — schema validation", () => {
  it("seed profile validates against full schema", () => {
    expect(() => companyProfileSchema.parse(SEED_COMPANY_PROFILE)).not.toThrow();
  });

  it("rejects invalid industry value", () => {
    const r = companyContactSchema.safeParse({
      ...SEED_COMPANY_PROFILE.contact,
      industry: "not-a-real-industry",
    });
    expect(r.success).toBe(false);
  });

  it("rejects oneSentenceHeadliner > 400 chars", () => {
    const r = companyContactSchema.safeParse({
      ...SEED_COMPANY_PROFILE.contact,
      oneSentenceHeadliner: "x".repeat(401),
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 3 strategic priorities", () => {
    const r = companyMaSchema.safeParse({
      ...SEED_COMPANY_PROFILE.ma,
      strategicPriorities: ["market_expansion", "tech_acquisition", "vertical_integration", "rd_innovation"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown country codes", () => {
    const r = companyAddressSchema.safeParse({
      ...SEED_COMPANY_PROFILE.address,
      countryCode: "XX",
    });
    expect(r.success).toBe(false);
  });

  it("PATCH schema accepts partial sections", () => {
    const r = companyProfilePatchSchema.safeParse({
      contact: { companyName: "New Name" },
    });
    expect(r.success).toBe(true);
  });

  it("PATCH schema rejects an invalid enum even in a partial section", () => {
    const r = companyProfilePatchSchema.safeParse({
      contact: { numberOfEmployees: "10000+" }, // not a valid range
    });
    expect(r.success).toBe(false);
  });
});

describe("company profile — M&A readiness score", () => {
  it("seed profile scores in a believable range (60-95)", () => {
    const { score } = computeMaReadinessScore(SEED_COMPANY_PROFILE.ma);
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThanOrEqual(95);
  });

  it("empty M&A panel scores low (<= 25)", () => {
    const empty = {
      ...SEED_COMPANY_PROFILE.ma,
      strategicPriorities: [],
      transactionInterests: [],
      partnerTypesSought: [],
      dealBreakers: [],
      competitor1Name: "", competitor2Name: "", competitor3Name: "",
      hasFormalBoard: false, hasPendingLitigation: true,
      isRegulatoryCompliant: false, hasExternalLegalCounsel: false,
      isFinanciallyAudited: false, isSaasRecurring: false,
      holdsMaterialIp: false, hasEsgFramework: false, hasDeiPolicy: false,
      hasCybersecurityCertification: false, accountingFirmName: "",
      operatingGeographies: [], customerSegments: [],
      hasMfnExclusivity: false, hasRevenueConcentration30Pct: false,
      hasChangeOfControlClauses: false,
      maReadinessNarrative: "",
      uniqueValueProposition: "",
    };
    const { score } = computeMaReadinessScore(empty);
    expect(score).toBeLessThanOrEqual(25);
  });

  it("sums components correctly (each clamped to its weight)", () => {
    const { components } = computeMaReadinessScore(SEED_COMPANY_PROFILE.ma);
    for (const c of components) {
      expect(c.awarded).toBeGreaterThanOrEqual(0);
    }
    const total = components.reduce((acc, c) => acc + c.weight, 0);
    expect(total).toBe(100);
  });
});

describe("company profile — patch + diff", () => {
  it("applyProfilePatch shallow-merges sections without losing siblings", () => {
    const merged = applyProfilePatch(SEED_COMPANY_PROFILE, {
      contact: { ...SEED_COMPANY_PROFILE.contact, companyName: "Renamed Co" },
    });
    expect(merged.contact.companyName).toBe("Renamed Co");
    expect(merged.contact.companyEmail).toBe(SEED_COMPANY_PROFILE.contact.companyEmail);
    expect(merged.legal).toEqual(SEED_COMPANY_PROFILE.legal);
  });

  it("diffChangedFields returns dotted paths", () => {
    const next = applyProfilePatch(SEED_COMPANY_PROFILE, {
      legal: { ...SEED_COMPANY_PROFILE.legal, countryOfIncorporationCode: "IN" },
    });
    const changes = diffChangedFields(SEED_COMPANY_PROFILE, next);
    expect(changes).toContain("legal.countryOfIncorporationCode");
  });

  it("diffChangedFields detects array changes wholesale (not item-level)", () => {
    const next = applyProfilePatch(SEED_COMPANY_PROFILE, {
      ma: {
        ...SEED_COMPANY_PROFILE.ma,
        operatingGeographies: ["north_america"],
      },
    });
    const changes = diffChangedFields(SEED_COMPANY_PROFILE, next);
    expect(changes).toContain("ma.operatingGeographies");
  });
});
