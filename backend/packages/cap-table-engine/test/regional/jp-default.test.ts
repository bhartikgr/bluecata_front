/**
 * JP regional formula pack tests.
 *
 * Japanese Kabushiki Kaisha (株式会社) raise via class shares (種類株式) under
 * Companies Act of Japan §107-108. The SAFE-equivalent is the J-KISS — Coral
 * Capital's open-source convertible-equity instrument that converts into a
 * defined A-class share at the next priced round.
 *
 * Stock acquisition rights (新株予約権) cover both warrants and employee
 * options. Tax-qualified options under Income Tax Act §29-2 receive favourable
 * treatment (no income tax at exercise, only 20.315% CGT at sale); non-
 * qualified options are taxed at exercise as employment income (up to 55%).
 */
import { describe, it, expect } from "vitest";
import { convertSafeToPreferred } from "../../src/conversion/safeToPreferred.js";
import { exerciseOption } from "../../src/conversion/optionExercise.js";
import { computeWaterfall } from "../../src/waterfall/liquidationWaterfall.js";
import { getFormula, listFormulas, REGIONS } from "../../src/formulas/registry.js";

describe("JP default formula pack", () => {
  it("JP preferred / J-KISS issuance produces jp_class_shares_required: true (Companies Act §107-108)", () => {
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
    const jp = convertSafeToPreferred({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "JP",
      formulaDef: { formula: "test" },
    });
    // Math is identical
    expect(jp.safeShares.toString()).toBe(us.safeShares.toString());
    expect(jp.binding).toBe("cap");
    // Class share designation required in 定款 (articles of incorporation)
    expect(jp.trace.region).toBe("JP");
    expect(jp.trace.outputs.jp_class_shares_required).toBe("true");
  });

  it("JP J-KISS conversion produces jp_jkiss_template_used: true (Coral Capital open-source)", () => {
    // J-KISS is the JP SAFE-equivalent — Coral Capital open-source. Engine surfaces
    // jp_jkiss_template_used: true on every JP-region SAFE conversion so doc-gen
    // pipelines emit the correct 新株予約権 template.
    const result = convertSafeToPreferred({
      purchaseAmount: "500000",
      capType: "post_money_cap",
      cap: "5000000",
      discount: "0.20",
      seriesPricePerShare: "1.00",
      companyCapitalization: "5000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "JP",
      formulaDef: { formula: "test" },
    });
    expect(result.trace.outputs.jp_jkiss_template_used).toBe("true");
    expect(result.trace.region).toBe("JP");
  });

  it("JP tax-qualified vs non-qualified stock option grants emit the correct flag", () => {
    // Tax-qualified (Income Tax Act §29-2): NO income tax at exercise; 20.315% CGT at sale only.
    const qualified = exerciseOption({
      exercisedOptions: 100_000n,
      exercisePrice: "1.00",
      fmvPerShare: "5.00",
      cashless: false,
      formulaId: "option.exercise",
      formulaVersion: "1.0.0",
      region: "JP",
      formulaDef: { formula: "exercise" },
      jpTaxQualified: true,
    });
    expect(qualified.trace.outputs.jp_tax_qualified_option).toBe("true");
    // Tax-qualified: no income tax at exercise, so the income-tax-at-exercise flag is NOT set.
    expect(qualified.trace.outputs.jp_income_tax_at_exercise).toBeUndefined();

    // Non-qualified: income tax due at exercise on (FMV − strike) × shares spread.
    const nonQualified = exerciseOption({
      exercisedOptions: 100_000n,
      exercisePrice: "1.00",
      fmvPerShare: "5.00",
      cashless: false,
      formulaId: "option.exercise",
      formulaVersion: "1.0.0",
      region: "JP",
      formulaDef: { formula: "exercise" },
      jpTaxQualified: false,
    });
    expect(nonQualified.trace.outputs.jp_tax_qualified_option).toBe("false");
    expect(nonQualified.trace.outputs.jp_income_tax_at_exercise).toBe("true");
    // Math is the same as US — strike paid in cash, full underlying issued.
    expect(nonQualified.sharesIssued.toString()).toBe("100000");
  });

  it("JP formula registry returns JP-tagged formulas via getFormula(id, \"JP\")", () => {
    const safePost = getFormula("safe.postmoney.conversion", "JP");
    expect(safePost).toBeDefined();
    expect(safePost!.region).toBe("JP");
    expect(safePost!.version).toBe("1.0.0");
    expect(safePost!.status).toBe("active");
    // Citation references Coral Capital J-KISS and Companies Act of Japan
    expect(safePost!.citation.source).toMatch(/J-KISS|Coral Capital|Companies Act of Japan/i);

    // Full JP pack should expose all 9 formula categories
    const jpFormulas = listFormulas("JP");
    expect(jpFormulas.length).toBe(9);
    const ids = new Set(jpFormulas.map((f) => f.id));
    expect(ids.has("safe.postmoney.conversion")).toBe(true);
    expect(ids.has("note.conversion")).toBe(true);
    expect(ids.has("antiDilution.broadBased")).toBe(true);
    expect(ids.has("esop.topup")).toBe(true);
    expect(ids.has("waterfall.liquidation")).toBe(true);
    expect(ids.has("ownership.percent")).toBe(true);

    // REGIONS export must include JP
    expect(REGIONS).toContain("JP");

    // JP ESOP definition mentions tax-qualified rules (Income Tax Act §29-2)
    const esop = getFormula("esop.topup", "JP");
    expect(esop).toBeDefined();
    expect(JSON.stringify(esop!.citation)).toMatch(/§29-2|tax-qualified|Income Tax Act/i);

    // JP waterfall surfaces class-share preference flag
    const w = getFormula("waterfall.liquidation", "JP");
    expect(w).toBeDefined();
    const wfResult = computeWaterfall({
      exitProceeds: "5000000",
      preferred: [{
        classId: "A",
        className: "A 種類株式",
        invested: "1000000",
        shares: 1_000_000n,
        liquidationPreferenceMultiple: 1,
        participating: false,
        seniority: 0,
      }],
      common: [{ holderId: "founders", shares: 4_000_000n }],
      formulaId: w!.id,
      formulaVersion: w!.version,
      region: "JP",
      formulaDef: w!.definition,
    });
    expect(wfResult.trace.outputs.jp_class_shares_required).toBe("true");
  });
});
