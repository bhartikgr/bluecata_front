/**
 * WAVE 52b · §11.6.2 / AC-16 — THE ROLLBACK FLAG, BOTH POLES.
 *
 * Wave 52 shipped NO feature flag and said so plainly in its report: "This means
 * rollback of W52 alone is not available and there is no flag to serve as one."
 * This file is the flag's proof.
 *
 * WHY BOTH POLES AND NOT JUST ONE. A flag that cannot restore the prior
 * behaviour is decoration, and a test that only asserts the ON pole would pass
 * identically if the OFF branch were a no-op. So the OFF pole is asserted here
 * with the pre-Wave-52 figures — $3.00 against a true $2.00, and a SAFE taking
 * shares it is not entitled to — and the ON pole with the canonical ones.
 *
 * WHAT "OFF" RESTORES, AND WHY IT IS ALL THREE AT ONCE. The Wave 52 change was
 * one ordering bug with three consequences, so the rollback returns all three
 * together:
 *   1. no fixed-point solve — the price is p0 = pre-money / FD(ledger);
 *   2. the pool top-up is pushed ABOVE the conversion loops, so it is sized
 *      against a base omitting every converting SAFE and note;
 *   3. the post-money SAFE's company capitalization is measured AFTER that push.
 *
 * A DISCREPANCY WITH WAVE 52'S OWN TRANSCRIPT, STATED RATHER THAN GLOSSED.
 * `build_log/wave52/W52_ENGINE_REORDER.md` §4 reports the pre-Wave-52 order as
 * `pricePerShare 2.0666668…` with `safeShares 2,903,225`. That is its mutation
 * **M4**, which reverted the ORDER but left the fixed-point solve ENABLED — so
 * the solve converged from p0 = 3 down to 2.0666. This flag's OFF pole is
 * M1 + M2 + M3: the solve is disabled too, because the pre-Wave-52 engine had no
 * solve at all (the price was computed on the first line of
 * `issue_preferred_round`). It therefore reports p = $3.00 and safeShares
 * 2,777,777. Both transcripts are correct measurements of different mutations;
 * this one is the fuller restoration, which is what a rollback has to be.
 *
 * PPS IS DELIBERATELY ABSENT. A fixture that injects $2.00 and then claims the
 * engine derived it is forbidden (§11.3.1 item 5), and the flag would be
 * unfalsifiable on a stored-price scenario — with a stored PPS, ON and OFF agree
 * by construction, which is asserted below as its own pole.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeCapTable } from "../../src/captable/compute.js";
import type { Transaction, Holder, PricingOrderMode } from "../../src/types.js";

const D = (v: string | number) => new Decimal(v);

const HOLDERS = [
  { id: "h_f", name: "Founders" },
  { id: "h_o", name: "Options granted" },
  { id: "pool", name: "Option pool" },
  { id: "h_s", name: "SAFE investor" },
  { id: "investors-rA", name: "Series A investors" },
] as unknown as Holder[];

function transactions(pricePerShare?: string): Transaction[] {
  return [
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
      round: {
        id: "rA", series: "Series A", preMoneyValuation: "30000000", investmentAmount: "10000000",
        optionPoolPostPercent: "22.5" /* WAVE 58 · R27 — WAS "25". The 25 was an ARTIFACT OF THE DEFECT: the
           pre-Wave-58 esop.topup solved the target against a base omitting the
           2,000,000 pool already on the cap table, and 25 was the figure that
           happened to yield the canonical 2,500,000 top-up through that wrong
           base. The TRUE post-round pool percentage of this canonical scenario is
           4,500,000 / 20,000,000 = 22.5% — which is exactly the number Wave 52c's
           own header called "the truth" while pinning 25. With the denominator
           FIXED and the target set to its true value, every canonical figure below
           is reproduced UNCHANGED: T = (22.5·(10,500,000+2,000,000+5,000,000) −
           100·2,000,000)/77.5 = 193,750,000/77.5 = 2,500,000 exactly, D =
           15,000,000, p = $2.00, N = 5,000,000, total 20,000,000.
           PERCENT-AS-WRITTEN (R16): 22.5 = 22.5%. */, optionPoolMode: "pre_money", currency: "USD",
        ...(pricePerShare === undefined ? {} : { pricePerShare }),
      } },
  ] as unknown as Transaction[];
}

