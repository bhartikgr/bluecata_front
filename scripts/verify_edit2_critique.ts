/**
 * Critique of line 171 asConvertedClamped: does clamping as-converted to the
 * residual prefBudget ever DISTORT the convert-vs-preference decision?
 *
 * Setup: a SENIOR class consumes most of the budget. A JUNIOR non-participating
 * class has a SMALL preference but OWNS a large share of equity, so its true
 * as-converted value (at full exit) exceeds its preference => it SHOULD convert
 * and share pro-rata in the FULL exit alongside common.
 *
 * But after the senior class, prefBudget is small. If asConvertedAtFull is
 * clamped to prefBudget and that clamp pushes it BELOW the junior's preference,
 * the code wrongly picks preference_only.
 */
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";
const base = { formulaId: "w", formulaVersion: "1.0.0", region: "US" as const, formulaDef: {} };
function show(label: string, r: any) {
  console.log("\n=== " + label + " ===", "remainder:", r.remainder);
  for (const p of r.payouts) console.log(`  ${p.classId ?? p.holderId}: total=${p.total} pref=${p.preferenceTaken} asConv=${p.asConvertedTaken} dec=${p.decision}`);
  console.log("  SUM:", r.payouts.reduce((s: number, p: any) => s + parseFloat(p.total), 0).toLocaleString());
}

// Senior class S: invested $18M, 1x pref, tiny shares. Junior class J: invested $1M (small pref),
// owns 5M shares (big equity). Common owns 1M shares. Exit = $20M.
// totalAsConvertedShares = S.shares + J.shares + common = 0.1M + 5M + 1M = 6.1M
// S (seniority 0): preferenceFull=$18M, prefBudget=20M -> preference=$18M. as-conv S small.
//   S as-conv = 0.1/6.1*20 = $0.33M < $18M pref -> preference_only $18M. prefBudget -> $2M.
// J (seniority 1): preferenceFull=$1M. asConvertedAtFull = 5/6.1*20 = $16.39M (TRUE convert value).
//   Correct decision: 16.39M >> 1M pref => J should CONVERT and take pro-rata of full exit.
//   BUT asConvertedClamped = min(16.39M, prefBudget=2M) = $2M. 2M > 1M pref => still converts. (>)
//   So here it still converts. To break it we need prefBudget < J.preference.
show("J should convert; clamp leaves it >pref (still converts)", computeWaterfall({
  exitProceeds: "20000000",
  preferred: [
    { classId: "S", className: "Senior", invested: "18000000", shares: 100_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
    { classId: "J", className: "Junior", invested: "1000000", shares: 5_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
  ],
  common: [{ holderId: "f", shares: 1_000_000n }],
  ...base,
}));

// Now FORCE the distortion: senior consumes budget down BELOW junior's preference.
// Senior invested $19.5M. Exit $20M. After S: prefBudget = $0.5M.
// J invested $1M (pref $1M), owns 5M shares. asConvertedAtFull = 5/6.1*20 = $16.39M.
//   TRUE: 16.39M >> 1M => J should convert, would receive pro-rata of remaining ($0.5M):
//     in convert path J shares pool with common: 5M/(5M+1M)*0.5M = $0.417M.
//   That's still better than... wait preference_only would give min path.
//   With clamp: asConvertedClamped = min(16.39M, 0.5M)=0.5M. 0.5M > 1M pref? NO.
//   => code picks preference_only, pays J $1M?! But budget only $0.5M. preference clamped:
//     preference = min(1M, prefBudget 0.5M) = $0.5M. So J gets $0.5M as preference_only.
//   Either way J ends with ~$0.5M. Compare to convert path $0.417M. Pref_only gives MORE here.
show("Senior eats budget below J pref: distortion check", computeWaterfall({
  exitProceeds: "20000000",
  preferred: [
    { classId: "S", className: "Senior", invested: "19500000", shares: 100_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
    { classId: "J", className: "Junior", invested: "1000000", shares: 5_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
  ],
  common: [{ holderId: "f", shares: 1_000_000n }],
  ...base,
}));

// The cleanest distortion: show that clamp flips decision vs UNCLAMPED logic.
// We compare what the code does vs what correct max(pref, convert) would do.
// Junior: pref $5M, owns 5M of 6.1M. Senior eats budget to $4M remaining.
// asConvertedAtFull = 5/6.1*exit. Pick exit so asConvFull > pref(5M) (junior SHOULD convert)
//   but prefBudget(4M) < pref(5M). Senior invested $16M, exit $20M => after S prefBudget=$4M.
//   J asConvFull = 5/6.1*20 = $16.39M > $5M pref => SHOULD CONVERT.
//   clamp: min(16.39,4)=4M. 4M>5M? NO => code picks preference_only.
//   preference clamped to min(5M, budget4M)=4M. J gets $4M flat, common $0.
//   CORRECT (convert): J+common share remaining $4M pro-rata: J=5/6*4=$3.33M, common $0.67M.
//   Pref_only path gives J $4M vs convert $3.33M. So for J, pref_only is actually >= convert here
//   because budget is the true ceiling. Document the real effect.
show("Distortion: J asConvFull>pref but budget<pref", computeWaterfall({
  exitProceeds: "20000000",
  preferred: [
    { classId: "S", className: "Senior", invested: "16000000", shares: 100_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
    { classId: "J", className: "Junior", invested: "5000000", shares: 5_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
  ],
  common: [{ holderId: "f", shares: 1_000_000n }],
  ...base,
}));
console.log("\nDONE");
