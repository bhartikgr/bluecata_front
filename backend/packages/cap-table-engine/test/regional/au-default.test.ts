/**
 * AU regional formula pack tests.
 *
 * Australian Pty Ltd companies are governed by the Corporations Act 2001 (Cth).
 * Share issuance under §254A requires Form 484 lodgement with ASIC within 28
 * days. Engine emits au_corporations_act_filing: true.
 *
 * The standout AU mechanism is the Employee Share Scheme (ESS) startup
 * concession under ITAA 1997 §83A-105: companies < 10 yrs old, < $50M
 * turnover, unlisted, AU-resident — no tax until disposal. The 50% CGT
 * discount under §115-100 applies to AU-resident individuals on > 12 mo
 * holdings.
 */
import { describe, it, expect } from "vitest";
import { convertSafeToPreferred } from "../../src/conversion/safeToPreferred.js";
import { computeEsopTopUp } from "../../src/instruments/esopTopUp.js";
import { computeWaterfall } from "../../src/waterfall/liquidationWaterfall.js";
import { getFormula, listFormulas, REGIONS } from "../../src/formulas/registry.js";

describe("AU default formula pack", () => {
  it("AU preferred / SAFE issuance triggers au_corporations_act_filing: true (Form 484, 28 days)", () => {
    const us = convertSafeToPreferred({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    const au = convertSafeToPreferred({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "AU",
      formulaDef: { formula: "test" },
    });
    // Math identical to US Pty-Ltd-equivalent calculation
    expect(au.safeShares.toString()).toBe(us.safeShares.toString());
    expect(au.binding).toBe("cap");
    expect(au.trace.region).toBe("AU");
    // Form 484 lodgement flag must be set
    expect(au.trace.outputs.au_corporations_act_filing).toBe("true");
  });

  it("AU ESOP grant for company qualifying for ESS startup concession produces au_ess_startup_concession_eligible: true", () => {
    const f = getFormula("esop.topup", "AU");
    expect(f).toBeDefined();

    // Company qualifies for §83A-105 startup concession (< 10 yr, < $50M, unlisted, AU-resident).
    const qualifying = computeEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "0.10",
      existingShares: 9_000_000n,
      existingPool: 0n,
      newInvestorShares: 1_000_000n,
      formulaId: f!.id,
      formulaVersion: f!.version,
      region: "AU",
      formulaDef: f!.definition,
      auEssStartupConcession: true,
    });
    // Pool sizing math still computes
    expect(qualifying.poolSharesToAdd > 0n).toBe(true);
    // Engine surfaces the startup concession flag — no tax until disposal
    expect(qualifying.trace.outputs.au_ess_startup_concession_eligible).toBe("true");
    // ASIC Form 484 also flagged on issuance
    expect(qualifying.trace.outputs.au_corporations_act_filing).toBe("true");

    // Non-qualifying company falls back to the deferred-tax regime.
    const nonQualifying = computeEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "0.10",
      existingShares: 9_000_000n,
      existingPool: 0n,
      newInvestorShares: 1_000_000n,
      formulaId: f!.id,
      formulaVersion: f!.version,
      region: "AU",
      formulaDef: f!.definition,
      auEssStartupConcession: false,
    });
    expect(nonQualifying.trace.outputs.au_ess_startup_concession_eligible).toBe("false");
  });

  it("AU liquidation waterfall with CGT-eligible holdings emits au_cgt_50_percent_discount_eligible: true (§115-100)", () => {
    const f = getFormula("waterfall.liquidation", "AU");
    expect(f).toBeDefined();

    // Holdings held > 12 months by AU-resident individual → 50% CGT discount applies.
    const eligible = computeWaterfall({
      exitProceeds: "10000000",
      preferred: [{
        classId: "A",
        className: "Series A Preferred",
        invested: "1000000",
        shares: 1_000_000n,
        liquidationPreferenceMultiple: 1,
        participating: false,
        seniority: 0,
      }],
      common: [{ holderId: "founders", shares: 9_000_000n }],
      formulaId: f!.id,
      formulaVersion: f!.version,
      region: "AU",
      formulaDef: f!.definition,
      auCgtDiscountEligible: true,
    });
    expect(eligible.trace.outputs.au_cgt_50_percent_discount_eligible).toBe("true");
    // Total payouts sum to gross exit (no WHT in standard AU exit)
    const total = eligible.payouts.reduce((s, p) => s + Number(p.total), 0);
    expect(total).toBeCloseTo(10_000_000, 0);

    // Foreign-resident individual (post-2012, §115-105 removed the discount) → flag false.
    const ineligible = computeWaterfall({
      exitProceeds: "10000000",
      preferred: [{
        classId: "A",
        className: "Series A Preferred",
        invested: "1000000",
        shares: 1_000_000n,
        liquidationPreferenceMultiple: 1,
        participating: false,
        seniority: 0,
      }],
      common: [{ holderId: "founders", shares: 9_000_000n }],
      formulaId: f!.id,
      formulaVersion: f!.version,
      region: "AU",
      formulaDef: f!.definition,
    });
    expect(ineligible.trace.outputs.au_cgt_50_percent_discount_eligible).toBe("false");
  });

  it("AU formula registry returns AU-tagged formulas via getFormula(id, \"AU\")", () => {
    const safePost = getFormula("safe.postmoney.conversion", "AU");
    expect(safePost).toBeDefined();
    expect(safePost!.region).toBe("AU");
    expect(safePost!.version).toBe("1.0.0");
    expect(safePost!.status).toBe("active");
    // Citation references Corporations Act 2001
    expect(safePost!.citation.source).toMatch(/Corporations Act 2001/i);

    // Full AU pack should expose all 9 formula categories
    const auFormulas = listFormulas("AU");
    expect(auFormulas.length).toBe(9);
    const ids = new Set(auFormulas.map((f) => f.id));
    expect(ids.has("safe.postmoney.conversion")).toBe(true);
    expect(ids.has("note.conversion")).toBe(true);
    expect(ids.has("antiDilution.broadBased")).toBe(true);
    expect(ids.has("esop.topup")).toBe(true);
    expect(ids.has("waterfall.liquidation")).toBe(true);
    expect(ids.has("ownership.percent")).toBe(true);

    // REGIONS export must include AU
    expect(REGIONS).toContain("AU");

    // AU ESOP definition references §83A-105 startup concession + §115-100 CGT discount
    const esop = getFormula("esop.topup", "AU");
    expect(esop).toBeDefined();
    expect(JSON.stringify(esop!.citation)).toMatch(/§83A-105|Division 83A|Startup concession/i);

    // AU waterfall references §115-100 CGT discount
    const w = getFormula("waterfall.liquidation", "AU");
    expect(w).toBeDefined();
    expect(JSON.stringify(w!.citation)).toMatch(/§115-100|CGT discount/i);
  });
});
