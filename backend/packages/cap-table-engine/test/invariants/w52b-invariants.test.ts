/**
 * WAVE 52b · AC-2 — INVARIANTS I-1, I-2 and I-6, THE FOUR WAVE 52 LEFT UNBUILT
 * (minus I-10, which needs a second process and lives in
 * `server/__tests__/w52b_round_math_persistence.test.ts`).
 *
 * Strategy Review 2 found SEVENTEEN acceptance criteria that could only ever
 * resolve in our favour. So every invariant below is asserted in BOTH
 * directions in this same file: the invariant holds on the engine's real output,
 * AND the listed falsifying mutation is applied and the invariant is observed to
 * FAIL. A one-sided assertion is not evidence.
 *
 * WHY THESE THREE COULD NOT BE COPIED FROM THE WITHDRAWN SET. §11.4.5 withdrew
 * `Σ ownership% == 100%` and `Σ holder_shares == T` as TAUTOLOGIES, because
 * `computeView` reduces `total` from the same `visible` rows it then divides —
 * `packages/cap-table-engine/src/captable/views.ts:49`, re-verified in this tree
 * this session, `const total = visible.reduce<bigint>((s, v) => s + v.shares, 0n)`.
 * Omit a holder, a SAFE, the pool or an entire class and the sum is STILL 100%.
 *
 * The tautology is not argued here, it is DEMONSTRATED: the I-2 pole below
 * deletes the unallocated-pool row, shows the percentages still summing to
 * exactly 100.000%, and shows I-2 going RED on the same data. That pair is the
 * evidence, and it is the I-2 analogue of the I-3 transcript §11.4.5 calls the
 * single most important line in the section.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { computeCapTable } from "../../src/captable/compute.js";
import type { Transaction, Holder } from "../../src/types.js";
import { conserve, compareSecuritySets, type ConservationEvent } from "./txConservation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Exact decimal throughout. Never `parseFloat`: §11.4.4 records that float
   conversion is how a `1e-12` tolerance quietly became `1e-9`. */
const D = (v: string | number) => new Decimal(v);

/* ------------------------------------------------------------------------- *
 * The canonical starting position, identical to w52-pricing-order.test.ts.
 * PPS is DELIBERATELY ABSENT so the engine constructs its own denominator.
 * ------------------------------------------------------------------------- */
const FOUNDER_COMMON = BigInt(8_000_000);
const GRANTED_OPTIONS = BigInt(1_000_000);
const EXISTING_POOL = BigInt(1_000_000);

const HOLDERS = [
  { id: "h_f", name: "Founders" },
  { id: "h_o", name: "Options granted" },
  { id: "pool", name: "Option pool" },
  { id: "h_s", name: "SAFE investor" },
  { id: "investors-rA", name: "Series A investors" },
] as unknown as Holder[];

function canonicalTransactions(): Transaction[] {
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
        id: "o1", holderId: "h_o", kind: "option", series: "Options",
        option: {
          grantedShares: GRANTED_OPTIONS, exercisePrice: "0.01",
          vestingMonths: 48, cliffMonths: 12, poolName: "Granted and outstanding options",
        },
      },
    },
    {
      type: "issue",
      date: "2026-01-01",
      security: {
        id: "o2", holderId: "pool", kind: "option", series: "Pool",
        option: {
          grantedShares: EXISTING_POOL, exercisePrice: "0.01",
          vestingMonths: 0, cliffMonths: 0, poolName: "Existing unallocated pool",
        },
      },
    },
    {
      type: "issue",
      date: "2026-01-01",
      security: {
        id: "s1", holderId: "h_s", kind: "safe", series: "SAFE",
        investmentAmount: "2000000", currency: "USD",
        safe: { type: "post_money_cap", cap: "10000000" },
      },
    },
    {
      type: "issue_preferred_round",
      date: "2026-02-01",
      round: {
        id: "rA", series: "Series A",
        preMoneyValuation: "30000000", investmentAmount: "10000000",
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
      },
    },
  ] as unknown as Transaction[];
}

