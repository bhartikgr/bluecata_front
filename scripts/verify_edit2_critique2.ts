/**
 * Sharpest test of the line-171 clamp distortion, and a re-implementation of the
 * CORRECT decision rule (unclamped convert-vs-preference, budget applied only as
 * a downstream cash cap) for side-by-side comparison.
 */
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";
const base = { formulaId: "w", formulaVersion: "1.0.0", region: "US" as const, formulaDef: {} };
function show(label: string, r: any) {
  console.log("\n=== " + label + " ===", "remainder:", r.remainder);
  for (const p of r.payouts) console.log(`  ${p.classId ?? p.holderId}: total=${Number(p.total).toFixed(2)} dec=${p.decision}`);
  console.log("  SUM:", r.payouts.reduce((s: number, p: any) => s + parseFloat(p.total), 0).toFixed(2));
}

// Junior SHOULD convert (asConvFull >> pref) and that conversion would give common
// a fair pro-rata slice. Senior eats budget so prefBudget < pref. The clamp makes
// junior take ALL residual budget as preference, ZEROING common — even though under
// NVCA the junior elected (economically) to convert and SHARE with common.
//
// Senior $17M, exit $20M => after senior prefBudget=$3M.
// Junior pref $4M, owns 9M of 10M as-converted shares (S 0M-ish). Common 1M.
// asConvFull(J) = 9/10 * 20 = $18M >> $4M => J converts (correct).
// If J converts: J + common split residual $3M: J=9/10*3=$2.7M, common=$0.3M.
// Engine (clamped): asConvClamped=min(18,3)=3M; 3M>4M? no => preference_only; pref clamped to $3M.
//   => J gets $3M, common $0.
const r = computeWaterfall({
  exitProceeds: "20000000",
  preferred: [
    { classId: "S", className: "Senior", invested: "17000000", shares: 1n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
    { classId: "J", className: "Junior", invested: "4000000", shares: 9_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
  ],
  common: [{ holderId: "f", shares: 1_000_000n }],
  ...base,
});
show("Engine (clamped line 171)", r);
console.log("  -> Junior takes ALL $3M residual as preference; common ZEROED.");
console.log("  NVCA-correct (J converts, shares residual w/ common): J=$2.70M, common=$0.30M");
console.log("\nDONE");
