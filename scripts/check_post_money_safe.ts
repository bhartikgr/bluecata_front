/**
 * v25.20 Lane 2 NC1 \u2014 Empirical post-money SAFE conversion math test.
 *
 * Scenario: founder owns 9,000,000 shares (S0). Investor signs a $1M
 * post-money SAFE with $10M post-money cap. A priced Series A then closes.
 *
 * YC post-money SAFE math:
 *   investor shares = $1M / ($10M / total_post_conversion)
 *
 * The SAFE-holder ownership at conversion must be exactly:
 *   $1M / $10M = 10% post-conversion (before the new Series A money).
 *
 * Pre-v25.20 produced 900,000 shares / 8.65% (cap denominator excluded the
 * SAFE pool). v25.20 must produce ~1,000,000 shares / 10.0%.
 */
import { computeCapTable } from "../packages/cap-table-engine/src/captable/compute.ts";
import type { Holder, Transaction } from "../packages/cap-table-engine/src/types.ts";

const holders: Holder[] = [
  { id: "founder", name: "Founder", type: "founder" },
  { id: "safe-investor", name: "YC SAFE Investor", type: "investor" },
  { id: "series-a", name: "Series A Lead", type: "investor" },
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
      shares: 9_000_000n,
    },
  } as any,
  {
    type: "issue",
    date: "2025-06-01",
    security: {
      id: "safe-yc-1m",
      holderId: "safe-investor",
      kind: "safe",
      investmentAmount: "1000000",
      currency: "USD",
      safe: { type: "post_money_cap", cap: "10000000" },
    },
  } as any,
  {
    type: "issue_preferred_round",
    date: "2026-01-01",
    round: {
      id: "A",
      series: "Series A",
      preMoneyValuation: "10000000",
      investmentAmount: "2000000",
      pricePerShare: "1.111111",
      liquidationPreferenceMultiple: 1,
      participating: false,
      antiDilution: "broad_based",
    },
  } as any,
];

const result = computeCapTable({
  companyId: "test-yc-safe",
  asOf: "2026-01-01",
  view: "fully_diluted",
  formulaRegion: "US",
  holders,
  transactions: txs,
} as any);

const safeRow = result.rows.find((r: any) => r.holderId === "safe-investor");
if (!safeRow) {
  console.error("FAIL: SAFE row not found in result");
  process.exit(1);
}

const safeShares = Number(safeRow.shares.toString());
console.log("YC $1M @ $10M post-money cap on S0 = 9,000,000:");
console.log("  SAFE shares:", safeShares.toLocaleString());
console.log("  Pre-v25.20 (bug):     900,000");
console.log("  Post-v25.20 (target): 1,000,000");

const tolerance = 5_000;
if (Math.abs(safeShares - 1_000_000) < tolerance) {
  console.log("\u2705 POST-MONEY SAFE MATH CORRECT \u2014 v25.20 Lane 2 NC1 hard-closed.");
  process.exit(0);
} else {
  console.error(`\u274C POST-MONEY SAFE MATH WRONG \u2014 expected ~1,000,000, got ${safeShares}`);
  process.exit(1);
}
