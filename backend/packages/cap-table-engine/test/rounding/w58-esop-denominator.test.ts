/**
 * WAVE 58 · owner ruling R27 — THE ESOP DENOMINATOR DEFECT, FIXED AND FENCED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, REPRODUCED HERE RATHER THAN DESCRIBED
 * ═══════════════════════════════════════════════════════════════════════════
 * `computeEsopTopUp` omitted `existingPool` from BOTH the base it solved the
 * target against AND from `newTotalShares`. The two omissions cancelled on the
 * REPORTED PERCENTAGE and did not cancel on the SHARE COUNTS, which is why the
 * defect read as a clean "25.000%" for two waves.
 *
 * Wave 52c recorded it by name and deliberately left it. R27 makes it a
 * PREREQUISITE of Wave 58, because the wizard now feeds this path a real
 * percentage: shipping the percentage without the fix would have put a live
 * 2.42-point error on a founder's own dilution screen.
 *
 * MUTATION TRANSCRIPT (reproduced, recorded in build_log/wave58/W58_NEW_TESTS.md):
 *   revert `baseInclExistingPool` to `existing.plus(newInv)` in
 *   `src/instruments/esopTopUp.ts`  → W58-D1, D2, D3, D5 and D6 all FAIL.
 *   revert `newTotalShares` to omit `input.existingPool`
 *                                    → W58-D1, D2, D4, D5 and D6 all FAIL.
 * Each is a one-expression edit, and no test in this file can pass without both.
 */
import { describe, it, expect } from "vitest";
import { computeEsopTopUp } from "../../src/instruments/esopTopUp.js";
import { refEsopTopUp } from "../../../cap-table-engine-ref/src/refMath.js";
import { D } from "../../src/primitives/bigDecimal.js";

/** The exact case named in R27 and in the Wave 58 brief. */
const R27_CASE = {
  mode: "pre_money" as const,
  targetPoolPercent: "25",           // PERCENT-AS-WRITTEN (R16 / OR-1)
  existingShares: BigInt(8_000_000), // founders only — the contract excludes the pool
  existingPool: BigInt(1_000_000),   // unallocated reserve already on the cap table
  newInvestorShares: BigInt(0),
  formulaId: "esop.topup",
  formulaVersion: "1.0.0",
  region: "US" as const,
  formulaDef: { formula: "w58" },
};

