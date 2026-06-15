// 3-class senior/junior cascade FIFO budget exhaustion vs NVCA §2.1.
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";
const base = { formulaId: "w", formulaVersion: "1.0.0", region: "US" as const, formulaDef: {} };
function show(label: string, r: any) {
  console.log("\n=== " + label + " ===", "remainder:", r.remainder);
  for (const p of r.payouts) console.log(`  ${p.classId ?? p.holderId}: total=${Number(p.total).toFixed(2)} dec=${p.decision}`);
  console.log("  SUM:", r.payouts.reduce((s: number, p: any) => s + parseFloat(p.total), 0).toFixed(2));
}
// C senior(0)=$6M, B(1)=$6M, A(2)=$6M; all 1x non-participating, tiny shares (take pref).
// Exit $14M. FIFO: C $6M -> budget $8M; B $6M -> budget $2M; A clamped $2M -> budget $0. Common $0.
show("3-class FIFO: $14M exit, C/B/A each $6M 1x", computeWaterfall({
  exitProceeds: "14000000",
  preferred: [
    { classId: "C", className: "Series C", invested: "6000000", shares: 10n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
    { classId: "B", className: "Series B", invested: "6000000", shares: 10n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
    { classId: "A", className: "Series A", invested: "6000000", shares: 10n, liquidationPreferenceMultiple: 1, participating: false, seniority: 2 },
  ],
  common: [{ holderId: "f", shares: 1_000_000n }],
  ...base,
}));
console.log("\nExpected (NVCA §2.1 FIFO): C=$6M, B=$6M, A=$2M (clamped), common=$0, sum=$14M");
console.log("DONE");