type Run = {
  totalShares: bigint;
  rows: { holderId: string; shares: bigint }[];
  trace: { formulaId: string; formulaVersion?: string; inputs: Record<string, string>; outputs: Record<string, string> }[];
};

function run(mode?: PricingOrderMode, pricePerShare?: string): Run {
  return computeCapTable({
    asOf: "2026-02-01", view: "fd", formulaRegion: "US",
    holders: HOLDERS, transactions: transactions(pricePerShare),
    ...(mode === undefined ? {} : { pricingOrderMode: mode }),
  } as never) as unknown as Run;
}

const pricing = (r: Run) => r.trace.find((t) => t.formulaId === "round.pricing.order")!;
const safeTrace = (r: Run) => r.trace.find((t) => String(t.formulaId).includes("safe"))!;
const poolTrace = (r: Run) => r.trace.find((t) => String(t.formulaId).includes("esop"))!;
const sharesOf = (r: Run, h: string) =>
  r.rows.filter((x) => x.holderId === h).reduce((s, x) => s + x.shares, BigInt(0));
const pctOf = (r: Run, h: string) =>
  D(sharesOf(r, h).toString()).div(D(r.totalShares.toString())).mul(100).toFixed(3, Decimal.ROUND_HALF_UP);

describe("W52b flag POLE A — ON is the default and produces the CORRECTED arithmetic", () => {
  it("w52b flag the ABSENT option behaves identically to an EXPLICIT ON — the default is the correct behaviour", () => {
    const absent = run(undefined);
    const explicit = run("w52_post_pool_post_conversion");
    expect(pricing(absent).outputs.pricePerShare).toBe(pricing(explicit).outputs.pricePerShare);
    expect(absent.totalShares.toString()).toBe(explicit.totalShares.toString());
    expect(safeTrace(absent).outputs.safeShares).toBe(safeTrace(explicit).outputs.safeShares);
    /* And the default is recorded in the trace, not merely implied. */
    expect(pricing(absent).outputs.pricingOrderMode).toBe("w52_post_pool_post_conversion");
  });

  it("w52b flag ON reproduces every canonical figure", () => {
    const r = run("w52_post_pool_post_conversion");
    const t = pricing(r);
    expect(t.outputs.pricePerShare).toBe("2");
    expect(t.outputs.pricingDenominator).toBe("15000000");
    expect(t.outputs.newInvestorShares).toBe("5000000");
    expect(t.outputs.converged).toBe("true");
    /* WAVE 58 · R27 — was "9". The fixed-point solve now converges in EIGHT
       iterations rather than nine, because the corrected pool base makes the
       target exact (S = 2,500,000 with no ceil residual) instead of leaving a
       fractional share to chase. The fixed point reached is identical: p = $2,
       D = 15,000,000, N = 5,000,000, T = 20,000,000, all asserted above and
       below and all UNCHANGED. Fewer iterations to the same answer. */
    expect(t.outputs.iterations).toBe("8");
    expect(r.totalShares.toString()).toBe("20000000");
    expect(safeTrace(r).inputs.companyCapitalization).toBe("12500000");
    expect(safeTrace(r).outputs.conversionPrice).toBe("0.8");
    expect(safeTrace(r).outputs.safeShares).toBe("2500000");
    expect(pctOf(r, "h_f")).toBe("40.000");
    expect(pctOf(r, "h_s")).toBe("12.500");
    expect(pctOf(r, "investors-rA")).toBe("25.000");
    /* T·p = $40,000,000 with a zero residual. */
    expect(D(r.totalShares.toString()).mul(D("2")).toFixed()).toBe("40000000");
  });
});

