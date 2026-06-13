/**
 * Reference ESOP top-up tests.
 *
 * Reference: Brad Feld primer "Option Pool Shuffle" — option pool grows BEFORE
 * the round in pre-money mode (founder dilution); grows AFTER in post-money mode
 * (everyone diluted).
 */
import { describe, it, expect } from "vitest";
import { refEsopTopUp } from "../src/refMath.js";

describe("Reference ESOP top-up", () => {
  it("Pre-money 10% pool: existing 8M, 2M new investor shares → pool ≈ 1,111,111", () => {
    // pool = 0.10 × (8M + 2M) / (1 − 0.10) = 1,000,000 / 0.9 = 1,111,111.11...
    const r = refEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "0.10",
      existingShares: 8000000n,
      existingPool: 0n,
      newInvestorShares: 2000000n,
    });
    expect(r.poolSharesToAdd).toBe(1111111n);
  });

  it("Post-money 10% pool: same inputs → pool = 0.10 × 10M = 1,000,000", () => {
    const r = refEsopTopUp({
      mode: "post_money",
      targetPoolPercent: "0.10",
      existingShares: 8000000n,
      existingPool: 0n,
      newInvestorShares: 2000000n,
    });
    expect(r.poolSharesToAdd).toBe(1000000n);
  });

  it("Existing pool reduces top-up needed", () => {
    const r = refEsopTopUp({
      mode: "post_money",
      targetPoolPercent: "0.10",
      existingShares: 7000000n,
      existingPool: 500000n,
      newInvestorShares: 2000000n,
    });
    // postFD = 7M + 500k + 2M = 9.5M; desired = 950k; delta = 450k
    expect(r.poolSharesToAdd).toBe(450000n);
  });
});
