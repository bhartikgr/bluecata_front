/**
 * Golden-master: ESOP top-up (pre-money vs post-money).
 *
 * Reference: YC primer "Pre-money vs post-money option pool"
 *   https://www.ycombinator.com/library/3y-the-option-pool-shuffle
 * Reference: Carta option pool blog
 *   https://carta.com/blog/option-pool/
 *
 * Setup:
 *   Existing (common + preferred ONLY): 8,000,000 founders
 *   Existing pool: 1,000,000
 *   New investor shares: 2,000,000
 *   Target post-round pool: 10%
 *
 * ─── WAVE 58 · R27 — THE FIXTURE WAS DOUBLE-COUNTING THE POOL ───────────────
 * This file previously passed `existingShares: 9_000_000` while ALSO passing
 * `existingPool: 1_000_000`, and described the 9,000,000 in this very header as
 * "8M founders + 1M existing pool". `EsopTopUpInput` declares `existingShares`
 * as "common + preferred + already-issued options" and `existingPool` as the
 * "unallocated pool already on cap" — two DISJOINT quantities. The fixture
 * counted the 1,000,000 twice, which is exactly the compensation the engine's
 * missing-existingPool denominator needed. That is why this golden master went
 * green over a live 2.42-point defect.
 *
 * The fixture is corrected to the contract (8,000,000) and EVERY EXPECTED
 * NUMBER BELOW IS UNCHANGED, because the reference figure was right all along:
 *
 *   T = (P × (existing + existingPool + newInv) − existingPool) / (1 − P)
 *     = (0.10 × (8,000,000 + 1,000,000 + 2,000,000) − 1,000,000) / 0.90
 *     = (1,100,000 − 1,000,000) / 0.90
 *     = 100,000 / 0.90
 *     = 111,111.111... → ceil 111,112
 *
 * MUTATION PROOF (recorded, reproduced): with this corrected fixture and the
 * PRE-Wave-58 engine, T = (0.10 × 10,000,000 − 1,000,000)/0.90 = 0, so
 * `poolSharesToAdd` is "0" and the first assertion below FAILS.
 */
import { describe, it, expect } from "vitest";
import { computeEsopTopUp } from "../../src/instruments/esopTopUp.js";

describe("ESOP top-up — golden master", () => {
  it("Pre-money pool top-up: 10% target, 111,112 shares to add", () => {
    const r = computeEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "10",   // WAVE 52c · B4 — PERCENT-AS-WRITTEN (R16): 10 = 10%
      existingShares: 8_000_000n, // WAVE 58 · R27 — was 9,000,000; double-counted existingPool
      existingPool: 1_000_000n,
      newInvestorShares: 2_000_000n,
      formulaId: "esop.topup",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(r.poolSharesToAdd.toString()).toBe("111112");
    expect(r.newPoolTotal.toString()).toBe("1111112");
    // resulting pool % ≈ 10%, PERCENT-AS-WRITTEN (R16): the number IS 10, not 0.10
    expect(parseFloat(r.resultingPoolPercent)).toBeGreaterThan(9.99);
    expect(parseFloat(r.resultingPoolPercent)).toBeLessThan(10.01);
    /* WAVE 58 · R27 — the denominator the percentage above is measured against
       now CONTAINS the existing pool: 8,000,000 + 1,000,000 + 2,000,000 +
       111,112 = 11,111,112. Before the fix it was 10,111,112. */
    expect(r.newTotalShares.toString()).toBe("11111112");
  });

  it("No top-up needed when existing pool already meets target", () => {
    const r = computeEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: "5",    // WAVE 52c · B4 — PERCENT-AS-WRITTEN (R16): 5 = 5%
      existingShares: 8_000_000n, // WAVE 58 · R27 — was 9,000,000; double-counted existingPool
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
