/**
 * Reference convertible-note tests.
 *
 * Reference: Pulley primer https://pulley.com/guides/convertible-notes
 *   $250,000 principal, 6% simple interest, 24 months, 20% discount, $5M cap.
 *   At Series A with PPS $1.00 and 10M company shares:
 *     simple interest = 250,000 × 0.06 × 2 = 30,000
 *     outstanding = 280,000
 *     cap price = 5,000,000 / 10,000,000 = 0.50  (binds)
 *     shares = 280,000 / 0.50 = 560,000
 */
import { describe, it, expect } from "vitest";
import { refConvertNote } from "../src/refMath.js";

describe("Reference Note conversion", () => {
  it("Pulley primer: $250k @ 6% simple, 24 months, 20% discount, $5M cap → 560,000 shares", () => {
    const r = refConvertNote({
      principal: "250000",
      interestRate: "0.06",
      interestKind: "simple",
      yearsElapsed: "2",
      cap: "5000000",
      discount: "0.20",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
    });
    expect(r.binding).toBe("cap");
    expect(r.outstanding.startsWith("280000")).toBe(true);
    expect(r.noteShares).toBe(560000n);
  });

  it("Discount binds when no cap: PPS $1.00, 25% discount → conv price $0.75", () => {
    const r = refConvertNote({
      principal: "100000",
      interestRate: "0.05",
      interestKind: "simple",
      yearsElapsed: "1",
      discount: "0.25",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
    });
    expect(r.binding).toBe("discount");
    // outstanding = 100,000 × (1 + 0.05) = 105,000; / 0.75 = 140,000
    expect(r.noteShares).toBe(140000n);
  });
});
