/**
 * Golden-master: YC Pre-Money SAFE conversion.
 *
 * Reference: YC SAFE primer (legacy pre-money)
 *   https://www.ycombinator.com/documents
 *   https://www.ycombinator.com/safe
 *
 * Worked example (pre-money cap):
 *   SAFE investor pays $500k.
 *   Pre-money valuation cap = $5,000,000.
 *   At Series A: 7,500,000 fully-diluted shares pre-conversion (founders + ESOP, no SAFEs).
 *   Series A PPS = $1.00.
 *
 *   Pre-money SAFE Price = Pre-Money Cap / Company Capitalization (pre-money, excluding the
 *   SAFE itself) = $5,000,000 / 7,500,000 = $0.66666666...
 *   SAFE shares = $500,000 / $0.6666... = 750,000
 *
 *   Verified: with 7,500,000 pre-conversion + 750,000 SAFE shares, post-cap ownership
 *   for SAFE = 750,000 / (7,500,000 + 750,000 + Series A shares).
 */
import { describe, it, expect } from "vitest";
import { convertSafeToPreferred } from "../../src/conversion/safeToPreferred.js";

describe("YC Pre-Money SAFE — golden master", () => {
  it("$500k @ $5M pre-money cap → 750,000 shares (at PPS $1.00, 7.5M pre-cap)", () => {
    const result = convertSafeToPreferred({
      purchaseAmount: "500000",
      capType: "pre_money_cap",
      cap: "5000000",
      seriesPricePerShare: "1.00",
      companyCapitalization: "7500000", // pre-money capitalization
      formulaId: "safe.premoney.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    // Conversion price = $5,000,000 / 7,500,000 = $0.6666666...
    // SAFE shares = $500,000 / $0.6666... = 750,000
    expect(result.binding).toBe("cap");
    expect(result.safeShares.toString()).toBe("750000");
  });

  it("Round price beats cap when cap is high enough → discount/PPS binds", () => {
    // Cap price = $20M / 5M = $4.00. PPS = $2.00. Round price wins.
    const result = convertSafeToPreferred({
      purchaseAmount: "100000",
      capType: "pre_money_cap",
      cap: "20000000",
      seriesPricePerShare: "2.00",
      companyCapitalization: "5000000",
      formulaId: "safe.premoney.conversion",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
    });
    expect(result.binding).toBe("round_price");
    // 100,000 / 2.00 = 50,000
    expect(result.safeShares.toString()).toBe("50000");
  });
});
