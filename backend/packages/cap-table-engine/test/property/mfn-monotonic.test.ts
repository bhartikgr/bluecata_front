/**
 * Property: MFN-resolved SAFE conversion never produces fewer shares than direct conversion.
 *
 * If the SAFE has MFN and a later SAFE with a lower cap or higher discount exists,
 * MFN should at worst keep the conversion price equal, never raise it.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyMfn } from "../../src/conversion/mfnOrdering.js";
import { convertSafeToPreferred } from "../../src/conversion/safeToPreferred.js";
import type { Security } from "../../src/types.js";

describe("Property: MFN never reduces share count", () => {
  it("MFN-resolved SAFE shares >= direct SAFE shares", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 50_000_000 }),
        fc.integer({ min: 100_000, max: 5_000_000 }),
        fc.integer({ min: 50, max: 95 }),
        (capA, capB, discountPct) => {
          const safeA: Security = {
            id: "a", holderId: "h1", kind: "safe",
            investmentAmount: "100000",
            safe: { type: "post_money_cap", cap: String(capA), mfn: true },
          };
          const safeB: Security = {
            id: "b", holderId: "h2", kind: "safe",
            investmentAmount: "100000",
            safe: { type: "post_money_cap", cap: String(Math.min(capA, capB)), discount: String(discountPct / 100) },
          };
          const resolved = applyMfn(safeA, { candidates: [safeA, safeB] });

          const directConv = convertSafeToPreferred({
            purchaseAmount: "100000",
            capType: safeA.safe!.type,
            cap: safeA.safe!.cap,
            seriesPricePerShare: "5",
            companyCapitalization: "10000000",
            formulaId: "safe.postmoney.conversion", formulaVersion: "1.0.0",
            region: "US", formulaDef: {},
          });
          const mfnConv = convertSafeToPreferred({
            purchaseAmount: "100000",
            capType: resolved.safe!.type,
            cap: resolved.safe!.cap,
            discount: resolved.safe!.discount,
            seriesPricePerShare: "5",
            companyCapitalization: "10000000",
            formulaId: "safe.postmoney.conversion", formulaVersion: "1.0.0",
            region: "US", formulaDef: {},
          });
          expect(mfnConv.safeShares).toBeGreaterThanOrEqual(directConv.safeShares);
        },
      ),
      { numRuns: 30 },
    );
  });
});
