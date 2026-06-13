import { describe, it, expect } from "vitest";
import { extractTermsFromText, reconcileTerms, type UploadedTerms } from "../templates";
import type { TermSheetData } from "../types";

const baseRound: TermSheetData = {
  companyName: "Acme Corp",
  companyLegalName: "Acme Corp, Inc.",
  roundName: "Series Seed",
  roundType: "seed",
  region: "US",
  instrument: "preferred",
  leadInvestor: "Hydra Capital",
  targetAmount: 4_000_000,
  preMoney: 18_000_000,
  postMoney: 22_000_000,
  pricePerShare: 1.42,
  fdSharesPreMoney: 12_500_000,
  liqPrefMultiple: 1,
  participating: false,
  capParticipation: "non-participating",
  antiDilutionVariant: "broad_based_wa",
  valuationCap: 0,
  discount: 0,
  interestRate: 0,
  maturityMonths: 0,
  mfn: false,
  poolSize: 10,
  poolTiming: "post_money",
  vestingMonths: 48,
  cliffMonths: 12,
  closeDate: "2026-07-15",
  founderNames: ["Avi Barnes"],
  governingLaw: "Delaware",
};

describe("reconcileTerms", () => {
  it("returns no mismatches when uploaded pre-money matches the round", () => {
    const uploaded: UploadedTerms = { preMoney: 18_000_000 };
    const diffs = reconcileTerms(baseRound, uploaded);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].match).toBe(true);
    expect(diffs.filter((d) => !d.match)).toHaveLength(0);
  });

  it("flags pre-money mismatch when uploaded value differs", () => {
    const uploaded: UploadedTerms = { preMoney: 15_000_000 };
    const diffs = reconcileTerms(baseRound, uploaded);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("Pre-money valuation");
    expect(diffs[0].match).toBe(false);
  });

  it("flags liquidation-preference multiple mismatch", () => {
    const uploaded: UploadedTerms = { liqPrefMultiple: 2 };
    const diffs = reconcileTerms(baseRound, uploaded);
    expect(diffs.find((d) => d.field === "Liquidation preference multiple")?.match).toBe(false);
  });

  it("extracts pre-money + liq pref + discount from typical phrasing", () => {
    const text = "Pre-money valuation: $18,000,000. The Series A Preferred shares carry 1x non-participating preferred. 20% discount applies on conversion.";
    const t = extractTermsFromText(text);
    expect(t.preMoney).toBe(18_000_000);
    expect(t.liqPrefMultiple).toBe(1);
    expect(t.discount).toBe(20);
    expect(t.instrument).toBe("preferred");
  });
});
