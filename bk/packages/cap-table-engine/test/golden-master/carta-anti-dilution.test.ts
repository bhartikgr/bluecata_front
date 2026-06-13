/**
 * Golden-master: Carta-style broad-based weighted-average anti-dilution.
 *
 * Reference: Carta blog "Anti-dilution protection: how it works"
 *   https://carta.com/blog/anti-dilution-protection/
 * Reference: NVCA Model Charter §4.4(d)(ii)(A) Broad-Based Weighted Average
 *   https://nvca.org/model-legal-documents/
 *
 *   Original Conversion Price (OCP) = $1.00
 *   Down-round New Issue Price (NIP) = $0.50
 *   Outstanding broad-based (A) = 10,000,000
 *   Money raised in dilutive issuance = $1,000,000
 *   Shares issued in dilutive round (C) = 2,000,000
 *   B = $1,000,000 / $1.00 = 1,000,000
 *
 *   NCP = 1.00 × (10,000,000 + 1,000,000) / (10,000,000 + 2,000,000)
 *       = 11,000,000 / 12,000,000
 *       = 0.916666666...
 *
 *   Protected preferred originally 1,000,000 shares.
 *   newShares = 1,000,000 × 1.00 / 0.91666... = 1,090,909.0909... → floor 1,090,909
 *   delta    = +90,909 shares
 */
import { describe, it, expect } from "vitest";
import { applyBroadBasedWeightedAverage } from "../../src/antiDilution/broadBasedWeightedAverage.js";

describe("Carta broad-based weighted-average AD — golden master", () => {
  it("Standard down-round protection produces NCP = 0.91666..., +90,909 shares", () => {
    const r = applyBroadBasedWeightedAverage({
      originalConversionPrice: "1.00",
      newIssuePrice: "0.50",
      moneyRaised: "1000000",
      outstandingBroadBased: 10_000_000n,
      sharesIssuedInRound: 2_000_000n,
      protectedShares: 1_000_000n,
      formulaId: "antiDilution.broadBased",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    // NCP rounded to 10dp
    expect(r.newConversionPrice.slice(0, 12)).toBe("0.9166666666");
    expect(r.newShares.toString()).toBe("1090909");
    expect(r.delta.toString()).toBe("90909");
  });

  it("No-op when NIP >= OCP (no down round)", () => {
    const r = applyBroadBasedWeightedAverage({
      originalConversionPrice: "1.00",
      newIssuePrice: "1.50",
      moneyRaised: "5000000",
      outstandingBroadBased: 10_000_000n,
      sharesIssuedInRound: 3_333_333n,
      protectedShares: 1_000_000n,
      formulaId: "antiDilution.broadBased",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(r.newConversionPrice).toBe("1");
    expect(r.delta.toString()).toBe("0");
  });

  it("Full-ratchet provides MORE shares than broad-based for same down round", () => {
    // Sanity: ratchet to NIP $0.50 → newShares = 1M × 1.00/0.50 = 2M. > broad-based 1.09M.
    const broad = applyBroadBasedWeightedAverage({
      originalConversionPrice: "1.00",
      newIssuePrice: "0.50",
      moneyRaised: "1000000",
      outstandingBroadBased: 10_000_000n,
      sharesIssuedInRound: 2_000_000n,
      protectedShares: 1_000_000n,
      formulaId: "antiDilution.broadBased",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(broad.newShares).toBeLessThan(2_000_001n);
    expect(broad.newShares).toBeGreaterThan(1_090_000n);
  });
});
