/**
 * IN regional formula pack tests.
 *
 * Indian companies are governed by Companies Act 2013 + FEMA + SEBI. The math
 * matches YC v1.2 conversion (the engine tracks pool/share counts identically),
 * but the *legal instrument* differs sharply:
 *   - Preferred → Compulsorily Convertible Preference Shares (CCPS) — Companies
 *     Act §55 forbids irredeemable preference; mandatory conversion ≤ 10 yrs.
 *   - Convertible note → Compulsorily Convertible Debenture (CCD).
 *   - SAFEs are documented as CCPS subscription agreements with a hard
 *     conversion long-stop date.
 *
 * Cross-border subscription requires FEMA Form FC-GPR within 30 days; engine
 * surfaces in_fema_filing_required: true.
 *
 * ESOP exercise spread is a §17(2)(vi) perquisite taxed at the marginal slab
 * rate; engine emits in_perquisite_tax_at_exercise: true.
 */
import { describe, it, expect } from "vitest";
import { convertSafeToPreferred } from "../../src/conversion/safeToPreferred.js";
import { computeEsopTopUp } from "../../src/instruments/esopTopUp.js";
import { getFormula, listFormulas, REGIONS } from "../../src/formulas/registry.js";

describe("IN default formula pack", () => {
  it("IN preferred / SAFE issuance produces in_ccps_required: true (Companies Act 2013 §55)", () => {
    // Math is identical to US YC v1.2; the IN region adds CCPS / FEMA / stamp-duty / DPIIT flags.
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
    const india = convertSafeToPreferred({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "IN",
      formulaDef: { formula: "test" },
    });
    expect(india.safeShares.toString()).toBe(us.safeShares.toString());
    expect(india.binding).toBe("cap");
    expect(india.trace.region).toBe("IN");
    // CCPS structure mandatory under Companies Act §55.
    expect(india.trace.outputs.in_ccps_required).toBe("true");
    // Indian Stamp Act 1899 — 0.005% on issue.
    expect(india.trace.outputs.in_stamp_duty_applicable).toBe("true");
    // §56(2)(viib) angel-tax exposure unless DPIIT-recognized.
    expect(india.trace.outputs.in_dpiit_recognition_required).toBe("true");
  });

  it("IN ESOP top-up emits in_perquisite_tax_at_exercise: true (§17(2)(vi) Income-tax Act 1961)", () => {
    const f = getFormula("esop.topup", "IN");
    expect(f).toBeDefined();
    const result = computeEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "0.10",
      existingShares: 9_000_000n,
      existingPool: 0n,
      newInvestorShares: 1_000_000n,
      formulaId: f!.id,
      formulaVersion: f!.version,
      region: "IN",
      formulaDef: f!.definition,
    });
    // Pool size math still computes correctly
    expect(result.poolSharesToAdd > 0n).toBe(true);
    // Engine surfaces the IN perquisite-tax flag (TDS under §192 due in payroll month of exercise).
    expect(result.trace.outputs.in_perquisite_tax_at_exercise).toBe("true");
    expect(result.trace.region).toBe("IN");
  });

  it("IN cross-border SAFE subscription emits in_fema_filing_required: true (Form FC-GPR within 30 days)", () => {
    // Any SAFE/CCPS subscription by a non-resident triggers FEMA Form FC-GPR within 30
    // days of allotment. Engine emits in_fema_filing_required on every IN-region conversion
    // because the audience for this engine is foreign-VC-funded Indian rounds.
    const indiaSafe = convertSafeToPreferred({
      purchaseAmount: "500000",
      capType: "post_money_cap",
      cap: "8000000",
      discount: "0.20",
      seriesPricePerShare: "1.50",
      companyCapitalization: "5000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "IN",
      formulaDef: { formula: "test" },
    });
    expect(indiaSafe.trace.outputs.in_fema_filing_required).toBe("true");
    // The other IN flags travel together on every IN issuance.
    expect(indiaSafe.trace.outputs.in_ccps_required).toBe("true");
    expect(indiaSafe.trace.outputs.in_dpiit_recognition_required).toBe("true");
  });

  it("IN formula registry returns IN-tagged formulas via getFormula(id, \"IN\")", () => {
    const safePost = getFormula("safe.postmoney.conversion", "IN");
    expect(safePost).toBeDefined();
    expect(safePost!.region).toBe("IN");
    expect(safePost!.version).toBe("1.0.0");
    expect(safePost!.status).toBe("active");
    // Citation references Companies Act 2013 + FEMA
    expect(safePost!.citation.source).toMatch(/Companies Act 2013|FEMA/i);

    // Full IN pack should expose all 9 formula categories
    const inFormulas = listFormulas("IN");
    expect(inFormulas.length).toBe(9);
    const ids = new Set(inFormulas.map((f) => f.id));
    expect(ids.has("safe.postmoney.conversion")).toBe(true);
    expect(ids.has("safe.premoney.conversion")).toBe(true);
    expect(ids.has("note.conversion")).toBe(true);
    expect(ids.has("antiDilution.fullRatchet")).toBe(true);
    expect(ids.has("antiDilution.broadBased")).toBe(true);
    expect(ids.has("antiDilution.narrowBased")).toBe(true);
    expect(ids.has("esop.topup")).toBe(true);
    expect(ids.has("waterfall.liquidation")).toBe(true);
    expect(ids.has("ownership.percent")).toBe(true);

    // REGIONS export must include IN
    expect(REGIONS).toContain("IN");

    // IN ESOP formula's definition references SEBI SBEB / perquisite tax
    const esop = getFormula("esop.topup", "IN");
    expect(esop).toBeDefined();
    expect(JSON.stringify(esop!.citation)).toMatch(/SEBI|perquisite|§17\(2\)\(vi\)/i);
  });
});