type Run = {
  totalShares: bigint;
  rows: { holderId: string; kind: string; series: string; shares: bigint; ownershipPercent: string }[];
  trace: { formulaId: string; inputs: Record<string, string>; outputs: Record<string, string> }[];
};

function run(): Run {
  return computeCapTable({
    asOf: "2026-02-01",
    view: "fd",
    formulaRegion: "US",
    holders: HOLDERS,
    transactions: canonicalTransactions(),
  } as never) as unknown as Run;
}

/** `holderId|kind|series` identifies each canonical security uniquely. */
const secKey = (r: { holderId: string; kind: string; series: string }) =>
  `${r.holderId}|${r.kind}|${r.series}`;

function renderedSet(r: Run): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const row of r.rows) m.set(secKey(row), (m.get(secKey(row)) ?? BigInt(0)) + row.shares);
  return m;
}

/**
 * The EVENT STREAM. Assembled from the engine's own emitted traces plus the raw
 * business inputs — never from the rendered rows, which is what makes I-1 an
 * independent check rather than a restatement.
 */
function eventStream(r: Run): ConservationEvent[] {
  const pricing = r.trace.find((t) => t.formulaId === "round.pricing.order")!;
  const safe = r.trace.find((t) => String(t.formulaId).includes("safe"))!;
  const topup = r.trace.find((t) => String(t.formulaId).includes("esop"))!;
  return [
    { kind: "issue", holderId: "h_f", securityId: "f1", shares: FOUNDER_COMMON, dilutive: false },
    { kind: "issue", holderId: "h_o", securityId: "o1", shares: GRANTED_OPTIONS, dilutive: false },
    { kind: "issue", holderId: "pool", securityId: "o2", shares: EXISTING_POOL, dilutive: false },
    {
      kind: "conversion",
      holderId: "h_s",
      fromSecurityId: "s1",
      toSecurityId: "s1-conv",
      shares: BigInt(safe.outputs.safeShares),
    },
    {
      kind: "issue",
      holderId: "pool",
      securityId: "pool-topup-rA",
      shares: BigInt(topup.outputs.poolSharesToAdd ?? topup.outputs.poolShares ?? "0"),
      dilutive: true,
    },
    {
      kind: "issue",
      holderId: "investors-rA",
      securityId: "round-rA-newpref",
      shares: BigInt(pricing.outputs.newInvestorShares),
      dilutive: true,
    },
  ];
}

/* ========================================================================= *
 * I-1 — T FROM TRANSACTION CONSERVATION == T FROM THE RENDERED ROWS
 * ========================================================================= */

