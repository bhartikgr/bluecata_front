/**
 * Probe the participation-cap binding logic to confirm correctness.
 * $5M invested, 2x cap => cap = $10M. We need participation large enough that
 * preference + participation > $10M, so cap binds.
 * Make the pref own a large fraction so participation is big.
 */
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";
const base = { formulaId: "w", formulaVersion: "1.0.0", region: "US" as const, formulaDef: {} };
function show(label: string, r: any) {
  console.log("\n=== " + label + " ===", "remainder:", r.remainder);
  for (const p of r.payouts) console.log(`  ${p.classId ?? p.holderId}: total=${p.total} pref=${p.preferenceTaken} part=${p.participation} dec=${p.decision}`);
  console.log("  SUM:", r.payouts.reduce((s: number, p: any) => s + parseFloat(p.total), 0).toLocaleString());
}

// Pref owns 5M of 6M total. exit $30M. pref=$5M; remAfterPref=$25M;
// participation = 5M/6M * 25M = 20.83M; total uncapped=25.83M > cap $10M.
// as-converted at full = 5M/6M*30M = 25M > cap $10M => CONVERTS (treatAsCommon).
// That tests the "as-converted exceeds cap => convert" branch.
show("Cap binds & as-conv>cap => converts", computeWaterfall({
  exitProceeds: "30000000",
  preferred: [{ classId: "A", className: "A", invested: "5000000", shares: 5_000_000n, liquidationPreferenceMultiple: 1, participating: true, participationCapMultiple: 2, seniority: 0 }],
  common: [{ holderId: "f", shares: 1_000_000n }],
  ...base,
}));

// Now make as-converted < cap but uncapped participation > cap, so cap truly binds to $10M.
// pref 1M shares, common 1M shares, exit $12M. pref=$5M; remAfterPref=$7M;
// participation=1M/2M*7M=$3.5M; total=$8.5M < cap $10M => cap does NOT bind, total $8.5M.
// Need bigger participation w/o as-conv>cap. Try exit $14M, pref 1M common 0.4M:
// total shares 1.4M; pref=$5M; remAfter=$9M; part=1/1.4*9=$6.43M; total=$11.43M>cap$10M.
// as-conv=1/1.4*14=$10M; is 10M>cap10M? no (equal). So cap binds => total=$10M.
show("Cap binds (as-conv<=cap) => $10M", computeWaterfall({
  exitProceeds: "14000000",
  preferred: [{ classId: "A", className: "A", invested: "5000000", shares: 1_000_000n, liquidationPreferenceMultiple: 1, participating: true, participationCapMultiple: 2, seniority: 0 }],
  common: [{ holderId: "f", shares: 400_000n }],
  ...base,
}));
console.log("\nDONE");
