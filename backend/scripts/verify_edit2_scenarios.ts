/**
 * Independent verification scenarios for Edit 2 (liquidation waterfall budget).
 * Read-only.
 */
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";

function show(label: string, r: any) {
  console.log("\n=== " + label + " ===");
  console.log("  remainder:", r.remainder);
  for (const p of r.payouts) {
    const who = p.classId ?? p.holderId;
    console.log(`  ${who}: total=${p.total} pref=${p.preferenceTaken} part=${p.participation} asConv=${p.asConvertedTaken} decision=${p.decision}`);
  }
  const sum = r.payouts.reduce((s: number, p: any) => s + parseFloat(p.total), 0);
  console.log("  SUM of payouts:", sum.toLocaleString());
}

const base = { formulaId: "waterfall.liquidation", formulaVersion: "1.0.0", region: "US" as const, formulaDef: { f: "test" } };

// 3a: $10M Series A 1x + $5M Series B 1x + $20M common; $30M exit.
// Both get full pref; common gets remainder $30M-$15M=$15M. NO change vs pre-v25.20.
// Use shares such that as-converted does NOT beat preference (so they take preference).
// A: $10M invested, B: $5M invested. Give them small share counts so as-converted < pref.
show("3a $30M exit: A=$10M 1x, B=$5M 1x, common; full prefs + remainder", computeWaterfall({
  exitProceeds: "30000000",
  preferred: [
    { classId: "A", className: "Series A", invested: "10000000", shares: 1_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
    { classId: "B", className: "Series B", invested: "5000000", shares: 500_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
  ],
  common: [{ holderId: "founder", shares: 8_000_000n }],
  ...base,
}));

// 3b: $10M Series A 1x + $5M Series B 1x; $8M exit. B senior (seniority 0), takes $5M;
// A takes $3M (clamped at remaining budget). Common $0.
show("3b $8M exit: B senior $5M, A clamped to $3M, common $0", computeWaterfall({
  exitProceeds: "8000000",
  preferred: [
    { classId: "A", className: "Series A", invested: "10000000", shares: 1_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 1 },
    { classId: "B", className: "Series B", invested: "5000000", shares: 500_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
  ],
  common: [{ holderId: "founder", shares: 8_000_000n }],
  ...base,
}));

// 3c: Participating preferred with cap: $5M invested, 2x cap, $30M exit.
// preference $5M; participation pro-rata; total capped at 2x*$5M=$10M. Must produce $10M.
// Give pref a share count so as-converted < cap (so it doesn't convert out).
// as-converted = shares/(total) * 30M. With pref 1M shares, common 9M => 1/10*30M=3M < 10M cap. ok.
show("3c $30M exit: $5M participating 2x cap → $10M (cap binding)", computeWaterfall({
  exitProceeds: "30000000",
  preferred: [
    { classId: "A", className: "Series A", invested: "5000000", shares: 1_000_000n, liquidationPreferenceMultiple: 1, participating: true, participationCapMultiple: 2, seniority: 0 },
  ],
  common: [{ holderId: "founder", shares: 9_000_000n }],
  ...base,
}));

console.log("\nDONE");
