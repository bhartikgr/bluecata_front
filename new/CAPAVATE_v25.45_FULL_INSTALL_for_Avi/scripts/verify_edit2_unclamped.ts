// Run the SAME distortion scenario against an UNCLAMPED copy (line 171 removed),
// keeping all other Edit-2 budget enforcement intact, to isolate the clamp's effect.
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/_probe_unclamped.ts";
const base = { formulaId: "w", formulaVersion: "1.0.0", region: "US" as const, formulaDef: {} };
function show(label: string, r: any) {
  console.log("\n=== " + label + " ===", "remainder:", r.remainder);
  for (const p of r.payouts) console.log(`  ${p.classId ?? p.holderId}: total=${Number(p.total).toFixed(2)} dec=${p.decision}`);
  console.log("  SUM:", r.payouts.reduce((s: number, p: any) => s + parseFloat(p.total), 0).toFixed(2));
}
// Same as critique2 distortion case.
show("UNCLAMPED (line171 removed) — distortion scenario", computeWaterfall({
  exitProceeds: "20000000",
  preferred: [
    { classId: "S", className: "Senior", invested: "17000000", shares: 1n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
    { classId: "J", className: "Junior", invested: "4000000", shares: 9_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
  ],
  common: [{ holderId: "f", shares: 1_000_000n }],
  ...base,
}));

// Also re-verify scenario 3b ($8M exit two classes) UNCLAMPED to ensure no over-pay reappears.
show("UNCLAMPED — 3b $8M exit (must still sum $8M)", computeWaterfall({
  exitProceeds: "8000000",
  preferred: [
    { classId: "A", className: "Series A", invested: "10000000", shares: 1_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
    { classId: "B", className: "Series B", invested: "5000000", shares: 500_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
  ],
  common: [{ holderId: "f", shares: 8_000_000n }],
  ...base,
}));
console.log("\nDONE");
