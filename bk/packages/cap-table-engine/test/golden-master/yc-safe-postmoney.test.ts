/**
 * Golden-master: YC Post-Money SAFE conversion.
 *
 * Reference: YC Post-Money SAFE User Guide (v1.2)
 *   https://www.ycombinator.com/documents
 *   https://www.ycombinator.com/blog/announcing-the-post-money-safe
 *
 * Worked example (canonical YC primer):
 *   SAFE investor pays $1,000,000 for a SAFE with $10,000,000 post-money cap.
 *   At Series A:
 *     existing pre-conversion capitalization = 9,000,000 shares (founders + pool)
 *     Series A PPS = $1.00
 *
 *   For a POST-money cap, the SAFE price denominator is the POST-money capitalization
 *   *including* the SAFE shares themselves. The defining invariant of post-money SAFE:
 *
 *     SAFE shares / (SAFE shares + everything else priced at this round)
 *       = (SAFE purchase amount) / (SAFE post-money cap)
 *
 *   Equivalently:
 *     SAFE_% = $1,000,000 / $10,000,000 = 10.000000%
 *
 *   To produce that, we feed the engine the post-money capitalization so the
 *   conversion price = cap / postMoneyCap = $10M / 10M = $1.00. With 9M existing shares,
 *   the SAFE issues 1,000,000 shares → exactly 10% of the 10M post-conversion total.
 */
import { describe, it, expect } from "vitest";
import { convertSafeToPreferred } from "../../src/conversion/safeToPreferred.js";
import { D } from "../../src/primitives/bigDecimal.js";

describe("YC Post-Money SAFE v1.2 — golden master", () => {
  it("$1M @ $10M post-money cap → exactly 10% of post-conversion", () => {
    // Post-money capitalization = existing 9,000,000 + SAFE shares 1,000,000 = 10,000,000.
    // Engine takes companyCapitalization = post-money denominator.
    const result = convertSafeToPreferred({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(result.safeShares.toString()).toBe("1000000");
    expect(result.binding).toBe("cap");
    // Post-conversion ownership of SAFE = 1,000,000 / 10,000,000 = 10%
    const safeOwnership = D(result.safeShares.toString()).div(D("10000000")).mul(100);
    expect(safeOwnership.toFixed(8)).toBe("10.00000000");
  });

  it("Discount-only SAFE (20% discount) at PPS $2.00 → conv price $1.60, $200k → 125,000 shares", () => {
    const result = convertSafeToPreferred({
      purchaseAmount: "200000",
      capType: "discount_only",
      discount: "0.20",
      seriesPricePerShare: "2.00",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(result.binding).toBe("discount");
    // 200,000 / 1.60 = 125,000
    expect(result.safeShares.toString()).toBe("125000");
  });

  it("Cap and discount both apply → engine picks lowest conversion price (cap)", () => {
    // Cap implies $10M / 10M = $1.00. Discount price = $1.50 × 0.80 = $1.20. Cap wins.
    const result = convertSafeToPreferred({
      purchaseAmount: "500000",
      capType: "post_money_cap",
      cap: "10000000",
      discount: "0.20",
      seriesPricePerShare: "1.50",
      companyCapitalization: "10000000",
      formulaId: "safe.postmoney.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(result.binding).toBe("cap");
    // 500,000 / 1.00 = 500,000 shares
    expect(result.safeShares.toString()).toBe("500000");
  });
});
