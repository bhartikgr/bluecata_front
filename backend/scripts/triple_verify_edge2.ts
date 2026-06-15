/* Deeper skeptical probes on participation × budget interaction. */
import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";
function wf(exit: string, prefs: any[], common: any[]) {
  return computeWaterfall({ exitProceeds: exit, preferred: prefs, common,
    formulaId: "w", formulaVersion: "1", region: "US", formulaDef: {} } as any);
}
function sum(r:any){ return r.payouts.reduce((s:number,p:any)=>s+parseFloat(p.total),0); }
function dump(label:string,r:any){
  console.log(`-- ${label} -- sum=${sum(r)} remainder=${r.remainder}`);
  r.payouts.forEach((p:any)=>console.log(`     ${p.classId||p.holderId} ${p.decision} total=${p.total} pref=${p.preferenceTaken} part=${p.participation}`));
}

// P1: senior NON-part $15M eats most budget; junior PARTICIPATING $5M tries to participate.
//   exit $20M. senior pref clamped 15M, budget->5M. junior: preferenceFull=5M, clamped to budget 5M.
//   remainingAfterAllPref = exit - totalPreferenceCash = 20 - (15+5)=0 → participation 0.
//   junior total=5M, clamp to budget 5M ok. sum=20. common 0.
//   POTENTIAL BUG: participation uses `exit` and totalPreferenceCash (unclamped). Check no overpay.
{
  const r = wf("20000000", [
    {classId:"senior",className:"B",invested:"15000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"junior",className:"A",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:1},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("P1 senior nonpart + junior part, tight", r);
  console.log(`     >>> sum<=exit? ${sum(r)<=20000001}`);
}

// P2: The dangerous one. senior NON-part $18M; junior PART $5M with healthy-looking participation.
//   exit $20M. senior clamps to 18M -> budget 2M.
//   junior: preferenceFull=5M, preference=clamp(5M, budget 2M)=2M.
//   remainingAfterAllPref = 20 - (18+5) = -3 <0 → participation=0.
//   total = preference(2M)+0 = 2M; final clamp to budget(2M)=2M. sum=20. OK no overpay.
{
  const r = wf("20000000", [
    {classId:"senior",className:"B",invested:"18000000",shares:100n,liquidationPreferenceMultiple:1,participating:false,seniority:0},
    {classId:"junior",className:"A",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:1},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("P2 senior nonpart 18M + junior part 5M", r);
  console.log(`     >>> sum<=exit? ${sum(r)<=20000001}`);
}

// P3: CRITICAL — can participation use full exit and OVERPAY when senior is participating too?
//   Two participating: B $5M (1M sh), A $5M (1M sh). common 1M. exit $30M.
//   totalPreferenceCash=10M. remainingAfterAllPref=20M. totalParticipatingShares=2M pref +1M common=3M.
//   B pref 5M + part 1M/3M*20M=6.667M = 11.667M. budget 30 ok.
//   A pref 5M + part 6.667M = 11.667M. budget after B = 30-11.667=18.333; A total 11.667 ok.
//   common = remaining = 30 - 23.333 = 6.667M.  sum = 11.667+11.667+6.667=30. OK.
{
  const r = wf("30000000", [
    {classId:"B",className:"B",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:0},
    {classId:"A",className:"A",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:1},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("P3 two participating healthy", r);
  console.log(`     >>> sum<=exit? ${sum(r)<=30000001} expect ~30M total, common~6.667M`);
}

// P4: participating cap binds AND as-converted exceeds cap → must convert (treatAsCommon).
//   A $5M, 2x cap=10M, participating, 5M shares. common 1M. exit $100M.
//   as-conv = 5M/6M*100=83.3M >> cap 10M → converts. Then pro-rata 5M/6M*100=83.3M, common 16.67M.
{
  const r = wf("100000000", [
    {classId:"A",className:"A",invested:"5000000",shares:5_000_000n,liquidationPreferenceMultiple:1,participating:true,participationCapMultiple:2,seniority:0},
  ], [{holderId:"f",shares:1_000_000n}]);
  dump("P4 part cap binds, as-conv>cap → convert", r);
  console.log(`     >>> A decision should be as_converted: ${r.payouts.find((p:any)=>p.classId==="A")?.decision}`);
  console.log(`     >>> sum<=exit? ${sum(r)<=100000001}`);
}

// P5: Negative-share / 100% common safety (no preferred) 
{
  const r = wf("10000000", [], [{holderId:"f",shares:1_000_000n},{holderId:"g",shares:1_000_000n}]);
  dump("P5 no preferred", r);
  console.log(`     >>> sum==exit? ${Math.abs(sum(r)-10000000)<1}`);
}