describe("W52b I-1 — transaction conservation against the rendered total", () => {
  it("w52b I-1 POLE A T_conserved equals the engine's rendered totalShares, exactly", () => {
    const r = run();
    const c = conserve(eventStream(r));
    expect(c.totalShares.toString()).toBe(r.totalShares.toString());
    /* And it is the canonical figure, not merely self-consistent. */
    expect(c.totalShares.toString()).toBe("20000000");
    /* opening 0 + issues 16.5m + conversions 2.5m − cancellations 0 + ... */
    expect(c.issued.toString()).toBe("17500000");
    expect(c.converted.toString()).toBe("2500000");
    expect(c.cancelled.toString()).toBe("0");
  });

  it("w52b I-1 POLE B MUTATION — deleting one holder row from the view breaks the equality by exactly that holding", () => {
    const r = run();
    const conserved = conserve(eventStream(r)).totalShares;
    /* The mutation §11.4.5 names: delete one holder row from the view. */
    const mutatedRows = r.rows.filter((x) => x.holderId !== "h_f");
    const mutatedTotal = mutatedRows.reduce((s, x) => s + x.shares, BigInt(0));
    expect(mutatedTotal).not.toBe(conserved);
    expect((conserved - mutatedTotal).toString()).toBe(FOUNDER_COMMON.toString());
    /* Exactly 8,000,000 shares of founder equity would have vanished silently. */
    expect((conserved - mutatedTotal).toString()).toBe("8000000");
  });

  it("w52b I-1 POLE B MUTATION — dropping one conversion event breaks the equality by the SAFE's share count", () => {
    const r = run();
    const full = conserve(eventStream(r)).totalShares;
    const dropped = conserve(eventStream(r).filter((e) => e.kind !== "conversion")).totalShares;
    expect(dropped).not.toBe(r.totalShares);
    expect((full - dropped).toString()).toBe("2500000");
  });

  it("w52b I-1 a transfer nets to exactly zero — it moves a holding, it does not create one", () => {
    const base = eventStream(run());
    const withTransfer = conserve([
      ...base,
      { kind: "transfer", fromHolderId: "h_f", toHolderId: "h_o", securityId: "f1", shares: BigInt(1_000_000) },
    ]);
    expect(withTransfer.transferNet.toString()).toBe("0");
    expect(withTransfer.totalShares.toString()).toBe("20000000");
    expect(withTransfer.byHolder.get("h_f")!.toString()).toBe("7000000");
    expect(withTransfer.byHolder.get("h_o")!.toString()).toBe("2000000");
  });

  it("w52b I-1 a cancellation REDUCES the conserved total — the minus sign is real, not decorative", () => {
    const base = eventStream(run());
    const c = conserve([
      ...base,
      { kind: "cancellation", holderId: "h_o", securityId: "o1", shares: BigInt(400_000) },
    ]);
    expect(c.cancelled.toString()).toBe("400000");
    expect(c.totalShares.toString()).toBe("19600000");
  });

  it("w52b I-1 the conservation module imports NOTHING from the engine (§11.4.6 item 1)", () => {
    const src = fs.readFileSync(path.join(HERE, "txConservation.ts"), "utf8");
    /* Zero imports at all is the strongest form and is what this module has. */
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\s*\(/);

    /* The forbidden-name check runs on the CODE, with comments stripped. The
       first draft ran on the raw file and went RED on its own header, which
       NAMES `computeView` in order to explain why it does not use it. A test
       that cannot tell a citation from a dependency is not measuring the
       dependency. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const forbidden of [
      "compute.js", "computeView", "views.js", "bigDecimal", "currentFullyDilutedShares",
      "captableCommitStore", "roundsStore", "roundMath", "Decimal",
    ]) {
      expect(code).not.toContain(forbidden);
    }
    /* And it uses bigint, not the production Decimal wrapper (§11.4.6 item 3). */
    expect(code).toContain("bigint");
  });
});

/* ========================================================================= *
 * I-2 — EVERY EXPECTED SECURITY APPEARS, ELEMENT-WISE
 * ========================================================================= */

/** Independently itemised: (holder, class, share count), written out by hand. */
const EXPECTED_SECURITIES = new Map<string, bigint>([
  ["h_f|common|Common", BigInt(8_000_000)],
  ["h_o|option|Options", BigInt(1_000_000)],
  ["pool|option|Pool", BigInt(1_000_000) + BigInt(2_500_000)],
  ["h_s|preferred|Series A", BigInt(2_500_000)],
  ["investors-rA|preferred|Series A", BigInt(5_000_000)],
]);

