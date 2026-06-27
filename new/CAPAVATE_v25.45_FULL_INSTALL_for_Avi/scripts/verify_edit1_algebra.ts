/**
 * Algebraic cross-check of Edit 1 against the YC post-money SAFE legal definition.
 *
 * YC legal (Pillar Legal / Law of VC): post-money SAFE ownership at conversion =
 *   Investment / Cap, where Company Capitalization INCLUDES the converting SAFE(s).
 *
 * Solve: X / (S0 + X_total) = Investment / Cap  (single SAFE: X_total = X)
 *   => X = (Investment/Cap) * (S0 + X)
 *   => X (1 - Investment/Cap) = (Investment/Cap)*S0
 *   => X = S0 * Investment / (Cap - Investment)
 *
 * The engine computes shares = purchase * S0 / effectiveCap where
 *   effectiveCap = Cap - sum(post-money SAFE amounts).
 * For a single SAFE, sum = Investment, so shares = S0 * Investment / (Cap - Investment).
 * These are ALGEBRAICALLY IDENTICAL. Confirm numerically:
 */
function engineShares(purchase: number, cap: number, S0: number, sumSafes: number) {
  // mirrors compute.ts: rebased = S0 * cap / (cap - sumSafes); capPrice = cap/rebased; shares = purchase/capPrice
  const effectiveCap = cap - sumSafes;
  const rebased = (S0 * cap) / effectiveCap;
  const capPrice = cap / rebased;
  return purchase / capPrice;
}
function ycClosedForm(purchase: number, cap: number, S0: number) {
  return (S0 * purchase) / (cap - purchase);
}

const cases = [
  { label: "Carta $1M @ $10M, S0=9M", purchase: 1_000_000, cap: 10_000_000, S0: 9_000_000, sumSafes: 1_000_000 },
  { label: "$500k @ $5M post, S0=4.5M (qubit 10%)", purchase: 500_000, cap: 5_000_000, S0: 4_500_000, sumSafes: 500_000 },
  { label: "$100k @ $4M post, S0=10M (SparkLaunch)", purchase: 100_000, cap: 4_000_000, S0: 10_000_000, sumSafes: 100_000 },
];

for (const c of cases) {
  const eng = engineShares(c.purchase, c.cap, c.S0, c.sumSafes);
  const yc = ycClosedForm(c.purchase, c.cap, c.S0);
  const ownAtConv = eng / (c.S0 + eng);
  const target = c.purchase / c.cap;
  console.log(`\n${c.label}`);
  console.log(`  engine shares      = ${eng.toFixed(2)}`);
  console.log(`  YC closed-form     = ${yc.toFixed(2)}`);
  console.log(`  ownership@conv     = ${(ownAtConv*100).toFixed(4)}%`);
  console.log(`  target (Inv/Cap)   = ${(target*100).toFixed(4)}%`);
  const diffPct = Math.abs(ownAtConv - target) / target * 100;
  console.log(`  ownership diff     = ${diffPct.toFixed(6)}%  ${diffPct < 0.5 ? "PASS (<0.5%)" : "FAIL"}`);
}
