/**
 * Independent verification scenarios for Edit 1 (post-money SAFE denominator).
 * Read-only — does not modify engine code.
 */
import { computeCapTable } from "../packages/cap-table-engine/src/captable/compute.ts";
import type { Holder, Transaction } from "../packages/cap-table-engine/src/types.ts";

function run(label: string, holders: Holder[], txs: Transaction[]) {
  const result = computeCapTable({
    companyId: "verify",
    asOf: "2030-01-01",
    view: "fully_diluted",
    formulaRegion: "US",
    holders,
    transactions: txs,
  } as any);
  console.log("\n=== " + label + " ===");
  for (const r of result.rows as any[]) {
    console.log(`  ${r.holderId}: shares=${r.shares.toString()} own%=${r.ownershipPercent}`);
  }
  return result;
}

// ---------- 3a: Two post-money SAFEs at same cap ----------
// $500k + $500k at $10M cap on 9M S0. Each should get 500,000 shares; combined 10%.
run("3a Two $500k post-money SAFEs @ $10M cap, S0=9M", [
  { id: "founder", name: "F", type: "founder" },
  { id: "safe1", name: "S1", type: "investor" },
  { id: "safe2", name: "S2", type: "investor" },
  { id: "seriesa", name: "A", type: "investor" },
], [
  { type: "issue", date: "2025-01-01", security: { id: "fc", holderId: "founder", kind: "common", series: "Common", shares: 9_000_000n } } as any,
  { type: "issue", date: "2025-06-01", security: { id: "s1", holderId: "safe1", kind: "safe", investmentAmount: "500000", currency: "USD", safe: { type: "post_money_cap", cap: "10000000" } } } as any,
  { type: "issue", date: "2025-06-02", security: { id: "s2", holderId: "safe2", kind: "safe", investmentAmount: "500000", currency: "USD", safe: { type: "post_money_cap", cap: "10000000" } } } as any,
  { type: "issue_preferred_round", date: "2026-01-01", round: { id: "A", series: "Series A", preMoneyValuation: "10000000", investmentAmount: "2000000", pricePerShare: "1.111111", liquidationPreferenceMultiple: 1, participating: false, antiDilution: "broad_based" } } as any,
]);

// ---------- 3b: Post-money SAFE + discount ----------
// $1M at $20M cap with 20% discount, round price $1/share, S0=10M.
// Cap price path: rebased denom; effectiveCap = 20M-1M=19M; denom = 10M*20M/19M=10,526,315
//   capPrice = 20M/10,526,315 = 1.9000; shares = 1M/1.9 = 526,315
// Discount price = 1.00 * (1-0.20) = 0.80; shares = 1M/0.80 = 1,250,000 (BETTER -> more shares)
// Round price = 1.00 -> 1,000,000
// Best for investor = lowest price = discount 0.80 -> 1,250,000 shares
run("3b $1M post-money @ $20M cap + 20% discount, PPS=$1, S0=10M", [
  { id: "founder", name: "F", type: "founder" },
  { id: "safe1", name: "S1", type: "investor" },
  { id: "seriesa", name: "A", type: "investor" },
], [
  { type: "issue", date: "2025-01-01", security: { id: "fc", holderId: "founder", kind: "common", series: "Common", shares: 10_000_000n } } as any,
  { type: "issue", date: "2025-06-01", security: { id: "s1", holderId: "safe1", kind: "safe", investmentAmount: "1000000", currency: "USD", safe: { type: "post_money_cap", cap: "20000000", discount: "0.20" } } } as any,
  { type: "issue_preferred_round", date: "2026-01-01", round: { id: "A", series: "Series A", preMoneyValuation: "10000000", investmentAmount: "2000000", pricePerShare: "1.00", liquidationPreferenceMultiple: 1, participating: false, antiDilution: "broad_based" } } as any,
]);

// ---------- 3c: Pre-money SAFE unchanged ----------
// $1M at $5M PRE-money cap on 5M S0 (we use 5M FD here), round $1/share.
// Pre-money cap price = 5M / 5M = 1.00 == round price. shares = 1M/1.00 = 1,000,000.
// To exercise the cap-binding clearly, also test with cap that binds:
// pre-money cap price = 5M/5M=1.00, round price 1.00 -> tie, cap wins -> 1,000,000
run("3c $1M pre-money @ $5M PRE cap on 5M S0, PPS=$1 (pre-money unchanged)", [
  { id: "founder", name: "F", type: "founder" },
  { id: "safe1", name: "S1", type: "investor" },
  { id: "seriesa", name: "A", type: "investor" },
], [
  { type: "issue", date: "2025-01-01", security: { id: "fc", holderId: "founder", kind: "common", series: "Common", shares: 5_000_000n } } as any,
  { type: "issue", date: "2025-06-01", security: { id: "s1", holderId: "safe1", kind: "safe", investmentAmount: "1000000", currency: "USD", safe: { type: "pre_money_cap", cap: "5000000" } } } as any,
  { type: "issue_preferred_round", date: "2026-01-01", round: { id: "A", series: "Series A", preMoneyValuation: "5000000", investmentAmount: "2000000", pricePerShare: "1.00", liquidationPreferenceMultiple: 1, participating: false, antiDilution: "broad_based" } } as any,
]);

// ---------- 3d: degenerate cap < sum of post-money SAFE amounts ----------
// $1M cap with $1.5M SAFE total. effectiveCap = 1M - 1.5M = -0.5M < 0 -> guard keeps old denom.
// Old denom = companyCap = S0 = 9M. capPrice = 1M/9M = 0.1111; shares = 1.5M/0.1111 = 13,500,000
// Should NOT crash; should fall back to companyCap.
run("3d degenerate: $1.5M SAFE total, $1M cap (effectiveCap<0 guard)", [
  { id: "founder", name: "F", type: "founder" },
  { id: "safe1", name: "S1", type: "investor" },
  { id: "seriesa", name: "A", type: "investor" },
], [
  { type: "issue", date: "2025-01-01", security: { id: "fc", holderId: "founder", kind: "common", series: "Common", shares: 9_000_000n } } as any,
  { type: "issue", date: "2025-06-01", security: { id: "s1", holderId: "safe1", kind: "safe", investmentAmount: "1500000", currency: "USD", safe: { type: "post_money_cap", cap: "1000000" } } } as any,
  { type: "issue_preferred_round", date: "2026-01-01", round: { id: "A", series: "Series A", preMoneyValuation: "9000000", investmentAmount: "1000000", pricePerShare: "1.00", liquidationPreferenceMultiple: 1, participating: false, antiDilution: "broad_based" } } as any,
]);

console.log("\nDONE");
