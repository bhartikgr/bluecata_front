/**
 * Golden-master: Convertible Note conversion.
 *
 * Reference: Pulley convertible note guide
 *   https://pulley.com/guides/convertible-notes
 * Reference: NVCA convertible note primer.
 *
 * Worked example (precision-controlled):
 *   Principal = $250,000, simple interest 6%/yr, 1.5 years to conversion → interest = $22,500
 *   Outstanding = $272,500
 *   Cap = $5,000,000, Discount = 20%
 *   Series A PPS = $1.50
 *   Company capitalization at conversion = 5,000,000 (just round)
 *
 *   Cap price = $5,000,000 / 5,000,000 = $1.00
 *   Discount price = $1.50 × 0.80 = $1.20
 *   → cap binds at $1.00 (lowest)
 *   noteShares = $272,500 / $1.00 = 272,500 (floor)
 */
import { describe, it, expect } from "vitest";
import { convertNoteToPreferred } from "../../src/conversion/noteToPreferred.js";

describe("Convertible Note conversion — golden master", () => {
  it("$250k @ 6% simple, 1.5y, $5M cap, 20% discount, $1.50 PPS → 272,500 shares (cap binds)", () => {
    const r = convertNoteToPreferred({
      principal: "250000",
      interestRate: "0.06",
      interestKind: "simple",
      yearsElapsed: "1.5",
      cap: "5000000",
      discount: "0.20",
      seriesPricePerShare: "1.50",
      companyCapitalization: "5000000",
      formulaId: "note.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(r.outstanding).toBe("272500");
    expect(r.binding).toBe("cap");
    expect(r.conversionPrice).toBe("1");
    expect(r.noteShares.toString()).toBe("272500");
  });

  it("Discount-only note (no cap) → discount binds, accrued interest counted", () => {
    // Principal $100k, 5% simple, 2y → $10k interest → $110k. Discount 25%, PPS $4.00 → $3.00 conv.
    // 110,000 / 3 = 36,666.6666... → 36,666 floor.
    const r = convertNoteToPreferred({
      principal: "100000",
      interestRate: "0.05",
      interestKind: "simple",
      yearsElapsed: "2",
      discount: "0.25",
      seriesPricePerShare: "4.00",
      companyCapitalization: "1000000",
      formulaId: "note.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(r.outstanding).toBe("110000");
    expect(r.binding).toBe("discount");
    expect(r.conversionPrice).toBe("3");
    expect(r.noteShares.toString()).toBe("36666");
  });

  it("Compound interest math: 6% compounded over 2y on $1000 = $1123.60", () => {
    const r = convertNoteToPreferred({
      principal: "1000",
      interestRate: "0.06",
      interestKind: "compounded",
      yearsElapsed: "2",
      seriesPricePerShare: "10",
      companyCapitalization: "1000000",
      formulaId: "note.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    // (1.06)^2 × 1000 = 1123.60
    expect(r.outstanding.startsWith("1123.6")).toBe(true);
  });
});