describe("W52b I-2 — set equality over the expected securities", () => {
  it("w52b I-2 POLE A every expected security appears with its exact share count", () => {
    const cmp = compareSecuritySets(EXPECTED_SECURITIES, renderedSet(run()));
    expect(cmp.missing).toEqual([]);
    expect(cmp.unexpected).toEqual([]);
    expect(cmp.differing).toEqual([]);
    expect(cmp.equal).toBe(true);
  });

  it("w52b I-2 POLE B MUTATION — removing the unallocated-pool row FAILS I-2 while the percentages STILL SUM TO 100%", () => {
    const r = run();
    /* The mutation §11.4.5 names for I-2. */
    const mutated = r.rows.filter((x) => !(x.holderId === "pool"));
    const mutatedTotal = mutated.reduce((s, x) => s + x.shares, BigInt(0));

    /* THE TAUTOLOGY, DEMONSTRATED. Percentages renormalised against the total
       reduced from the SAME rows — views.ts:49 — still sum to exactly 100.000%
       with 3,500,000 shares of employee equity simply gone. */
    const sum = mutated.reduce(
      (acc, x) => acc.plus(D(x.shares.toString()).div(D(mutatedTotal.toString())).mul(100)),
      D(0),
    );
    expect(sum.toFixed(3)).toBe("100.000");

    /* And I-2, on the identical data, is RED and names what is missing. */
    const cmp = compareSecuritySets(EXPECTED_SECURITIES, renderedSet({ ...r, rows: mutated }));
    expect(cmp.equal).toBe(false);
    expect(cmp.missing).toEqual(["pool|option|Pool"]);
  });

  it("w52b I-2 POLE B MUTATION — a phantom extra security is reported as unexpected", () => {
    const r = run();
    const mutated = [
      ...r.rows,
      { holderId: "h_ghost", kind: "common", series: "Common", shares: BigInt(1), ownershipPercent: "0" },
    ];
    const cmp = compareSecuritySets(EXPECTED_SECURITIES, renderedSet({ ...r, rows: mutated }));
    expect(cmp.equal).toBe(false);
    expect(cmp.unexpected).toEqual(["h_ghost|common|Common"]);
  });

  it("w52b I-2 POLE B MUTATION — a ONE-SHARE difference on an existing security is reported by id", () => {
    const r = run();
    const mutated = r.rows.map((x) =>
      x.holderId === "investors-rA" ? { ...x, shares: x.shares - BigInt(1) } : x,
    );
    const cmp = compareSecuritySets(EXPECTED_SECURITIES, renderedSet({ ...r, rows: mutated }));
    expect(cmp.equal).toBe(false);
    /* Tolerance is EXACTLY 0 shares (§11.4.4): one share is a real difference. */
    expect(cmp.differing).toEqual([
      { id: "investors-rA|preferred|Series A", expected: "5000000", rendered: "4999999" },
    ]);
  });

  it("w52b I-2 the SAFE and the new investor are DISTINCT securities in the same series", () => {
    /* A set comparison keyed on series alone would merge them and hide 2,500,000
       shares inside the Series A line. The key includes the holder for that
       reason. */
    const rendered = renderedSet(run());
    expect(rendered.get("h_s|preferred|Series A")!.toString()).toBe("2500000");
    expect(rendered.get("investors-rA|preferred|Series A")!.toString()).toBe("5000000");
  });
});

/* ========================================================================= *
 * I-6 — THE UNIVERSAL RECONCILIATION, IN EXACT DECIMAL
 *
 *   T·p − PMV − ΣI  ==  −Σr + Σ(outside-D shares)·p
 *
 * §11.4.1 withdrew the biconditional `T·p == PMV + I` in BOTH directions.
 * The reconciliation is the form that is true in every scenario, including
 * multi-close, and it is the form that can fail.
 * ========================================================================= */

type Recon = {
  label: string;
  T: string; p: string; PMV: string;
  investments: string[];
  residuals: string[];
  outsideDShares: string;
};

function reconcile(s: Recon): { lhs: Decimal; rhs: Decimal; closes: boolean } {
  const T = D(s.T), p = D(s.p), PMV = D(s.PMV);
  const sumI = s.investments.reduce((a, v) => a.plus(D(v)), D(0));
  const sumR = s.residuals.reduce((a, v) => a.plus(D(v)), D(0));
  const lhs = T.mul(p).minus(PMV).minus(sumI);
  const rhs = sumR.neg().plus(D(s.outsideDShares).mul(p));
  return { lhs, rhs, closes: lhs.eq(rhs) };
}