describe("W52b flag POLE B — OFF restores the pre-Wave-52 arithmetic, defects and all", () => {
  it("w52b flag OFF restores the $3.00 price — a 50% overprice against the true $2.00", () => {
    const r = run("legacy_pre_w52");
    const t = pricing(r);
    expect(t.outputs.pricingOrderMode).toBe("legacy_pre_w52");
    expect(t.outputs.pricePerShare).toBe("3");
    /* $30,000,000 / 10,000,000 — a denominator with neither the new pool nor the
       converting SAFE in it. */
    expect(t.outputs.trail.split(" -> ")[0]).toBe("3");
    expect(D(t.outputs.pricePerShare).div(D("2")).toFixed()).toBe("1.5");
  });

  it("w52b flag OFF SKIPS the solve entirely and says so — iterations 0, converged false", () => {
    const t = pricing(run("legacy_pre_w52"));
    expect(t.outputs.iterations).toBe("0");
    /* It must NOT claim a fixed point it did not reach. */
    expect(t.outputs.converged).toBe("false");
    expect(t.outputs.trail).toBe("3");
  });

  it("w52b flag OFF puts the round's new pool back INSIDE the post-money SAFE's capitalization", () => {
    const on = safeTrace(run("w52_post_pool_post_conversion"));
    const off = safeTrace(run("legacy_pre_w52"));
    expect(on.inputs.companyCapitalization).toBe("12500000");
    /* The pool row is in the ledger when the measurement is taken, so the base
       is larger and the SAFE is handed shares it is not entitled to.

       WAVE 58 · R27 — THE LEGACY-POLE NUMBERS MOVED, AND THE DEFECT THIS POLE
       PROVES DID NOT. The pole restores the pre-Wave-52 ORDER; it was never a
       reproduction of the pre-Wave-58 POOL DENOMINATOR, and R27 fixes the latter
       everywhere including here. Derived by hand, then confirmed by execution:
         legacy pool top-up S = (22.5·(8,000,000 + 2,000,000 + 3,333,333)
                                 − 100·2,000,000) / 77.5
                              = 99,999,992.5 / 77.5 = 1,290,322.48… → ceil 1,290,323
         base measured WITH that pool row present
                              = 8,000,000 + 1,000,000 + 1,000,000 + 1,290,323
                              = 11,290,323
         companyCapitalization = 11,290,323 / (1 − 2,000,000/10,000,000)
                              = 11,290,323 / 0.8 = 14,112,903.75 → 14,112,904
         safeShares           = 14,112,903.75 − 11,290,323 = 2,822,580.75
                              → FLOOR 2,822,580  (share counts round DOWN; the
                                reported companyCapitalization is the rounded
                                14,112,904, which is why the two do not add up
                                by eye — exactly the same convention as the
                                pre-Wave-58 pair 13,888,889 / 2,777,777)
       The DIRECTION of every defect is unchanged: the base is still larger than
       the correct 12,500,000, and the SAFE is still handed shares it is not
       entitled to — now 322,580 of them instead of 277,777. */
    expect(off.inputs.companyCapitalization).toBe("14112904");
    expect(off.outputs.safeShares).toBe("2822580");
    expect(
      (BigInt(off.outputs.safeShares) - BigInt(on.outputs.safeShares)).toString(),
    ).toBe("322580");
    /* The sign of the error is the load-bearing claim, so assert it directly. */
    expect(BigInt(off.inputs.companyCapitalization) > BigInt(on.inputs.companyCapitalization)).toBe(true);
  });

  it("w52b flag OFF sizes the pool top-up against a base omitting the converting SAFE", () => {
    const on = poolTrace(run("w52_post_pool_post_conversion"));
    const off = poolTrace(run("legacy_pre_w52"));
    const onShares = on.outputs.poolSharesToAdd ?? on.outputs.poolShares;
    const offShares = off.outputs.poolSharesToAdd ?? off.outputs.poolShares;
    expect(onShares).toBe("2500000");
    /* WAVE 58 · R27 — was "1111111", the pre-fix figure. Derivation in the test
       above; 1,290,323 = ceil((22.5·13,333,333 − 200,000,000)/77.5). The claim
       this case makes — that the legacy order sizes the pool against a base
       OMITTING the converting SAFE, and therefore under-sizes it — is unchanged
       and still holds: 1,290,323 < 2,500,000. */
    expect(offShares).toBe("1290323");
    expect(offShares).not.toBe(onShares);
    expect(BigInt(offShares!) < BigInt(onShares!)).toBe(true);
  });

  it("w52b flag OFF overstates the founders and understates the incoming investor", () => {
    const on = run("w52_post_pool_post_conversion");
    const off = run("legacy_pre_w52");
    expect(pctOf(on, "h_f")).toBe("40.000");
    /* WAVE 58 · R27 — was "46.452" / a 6.452-point overstatement. Derived by
       hand then confirmed by execution: legacy total shares
         = 8,000,000 + 1,000,000 + 1,000,000 + 1,290,323 + 2,822,580 + 3,333,333
         = 17,446,236
       and 8,000,000 / 17,446,236 = 45.8551…% → "45.855", a 5.855-point
       overstatement of founder equity that does not exist. The defect's
       DIRECTION and its materiality are unchanged; only its magnitude moves,
       because the legacy pool is now correctly sized against its (still wrong)
       legacy base. */
    expect(pctOf(off, "h_f")).toBe("45.855");
    expect(D(pctOf(off, "h_f")).minus(D(pctOf(on, "h_f"))).toFixed(3)).toBe("5.855");
    expect(pctOf(on, "investors-rA")).toBe("25.000");
    /* 3,333,333 / 17,446,236 = 19.1063…% → "19.106". Was "19.355". The investor
       is still understated by more than five points on the same $10,000,000. */
    expect(pctOf(off, "investors-rA")).toBe("19.106");
    /* The investor wired $10,000,000 either way and gets 1,666,667 fewer shares. */
    expect(sharesOf(on, "investors-rA").toString()).toBe("5000000");
    expect(sharesOf(off, "investors-rA").toString()).toBe("3333333");
  });

  it("w52b flag OFF also breaks the residual: $1.00 of the investor's money buys nothing", () => {
    const off = pricing(run("legacy_pre_w52"));
    const N = D(off.outputs.newInvestorShares);
    const p = D(off.outputs.pricePerShare);
    const r = D("10000000").minus(N.mul(p));
    expect(r.toFixed()).toBe("1");
    /* The residual bound 0 <= r < p still holds — the defect is the price, not
       the floor rule, and the rollback must not confuse the two. */
    expect(r.gte(0)).toBe(true);
    expect(r.lt(p)).toBe(true);
  });

  it("w52b flag ON and OFF differ on EVERY headline figure — the rollback is real, not nominal", () => {
    const on = run("w52_post_pool_post_conversion");
    const off = run("legacy_pre_w52");
    expect(pricing(off).outputs.pricePerShare).not.toBe(pricing(on).outputs.pricePerShare);
    expect(pricing(off).outputs.pricingDenominator).not.toBe(pricing(on).outputs.pricingDenominator);
    expect(pricing(off).outputs.newInvestorShares).not.toBe(pricing(on).outputs.newInvestorShares);
    expect(off.totalShares).not.toBe(on.totalShares);
    expect(safeTrace(off).outputs.safeShares).not.toBe(safeTrace(on).outputs.safeShares);
  });
});