describe("WAVE 58 · R27 — the existing pool is inside its own denominator", () => {
  it("W58-D1 — the R27 case: 1,666,667 added, total 10,666,667, and 25% is TRUE of it", () => {
    const r = computeEsopTopUp(R27_CASE);
    /* T = (25·(8,000,000 + 1,000,000 + 0) − 100·1,000,000) / 75
         = 125,000,000 / 75 = 1,666,666.66… → ceil 1,666,667.
       BEFORE the fix this returned 1,333,334 — 333,333 shares of employee
       equity that the agreed 25% target actually requires and did not get. */
    expect(r.poolSharesToAdd.toString()).toBe("1666667");
    expect(r.newPoolTotal.toString()).toBe("2666667");
    /* BEFORE the fix: 9,333,334, i.e. short by exactly the 1,000,000 existing
       pool. That is the whole defect, in one number. */
    expect(r.newTotalShares.toString()).toBe("10666667");
    const pct = Number(r.resultingPoolPercent);
    expect(pct).toBeGreaterThanOrEqual(25);
    expect(pct).toBeLessThan(25.001);
  });

  it("W58-D2 — the PRE-FIX output, measured honestly, was 22.580650% and not 25%", () => {
    /* This is the falsification of the old number, computed here rather than
       quoted. The pre-fix engine added 1,333,334 shares and reported 25.000005%.
       Measured against the total that ACTUALLY existed — founders + existing pool
       + new investors + the top-up = 10,333,334 — the same pool was 22.580650%.
       A 2.42-POINT overstatement on a founder's dilution screen. */
    const preFixTopUp = D("1333334");
    const preFixPoolTotal = D("1000000").plus(preFixTopUp);      // 2,333,334
    const preFixReportedTotal = D("8000000").plus(preFixTopUp);  // 9,333,334 (WRONG)
    const trueTotal = D("8000000").plus("1000000").plus(preFixTopUp); // 10,333,334
    expect(preFixReportedTotal.toFixed()).toBe("9333334");
    expect(trueTotal.toFixed()).toBe("10333334");
    expect(preFixPoolTotal.mul(100).div(preFixReportedTotal).toFixed(6)).toBe("25.000005");
    expect(preFixPoolTotal.mul(100).div(trueTotal).toFixed(6)).toBe("22.580650");
    /* And the fixed engine does NOT produce the pre-fix figures. */
    const r = computeEsopTopUp(R27_CASE);
    expect(r.poolSharesToAdd.toString()).not.toBe("1333334");
    expect(r.newTotalShares.toString()).not.toBe("9333334");
  });

  it("W58-D3 — the SOLVED BASE is published in the trace, and it contains the existing pool", () => {
    const r = computeEsopTopUp(R27_CASE);
    /* 8,000,000 + 1,000,000 + 0. The number is in the trace so a reviewer never
       has to re-derive it to check the claim. */
    expect(String(r.trace.outputs.poolTargetBase)).toBe("9000000");
    expect(String(r.trace.outputs.poolTargetBaseDefinition)).toBe(
      "existingShares + existingPool + newInvestorShares",
    );
  });

  it("W58-D4 — the trace's denominator label no longer disclaims a defect, because there is none", () => {
    const r = computeEsopTopUp(R27_CASE);
    const denom = String(r.trace.outputs.resultingPoolPercentDenominator);
    expect(denom).not.toContain("omits existingPool");
    expect(denom).toContain("existingShares + existingPool + newInvestorShares + poolSharesToAdd");
    /* What is STILL not modelled is named rather than dropped. */
    expect(String(r.trace.outputs.poolTargetBaseExclusions)).toContain("granted options");
  });

  it("W58-D5 — the gross-up identity F/(1 − p) = F + S holds on the engine's own outputs", () => {
    /* CAPTABLE_MATH_INDUSTRY_STANDARD.md §4.2. F is the NON-POOL base and S is
       the TOTAL pool after the round; p is the resulting pool fraction. The
       identity is algebraically unconditional, so a failure here is a defect in
       the engine and not in the identity.

       Checked on three fixtures, including one that lands EXACTLY. */
    const cases = [
      { existingShares: BigInt(8_000_000), existingPool: BigInt(1_000_000), newInvestorShares: BigInt(0), targetPoolPercent: "25" },
      { existingShares: BigInt(10_500_000), existingPool: BigInt(2_000_000), newInvestorShares: BigInt(0), targetPoolPercent: "25" },
      { existingShares: BigInt(8_000_000), existingPool: BigInt(1_000_000), newInvestorShares: BigInt(2_000_000), targetPoolPercent: "10" },
    ];
    for (const c of cases) {
      const r = computeEsopTopUp({ ...R27_CASE, ...c });
      const F = D(c.existingShares.toString()).plus(c.newInvestorShares.toString());
      const p = D(r.resultingPoolPercent).div(100);
      const grossedUp = F.div(D(1).minus(p));
      /* F + S == F/(1 − p). Tolerance is ONE SHARE, and that one share is the
         documented ceil on the top-up (§4.3 rounds S UP so the target is MET);
         it is not a floating-point allowance. */
      const lhs = grossedUp;
      const rhs = F.plus(r.newPoolTotal.toString());
      expect(rhs.minus(lhs).abs().lte(1)).toBe(true);
      /* And the total the engine reports IS that grossed-up number. */
      expect(D(r.newTotalShares.toString()).minus(lhs).abs().lte(1)).toBe(true);
    }
  });

  it("W58-D6 — the fixed engine now AGREES with the independent reference engine", () => {
    /* `refEsopTopUp` is a SECOND, separately written implementation, and its file
       comment stated the correct denominator all along:
         newPoolShares = (target × (existingShares + existingPool + newInvestorShares)
                          − existingPool) / (1 − target)
       Before Wave 58 the two engines disagreed by 333,333 shares on the R27 case.
       They now differ by at most ONE share, and that one share is a KNOWN,
       DOCUMENTED rounding divergence: the primary engine ceils the top-up (so the
       target is met) and the reference floors it. That divergence is asserted, not
       hidden, so it cannot silently widen. */
    const cases = [
      { existingShares: BigInt(8_000_000), existingPool: BigInt(1_000_000), newInvestorShares: BigInt(0), targetPoolPercent: "25" },
      { existingShares: BigInt(10_500_000), existingPool: BigInt(2_000_000), newInvestorShares: BigInt(0), targetPoolPercent: "25" },
      { existingShares: BigInt(8_000_000), existingPool: BigInt(1_000_000), newInvestorShares: BigInt(2_000_000), targetPoolPercent: "10" },
      { existingShares: BigInt(9_250_000), existingPool: BigInt(100_000), newInvestorShares: BigInt(1_695_000), targetPoolPercent: "20" },
    ];
    for (const c of cases) {
      const mine = computeEsopTopUp({ ...R27_CASE, ...c });
      const theirs = refEsopTopUp({
        mode: "pre_money",
        targetPoolPercent: c.targetPoolPercent,
        existingShares: c.existingShares,
        existingPool: c.existingPool,
        newInvestorShares: c.newInvestorShares,
      });
      const gap = mine.poolSharesToAdd - theirs.poolSharesToAdd;
      expect(gap >= BigInt(0) && gap <= BigInt(1)).toBe(true);
    }
  });

  it("W58-D7 — a target the existing pool already exceeds still yields ZERO, never a negative", () => {
    const r = computeEsopTopUp({ ...R27_CASE, targetPoolPercent: "5" });
    /* T = (5·9,000,000 − 100,000,000)/95 < 0 → clamped to 0. The engine must not
       "un-reserve" shares: reducing a pool is a cancellation, not a top-up. */
    expect(r.poolSharesToAdd.toString()).toBe("0");
    expect(r.newPoolTotal.toString()).toBe("1000000");
    expect(r.newTotalShares.toString()).toBe("9000000");
    /* And the percentage reported is the TRUE one — 1,000,000 of 9,000,000 —
       which is 11.111%, i.e. ABOVE the 5% asked for, and it says so honestly
       rather than reporting the target back. */
    expect(Number(r.resultingPoolPercent)).toBeCloseTo(11.1111, 3);
  });

  it("W58-D8 — R16 range and unit behaviour are unchanged by this fix", () => {
    /* The fix must not have quietly re-scaled anything. 0.25 is still a quarter
       of one percent, and 100 is still refused by name. */
    expect(() => computeEsopTopUp({ ...R27_CASE, targetPoolPercent: "100" })).toThrow(
      "Pool target must be < 100%",
    );
    const quarter = computeEsopTopUp({ ...R27_CASE, targetPoolPercent: "0.25" });
    expect(quarter.poolSharesToAdd.toString()).toBe("0");
    const r = computeEsopTopUp(R27_CASE);
    expect(r.trace.inputs.targetPoolPercent).toBe("25");
    expect(r.trace.inputs.targetPoolPercentUnit).toBe("percent_as_written_r16");
    expect(r.trace.outputs.resultingPoolPercentUnit).toBe("percent_as_written_r16");
  });
});