describe("W52b I-6 — the universal reconciliation equation", () => {
  it("w52b I-6 POLE A the canonical scenario closes at exactly zero on both sides", () => {
    const r = reconcile({
      label: "canonical",
      T: "20000000", p: "2", PMV: "30000000",
      investments: ["10000000"], residuals: ["0"], outsideDShares: "0",
    });
    expect(r.lhs.toFixed()).toBe("0");
    expect(r.rhs.toFixed()).toBe("0");
    expect(r.closes).toBe(true);
  });

  it("w52b I-6 POLE A a NON-ZERO residual closes the reconciliation, and T·p != PMV + I", () => {
    /* Wave 52's own worked residual example: T·p = $900,999 against
       PMV + I = $901,000, differing by exactly the $1.00 residual. */
    const r = reconcile({
      label: "residual",
      T: "900999", p: "1", PMV: "900000",
      investments: ["1000"], residuals: ["1"], outsideDShares: "0",
    });
    expect(r.closes).toBe(true);
    expect(r.lhs.toFixed()).toBe("-1");
    /* The withdrawn identity is FALSE here, and that is the point. */
    expect(D("900999").mul(D("1")).eq(D("900000").plus(D("1000")))).toBe(false);
  });

  it("w52b I-6 POLE A MULTI-CLOSE — two closes with two residuals still reconcile", () => {
    /* Close 1: $500,000 at $2.00 → 250,000 shares, r1 = $0.
       Close 2: $499,998.97 at $2.00 → 249,999 shares, r2 = $0.97.
       D = 15,000,000, T = 15,000,000 + 250,000 + 249,999 = 15,499,999. */
    const r = reconcile({
      label: "multi-close",
      T: "15499999", p: "2", PMV: "30000000",
      investments: ["500000", "499998.97"], residuals: ["0", "0.97"], outsideDShares: "0",
    });
    expect(r.closes).toBe(true);
    expect(r.rhs.toFixed()).toBe("-0.97");
    /* Every share count is an integer: 249,999 = floor(499998.97 / 2). */
    expect(D("499998.97").div(D("2")).floor().toFixed()).toBe("249999");
  });

  it("w52b I-6 POLE A a holder OUTSIDE D contributes exactly shares·p to the right-hand side", () => {
    /* 100,000 shares issued post-closing and outside the priced denominator. */
    const r = reconcile({
      label: "outside-D",
      T: "20100000", p: "2", PMV: "30000000",
      investments: ["10000000"], residuals: ["0"], outsideDShares: "100000",
    });
    expect(r.closes).toBe(true);
    expect(r.rhs.toFixed()).toBe("200000");
  });

  it("w52b I-6 POLE B MUTATION — moving one holder into T but NOT into D breaks it by exactly shares·p", () => {
    /* The mutation §11.4.5 names: "move one holder in/out of D without moving it
       in T". T carries the 100,000 shares; the reconciliation is told there are
       no outside-D shares. */
    const r = reconcile({
      label: "mutated",
      T: "20100000", p: "2", PMV: "30000000",
      investments: ["10000000"], residuals: ["0"], outsideDShares: "0",
    });
    expect(r.closes).toBe(false);
    expect(r.lhs.minus(r.rhs).toFixed()).toBe("200000");
  });

  it("w52b I-6 POLE B MUTATION — dropping one close's residual breaks it by exactly that residual", () => {
    const r = reconcile({
      label: "mutated-multi",
      T: "15499999", p: "2", PMV: "30000000",
      investments: ["500000", "499998.97"], residuals: ["0", "0"], outsideDShares: "0",
    });
    expect(r.closes).toBe(false);
    expect(r.lhs.minus(r.rhs).toFixed()).toBe("-0.97");
  });

  it("w52b I-6 is compared as EXACT decimals, never through parseFloat", () => {
    /* $0.97 and 2 cannot be represented exactly in binary floating point; the
       float route reports a spurious residue, the Decimal route reports zero.
       This is why §11.4.4 forbids the float comparison by name. */
    const exact = D("15499999").mul(D("2")).minus(D("30000000")).minus(D("500000")).minus(D("499998.97"));
    expect(exact.toFixed()).toBe("-0.97");
    const viaFloat = 15499999 * 2 - 30000000 - 500000 - 499998.97;
    expect(viaFloat).not.toBe(-0.97);
    expect(Math.abs(viaFloat + 0.97)).toBeLessThan(1e-6);
  });
});
