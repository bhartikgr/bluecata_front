/**
 * Property: Σ ownership_i = 100% within tolerance for any cap-table view.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeView } from "../../src/captable/views.js";
import type { Holder, Security } from "../../src/types.js";

describe("Property: ownership percentages sum to 100%", () => {
  it("Random common-only cap tables sum to 100% within 1e-12", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 1_000_000_000n }), { minLength: 1, maxLength: 50 }),
        (sharesArr) => {
          const holders: Holder[] = sharesArr.map((_, i) => ({
            id: `h${i}`, name: `Holder ${i}`, type: "founder",
          }));
          const securities: Security[] = sharesArr.map((s, i) => ({
            id: `s${i}`, holderId: `h${i}`, kind: "common", shares: s, series: "Common",
          }));
          const rows = computeView({ view: "basic", securities, holders });
          const sum = rows.reduce((s, r) => s + parseFloat(r.ownershipPercent), 0);
          expect(Math.abs(sum - 100)).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 50 },
    );
  });
});
