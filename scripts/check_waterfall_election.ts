/**
 * v25.20 Lane 2 NC3 \u2014 Empirical waterfall election test.
 *
 * The v25.20 cap-table math verification (top model) found that the original
 * v25.20 NC3 patch clamped the as-converted value at `prefBudget` before the
 * convert-vs-preference election, which could WRONGLY flip a junior preferred
 * class with large equity into `preference_only` and zero common's residual.
 *
 * Concrete regression scenario the verifier surfaced (and that this script
 * now locks in):
 *
 *   Senior $17M 1\u00d7 (owns ~0 shares)
 *   Junior $4M 1\u00d7 (owns 9M of 10M as-converted shares \u2014 90% equity)
 *   Common 1M shares
 *   Exit $20M
 *
 *   Junior's TRUE as-converted = 9M/10M \u00d7 $20M = $18M, which MASSIVELY exceeds
 *   its $4M preference, so Junior must CONVERT.
 *
 *   Senior takes $17M, leaving $3M.
 *   Junior (converted) takes 9M/10M \u00d7 $3M = $2.70M.
 *   Common takes 1M/10M \u00d7 $3M = $0.30M.
 *   Sum = $20M (exit), NVCA \u00a72.1-correct.
 *
 *   Pre-fix (clamped) would have paid Junior $3M as preference_only, common $0.
 *   This script asserts the corrected behaviour.
 */
import { computeWaterfall } from \"../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts\";

const result = computeWaterfall({
  exitProceeds: \"20000000\",
  preferred: [
    {
      classId: \"senior\",
      className: \"Series B Preferred\",
      shares: 100n,
      invested: \"17000000\",
      liquidationPreferenceMultiple: 1,
      participating: false,
      seniority: 0,
    },
    {
      classId: \"junior\",
      className: \"Series A Preferred\",
      shares: 9_000_000n,
      invested: \"4000000\",
      liquidationPreferenceMultiple: 1,
      participating: false,
      seniority: 1,
    },
  ],
  common: [
    { holderId: \"common\", shares: 1_000_000n },
  ],
} as any);

console.log(\"v25.20 waterfall election regression\");
console.log(\"  Senior:\", result.payouts.find((p: any) => p.classId === \"senior\")?.total);
console.log(\"  Junior:\", result.payouts.find((p: any) => p.classId === \"junior\")?.total);
console.log(\"  Junior decision:\", result.payouts.find((p: any) => p.classId === \"junior\")?.decision);
console.log(\"  Common:\", result.commonPayouts?.[0]?.total ?? result.payouts.find((p: any) => p.holderId === \"common\")?.total ?? \"unknown shape\");

// Sum sanity: must equal exit ($20M) within rounding.
const allRows: number[] = [];
if (Array.isArray(result.payouts)) {
  for (const p of result.payouts) {
    if (p?.total) allRows.push(Number(p.total));
  }
}
if (Array.isArray(result.commonPayouts)) {
  for (const c of result.commonPayouts) {
    if (c?.total) allRows.push(Number(c.total));
  }
}
const sum = allRows.reduce((a, b) => a + b, 0);
console.log(\"  Total paid:\", sum.toLocaleString());

const senior = Number(result.payouts.find((p: any) => p.classId === \"senior\")?.total ?? \"0\");
const junior = Number(result.payouts.find((p: any) => p.classId === \"junior\")?.total ?? \"0\");
const juniorDecision = result.payouts.find((p: any) => p.classId === \"junior\")?.decision;

// NVCA-correct:
//   Senior \u2248 17,000,000 (clamped preference)
//   Junior \u2248 2,700,000 (converted, 9/10 of $3M residual)
//   Junior decision should NOT be \"preference_only\" \u2014 the rational actor converts.
const tol = 5000;
const seniorOk = Math.abs(senior - 17_000_000) < tol;
const juniorOk = Math.abs(junior - 2_700_000) < tol;
const sumOk = Math.abs(sum - 20_000_000) < tol;
const decisionOk = juniorDecision !== \"preference_only\";

if (seniorOk && juniorOk && sumOk && decisionOk) {
  console.log(\"\\n\u2705 WATERFALL ELECTION CORRECT \u2014 v25.20 Lane 2 NC3 post-verification fix holds.\");
  process.exit(0);
} else {
  console.error(\"\\n\u274C WATERFALL ELECTION WRONG:\");
  console.error(\"  senior ok?\", seniorOk, \"(want 17,000,000, got\", senior.toLocaleString(), \")\");
  console.error(\"  junior ok?\", juniorOk, \"(want 2,700,000, got\", junior.toLocaleString(), \")\");
  console.error(\"  sum ok?\", sumOk, \"(want 20,000,000, got\", sum.toLocaleString(), \")\");
  console.error(\"  decision ok?\", decisionOk, \"(want !preference_only, got\", juniorDecision, \")\");
  process.exit(1);
}
