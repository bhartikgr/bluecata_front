/**
 * Reference liquidation waterfall tests.
 *
 * References: NVCA Model Certificate §2; Pulley waterfall guide.
 */
import { describe, it, expect } from "vitest";
import { refWaterfall } from "../src/refMath.js";

describe("Reference Waterfall", () => {
  it("Single non-participating preferred at $10M exit takes max(preference, as-converted)", () => {
    // Series A: invested $5M, 1× pref, 4M shares; common = 6M shares.
    // exit = $10M
    // preference = $5M
    // as-converted = 4M / 10M × 10M = $4M < $5M → take preference
    const r = refWaterfall({
      exitProceeds: "10000000",
      preferred: [{
        classId: "A", className: "Series A", invested: "5000000",
        shares: 4000000n, liquidationPreferenceMultiple: 1,
        participating: false, seniority: 0,
      }],
      common: [{ holderId: "founder", shares: 6000000n }],
    });
    // Preferred takes $5M, common takes the rest
    const prefPayout = r.payouts.find((p) => p.classId === "A");
    const commonPayout = r.payouts.find((p) => p.holderId === "founder");
    expect(prefPayout?.total.startsWith("5000000")).toBe(true);
    expect(commonPayout?.total.startsWith("5000000")).toBe(true);
  });

  it("Non-participating preferred converts when as-converted exceeds preference", () => {
    // Series A: invested $5M, 1× pref, 4M shares; common = 1M shares; exit = $50M
    // preference = $5M; as-converted = 4M/5M × 50M = $40M >> $5M → convert
    const r = refWaterfall({
      exitProceeds: "50000000",
      preferred: [{
        classId: "A", className: "Series A", invested: "5000000",
        shares: 4000000n, liquidationPreferenceMultiple: 1,
        participating: false, seniority: 0,
      }],
      common: [{ holderId: "founder", shares: 1000000n }],
    });
    // No preference taken; both get pro-rata of $50M
    const prefPayout = r.payouts.find((p) => p.classId === "A");
    const commonPayout = r.payouts.find((p) => p.holderId === "founder");
    // Preferred: 4/5 × 50M = 40M; Common: 1/5 × 50M = 10M
    expect(prefPayout?.total.startsWith("40000000")).toBe(true);
    expect(commonPayout?.total.startsWith("10000000")).toBe(true);
  });

  it("2× participating preferred with cap", () => {
    // Series A: invested $5M, 2× pref participating, cap 3×, 4M shares; common = 6M; exit = $30M
    // preference = $10M
    // remaining after all pref = $30M − $10M = $20M
    // participation = 4M / 10M × 20M = $8M
    // total = $18M ≤ cap (3×$5M = $15M)? 18 > 15 → cap binds
    // as-converted = 4M / 10M × 30M = $12M < cap, so cap applies; total = $15M
    const r = refWaterfall({
      exitProceeds: "30000000",
      preferred: [{
        classId: "A", className: "Series A", invested: "5000000",
        shares: 4000000n, liquidationPreferenceMultiple: 2,
        participating: true, participationCapMultiple: 3, seniority: 0,
      }],
      common: [{ holderId: "founder", shares: 6000000n }],
    });
    const prefPayout = r.payouts.find((p) => p.classId === "A");
    expect(prefPayout?.total.startsWith("15000000")).toBe(true);
  });
});
