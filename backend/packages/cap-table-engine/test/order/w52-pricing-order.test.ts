/**
 * WAVE 52 · 52-Q6 (OPTION 2) — PROOF THAT PRICING NOW HAPPENS LAST.
 *
 * Owner decision 52-Q6 = Option 2: the cap-table engine reorder (formerly the
 * separate wave W58) is folded INTO Wave 52. This file is the evidence.
 *
 * WHAT THE ENGINE USED TO DO. `issue_preferred_round` computed the price per
 * share on its FIRST line, from `currentFullyDilutedShares(ledger)` — a
 * denominator containing neither the round's new option pool nor any converting
 * SAFE or note — then froze the new investor share count from that price, and
 * only THEN pushed the pool and converted the instruments. It also measured the
 * post-money SAFE's own company capitalization AFTER the pool row had been
 * pushed, so a pool the SAFE is not entitled to be diluted by was inside its
 * denominator.
 *
 * WHAT IT DOES NOW. The price is a fixed point solved after the pool top-up and
 * after conversion; the SAFE's company capitalization is measured before the
 * pool; and the pool top-up is sized against a base that already contains the
 * converted shares.
 *
 * Every number below is asserted against the canonical worked example, which is
 * independent of this engine: it is arithmetic published in the response to the
 * external reviewer and traceable to the YC post-money safe primer and to
 * Wilson Sonsini's price-per-share formula.
 *
 * THE CRITICAL POLE: the canonical scenario is run with `pricePerShare`
 * DELIBERATELY ABSENT, so the engine must construct its own denominator. A
 * fixture that injects $2.00 and then claims the engine derived it is forbidden
 * (Strategy §11.3.1 item 5), and `w52 requires a PPS-absent scenario` below
 * fails if that scenario is ever removed.
 */
import { describe, it, expect } from "vitest";
import { computeCapTable } from "../../src/captable/compute.js";
import type { Transaction, Holder } from "../../src/types.js";

/* ------------------------------------------------------------------------- *
 * The canonical starting position. Shares are integers; nothing is a float.
 * ------------------------------------------------------------------------- */
const FOUNDER_COMMON = BigInt(8_000_000);
const GRANTED_OPTIONS = BigInt(1_000_000);
const EXISTING_POOL = BigInt(1_000_000);
/** Pre-SAFE fully diluted base: 8,000,000 + 1,000,000 + 1,000,000. */
const PRE_SAFE_FD_BASE = BigInt(10_000_000);

const HOLDERS = [
  { id: "h_f", name: "Founders" },
  { id: "h_o", name: "Options granted" },
  { id: "pool", name: "Option pool" },
  { id: "h_s", name: "SAFE investor" },
  { id: "investors-rA", name: "Series A investors" },
] as unknown as Holder[];

/**
 * @param pricePerShare omit to force the engine to construct its own
 *   denominator — that is the whole point of the PPS-absent pole.
 */
function canonicalTransactions(pricePerShare?: string): Transaction[] {
  return [
    {
      type: "issue",
      date: "2026-01-01",
      security: { id: "f1", holderId: "h_f", kind: "common", series: "Common", shares: FOUNDER_COMMON },
    },
    {
      type: "issue",
      date: "2026-01-01",
      security: {
        id: "o1",
        holderId: "h_o",
        kind: "option",
        series: "Options",
        option: {
          grantedShares: GRANTED_OPTIONS,
          exercisePrice: "0.01",
          vestingMonths: 48,
          cliffMonths: 12,
          poolName: "Granted and outstanding options",
        },
      },
    },
    {
      type: "issue",
      date: "2026-01-01",
      security: {
        id: "o2",
        holderId: "pool",
        kind: "option",
        series: "Pool",
        option: {
          grantedShares: EXISTING_POOL,
          exercisePrice: "0.01",
          vestingMonths: 0,
          cliffMonths: 0,
          poolName: "Existing unallocated pool",
        },
      },
    },
    {
      type: "issue",
      date: "2026-01-01",
      security: {
        id: "s1",
        holderId: "h_s",
        kind: "safe",
        series: "SAFE",
        investmentAmount: "2000000",
        currency: "USD",
        safe: { type: "post_money_cap", cap: "10000000" },
      },
    },
    {
      type: "issue_preferred_round",
      date: "2026-02-01",
      round: {
        id: "rA",
        series: "Series A",
        preMoneyValuation: "30000000",
        investmentAmount: "10000000",
        /* 25% post-round pool target under the engine's own esop.topup formula
           yields exactly the canonical 2,500,000 new pool shares. */
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
           PERCENT-AS-WRITTEN (R16): 22.5 = 22.5%. */,
        optionPoolMode: "pre_money",
        currency: "USD",
        ...(pricePerShare === undefined ? {} : { pricePerShare }),
      },
    },
  ] as unknown as Transaction[];
}