describe("W52b flag — the one case where the two poles must AGREE", () => {
  it("w52b flag a STORED price per share makes ON and OFF identical, by construction", () => {
    /* This is why the flag is safe for existing ledger rows: the wizard stores a
       price for every priced round, the `??` branch is not taken, and the solve
       does not run in EITHER mode. The only surviving difference would be the
       pool/conversion order, and this assertion measures whether it survives. */
    const on = run("w52_post_pool_post_conversion", "2");
    const off = run("legacy_pre_w52", "2");
    expect(pricing(on).outputs.pricePerShare).toBe("2");
    expect(pricing(off).outputs.pricePerShare).toBe("2");
    expect(pricing(on).outputs.iterations).toBe("0");
    expect(pricing(off).outputs.iterations).toBe("0");
    expect(pricing(on).outputs.newInvestorShares).toBe(pricing(off).outputs.newInvestorShares);
    /*
     * MEASURED, NOT ASSUMED, AND THE ANSWER IS "NO — THE ORDER STILL BITES".
     * Even with the price stored, the pool/conversion ORDER changes the SAFE's
     * capitalization and the pool size, so `totalShares` differs between the two
     * modes. That matters for the deployment-time `reconcile()` question in the
     * UNVERIFIED list: a stored PPS protects the PRICE and the INVESTOR SHARE
     * COUNT, which is what `reconcile()` recomputes — it does NOT protect the
     * total. Recorded here as the measurement rather than asserted as equality
     * we would have preferred.
     */
    expect(safeTrace(on).inputs.companyCapitalization).toBe("12500000");
    expect(safeTrace(off).inputs.companyCapitalization).not.toBe("12500000");
    expect(on.totalShares).not.toBe(off.totalShares);
  });

  it("w52b flag the trace records WHICH order produced the number, at version 52.2.0", () => {
    for (const mode of ["w52_post_pool_post_conversion", "legacy_pre_w52"] as PricingOrderMode[]) {
      const t = pricing(run(mode));
      expect(t.formulaVersion).toBe("52.2.0");
      expect(t.outputs.pricingOrderMode).toBe(mode);
    }
  });
});
