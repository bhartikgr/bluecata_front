/**
 * Golden-master: ESOP top-up (pre-money vs post-money).
 *
 * Reference: YC primer "Pre-money vs post-money option pool"
 *   https://www.ycombinator.com/library/3y-the-option-pool-shuffle
 * Reference: Carta option pool blog
 *   https://carta.com/blog/option-pool/
 *
 * Setup:
 *   Existing: 9,000,000 (8M founders + 1M existing pool)
 *   Existing pool: 1,000,000
 *   New investor shares: 2,000,000
 *   Target post-round pool: 10%
 *
 *   T = (P × (existing + newInv) − existingPool) / (1 − P)
 *     = (0.10 × (9,000,000 + 2,000,000) − 1,000,000) / 0.90
 *     = (1,100,000 − 1,000,000) / 0.90
 *     = 100,000 / 0.90
 *     = 111,111.111... → ceil 111,112
 */
import { describe, it, expect } from "vitest";
import { computeEsopTopUp } from "../../src/instruments/esopTopUp.js";

describe("ESOP top-up — golden master", () => {
  it("Pre-money pool top-up: 10% target, 111,112 shares to add", () => {
    const r = computeEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "0.10",
      existingShares: 9_000_000n,
      existingPool: 1_000_000n,
      newInvestorShares: 2_000_000n,
      formulaId: "esop.topup",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(r.poolSharesToAdd.toString()).toBe("111112");
    expect(r.newPoolTotal.toString()).toBe("1111112");
    // resulting pool % ≈ 10%
    expect(parseFloat(r.resultingPoolPercent)).toBeGreaterThan(0.0999);
    expect(parseFloat(r.resultingPoolPercent)).toBeLessThan(0.1001);
  });

  it("No top-up needed when existing pool already meets target", () => {
    const r = computeEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "0.05",
      existingShares: 9_000_000n,
      existingPool: 1_000_000n,
      newInvestorShares: 2_000_000n,
      formulaId: "esop.topup",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(r.poolSharesToAdd.toString()).toBe("0");
  });
});