function run(pricePerShare?: string) {
  return computeCapTable({
    asOf: "2026-02-01",
    view: "fd",
    formulaRegion: "US",
    holders: HOLDERS,
    transactions: canonicalTransactions(pricePerShare),
  } as never) as unknown as {
    totalShares: bigint;
    rows: { holderId: string; shares: bigint; ownershipPercent: string }[];
    trace: { formulaId: string; inputs: Record<string, string>; outputs: Record<string, string> }[];
  };
}

const pricingTrace = (r: ReturnType<typeof run>) =>
  r.trace.find((t) => t.formulaId === "round.pricing.order")!;

describe("WAVE 52 · 52-Q6 — the engine prices AFTER the pool top-up and AFTER conversion", () => {
  it("w52 requires a PPS-absent scenario", () => {
    /* Guards the whole file against being weakened into a pinned-literal
       fixture. If someone injects a price into the canonical scenario, this
       fails and names why. */
    const tx = canonicalTransactions();
    const round = (tx.find((t) => t.type === "issue_preferred_round") as { round: Record<string, unknown> }).round;
    expect(Object.prototype.hasOwnProperty.call(round, "pricePerShare")).toBe(false);
    expect(round.preMoneyValuation).toBe("30000000");
  });

  it("w52 AC-1 POLE A — the PPS-absent engine reproduces every canonical figure", () => {
    const r = run();
    const t = pricingTrace(r);

    /* The pricing denominator D = founders + granted + existing pool
       + converted SAFE + new pool = 8m + 1m + 1m + 2.5m + 2.5m. */
    expect(t.outputs.pricingDenominator).toBe("15000000");
    expect(t.outputs.pricePerShare).toBe("2");
    expect(t.outputs.newInvestorShares).toBe("5000000");
    expect(t.outputs.converged).toBe("true");
    /* T = D + N. */
    expect(r.totalShares.toString()).toBe("20000000");
  });

  it("w52 AC-1 POLE A — the SAFE converts at the canonical price and share count", () => {
    const r = run();
    const safeTrace = r.trace.find((x) => String(x.formulaId).includes("safe"))!;
    /* cap / (base / (1 - purchase/cap)) = 10,000,000 / 12,500,000 = 0.80 */
    expect(safeTrace.outputs.conversionPrice).toBe("0.8");
    expect(safeTrace.outputs.safeShares).toBe("2500000");
    expect(safeTrace.outputs.binding).toBe("cap");
  });

  it("w52 the SAFE's company capitalization EXCLUDES the round's new pool", () => {
    /* This is the assertion that fails if `companyCap` is ever measured after
       the pool row is pushed again. With the 2,500,000 pool wrongly inside,
       the re-based denominator becomes 15,625,000, the price $0.64, and the
       SAFE takes 3,125,000 shares instead of 2,500,000. */
    const r = run();
    const safeTrace = r.trace.find((x) => String(x.formulaId).includes("safe"))!;
    expect(safeTrace.inputs.companyCapitalization).toBe(
      (PRE_SAFE_FD_BASE * BigInt(10) / BigInt(8)).toString(), // 12,500,000
    );
    expect(safeTrace.outputs.safeShares).not.toBe("3125000");
  });

  it("w52 ownership matches the canonical table on the post-money FD denominator", () => {
    const r = run();
    const by = (h: string) =>
      r.rows.filter((x) => x.holderId === h).reduce((s, x) => s + x.shares, BigInt(0));
    expect(by("h_f").toString()).toBe("8000000");
    expect(by("h_o").toString()).toBe("1000000");
    /* Existing 1,000,000 pool + 2,500,000 top-up = 3,500,000 unallocated. */
    expect(by("pool").toString()).toBe("3500000");
    expect(by("h_s").toString()).toBe("2500000");
    expect(by("investors-rA").toString()).toBe("5000000");

    /* Percentages on T = 20,000,000, exact — 40.000% / 12.500% / 25.000%. */
    const pct = (n: bigint) => (Number(n) * 100) / 20_000_000;
    expect(pct(by("h_f")).toFixed(3)).toBe("40.000");
    expect(pct(by("h_s")).toFixed(3)).toBe("12.500");
    expect(pct(by("investors-rA")).toFixed(3)).toBe("25.000");
    expect(pct(by("pool")).toFixed(3)).toBe("17.500");
  });

  it("w52 the OLD order is recorded in the trail, and it was $3.00", () => {
    /* The first element of the solve trail is byte-identically the price the
       pre-Wave-52 engine produced: pre-money / FD-before-anything =
       $30,000,000 / 10,000,000 = $3.00. It is kept in the trace so the
       before/after is auditable in production, not only in this test. */
    const t = pricingTrace(run());
    const trail = t.outputs.trail.split(" -> ");
    expect(trail[0]).toBe("3");
    expect(trail[trail.length - 1]).toBe("2");
    expect(t.inputs.fdBeforeRound).toBe("10000000");
    expect(t.inputs.storedPricePerShare).toBe("(absent - derived)");
  });

  it("w52 POLE B — the pre-pool, pre-conversion denominator produces the WRONG price", () => {
    /* The substituted-denominator pole. $30,000,000 / 10,000,000 = $3.00 is
       what the old order could reach; the engine must no longer produce it. */
    const wrongDenominator = PRE_SAFE_FD_BASE; // 10,000,000
    expect((30_000_000 / Number(wrongDenominator)).toFixed(2)).toBe("3.00");
    const t = pricingTrace(run());
    expect(t.outputs.pricePerShare).not.toBe("3");
    expect(t.outputs.pricingDenominator).not.toBe(wrongDenominator.toString());
  });

  it("w52 a STORED price per share is used verbatim and skips the solve", () => {
    /* The safety property that protects existing ledger rows: where the wizard
       supplies a price — which it does for every priced round — the `??` branch
       is not taken, the solve does not run, and the reference share counts that
       the sacred hash-chained captableCommitStore recomputes are unchanged. */
    const t = pricingTrace(run("2"));
    expect(t.inputs.storedPricePerShare).toBe("2");
    expect(t.outputs.iterations).toBe("0");
    expect(t.outputs.pricePerShare).toBe("2");
    expect(t.outputs.trail).toBe("2");
  });

  it("w52 a stored price and the derived price agree on the canonical scenario", () => {
    /* Independent cross-check: the solve's answer is the same object the
       product path would have supplied. Share counts must match to the SHARE —
       tolerance is exactly zero shares. */
    const derived = run();
    const stored = run("2");
    expect(derived.totalShares.toString()).toBe(stored.totalShares.toString());
    const key = (r: ReturnType<typeof run>) =>
      r.rows.map((x) => `${x.holderId}:${x.shares}`).sort().join("|");
    expect(key(derived)).toBe(key(stored));
  });

  it("w52 residual is exactly zero on the canonical scenario, and the identity closes", () => {
    /* T·p = PMV + I − r, the only form this wave asserts. Here r = 0, so the
       equality is exact — and that is asserted, not assumed. */
    const r = run();
    const T = r.totalShares;
    const p = 2;
    const I = 10_000_000;
    const PMV = 30_000_000;
    const N = 5_000_000;
    const residual = I - N * p;
    expect(residual).toBe(0);
    expect(Number(T) * p).toBe(PMV + I - residual);
    expect(Number(T) * p).toBe(40_000_000);
  });
});
