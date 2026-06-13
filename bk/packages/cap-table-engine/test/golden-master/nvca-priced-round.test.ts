/**
 * Golden-master: NVCA priced Series A baseline.
 *
 * Reference: NVCA Model Legal Documents (Term Sheet, Charter, SPA)
 *   https://nvca.org/model-legal-documents/
 *
 * Standard Series A scenario:
 *   Pre-money: 8,000,000 founder shares + 2,000,000 reserved option pool = 10,000,000 fully-diluted.
 *   Pre-money valuation: $20,000,000.
 *   Series A round: $5,000,000 invested at the resulting PPS.
 *   PPS = pre-money / FD pre-money = $20,000,000 / 10,000,000 = $2.00
 *   New investor shares = $5,000,000 / $2.00 = 2,500,000
 *   Post-money FD = 10,000,000 + 2,500,000 = 12,500,000
 *   Investor ownership = 2,500,000 / 12,500,000 = 20.000%
 *   Founders = 8M/12.5M = 64%, Pool = 2M/12.5M = 16%.
 */
import { describe, it, expect } from "vitest";
import { computeCapTable } from "../../src/captable/compute.js";
import type { Holder, Transaction } from "../../src/types.js";

describe("NVCA priced Series A baseline — golden master", () => {
  it("$5M @ $20M pre-money on 10M FD → 20.00% to investors", () => {
    const holders: Holder[] = [
      { id: "founder", name: "Founder", type: "founder" },
      { id: "pool", name: "Option Pool", type: "pool" },
      { id: "investors-A", name: "Series A Investors", type: "investor" },
    ];

    const txs: Transaction[] = [
      {
        type: "issue",
        date: "2025-01-01",
        security: {
          id: "founder-common",
          holderId: "founder",
          kind: "common",
          series: "Common",
          shares: 8_000_000n,
        },
      },
      {
        type: "issue",
        date: "2025-01-02",
        security: {
          id: "pool-initial",
          holderId: "pool",
          kind: "option",
          series: "Pool",
          option: { grantedShares: 2_000_000n, exercisePrice: "0.01", vestingMonths: 0, cliffMonths: 0 },
        },
      },
      {
        type: "issue_preferred_round",
        date: "2025-06-01",
        round: {
          id: "A",
          series: "Series A",
          preMoneyValuation: "20000000",
          investmentAmount: "5000000",
          pricePerShare: "2.00",
          liquidationPreferenceMultiple: 1,
          participating: false,
          antiDilution: "broad_based",
        },
      },
    ];

    const result = computeCapTable({
      companyId: "test",
      asOf: "2025-06-01",
      view: "fully_diluted",
      formulaRegion: "US",
      holders,
      transactions: txs,
    });

    expect(result.totalShares.toString()).toBe("12500000");
    const founderRow = result.rows.find((r) => r.holderId === "founder");
    const investorRow = result.rows.find((r) => r.holderId === "investors-A");
    const poolRow = result.rows.find((r) => r.holderId === "pool");

    expect(founderRow).toBeDefined();
    expect(investorRow).toBeDefined();
    expect(poolRow).toBeDefined();
    expect(founderRow!.shares.toString()).toBe("8000000");
    expect(investorRow!.shares.toString()).toBe("2500000");
    expect(poolRow!.shares.toString()).toBe("2000000");

    // Ownership %
    expect(parseFloat(founderRow!.ownershipPercent).toFixed(4)).toBe("64.0000");
    expect(parseFloat(investorRow!.ownershipPercent).toFixed(4)).toBe("20.0000");
    expect(parseFloat(poolRow!.ownershipPercent).toFixed(4)).toBe("16.0000");
  });
});
