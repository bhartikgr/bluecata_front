/**
 * Reference SAFE conversion tests — pinned to the same published references
 * as the primary engine's `yc-safe-postmoney.test.ts` and `yc-safe-premoney.test.ts`.
 *
 * Reference: YC SAFE User Guide v1.2.
 *   https://www.ycombinator.com/documents
 *   https://www.ycombinator.com/blog/announcing-the-post-money-safe
 */
import { describe, it, expect } from "vitest";
import { refConvertSafe } from "../src/refMath.js";

describe("Reference SAFE conversion (YC SAFE v1.2 golden masters)", () => {
  it("$1M @ $10M post-money cap → exactly 1,000,000 shares (10% post-conversion)", () => {
    const r = refConvertSafe({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
    });
    expect(r.safeShares).toBe(1000000n);
    expect(r.binding).toBe("cap");
  });

  it("Discount-only SAFE (20% discount) at PPS $2.00 → conv price $1.60, $200k → 125,000 shares", () => {
    const r = refConvertSafe({
      purchaseAmount: "200000",
      capType: "discount_only",
      discount: "0.20",
      seriesPricePerShare: "2.00",
      companyCapitalization: "10000000",
    });
    expect(r.binding).toBe("discount");
    expect(r.safeShares).toBe(125000n);
  });

  it("Cap and discount both apply → cap binds (lowest price)", () => {
    const r = refConvertSafe({
      purchaseAmount: "500000",
      capType: "post_money_cap",
      cap: "10000000",
      discount: "0.20",
      seriesPricePerShare: "1.50",
      companyCapitalization: "10000000",
    });
    expect(r.binding).toBe("cap");
    expect(r.safeShares).toBe(500000n);
  });

  it("Pre-money SAFE: $500k @ $5M pre-money cap, 8M existing shares → 800,000 shares", () => {
    // Pre-money cap price = 5,000,000 / 8,000,000 = $0.625
    // Shares = 500,000 / 0.625 = 800,000
    const r = refConvertSafe({
      purchaseAmount: "500000",
      capType: "pre_money_cap",
      cap: "5000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "8000000",
    });
    expect(r.binding).toBe("cap");
    expect(r.safeShares).toBe(800000n);
  });
});
