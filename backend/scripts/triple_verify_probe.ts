/* THIRD INDEPENDENT verification probe — written from scratch, trusts nothing. */
import { computeCapTable } from "../packages/cap-table-engine/src/captable/compute.ts";
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";
import type { Holder, Transaction } from "../packages/cap-table-engine/src/types.ts";

let failures = 0;
function check(label: string, expected: number, actual: number, tolAbs: number) {
  const ok = Math.abs(expected - actual) <= tolAbs;
  if (!ok) failures++;
  console.log(`${ok ? "MATCH" : "*** MISMATCH"} | ${label} | expected=${expected} actual=${actual} tol=${tolAbs}`);
}
function info(s: string) { console.log("  " + s); }

// ---------- CLAIM 1: post-money SAFE conversion ----------
function runSafe(S0: bigint, safes: { amt: string }[], cap: string) {
  const holders: Holder[] = [
    { id: "founder", name: "Founder", type: "founder" },
    { id: "seriesA", name: "Series A", type: "investor" },
  ];
  const txs: Transaction[] = [
    { type: "issue", date: "2025-01-01", security: { id: "f", holderId: "founder", kind: "common", series: "Common", shares: S0 } } as any,
  ];
  safes.forEach((s, i) => {
    holders.push({ id: `safe${i}`, name: `SAFE ${i}`, type: "investor" });
    txs.push({ type: "issue", date: "2025-02-01", security: {
      id: `safe${i}`, holderId: `safe${i}`, kind: "safe", series: "SAFE",
      investmentAmount: s.amt, currency: "USD",
      safe: { type: "post_money_cap", cap },
    } } as any);
  });
  // priced round closes; pps high so cap binds. Tiny new money to avoid distorting.
  txs.push({ type: "issue_preferred_round", date: "2025-06-01", round: {
    id: "A", series: "Series A", preMoneyValuation: "100000000",
    investmentAmount: "0", pricePerShare: "1000",
    liquidationPreferenceMultiple: 1, participating: false,
  } } as any);
  const res = computeCapTable({ asOf: "2025-06-02", view: "fully_diluted", formulaRegion: "US", holders, transactions: txs } as any);
  return res;
}

console.log("\n========== CLAIM 1: post-money SAFE ==========");

// S1: S0=9M, one $1M SAFE @ $10M post cap → 1,000,000 shares, 10%
{
  const r = runSafe(9_000_000n, [{ amt: "1000000" }], "10000000");
  const safeRow = r.rows.find((x: any) => x.holderId === "safe0");
  const totalNonRound = r.rows.filter((x:any)=>x.holderId!=="investors-A").reduce((s:number,x:any)=>s+Number(x.shares),0);
  info(`S1 safe shares=${safeRow?.shares} ownership%=${safeRow?.ownershipPercent}`);
  check("S1 shares", 1_000_000, Number(safeRow?.shares ?? 0), 1);
  // ownership = safe / (S0 + safe) = 1M/10M = 10%
  check("S1 ownership% (of 9M+1M)", 10, 100*Number(safeRow?.shares??0)/(9_000_000+Number(safeRow?.shares??0)), 0.001);
}

// S2: S0=9M, two $500k SAFEs → each 500,000, combined 1M / 10M = 10%
{
  const r = runSafe(9_000_000n, [{ amt: "500000" }, { amt: "500000" }], "10000000");
  const s0 = r.rows.find((x: any) => x.holderId === "safe0");
  const s1 = r.rows.find((x: any) => x.holderId === "safe1");
  info(`S2 safe0=${s0?.shares} safe1=${s1?.shares}`);
  check("S2 safe0 shares", 500_000, Number(s0?.shares ?? 0), 1);
  check("S2 safe1 shares", 500_000, Number(s1?.shares ?? 0), 1);
  const combined = Number(s0?.shares??0)+Number(s1?.shares??0);
  check("S2 combined ownership%", 10, 100*combined/(9_000_000+combined), 0.001);
}

// S3: S0=5M, $2M SAFE @ $10M → 1,250,000, 20%
{
  const r = runSafe(5_000_000n, [{ amt: "2000000" }], "10000000");
  const s0 = r.rows.find((x: any) => x.holderId === "safe0");
  info(`S3 safe shares=${s0?.shares}`);
  check("S3 shares", 1_250_000, Number(s0?.shares ?? 0), 1);
  check("S3 ownership%", 20, 100*Number(s0?.shares??0)/(5_000_000+Number(s0?.shares??0)), 0.001);
}

