/**
 * Property: Broad-based weighted-average anti-dilution can ONLY increase (or keep equal)
 * the protected preferred share count. It never decreases shares.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyBroadBasedWeightedAverage } from "../../src/antiDilution/broadBasedWeightedAverage.js";

describe("Property: anti-dilution monotonic (newShares >= protectedShares)", () => {
  it("For any random down-round, newShares >= protectedShares", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.01), max: Math.fround(10), noNaN: true, noDefaultInfinity: true }),
        fc.float({ min: Math.fround(0.001), max: Math.fround(0.999), noNaN: true, noDefaultInfinity: true }),
        fc.bigInt({ min: 1_000_000n, max: 100_000_000n }),
        fc.bigInt({ min: 1n, max: 50_000_000n }),
        fc.bigInt({ min: 1_000n, max: 10_000_000n }),
        (ocp, downRatio, A, C, protectedShares) => {
          const ocpStr = ocp.toFixed(6);
          const nipStr = (ocp * downRatio).toFixed(6);
          const moneyRaised = (Number(C) * (ocp * downRatio)).toFixed(2);
          const r = applyBroadBasedWeightedAverage({
            originalConversionPrice: ocpStr,
            newIssuePrice: nipStr,
            moneyRaised,
            outstandingBroadBased: A,
            sharesIssuedInRound: C,
            protectedShares,
            formulaId: "antiDilution.broadBased",
            formulaVersion: "1.0.0",
            region: "US",
            formulaDef: { formula: "test" },
          });
          expect(r.newShares).toBeGreaterThanOrEqual(protectedShares);
          expect(r.delta).toBeGreaterThanOrEqual(0n);
        },
      ),
      { numRuns: 50 },
    );
  });
});
