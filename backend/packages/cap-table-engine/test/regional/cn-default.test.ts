/**
 * CN regional formula pack tests.
 *
 * Mainland China startups raising USD/foreign capital almost always run under
 * a Cayman parent → BVI / HK intermediate → WFOE / VIE → onshore OpCo. The
 * underlying math at the Cayman-parent level matches YC US conventions; the
 * CN region adds three engine-level differences:
 *
 *   1. SAFE Circular 37 cross-border registration flag on every conversion.
 *   2. Phantom-equity / SARs ESOP variant — contractual cash-settled units
 *      that bypass share issuance entirely (no SAMR filing needed).
 *   3. Onshore→offshore dividend WHT applied to the waterfall (10% standard,
 *      5% under HK-PRC double-tax treaty for qualifying recipients).
 */
import { describe, it, expect } from "vitest";
import { convertSafeToPreferred } from "../../src/conversion/safeToPreferred.js";
import { computeEsopTopUp } from "../../src/instruments/esopTopUp.js";
import { computeWaterfall } from "../../src/waterfall/liquidationWaterfall.js";
import { getFormula, listFormulas, REGIONS } from "../../src/formulas/registry.js";

describe("CN default formula pack", () => {
  it("CN SAFE conversion produces same math as US but trace contains safe_circular_37_required: true", () => {
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
    const cn = convertSafeToPreferred({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "CN",
      formulaDef: { formula: "test" },
    });
    // Math is identical
    expect(cn.safeShares.toString()).toBe(us.safeShares.toString());
    expect(cn.conversionPrice).toBe(us.conversionPrice);
    expect(cn.binding).toBe("cap");
    // CN-specific trace flags
    expect(cn.trace.region).toBe("CN");
    expect(cn.trace.outputs.safe_circular_37_required).toBe("true");
    expect(cn.trace.outputs.samr_filing_required).toBe("true");
  });

  it("CN ESOP supports phantom_equity variant — no actual shares issued, contractual units tracked", () => {
    const f = getFormula("esop.topup", "CN");
    expect(f).toBeDefined();
    const result = computeEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "0.10",
      existingShares: 9_000_000n,
      existingPool: 0n,
      newInvestorShares: 1_000_000n,
      formulaId: f!.id,
      formulaVersion: f!.version,
      region: "CN",
      formulaDef: f!.definition,
      phantomEquity: true,
    });
    // Pool sizing math still computes (for tracking)
    expect(result.poolSharesToAdd > 0n).toBe(true);
    // Trace marks the grant as phantom equity with no actual share issuance
    expect(result.trace.outputs.phantom_equity).toBe("true");
    expect(result.trace.outputs.shares_issued).toBe("0");
    expect(result.trace.outputs.cn_phantom_equity_no_samr_filing).toBe("true");
    expect(result.trace.region).toBe("CN");
  });

  it("CN liquidation waterfall applies 10% withholding tax when configured", () => {
    // $10M exit, single non-participating preferred class with $1M @ 1x preference,
    // 1M preferred shares + 9M common (founders).
    // Without WHT: preferred takes max(1M, asConverted at 10M / 10M = 1M) → preferred is indifferent.
    //   Founders take remaining $9M.
    // With 10% WHT on $10M gross → net exit = $9M.
    //   Preferred: pref = $1M, asConvAtFull = 1M/10M × $9M = $900k → preference wins.
    //   Founders: $9M − $1M = $8M pro-rata.
    const f = getFormula("waterfall.liquidation", "CN");
    expect(f).toBeDefined();

    const noWht = computeWaterfall({
      exitProceeds: "10000000",
      preferred: [{
        classId: "A",
        className: "Series A",
        invested: "1000000",
        shares: 1_000_000n,
        liquidationPreferenceMultiple: 1,
        participating: false,
        seniority: 0,
      }],
      common: [{ holderId: "founders", shares: 9_000_000n }],
      formulaId: f!.id,
      formulaVersion: f!.version,
      region: "CN",
      formulaDef: f!.definition,
    });

    const withWht = computeWaterfall({
      exitProceeds: "10000000",
      preferred: [{
        classId: "A",
        className: "Series A",
        invested: "1000000",
        shares: 1_000_000n,
        liquidationPreferenceMultiple: 1,
        participating: false,
        seniority: 0,
      }],
      common: [{ holderId: "founders", shares: 9_000_000n }],
      formulaId: f!.id,
      formulaVersion: f!.version,
      region: "CN",
      formulaDef: f!.definition,
      withholdingTaxRate: "0.10",
    });

    // No-WHT: total payouts sum to $10M (gross)
    const noWhtTotal = noWht.payouts.reduce((s, p) => s + Number(p.total), 0);
    expect(noWhtTotal).toBeCloseTo(10_000_000, 0);

    // With-WHT: total payouts sum to $9M (net of 10% WHT)
    const withWhtTotal = withWht.payouts.reduce((s, p) => s + Number(p.total), 0);
    expect(withWhtTotal).toBeCloseTo(9_000_000, 0);

    // Trace surfaces the CN dividend WHT flag and amounts
    expect(withWht.trace.outputs.cn_dividend_wht_applied).toBe("true");
    expect(withWht.trace.outputs.netExit).toBe("9000000");
    expect(withWht.trace.outputs.withholdingTaxApplied).toBe("1000000");
  });

  it("CN formula registry returns CN-tagged formulas via getFormula(id, \"CN\")", () => {
    const safePost = getFormula("safe.postmoney.conversion", "CN");
    expect(safePost).toBeDefined();
    expect(safePost!.region).toBe("CN");
    expect(safePost!.version).toBe("1.0.0");
    expect(safePost!.status).toBe("active");
    // Citation references PRC Company Law and SAFE Circular 37
    expect(safePost!.citation.note).toMatch(/Circular 37|PRC|Cayman/i);

    // Full CN pack should expose all 9 formula categories
    const cnFormulas = listFormulas("CN");
    expect(cnFormulas.length).toBe(9);
    const ids = new Set(cnFormulas.map((f) => f.id));
    expect(ids.has("safe.postmoney.conversion")).toBe(true);
    expect(ids.has("note.conversion")).toBe(true);
    expect(ids.has("antiDilution.broadBased")).toBe(true);
    expect(ids.has("esop.topup")).toBe(true);
    expect(ids.has("waterfall.liquidation")).toBe(true);

    // REGIONS export must include CN
    expect(REGIONS).toContain("CN");

    // CN ESOP formula's definition should mention phantom_equity
    const esop = getFormula("esop.topup", "CN");
    expect(esop).toBeDefined();
    expect(JSON.stringify(esop!.definition)).toMatch(/phantom_equity/i);
  });
});