// S4 DEGENERATE: S0=9M, $11M SAFE @ $10M cap. effectiveCap = -1M → guard falls back.
{
  let crashed = false; let r:any;
  try { r = runSafe(9_000_000n, [{ amt: "11000000" }], "10000000"); }
  catch (e) { crashed = true; console.log("*** CRASHED:", String(e)); failures++; }
  if (!crashed) {
    const s0 = r.rows.find((x: any) => x.holderId === "safe0");
    info(`S4 (degenerate) did NOT crash. safe shares=${s0?.shares}`);
    // fallback denominator = companyCap = S0 = 9M; capPrice = cap/S0 = 10M/9M=1.111; shares=11M/1.111=9.9M
    const expectedFallback = 11_000_000 * 9_000_000 / 10_000_000; // = 9,900,000
    info(`  expected fallback shares ~= ${expectedFallback}`);
    check("S4 fallback shares (no rebase)", expectedFallback, Number(s0?.shares??0), 2);
  }
}

// ---------- CLAIM 2: budget enforcement ----------
console.log("\n========== CLAIM 2: budget enforcement ==========");
function wf(exit: string, prefs: any[], common: any[]) {
  return computeWaterfall({ exitProceeds: exit, preferred: prefs, common,
    formulaId: "w", formulaVersion: "1", region: "US", formulaDef: {} } as any);
}
function sumPayouts(r:any){ return r.payouts.reduce((s:number,p:any)=>s+parseFloat(p.total),0); }

