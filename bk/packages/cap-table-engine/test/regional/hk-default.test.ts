/**
 * HK regional formula pack tests.
 *
 * Hong Kong startups typically issue SAFEs and preferred via a Cayman
 * exempted-company parent (HK has English-common-law company framework but
 * preferred-share mechanics are most flexible at the Cayman parent level).
 * The math is therefore identical to the YC US conventions; HK adds tax
 * treatment differences, not math differences.
 *
 * IRD DIPN 38: ESOP exercise spread is taxed as employment income on the
 * exercise date — the engine emits hk_income_tax_at_exercise: true in the trace.
 */
import { describe, it, expect } from "vitest";
import { convertSafeToPreferred } from "../../src/conversion/safeToPreferred.js";
import { exerciseOption } from "../../src/conversion/optionExercise.js";
import { getFormula, listFormulas, REGIONS } from "../../src/formulas/registry.js";

describe("HK default formula pack", () => {
  it("HK SAFE post-money conversion produces identical shares to US (same Cayman-parent math)", () => {
    // Same input: $1M @ $10M post-money cap, $1.00 PPS, 10M post-money cap shares.
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
    const hk = convertSafeToPreferred({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "HK",
      formulaDef: { formula: "test" },
    });
    expect(hk.safeShares.toString()).toBe(us.safeShares.toString());
    expect(hk.safeShares.toString()).toBe("1000000");
    expect(hk.binding).toBe("cap");
    expect(hk.trace.region).toBe("HK");
    // HK trace surfaces no-capital-controls flag (informational; not a calculation change)
    expect(hk.trace.outputs.hk_no_capital_controls).toBe("true");
  });

  it("HK ESOP option exercise emits hk_income_tax_at_exercise: true (IRD DIPN 38)", () => {
    const result = exerciseOption({
      exercisedOptions: 100_000n,
      exercisePrice: "0.25",
      fmvPerShare: "2.00",
      cashless: false,
      formulaId: "option.exercise",
      formulaVersion: "1.0.0",
      region: "HK",
      formulaDef: { formula: "exercise" },
    });
    expect(result.sharesIssued.toString()).toBe("100000");
    // Exercise spread = (FMV - exercisePrice) × shares is taxed as Salaries Tax
    // income in the year of exercise; the engine surfaces this.
    expect(result.trace.outputs.hk_income_tax_at_exercise).toBe("true");
    expect(result.trace.outputs.hk_no_cgt).toBe("true");
    expect(result.trace.region).toBe("HK");
  });

  it("HK formula registry returns HK-tagged formulas via getFormula(id, \"HK\")", () => {
    const safePost = getFormula("safe.postmoney.conversion", "HK");
    expect(safePost).toBeDefined();
    expect(safePost!.region).toBe("HK");
    expect(safePost!.version).toBe("1.0.0");
    expect(safePost!.status).toBe("active");
    // Citation includes Companies Ordinance reference
    expect(safePost!.citation.source).toMatch(/Companies Ordinance|Cayman/i);

    // Full HK pack should expose all 9 formula categories
    const hkFormulas = listFormulas("HK");
    expect(hkFormulas.length).toBe(9);
    const ids = new Set(hkFormulas.map((f) => f.id));
    expect(ids.has("safe.postmoney.conversion")).toBe(true);
    expect(ids.has("safe.premoney.conversion")).toBe(true);
    expect(ids.has("note.conversion")).toBe(true);
    expect(ids.has("antiDilution.fullRatchet")).toBe(true);
    expect(ids.has("antiDilution.broadBased")).toBe(true);
    expect(ids.has("antiDilution.narrowBased")).toBe(true);
    expect(ids.has("esop.topup")).toBe(true);
    expect(ids.has("waterfall.liquidation")).toBe(true);
    expect(ids.has("ownership.percent")).toBe(true);

    // REGIONS must include HK
    expect(REGIONS).toContain("HK");
  });
});
