import { describe, it, expect } from "vitest";
import { getTemplate, renderTermSheetText, extractTermsFromText, reconcileTerms } from "../templates";
import type { TermSheetData, Region } from "../types";
import type { InstrumentValue } from "@shared/schema";

const mockData: TermSheetData = {
  companyName: "NovaPay AI",
  companyLegalName: "NovaPay AI, Inc.",
  roundName: "NovaPay Series A",
  roundType: "series_a",
  region: "US",
  instrument: "preferred",
  leadInvestor: "Hydra Capital",
  targetAmount: 10_000_000,
  preMoney: 40_000_000,
  postMoney: 50_000_000,
  pricePerShare: 3.85,
  fdSharesPreMoney: 12_000_000,
  liqPrefMultiple: 1,
  participating: false,
  capParticipation: "",
  antiDilutionVariant: "Broad-Based Weighted-Average",
  valuationCap: 8_000_000,
  discount: 20,
  interestRate: 6,
  maturityMonths: 24,
  mfn: true,
  poolSize: 10,
  poolTiming: "pre_money",
  vestingMonths: 48,
  cliffMonths: 12,
  closeDate: "2026-07-15",
  founderNames: ["Maya Chen", "Daniel Okafor"],
  governingLaw: "",
};

const REGIONS: Region[] = ["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU"];
const INSTRUMENTS: InstrumentValue[] = ["common", "preferred", "safe_post", "safe_pre", "convertible_note", "warrant", "option_pool"];

describe("Term sheet templates", () => {
  it("NVCA Series A renders 1× non-participating + broad-based WA correctly", () => {
    const t = getTemplate("US", "preferred", { ...mockData, liqPrefMultiple: 1, participating: false, antiDilutionVariant: "Broad-Based Weighted-Average" });
    const text = renderTermSheetText(t, mockData);
    expect(t.templateName).toMatch(/NVCA/);
    expect(text).toMatch(/1× non-participating/);
    expect(text).toMatch(/Broad-Based Weighted-Average/);
    expect(text).toMatch(/\$10,000,000/);
    expect(text).toMatch(/\$40,000,000/);
  });

  it("UK BVCA template references Companies Act 2006", () => {
    const t = getTemplate("UK", "preferred", { ...mockData, region: "UK" });
    const text = renderTermSheetText(t, { ...mockData, region: "UK" });
    expect(t.templateName).toMatch(/BVCA/);
    expect(text).toMatch(/Companies Act 2006/);
  });

  it("IN CCPS template references Companies Act 2013 §55 + compulsorily convertible", () => {
    const d = { ...mockData, region: "IN" as Region };
    const t = getTemplate("IN", "preferred", d);
    const text = renderTermSheetText(t, d);
    expect(t.templateName).toMatch(/CCPS|Compulsorily Convertible/i);
    expect(text).toMatch(/Companies Act 2013/);
    expect(text).toMatch(/§55/);
    expect(text.toLowerCase()).toMatch(/compulsorily convertible/);
  });

  it("JP J-KISS template references J-KISS + Coral Capital", () => {
    const d = { ...mockData, region: "JP" as Region, instrument: "safe_post" as InstrumentValue };
    const t = getTemplate("JP", "safe_post", d);
    const text = renderTermSheetText(t, d);
    expect(t.templateName).toMatch(/J-KISS/);
    expect(t.sourceCitations.join("\n")).toMatch(/Coral Capital/);
  });

  it("Every region × instrument combination has non-empty citations", () => {
    for (const region of REGIONS) {
      for (const inst of INSTRUMENTS) {
        const t = getTemplate(region, inst, { ...mockData, region, instrument: inst });
        expect(t.sourceCitations.length, `${region}/${inst} citations`).toBeGreaterThanOrEqual(3);
        expect(t.sections.length, `${region}/${inst} sections`).toBeGreaterThan(5);
        // counsel disclaimer is always present
        expect(t.sections.some(s => s.disclaimerSection === true)).toBe(true);
      }
    }
  });

  it("Region-specific governing law clause is present in every template", () => {
    for (const region of REGIONS) {
      const t = getTemplate(region, "preferred", { ...mockData, region });
      const text = renderTermSheetText(t, { ...mockData, region });
      expect(text).toMatch(/Governing Law/);
    }
  });

  it("Region/instrument fallback never returns undefined", () => {
    const t = getTemplate("US", "warrant", mockData);
    expect(t).toBeDefined();
    expect(t.templateName).toBeTruthy();
    expect(t.sections.length).toBeGreaterThan(3);
  });
});

describe("Term sheet reconciliation — extract + compare", () => {
  it("matching uploaded pre-money returns no mismatch", () => {
    const text = "Pre-Money Valuation: $40,000,000. Liquidation Preference 1× non-participating preferred. Broad-based weighted average anti-dilution.";
    const extracted = extractTermsFromText(text);
    const diffs = reconcileTerms(mockData, extracted);
    const pre = diffs.find(d => d.field === "Pre-money valuation");
    expect(pre?.match).toBe(true);
  });

  it("different pre-money returns one mismatch", () => {
    const text = "Pre-Money Valuation: $20,000,000. 1× non-participating preferred.";
    const extracted = extractTermsFromText(text);
    const diffs = reconcileTerms(mockData, extracted);
    const pre = diffs.find(d => d.field === "Pre-money valuation");
    expect(pre?.match).toBe(false);
  });

  it("different liq-pref multiple returns mismatch", () => {
    const text = "Pre-Money Valuation: $40,000,000. 2× participating preferred.";
    const extracted = extractTermsFromText(text);
    const diffs = reconcileTerms(mockData, extracted);
    const liq = diffs.find(d => d.field === "Liquidation preference multiple");
    expect(liq?.match).toBe(false);
  });

  it("extracts million suffix correctly", () => {
    const text = "Pre-money valuation of $40 million; valuation cap $8 million.";
    const extracted = extractTermsFromText(text);
    expect(extracted.preMoney).toEqual(40_000_000);
    expect(extracted.valuationCap).toEqual(8_000_000);
  });

  it("extracts full ratchet anti-dilution", () => {
    const text = "Anti-dilution: full ratchet protection.";
    const extracted = extractTermsFromText(text);
    expect(extracted.antiDilution).toEqual("full_ratchet");
  });
});