// C2.1 single 1x $10M, exit $8M → total == $8M
{
  const r = wf("8000000", [{classId:"A",className:"A",invested:"10000000",shares:2_500_000n,liquidationPreferenceMultiple:1,participating:false,seniority:0}], [{holderId:"f",shares:7_500_000n}]);
  const A = r.payouts.find((p:any)=>p.classId==="A");
  info(`C2.1 A total=${A?.total} sum=${sumPayouts(r)}`);
  check("C2.1 A payout clamped", 8_000_000, parseFloat(A!.total), 1);
  check("C2.1 total<=exit", 8_000_000, sumPayouts(r), 1);
}
// C2.2 B senior $10M + A junior $5M, exit $12M → B=10, A=2, common 0
{
  const r = wf("12000000", [
    {classId:"B",className:"B",invested:"10000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"A",className:"A",invested:"5000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:1},
  ], [{holderId:"f",shares:7_500_000n}]);
  const B=r.payouts.find((p:any)=>p.classId==="B"); const A=r.payouts.find((p:any)=>p.classId==="A");
  info(`C2.2 B=${B?.total} A=${A?.total} sum=${sumPayouts(r)}`);
  check("C2.2 B", 10_000_000, parseFloat(B!.total), 1);
  check("C2.2 A clamped", 2_000_000, parseFloat(A!.total), 1);
  check("C2.2 total==exit", 12_000_000, sumPayouts(r), 1);
}
// C2.3 same, exit $4M → B=4, A=0
{
  const r = wf("4000000", [
    {classId:"B",className:"B",invested:"10000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"A",className:"A",invested:"5000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:1},
  ], [{holderId:"f",shares:7_500_000n}]);
  const B=r.payouts.find((p:any)=>p.classId==="B"); const A=r.payouts.find((p:any)=>p.classId==="A");
  info(`C2.3 B=${B?.total} A=${A?.total} sum=${sumPayouts(r)}`);
  check("C2.3 B clamped", 4_000_000, parseFloat(B!.total), 1);
  check("C2.3 A zero", 0, parseFloat(A!.total), 1);
  check("C2.3 total==exit", 4_000_000, sumPayouts(r), 1);
}
// C2.4 three classes $5M each, exit $20M → each 5, common 5
{
  const r = wf("20000000", [
    {classId:"A",className:"A",invested:"5000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"B",className:"B",invested:"5000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:1},
    {classId:"C",className:"C",invested:"5000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:2},
  ], [{holderId:"f",shares:1_000_000n}]);
  const f=r.payouts.find((p:any)=>p.holderId==="f");
  info(`C2.4 common=${f?.total} sum=${sumPayouts(r)} remainder=${r.remainder}`);
  check("C2.4 common residual", 5_000_000, parseFloat(f!.total), 1);
  check("C2.4 total==exit", 20_000_000, sumPayouts(r), 1);
}

// ---------- CLAIM 3: unclamped as-converted election ----------
console.log("\n========== CLAIM 3: election uses unclamped as-converted ==========");
// C3.1 regression: senior $17M (100sh) / junior $4M (9M sh) / common 1M / exit $20M
{
  const r = wf("20000000", [
    {classId:"senior",className:"B",invested:"17000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"junior",className:"A",invested:"4000000",shares:9_000_000n,liquidationPreferenceMultiple:1,participating:false,seniority:1},
  ], [{holderId:"f",shares:1_000_000n}]);
  const s=r.payouts.find((p:any)=>p.classId==="senior"); const j=r.payouts.find((p:any)=>p.classId==="junior"); const f=r.payouts.find((p:any)=>p.holderId==="f");
  info(`C3.1 senior=${s?.total}(${s?.decision}) junior=${j?.total}(${j?.decision}) common=${f?.total} sum=${sumPayouts(r)}`);
  check("C3.1 senior", 17_000_000, parseFloat(s!.total), 1);
  if (j?.decision === "preference_only") { console.log("*** MISMATCH | C3.1 junior wrongly preference_only"); failures++; }
  else console.log(`MATCH | C3.1 junior converted (decision=${j?.decision})`);
  check("C3.1 junior 9/10 of 3M", 2_700_000, parseFloat(j!.total), 1000);
  check("C3.1 common 1/10 of 3M", 300_000, parseFloat(f!.total), 1000);
  check("C3.1 total==exit", 20_000_000, sumPayouts(r), 100);
}
// C3.2 INVERSE: junior owns 100 shares → tiny as-conv → preference_only $3M, common $0
{
  const r = wf("20000000", [
    {classId:"senior",className:"B",invested:"17000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"junior",className:"A",invested:"4000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:1},
  ], [{holderId:"f",shares:1_000_000n}]);
  const s=r.payouts.find((p:any)=>p.classId==="senior"); const j=r.payouts.find((p:any)=>p.classId==="junior"); const f=r.payouts.find((p:any)=>p.holderId==="f");
  info(`C3.2 senior=${s?.total} junior=${j?.total}(${j?.decision}) common=${f?.total} sum=${sumPayouts(r)}`);
  if (j?.decision !== "preference_only") { console.log(`*** MISMATCH | C3.2 junior should be preference_only got ${j?.decision}`); failures++; }
  else console.log("MATCH | C3.2 junior preference_only");
  check("C3.2 junior clamped to 3M", 3_000_000, parseFloat(j!.total), 1);
  check("C3.2 common 0", 0, f? parseFloat(f.total):0, 1);
  check("C3.2 total==exit", 20_000_000, sumPayouts(r), 1);
}

// ---------- CLAIM 4: participating cap not double-clamped ----------
console.log("\n========== CLAIM 4: participating cap ==========");
// $5M @ 2x cap (=$10M), participating, exit $30M.
{
  const r = wf("30000000", [
    {classId:"A",className:"A",invested:"5000000",shares:2_500_000n,liquidationPreferenceMultiple:1,participating:true,participationCapMultiple:2,seniority:0},
  ], [{holderId:"f",shares:7_500_000n}]);
  const A=r.payouts.find((p:any)=>p.classId==="A");
  info(`C4 A total=${A?.total}(${A?.decision}) pref=${A?.preferenceTaken} part=${A?.participation} sum=${sumPayouts(r)}`);
  // pref $5M + participation 2.5/10 of (30-5)=6.25M => 11.25M, capped at 10M.
  // But if as-converted 0.25*30=7.5M < cap 10M, so it does NOT convert; total=cap=10M.
  const total = parseFloat(A!.total);
  if (total > 10_000_000 + 1) { console.log("*** MISMATCH | C4 exceeds 2x cap"); failures++; }
  else console.log(`MATCH | C4 total<=cap ($10M): ${total}`);
  check("C4 total==cap 10M", 10_000_000, total, 1);
  check("C4 total<=exit", true as any, (sumPayouts(r)<=30_000_001)?true:false as any, 0);
}

console.log(`\n========== RESULT: ${failures} failures ==========`);
process.exit(failures>0?1:0);
