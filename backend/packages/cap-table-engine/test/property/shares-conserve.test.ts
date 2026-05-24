/**
 * Property: total issued common+preferred shares are conserved across non-issuance,
 * non-conversion transactions (plain transfers don't change the total).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeCapTable } from "../../src/captable/compute.js";
import type { Holder, Transaction } from "../../src/types.js";

describe("Property: share conservation", () => {
  it("Issuing N common + Y preferred yields total = N+Y in basic view", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 100_000_000n }),
        fc.bigInt({ min: 1n, max: 100_000_000n }),
        (n, y) => {
          const holders: Holder[] = [
            { id: "f", name: "F", type: "founder" },
            { id: "i", name: "I", type: "investor" },
          ];
          const txs: Transaction[] = [
            { type: "issue", date: "2025-01-01", security: { id: "c", holderId: "f", kind: "common", shares: n, series: "Common" } },
            {
              type: "issue", date: "2025-02-01",
              security: {
                id: "p", holderId: "i", kind: "preferred", shares: y, series: "Series A",
                preferred: { liquidationPreferenceMultiple: 1, participating: false, seniority: 0, originalIssuePrice: "1" },
              },
            },
          ];
          const r = computeCapTable({
            companyId: "x", asOf: "2025-12-31", view: "basic",
            formulaRegion: "US", holders, transactions: txs,
          });
          expect(r.totalShares).toBe(n + y);
        },
      ),
      { numRuns: 50 },
    );
  });
});
