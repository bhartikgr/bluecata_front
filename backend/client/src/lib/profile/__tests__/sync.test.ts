/**
 * Sprint 8 — Cross-cutting sync tests.
 *
 * Pure-logic verification that the country -> region -> attribution chain
 * resolves end-to-end (without UI). This is the "dynamically connected with
 * the rest of the sites" mandate from the user.
 */
import { describe, it, expect } from "vitest";
import { regionForCountry, engineAttribution, defaultTermSheetTemplate } from "../region";
import { deriveLegalFields, applyProfilePatch, diffChangedFields } from "../types";
import { SEED_COMPANY_PROFILE } from "../seed";
import { kycVariantForCountry } from "../data/enums";

describe("country → region → engine → KYC propagation", () => {
  it.each([
    ["US", "US", "us_reg_d_506c", "us_nvca_seed"],
    ["IN", "IN", "in_fema_kyc",   "in_pvt_seed"],
    ["GB", "UK", "uk_self_certified", "uk_bvca_seed"],
    ["JP", "JP", "jp_qii",        "jp_kk_seed"],
    ["AU", "AU", "au_sophisticated", "au_pty_seed"],
    ["SG", "SG", "sg_accredited", "sg_pte_seed"],
    ["HK", "HK", "hk_professional", "hk_seed"],
    ["CN", "CN", "cn_safe_circular_37", "cn_wfoe_seed"],
    ["CA", "CA", "ca_ni_45_106", "ca_nvca_inspired_seed"],
  ])("country %s -> region %s, kyc %s, template %s", (country, region, kyc, tpl) => {
    expect(regionForCountry(country)).toBe(region);
    expect(kycVariantForCountry(country)).toBe(kyc);
    expect(defaultTermSheetTemplate(region as Parameters<typeof defaultTermSheetTemplate>[0])).toBe(tpl);
  });

  it("changing countryOfIncorporation produces matching diff + new derivations", () => {
    // Start: US. Change to India.
    const next = applyProfilePatch(SEED_COMPANY_PROFILE, {
      legal: {
        ...SEED_COMPANY_PROFILE.legal,
        countryOfIncorporationCode: "IN",
        ...deriveLegalFields("IN"),
      },
    });
    // Region must update.
    expect(next.legal.region).toBe("IN");
    // KYC variant must update.
    expect(next.legal.kycVariant).toBe("in_fema_kyc");
    // Attribution must update.
    expect(next.legal.engineAttribution).toBe("Computed by IN-default v1.0.0");
    // Diff returns the four fields that changed.
    const diff = diffChangedFields(SEED_COMPANY_PROFILE, next);
    expect(diff).toContain("legal.countryOfIncorporationCode");
    expect(diff).toContain("legal.region");
    expect(diff).toContain("legal.kycVariant");
    expect(diff).toContain("legal.engineAttribution");
  });

  it("badge string is exactly the format the cap-table page renders", () => {
    expect(engineAttribution(regionForCountry("IN"))).toBe("Computed by IN-default v1.0.0");
    expect(engineAttribution(regionForCountry("US"))).toBe("Computed by US-default v1.0.0");
    expect(engineAttribution(regionForCountry("BR"))).toBe("Computed by Custom-default v1.0.0");
  });
});

describe("changedFields[] sync payload contract", () => {
  it("returns top-level changed sections via prefix paths", () => {
    const next = applyProfilePatch(SEED_COMPANY_PROFILE, {
      contact: { ...SEED_COMPANY_PROFILE.contact, oneSentenceHeadliner: "Updated headline" },
    });
    const diff = diffChangedFields(SEED_COMPANY_PROFILE, next);
    expect(diff).toEqual(["contact.oneSentenceHeadliner"]);
  });

  it("multi-field changes produce stable, sorted-equivalent paths", () => {
    const next = applyProfilePatch(SEED_COMPANY_PROFILE, {
      ma: {
        ...SEED_COMPANY_PROFILE.ma,
        hasFormalBoard: false,
        hasEsgFramework: true,
      },
    });
    const diff = diffChangedFields(SEED_COMPANY_PROFILE, next);
    expect(diff).toContain("ma.hasFormalBoard");
    expect(diff).toContain("ma.hasEsgFramework");
  });
});
