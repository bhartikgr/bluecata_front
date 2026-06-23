import { computeWaterfall } from "../packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts";
function wf(exit: string, prefs: any[], common: any[]) {
  return computeWaterfall({ exitProceeds: exit, preferred: prefs, common, formulaId:"w",formulaVersion:"1",region:"US",formulaDef:{} } as any);
}
function sum(r:any){ return r.payouts.reduce((s:number,p:any)=>s+parseFloat(p.total),0); }
function dump(l:string,r:any){console.log(`-- ${l} -- sum=${sum(r)} remainder=${r.remainder}`);
  r.payouts.forEach((p:any)=>console.log(`     ${p.classId||p.holderId} ${p.decision} total=${p.total} pref=${p.preferenceTaken} part=${p.participation}`));}

// ADVERSARIAL: 3 participating classes, NO cap, modest exit just above total preference.
// B $5M, A $5M, C $5M each 1M sh. common 1M. exit = $16M (preference total 15M, residual 1M).
// remainingAfterAllPref = 16-15 = 1M. totalParticipatingShares=3M pref+1M common=4M.
// each pref class part = 1M/4M*1M = 0.25M. each total = 5.25M. common = 1M/4M*1M=0.25M.
// sum = 3*5.25 + 0.25 = 15.75 + 0.25 = 16. OK.
{
  const r = wf("16000000",[
    {classId:"B",className:"B",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:0},
    {classId:"A",className:"A",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:1},
    {classId:"C",className:"C",invested:"5000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:2},
  ],[{holderId:"f",shares:1_000_000n}]);
  dump("ADV1 three participating just above pref",r);
  console.log(`     >>> sum<=exit? ${sum(r)<=16000001}`);
}

// ADVERSARIAL 2: participating class where preference alone exceeds exit, plus the final clamp.
// B $30M 1x participating, 1M sh, exit $20M. preferenceFull=30M, preference=clamp(30,budget20)=20M.
// remainingAfterAllPref = 20 - 30 = -10 <0 → part 0. total=20M. final clamp budget20 ok. sum=20.
{
  const r = wf("20000000",[
    {classId:"B",className:"B",invested:"30000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:0},
  ],[{holderId:"f",shares:1_000_000n}]);
  dump("ADV2 participating pref>exit",r);
  console.log(`     >>> sum<=exit? ${sum(r)<=20000001}`);
}

// ADVERSARIAL 3: mixed — senior participating eats budget, junior participating with shares.
// B $10M part (1M sh) senior, A $10M part (1M sh) junior. common 0 shares. exit $15M.
// totalPrefCash=20M. remainingAfterAllPref=-5<0 → part 0 for both.
// B pref clamp(10,15)=10, budget->5. A pref clamp(10,5)=5. sum=15. No common.
{
  const r = wf("15000000",[
    {classId:"B",className:"B",invested:"10000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:0},
    {classId:"A",className:"A",invested:"10000000",shares:1_000_000n,liquidationPreferenceMultiple:1,participating:true,seniority:1},
  ],[]);
  dump("ADV3 two part, no common, underwater",r);
  console.log(`     >>> sum<=exit? ${sum(r)<=15000001}`);
}
