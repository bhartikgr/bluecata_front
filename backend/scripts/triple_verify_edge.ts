/* Skeptical edge-case probes — hunting for bugs the first two passes missed. */
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";

function wf(exit: string, prefs: any[], common: any[]) {
  return computeWaterfall({ exitProceeds: exit, preferred: prefs, common,
    formulaId: "w", formulaVersion: "1", region: "US", formulaDef: {} } as any);
}
function sum(r:any){ return r.payouts.reduce((s:number,p:any)=>s+parseFloat(p.total),0); }
function dump(label:string,r:any){
  console.log(`-- ${label} -- sum=${sum(r)} remainder=${r.remainder}`);
  r.payouts.forEach((p:any)=>console.log(`     ${p.classId||p.holderId} ${p.decision} total=${p.total} pref=${p.preferenceTaken} part=${p.participation} asConv=${p.asConvertedTaken}`));
}

// E1: TWO participating classes, both with preferences. Test for overpay.
// B senior $10M 1x part, A junior $10M 1x part. exit $15M. totalPrefCash=$20M (UNCLAMPED).
// remainingAfterAllPref = 15-20 = -5M < 0 → participation=0 for both.
// B takes pref clamped to budget 15 => 10M (budget ok). A pref clamped: budget now 5M => A pref=5M.
// Sum should be 15M, NOT exceed exit.
{
  const r = wf("15000000", [
    {classId:"B",className:"B",invested:"10000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:0},
    {classId:"A",className:"A",invested:"10000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:1},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("E1 two participating, underwater exit", r);
  console.log(`     >>> OVERPAY CHECK: sum(${sum(r)}) <= exit(15000000)? ${sum(r)<=15000001}`);
}

// E2: participating with NO cap, healthy exit. B $5M 1x part 1M sh, common 1M sh. exit $20M.
// pref 5M; remainder 15M; part = 1M/2M*15M=7.5M; total=12.5M; common=7.5M. sum=20.
{
  const r = wf("20000000", [
    {classId:"B",className:"B",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:0},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("E2 participating no cap", r);
  console.log(`     >>> sum<=exit? ${sum(r)<=20000001}  expect B total ~12.5M common ~7.5M`);
}

// E3: zero exit
{
  const r = wf("0", [
    {classId:"A",className:"A",invested:"5000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("E3 zero exit", r);
  console.log(`     >>> sum==0? ${Math.abs(sum(r))<1}`);
}

// E4: WHT applied. exit $10M, 10% WHT → net $9M. single 1x $10M pref.
// preference clamped to net 9M. sum of payouts should be 9M (net), NOT 10M.
{
  const r = computeWaterfall({ exitProceeds:"10000000", withholdingTaxRate:"0.10",
    preferred:[{classId:"A",className:"A",invested:"10000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0}],
    common:[{holderId:"f",shares:1_000_000n}], formulaId:"w",formulaVersion:"1",region:"CN",formulaDef:{} } as any);
  dump("E4 WHT 10%", r);
  console.log(`     >>> sum<=net(9M)? ${sum(r)<=9000001}  netExit=${r.trace.outputs.netExit}`);
}

// E5: as-converted election TIE — as-converted EXACTLY equals preference.
// Non-part class, invested $5M 1x, shares chosen so as-conv at full == 5M exactly.
// exit $10M, total as-conv shares: class 1M + common 1M = 2M. as-conv = 1M/2M*10M=5M == pref 5M.
// Code: asConvertedAtFull.gt(preferenceFull) is FALSE (equal) → preference_only. Edge: equal→takes pref.
{
  const r = wf("10000000", [
    {classId:"A",className:"A",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("E5 as-conv == pref tie", r);
  console.log(`     >>> decision=${r.payouts.find((p:any)=>p.classId==="A")?.decision} (tie → preference_only is correct/conservative)`);
  console.log(`     >>> sum<=exit? ${sum(r)<=10000001}`);
}

// E6: junior converts but senior ALSO converts (both as-conv > pref). exit huge $100M.
// senior $10M 2.5M sh, junior $5M 2.5M sh, common 5M. total as-conv 10M sh.
// senior as-conv 2.5/10*100=25M>20M(2x? no 1x=10M) yes>10M converts. junior 25M>5M converts.
// both treatAsCommon → all 100M split pro-rata by 10M shares. sum=100M.
{
  const r = wf("100000000", [
    {classId:"senior",className:"B",invested:"10000000",shares:2_500_000n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"junior",className:"A",invested:"5000000",shares:2_500_000n,liquidationPreferenceMultiple:1,participating:false,seniority:1},
  ], [{holderId:"f",shares:5_000_000n}]);
  dump("E6 both convert, big exit", r);
  console.log(`     >>> sum==exit? ${Math.abs(sum(r)-100000000)<10}`);
}

// E7: DANGER probe — junior converts (treatAsCommon) but senior takes preference that
//   uses MORE than exit, leaving remaining=0, yet junior's as-conv expectation was nonzero.
//   senior $25M 100sh, junior $4M 9M sh, common 1M. exit $20M.
//   senior pref clamped to 20M (budget). junior elects convert (as-conv 18M>4M).
//   remaining = exit - paidPref = 20-20 = 0. junior gets 0, common 0. sum=20. No overpay.
{
  const r = wf("20000000", [
    {classId:"senior",className:"B",invested:"25000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"junior",className:"A",invested:"4000000",shares:9_000_000n,liquidationPreferenceMultiple:1,participating:false,seniority:1},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("E7 senior eats everything, junior converted to nothing", r);
  console.log(`     >>> sum<=exit? ${sum(r)<=20000001} (junior converted but gets 0 — acceptable, no overpay)`);
}
