/**
 * Reference broad-based weighted-average anti-dilution tests.
 *
 * Reference: NVCA Model Charter §4.4(d)(ii)(A); Carta blog "How weighted-average
 * anti-dilution works" — https://carta.com/blog/anti-dilution-protection/.
 *
 * Worked example (Carta primer):
 *   OCP = $1.00
 *   New round: $2,000,000 raised at $0.50 PPS → 4,000,000 shares issued
 *   Outstanding (broad-based) = 10,000,000
 *   B = 2,000,000 / 1.00 = 2,000,000
 *   NCP = 1.00 × (10M + 2M) / (10M + 4M) = 12/14 = 0.857142857142857...
 *   Protected class had 1,000,000 shares at OCP $1.00 → newShares = 1,000,000 × 1.00 / 0.857142857...
 *                                                          = 1,166,666.666...
 *   floor → 1,166,666
 */
import { describe, it, expect } from "vitest";
import { refBroadBasedAD } from "../src/refMath.js";

describe("Reference Broad-Based Weighted-Average AD", () => {
  it("Carta canonical primer example", () => {
    const r = refBroadBasedAD({
      originalConversionPrice: "1.00",
      newIssuePrice: "0.50",
      moneyRaised: "2000000",
      outstandingBroadBased: 10000000n,
      sharesIssuedInRound: 4000000n,
      protectedShares: 1000000n,
    });
    expect(r.newShares).toBe(1166666n);
    expect(r.delta).toBe(166666n);
    // NCP starts with "0.857142857142857"
    expect(r.newConversionPrice.startsWith("0.857142857142857")).toBe(true);
  });

  it("No down-round → no change (newPrice ≥ OCP)", () => {
    const r = refBroadBasedAD({
      originalConversionPrice: "1.00",
      newIssuePrice: "1.00",
      moneyRaised: "1000000",
      outstandingBroadBased: 10000000n,
      sharesIssuedInRound: 1000000n,
      protectedShares: 500000n,
    });
    expect(r.newShares).toBe(500000n);
    expect(r.delta).toBe(0n);
  });

  it("Soft down-round → small delta", () => {
    const r = refBroadBasedAD({
      originalConversionPrice: "1.00",
      newIssuePrice: "0.90",
      moneyRaised: "900000",
      outstandingBroadBased: 9000000n,
      sharesIssuedInRound: 1000000n,
      protectedShares: 500000n,
    });
    expect(r.delta > 0n).toBe(true);
    expect(r.newShares > 500000n).toBe(true);
  });
});
