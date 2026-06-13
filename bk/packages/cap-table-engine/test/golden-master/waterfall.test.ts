/**
 * Golden-master: liquidation waterfall.
 *
 * Reference: NVCA Model Certificate of Incorporation §2 (Liquidation Preference)
 *   https://nvca.org/model-legal-documents/
 * Reference: Pulley waterfall guide
 *   https://pulley.com/guides/liquidation-preferences
 *
 * Scenario A — 1× non-participating preferred, exit = $50M, $10M invested in Series A
 *   for 25% of company. As-converted share = 0.25 × $50M = $12.5M. > preference $10M.
 *   → Class A converts to common, shares pro-rata.
 *
 * Scenario B — 2× participating preferred with 3× cap, $10M invested, 25% post.
 *   Exit = $30M. Preference = $20M. Pool participate (75% common + 25% pref) = $10M × 0.25 = $2.5M.
 *   Total pre-cap = $22.5M. Cap = 3× × $10M = $30M. Not capped.
 *   → Class A pays $22.5M, common $7.5M.
 */
import { describe, it, expect } from "vitest";
import { computeWaterfall } from "../../src/waterfall/liquidationWaterfall.js";

describe("Liquidation waterfall — golden master", () => {
  it("1× non-participating: as-converted beats preference → class converts", () => {
    const r = computeWaterfall({
      exitProceeds: "50000000",
      preferred: [
        {
          classId: "A", className: "Series A", invested: "10000000",
          shares: 2_500_000n, liquidationPreferenceMultiple: 1,
          participating: false, seniority: 0,
        },
      ],
      common: [{ holderId: "founder", shares: 7_500_000n }],
      formulaId: "waterfall.liquidation",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    // Class A converted; total proceeds split pro-rata: 2.5M of 10M → 25% × 50M = $12.5M
    const aPay = r.payouts.find((p) => p.classId === "A");
    const founder = r.payouts.find((p) => p.holderId === "founder");
    expect(aPay?.decision).toBe("as_converted");
    expect(parseFloat(aPay!.total)).toBeCloseTo(12500000, 0);
    expect(parseFloat(founder!.total)).toBeCloseTo(37500000, 0);
  });

  it("2× participating with 3× cap, exit $30M: preference $20M + participation $2.5M", () => {
    const r = computeWaterfall({
      exitProceeds: "30000000",
      preferred: [
        {
          classId: "A", className: "Series A", invested: "10000000",
          shares: 2_500_000n, liquidationPreferenceMultiple: 2,
          participating: true, participationCapMultiple: 3, seniority: 0,
        },
      ],
      common: [{ holderId: "founder", shares: 7_500_000n }],
      formulaId: "waterfall.liquidation",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    const aPay = r.payouts.find((p) => p.classId === "A");
    const founder = r.payouts.find((p) => p.holderId === "founder");
    expect(aPay?.decision).toBe("preference_then_participate");
    // preference = 20M; remainder = 10M; pref share = 2.5/10 × 10 = 2.5M; total = 22.5M
    expect(parseFloat(aPay!.preferenceTaken)).toBeCloseTo(20000000, 0);
    expect(parseFloat(aPay!.participation)).toBeCloseTo(2500000, 0);
    expect(parseFloat(aPay!.total)).toBeCloseTo(22500000, 0);
    expect(parseFloat(founder!.total)).toBeCloseTo(7500000, 0);
  });

  it("1× preference with low exit: preference fully covers", () => {
    const r = computeWaterfall({
      exitProceeds: "8000000",
      preferred: [
        {
          classId: "A", className: "Series A", invested: "10000000",
          shares: 2_500_000n, liquidationPreferenceMultiple: 1,
          participating: false, seniority: 0,
        },
      ],
      common: [{ holderId: "founder", shares: 7_500_000n }],
      formulaId: "waterfall.liquidation",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    const aPay = r.payouts.find((p) => p.classId === "A");
    expect(aPay?.decision).toBe("preference_only");
    /* v25.20 Lane 2 NC3 (hard close):
         Pre-v25.20 reported the nominal $10M preference here, even though only
         $8M existed in the exit pool. The new budget-clamp (line 122) caps each
         class's preference at the remaining `prefBudget`. The engine now reports
         the actual cash paid, which is min(preference, remaining) = $8M, and the
         payouts sum to the exit exactly. */
    expect(parseFloat(aPay!.total)).toBeCloseTo(8000000, 0);
    // Total payouts must not exceed exit proceeds.
    const totalPaid = r.payouts.reduce((s, p) => s + parseFloat(p.total), 0);
    expect(totalPaid).toBeLessThanOrEqual(8000000 + 1); // ±$1 rounding
  });

  /* v25.20 Lane 2 NC3 (post-verification) — regression test for the
     convert-vs-preference election. The election value MUST use the TRUE
     as-converted (against full exit), not a residual-clamped value.

     Scenario surfaced by the v25.20 math-verification probe:
       Senior (B) $17M 1× with ~0 shares.
       Junior (A) $4M 1× with 9M of 10M as-converted shares (90% equity).
       Common 1M shares. Exit $20M.

       Junior's TRUE as-converted = 9M/10M × $20M = $18M, easily beating its $4M
       preference — a rational holder converts. Senior takes $17M (budget-
       clamped at the $17M it invested); $3M residual is split pro-rata across
       all common-treated shares.

       Engine before fix (wrongly clamped election): Junior got $3M as
       preference_only, common $0.
       Engine after fix: Junior converts, takes 9M/10M × $3M = $2.70M; common
       takes 1M/10M × $3M = $0.30M. Sum = $20M. NVCA §2.1-correct. */
  it("v25.20 NC3 — junior with large equity ratio converts even when budget is tight", () => {
    const r = computeWaterfall({
      exitProceeds: "20000000",
      preferred: [
        {
          classId: "senior", className: "Series B", invested: "17000000",
          shares: 100n, liquidationPreferenceMultiple: 1,
          participating: false, seniority: 0,
        },
        {
          classId: "junior", className: "Series A", invested: "4000000",
          shares: 9_000_000n, liquidationPreferenceMultiple: 1,
          participating: false, seniority: 1,
        },
      ],
      common: [{ holderId: "founder", shares: 1_000_000n }],
      formulaId: "waterfall.liquidation",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    const senior = r.payouts.find((p) => p.classId === "senior");
    const junior = r.payouts.find((p) => p.classId === "junior");
    const founder = r.payouts.find((p) => p.holderId === "founder");
    // Senior takes its full $17M preference.
    expect(senior?.decision).toBe("preference_only");
    expect(parseFloat(senior!.total)).toBeCloseTo(17_000_000, 0);
    // Junior MUST elect to convert (its true as-converted $18M >> $4M preference),
    // even though prefBudget is only $3M at that point.
    expect(junior?.decision).not.toBe("preference_only");
    // After conversion, the $3M residual is split 9/10 to junior, 1/10 to founder.
    expect(parseFloat(junior!.total)).toBeCloseTo(2_700_000, -3);
    expect(parseFloat(founder!.total)).toBeCloseTo(300_000, -3);
    // Sum payouts == exit exactly.
    const total = parseFloat(senior!.total) + parseFloat(junior!.total) + parseFloat(founder!.total);
    expect(total).toBeCloseTo(20_000_000, -3);
  });
});
