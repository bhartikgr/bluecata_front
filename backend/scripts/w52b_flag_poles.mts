/**
 * WAVE 52b — BOTH POLES OF THE ROLLBACK FLAG, with worked numbers.
 *
 * Runs the canonical worked example through the engine TWICE — flag ON (the
 * corrected Wave 52 order) and flag OFF (`legacy_pre_w52`) — and prints every
 * figure that moves. `pricePerShare` is DELIBERATELY ABSENT so the engine has to
 * construct its own denominator; a fixture that injects $2.00 and then claims the
 * engine derived it is forbidden (§11.3.1 item 5).
 *
 * Run: npx tsx build_log/wave52b/w52b_flag_poles.mts   (from work/)
 */
import Decimal from "decimal.js";
import { computeCapTable } from "../packages/cap-table-engine/src/captable/compute.js";
import type { Transaction, Holder, PricingOrderMode } from "../packages/cap-table-engine/src/types.js";

const D = (v: string | number) => new Decimal(v);

const HOLDERS = [
  { id: "h_f", name: "Founders" },
  { id: "h_o", name: "Options granted" },
  { id: "pool", name: "Option pool" },
  { id: "h_s", name: "SAFE investor" },
  { id: "investors-rA", name: "Series A investors" },
] as unknown as Holder[];

const TX: Transaction[] = [
  { type: "issue", date: "2026-01-01",
    security: { id: "f1", holderId: "h_f", kind: "common", series: "Common", shares: BigInt(8_000_000) } },
  { type: "issue", date: "2026-01-01",
    security: { id: "o1", holderId: "h_o", kind: "option", series: "Options",
      option: { grantedShares: BigInt(1_000_000), exercisePrice: "0.01", vestingMonths: 48, cliffMonths: 12, poolName: "Granted" } } },
  { type: "issue", date: "2026-01-01",
    security: { id: "o2", holderId: "pool", kind: "option", series: "Pool",
      option: { grantedShares: BigInt(1_000_000), exercisePrice: "0.01", vestingMonths: 0, cliffMonths: 0, poolName: "Existing pool" } } },
  { type: "issue", date: "2026-01-01",
    security: { id: "s1", holderId: "h_s", kind: "safe", series: "SAFE",
      investmentAmount: "2000000", currency: "USD", safe: { type: "post_money_cap", cap: "10000000" } } },
  { type: "issue_preferred_round", date: "2026-02-01",
    round: { id: "rA", series: "Series A", preMoneyValuation: "30000000", investmentAmount: "10000000",
      /* WAVE 58f · FOLD-IN 2 — WAS "0.25", WHICH NOW MEANS A QUARTER OF ONE PERCENT.
         This harness was written before owner ruling R16 fixed the field as
         PERCENT-AS-WRITTEN. `"0.25"` used to be read as a fraction meaning 25%;
         it is now read literally as 0.25%, so the drill it documents crashed
         instead of running, and the emergency lever it is cited as could not be
         pulled. The intended 25% is written the way R16 requires. */
        optionPoolPostPercent: "25", optionPoolMode: "pre_money", currency: "USD" } },
] as unknown as Transaction[];

function run(mode: PricingOrderMode | undefined) {
  const r = computeCapTable({
    asOf: "2026-02-01", view: "fd", formulaRegion: "US",
    holders: HOLDERS, transactions: TX,
    ...(mode === undefined ? {} : { pricingOrderMode: mode }),
  } as never) as unknown as {
    totalShares: bigint;
    rows: { holderId: string; shares: bigint; ownershipPercent: string }[];
    trace: { formulaId: string; inputs: Record<string, string>; outputs: Record<string, string> }[];
  };
  const pricing = r.trace.find((t) => t.formulaId === "round.pricing.order")!;
  const safe = r.trace.find((t) => String(t.formulaId).includes("safe"))!;
  const topup = r.trace.find((t) => String(t.formulaId).includes("esop"))!;
  const by = (h: string) =>
    r.rows.filter((x) => x.holderId === h).reduce((s, x) => s + x.shares, BigInt(0));
  const T = r.totalShares;
  const pct = (h: string) =>
    D(by(h).toString()).div(D(T.toString())).mul(100).toFixed(3, Decimal.ROUND_HALF_UP);
  return { r, pricing, safe, topup, T, by, pct };
}

function report(label: string, mode: PricingOrderMode | undefined) {
  const o = run(mode);
  const p = D(o.pricing.outputs.pricePerShare);
  const I = D("10000000");
  const N = D(o.pricing.outputs.newInvestorShares);
  const residual = I.minus(N.mul(p));
  console.log(`\n===== ${label} =====`);
  console.log(`  pricingOrderMode (from trace)   ${o.pricing.outputs.pricingOrderMode}`);
  console.log(`  formulaVersion                  ${(o.pricing as any).formulaVersion ?? "(n/a)"}`);
  console.log(`  p0 (first trail element)        ${o.pricing.outputs.trail.split(" -> ")[0]}`);
  console.log(`  iterations                      ${o.pricing.outputs.iterations}`);
  console.log(`  converged                       ${o.pricing.outputs.converged}`);
  console.log(`  price per share  p              ${p.toFixed()}`);
  console.log(`  pricing denominator  D          ${o.pricing.outputs.pricingDenominator}`);
  console.log(`  new investor shares  N          ${N.toFixed()}`);
  console.log(`  residual  r = I - N*p           ${residual.toFixed()}`);
  console.log(`  total shares  T                 ${o.T.toString()}`);
  console.log(`  T * p                           ${D(o.T.toString()).mul(p).toFixed()}`);
  console.log(`  SAFE companyCapitalization      ${o.safe.inputs.companyCapitalization}`);
  console.log(`  SAFE conversionPrice            ${o.safe.outputs.conversionPrice}`);
  console.log(`  SAFE shares                     ${o.safe.outputs.safeShares}`);
  console.log(`  pool top-up shares              ${o.topup.outputs.poolSharesToAdd ?? o.topup.outputs.poolShares}`);
  console.log(`  founders %  (of T)              ${o.pct("h_f")}`);
  console.log(`  SAFE investor %  (of T)         ${o.pct("h_s")}`);
  console.log(`  Series A %  (of T)              ${o.pct("investors-rA")}`);
  console.log(`  pool total shares               ${o.by("pool").toString()}`);
  return { p, N, T: o.T, o };
}

const on = report("FLAG ON  (default, absent option)  — w52_post_pool_post_conversion", undefined);
const onExplicit = report("FLAG ON  (explicit)               — w52_post_pool_post_conversion", "w52_post_pool_post_conversion");
const off = report("FLAG OFF (rollback)               — legacy_pre_w52", "legacy_pre_w52");

console.log("\n===== DELTA, ON vs OFF =====");
console.log(`  price per share          ${on.p.toFixed()}  ->  ${off.p.toFixed()}`);
console.log(`  overprice factor         ${off.p.div(on.p).toFixed(6)}x`);
console.log(`  SAFE shares              ${on.o.safe.outputs.safeShares}  ->  ${off.o.safe.outputs.safeShares}`);
console.log(`  SAFE shares taken extra  ${D(off.o.safe.outputs.safeShares).minus(D(on.o.safe.outputs.safeShares)).toFixed()}`);
console.log(`  total shares T           ${on.T.toString()}  ->  ${off.T.toString()}`);
console.log(`  founders %               ${on.o.pct("h_f")}  ->  ${off.o.pct("h_f")}`);
console.log(`  founders pp overstated   ${D(off.o.pct("h_f")).minus(D(on.o.pct("h_f"))).toFixed(3)}`);

const defaultMatchesOn =
  on.p.eq(onExplicit.p) && on.T === onExplicit.T &&
  on.o.safe.outputs.safeShares === onExplicit.o.safe.outputs.safeShares;
console.log(`\n  ABSENT OPTION == EXPLICIT ON : ${defaultMatchesOn}`);
console.log(`  OFF DIFFERS FROM ON          : ${!off.p.eq(on.p)}`);
if (!defaultMatchesOn || off.p.eq(on.p)) {
  console.error("\nFAIL — the flag does not actually change behaviour, or the default is not ON.");
  process.exit(1);
}
console.log("\nOK — both poles reproduced, and the default is the corrected behaviour.");
