/**
 * WAVE 72 · DEFECT 1 — AN IMPOSSIBLE FINANCING NO LONGER RETURNS SUCCESS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, VERBATIM FROM THE FINAL INDEPENDENT MATH REVIEW
 * (`build_log/final_review/REVIEW_1_MATH.md`, §"Still-wrong boundary"), and
 * re-executed before anything was changed (`build_log/wave72/scratch/p1_repro.mts`):
 *
 *     projectPostClose([{ instrument: "common", shares: 0 }],
 *                      { preMoneyValuation: 30_000_000,
 *                        investmentAmount: 10_000_000, series: "A" })
 *     -> OK success
 *        totalShares=0   pricePerShare="Infinity"   pricingDenominator="0"
 *        newInvestorShares="0"   iterations="1"     converged="false"
 *
 * A $10,000,000 investment bought ZERO shares at an INFINITE price and the
 * platform reported success. TWO INDEPENDENT FAULTS, and this file proves both
 * separately, because fixing either alone leaves the other:
 *
 *   FAULT 1  a pricing denominator of zero must REFUSE BY NAME. `Infinity` must
 *            never be emitted.
 *   FAULT 2  `converged="false"` must never be returned as success. Proved on a
 *            fixture whose denominator is POSITIVE — so it cannot be passing
 *            because of fault 1's fix.
 *
 * EVERY BLOCK IS AT BOTH POLES. A refusal that fires unconditionally is a worse
 * product than the defect, so each refusal is paired with a legitimate financing
 * over a non-zero share count that must still succeed with UNCHANGED numbers.
 *
 * MUTATION TRANSCRIPT: `build_log/wave72/W72_TESTS.md`.
 * VISIBILITY (R58): `build_log/wave72/WAVE72_REPORT.md` §"What a user sees".
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { computeCapTable, ZeroPricingDenominatorError } from "@capavate/cap-table-engine";
import {
  projectPostClose, runEngine, RoundMathTermRefusal,
  ZeroPricingDenominatorRefusal, PricingSolveNotConvergedRefusal,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";

const sec = (o: Record<string, unknown>): ApiSecurity => o as unknown as ApiSecurity;

/** The review's own fixture: a NAMED holder with zero shares. */
const ZERO_SHARE_LEDGER: ApiSecurity[] = [
  sec({ id: "s-f", companyId: "co", instrument: "common", holderName: "Founders", holderType: "founder", series: null, shares: 0, issuedAt: "2020-01-01" }),
];
/** THE CONTROL LEDGER — a real company. Every refusal below is paired with this. */
const REAL_LEDGER: ApiSecurity[] = [
  sec({ id: "s-f", companyId: "co", instrument: "common", holderName: "Founders", holderType: "founder", series: null, shares: 8_000_000, issuedAt: "2020-01-01" }),
];
/** The non-convergence pole, found by search (`build_log/wave72/scratch/p4_search2.mts`):
    1 share, a $7 pre-money, a $1 raise and a post-money SAFE. The solve's price
    collapses by ~4 orders of magnitude per iteration and never settles. */
const DIVERGENT_LEDGER: ApiSecurity[] = [
  sec({ id: "c1", companyId: "co", instrument: "common", holderName: "F", holderType: "founder", series: null, shares: 1, issuedAt: "2020-01-01" }),
  sec({ id: "s1", companyId: "co", instrument: "safe", holderName: "Angel", holderType: "investor", series: null, shares: 0, investmentAmount: 50_000, valuationCap: 1_000_000, safeCapType: "post_money_cap", issuedAt: "2021-01-01" }),
];
const DIVERGENT_ROUND = { preMoneyValuation: 7, investmentAmount: 1, series: "A" } as never;

/* ═══════════════════════════════════════════════════════════════════════════
 * A — FAULT 1: A ZERO PRICING DENOMINATOR REFUSES BY NAME
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W72-A — fault 1: no shares to price against is a named refusal", () => {
  it("W72-A1 — the ENGINE refuses at the one line that divides a valuation by a share count", () => {
    /* Thrown in `compute.ts::priceAndBuildRound`, not merely translated later, so
       NO caller of the engine can obtain an `Infinity` price — including the
       `legacy_pre_w52` rollback mode, which runs no solve at all. */
    let caught: unknown = null;
    try {
      computeCapTable({
        companyId: "co", asOf: "2026-06-01", view: "fully_diluted",
        formulaRegion: "US",
        holders: [{ id: "h1", name: "Founders", type: "founder" }],
        transactions: [{
          type: "issue_preferred_round", date: "2026-01-01",
          round: { id: "A", series: "A", preMoneyValuation: "30000000", investmentAmount: "10000000", liquidationPreferenceMultiple: 1 },
        }],
      } as never);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ZeroPricingDenominatorError);
    const e = caught as ZeroPricingDenominatorError;
    expect(e.name).toBe("ZeroPricingDenominatorError");
    expect(e.code).toBe("zero_pricing_denominator");
    expect(e.fdSharesBeforeRound).toBe("0");
    /* NAMES THE CONDITION, THE RULE AND THE SCREEN (the voice 0192's messages use). */
    expect(e.message).toContain("no fully-diluted shares to price against");
    expect(e.message).toContain("pre-money valuation ÷ the fully-diluted share count");
    /* NAMES A SURFACE THAT EXISTS AND WORKS (R58). It says /founder/rounds, because
       v25.48.3 Q-F1 made the cap table VIEW-ONLY: its "Add security in Rounds" button
       routes to /founder/rounds and there is no add-security dialog there any more.
       Telling a founder to add a security on the cap table would be describing a
       control that is not there. */
    expect(e.message).toContain("/founder/rounds");
    expect(e.message).toContain("VIEW-ONLY");
  });

  it("W72-A2 — the PROJECTION refuses with the same code, in the shape the HTTP layer already maps", () => {
    /* The review's exact input. */
    let caught: unknown = null;
    try {
      projectPostClose(ZERO_SHARE_LEDGER, { preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "A" } as never);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ZeroPricingDenominatorRefusal);
    expect(caught).toBeInstanceOf(RoundMathTermRefusal);
    const e = caught as ZeroPricingDenominatorRefusal;
    expect(e.code).toBe("zero_pricing_denominator");
    expect(e.name).toBe("ZeroPricingDenominatorRefusal");
    expect(e.securityId).toBe("A");           // the series, as `invalid_pre_money_valuation` does
    expect(e.field).toBe("shares");
    expect(e.message).toContain("/founder/rounds");
  });

  it("W72-A3 — the NEIGHBOURING refusal is unchanged: pre-money 0 and -1 still refuse as `invalid_pre_money_valuation`", () => {
    /* This wave's refusal is modelled on that one and must not shadow it: a zero
       pre-money over a REAL ledger is still the pre-money's refusal, by name. */
    for (const pmv of [0, -1]) {
      let caught: unknown = null;
      try {
        projectPostClose(REAL_LEDGER, { preMoneyValuation: pmv, investmentAmount: 10_000_000, series: "A" } as never);
      } catch (e) { caught = e; }
      expect((caught as { code?: string }).code).toBe("invalid_pre_money_valuation");
      expect((caught as { securityId?: string }).securityId).toBe("A");
    }
  });

  it("W72-A4 — CONTROL POLE: a legitimate financing over 8,000,000 shares still succeeds, numbers unchanged", () => {
    const r = projectPostClose(REAL_LEDGER, { preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "A" } as never);
    const t = r.trace.find((x) => x.formulaId === "round.pricing.order");
    /* Measured on the tree BEFORE this wave (`build_log/wave72/scratch/p1_repro.mts`,
       first run) and asserted here so a refusal cannot creep into the happy path. */
    expect(t?.outputs?.pricePerShare).toBe("3.75");
    expect(t?.outputs?.pricingDenominator).toBe("8000000");
    expect(t?.outputs?.newInvestorShares).toBe("2666666");
    expect(t?.outputs?.converged).toBe("true");
    expect(r.totalShares.toString()).toBe("10666666");
  });

  it("W72-A5 — CONTROL POLE: a SAFE + option-pool projection is unchanged, value for value", () => {
    /* THE WHOLE-PIPELINE NON-REGRESSION: SAFE conversion, pool top-up, a
       ten-iteration fixed-point solve and the ownership rows all in one
       projection. If this wave moved any of that, this fails.

       HONEST LABELLING, corrected during this wave rather than asserted: this is
       NOT the sacred §12 canonical example. §12's fixture (which yields D =
       15,000,000, p = $2.00, N = 5,000,000, T = 20,000,000) is pinned by
       `packages/cap-table-engine/test/order/w52-pricing-order.test.ts` and is
       green in this wave's 128/128 engine run; this fixture is a NEIGHBOURING one
       whose figures were MEASURED on the pre-fix tree
       (`build_log/wave72/scratch/p6_pre_fix_measure.mts`, run with the pre-fix
       files restored) and are asserted here unchanged.

       WHY THE PRICE IS PINNED BY PREFIX AND NOT BY ITS FULL 39 DIGITS: the exact
       number of significant digits `decimal.js` returns for this quotient depends
       on the GLOBAL `Decimal` precision, which differs between a bare `tsx` run
       (37 digits) and this vitest environment (39) because other modules loaded
       into the process configure it. That sensitivity is pre-existing, is NOT
       moved by this wave (the pre-fix and post-fix runs are byte-identical in the
       same environment: 37 digits ending `…8942344` under `tsx`, 39 ending
       `…942343 63` here, i.e. the same quotient at two precisions) and is recorded in `WAVE72_REPORT.md` under UNVERIFIED.
       The share counts, which is what anybody owns, are pinned exactly. */
    const ledger: ApiSecurity[] = [
      sec({ id: "s-f", companyId: "co", instrument: "common", holderName: "Founders", holderType: "founder", series: null, shares: 8_000_000, issuedAt: "2020-01-01" }),
      sec({ id: "s-p", companyId: "co", instrument: "option", holderName: "ESOP Pool", holderType: "pool", series: null, shares: 2_000_000, issuedAt: "2020-01-01" }),
      sec({ id: "s-safe", companyId: "co", instrument: "safe", holderName: "SAFE holder", holderType: "investor", series: null, shares: 0, investmentAmount: 2_000_000, valuationCap: 10_000_000, safeCapType: "post_money_cap", issuedAt: "2021-01-01" }),
    ];
    const r = projectPostClose(ledger, {
      preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "A",
      optionPoolPostPercent: "22.5",
    } as never);
    const t = r.trace.find((x) => x.formulaId === "round.pricing.order");
    expect(String(t?.outputs?.pricePerShare).startsWith("2.37499999010416670789930538375289423")).toBe(true);
    expect(t?.outputs?.pricingDenominator).toBe("12631579");
    expect(t?.outputs?.newInvestorShares).toBe("4210526");
    expect(t?.outputs?.iterations).toBe("10");
    expect(t?.outputs?.converged).toBe("true");
    expect(r.totalShares.toString()).toBe("16842105");
    /* The rows still sum to 100% of the fully-diluted total, to 6dp. */
    const sum = r.rows.reduce((acc, row) => acc + Number(row.ownershipPercent ?? "0"), 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it("W72-A6 — `Infinity` IS NEVER EMITTED, over a matrix of ledgers: every projection either refuses or prices finitely", () => {
    const ledgers: Array<[string, ApiSecurity[]]> = [
      ["zero-share common", ZERO_SHARE_LEDGER],
      ["no securities at all", []],
      ["zero-share option pool", [sec({ id: "p", companyId: "co", instrument: "option", holderName: "Pool", holderType: "pool", series: null, shares: 0, issuedAt: "2020-01-01" })]],
      ["zero-share warrant", [sec({ id: "w", companyId: "co", instrument: "warrant", holderName: "Bank", holderType: "other", series: null, shares: 0, issuedAt: "2020-01-01" })]],
      ["one share", [sec({ id: "c", companyId: "co", instrument: "common", holderName: "F", holderType: "founder", series: null, shares: 1, issuedAt: "2020-01-01" })]],
      ["real ledger", REAL_LEDGER],
    ];
    let refusals = 0;
    let successes = 0;
    for (const [label, ledger] of ledgers) {
      try {
        const r = projectPostClose(ledger, { preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "A" } as never);
        successes++;
        const t = r.trace.find((x) => x.formulaId === "round.pricing.order");
        const pps = String(t?.outputs?.pricePerShare ?? "");
        expect(Number.isFinite(Number(pps)), `${label} priced at ${pps}`).toBe(true);
        expect(Number(pps), `${label} priced at ${pps}`).toBeGreaterThan(0);
        /* And nothing anywhere in the returned trace says it either. */
        expect(JSON.stringify(r.trace)).not.toContain("Infinity");
      } catch (e) {
        expect(e, `${label} threw something unnamed`).toBeInstanceOf(RoundMathTermRefusal);
        expect(String((e as Error).message)).not.toContain("Infinity price");
        refusals++;
      }
    }
    /* BOTH poles genuinely occur in the matrix — otherwise this proves nothing. */
    expect(refusals).toBeGreaterThan(0);
    expect(successes).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B — FAULT 2: AN UNCONVERGED SOLVE IS NOT A SUCCESS (independently of fault 1)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W72-B — fault 2: the pricing solve must settle before a price is reported", () => {
  it("W72-B1 — a solve that does not settle REFUSES BY NAME, on a POSITIVE denominator", () => {
    let caught: unknown = null;
    let capturedOpts: unknown = null;
    try {
      projectPostClose(DIVERGENT_LEDGER, DIVERGENT_ROUND, "US", undefined, (o) => { capturedOpts = o; });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PricingSolveNotConvergedRefusal);
    const e = caught as PricingSolveNotConvergedRefusal;
    expect(e.code).toBe("pricing_solve_not_converged");
    expect(e.field).toBe("pricePerShare");
    expect(e.iterations).toBe("24");
    expect(e.message).toContain("did not settle");
    expect(e.message).toContain("Edit terms");

    /* THE INDEPENDENCE PROOF. Running the SAME captured compute options through
       the engine shows a POSITIVE pricing denominator and `converged=false`, so
       this refusal cannot be fault 1's fix firing under another name. It also
       records what the platform used to return here: a successful cap table at a
       price of 2.2e-91 per share, on which the founder's single share was
       0.0000000000…% of the company. */
    const raw = computeCapTable(capturedOpts as never);
    const t = raw.trace.find((x) => x.formulaId === "round.pricing.order");
    expect(BigInt(String(t?.outputs?.pricingDenominator))).toBeGreaterThan(BigInt(0));
    expect(t?.outputs?.converged).toBe("false");
    expect(Number(String(t?.outputs?.pricePerShare))).toBeGreaterThan(0);
    expect(Number(String(t?.outputs?.pricePerShare))).toBeLessThan(1e-50);
  });

  it("W72-B2 — the ONE exemption is scoped to the `legacy_pre_w52` rollback and is not a hole anywhere else", () => {
    /* WHY THIS IS NOT A WEAKENING. `legacy_pre_w52` runs NO solve (iterations 0)
       and reports `converged=false` so its trace never claims a fixed point it
       never looked for; it exists so the pre-Wave-52 arithmetic can be reproduced
       exactly, and `w52c_round_math_reachability` asserts the route serves it.
       Refusing there would delete the rollback rather than fix a dead promise.
       The exemption is asserted to be EXACTLY this narrow: same ledger, same
       terms, corrected mode -> still refused. */
    const legacy = projectPostClose(DIVERGENT_LEDGER, DIVERGENT_ROUND, "US", "legacy_pre_w52");
    const t = legacy.trace.find((x) => x.formulaId === "round.pricing.order");
    expect(t?.outputs?.pricingOrderMode).toBe("legacy_pre_w52");
    expect(t?.outputs?.iterations).toBe("0");
    expect(t?.outputs?.converged).toBe("false");
    /* Still finite and positive — the engine's zero-denominator throw covers this
       mode too, so the rollback cannot carry an `Infinity` out either. */
    expect(Number(String(t?.outputs?.pricePerShare))).toBeGreaterThan(0);
    expect(Number.isFinite(Number(String(t?.outputs?.pricePerShare)))).toBe(true);

    expect(() => projectPostClose(DIVERGENT_LEDGER, DIVERGENT_ROUND, "US", "w52_post_pool_post_conversion"))
      .toThrow(PricingSolveNotConvergedRefusal);
  });

  it("W72-B3 — CONTROL POLE: every converged projection is still returned, with `converged=\"true\"`", () => {
    for (const pool of [undefined, "10", "22.5"]) {
      const r = projectPostClose(REAL_LEDGER, {
        preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "A",
        ...(pool ? { optionPoolPostPercent: pool } : {}),
      } as never);
      const t = r.trace.find((x) => x.formulaId === "round.pricing.order");
      expect(t?.outputs?.converged).toBe("true");
      expect(r.totalShares > BigInt(0)).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * C — D18's CONTRACT AT THE LEAF IS UNTOUCHED (the engine is correct; the
 *     consumers were not — see the client tests for the other half)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W72-C — the engine's `ownershipPercent` contract is unchanged by this wave", () => {
  it("W72-C1 — 0/0 is `null`, 0/1 is `\"0\"`, 1/1 is `\"100\"`", () => {
    const zero = runEngine(ZERO_SHARE_LEDGER, "fully_diluted");
    expect(zero.rows.length).toBe(1);
    expect(zero.rows[0].ownershipPercent).toBeNull();

    const oneOfOne = runEngine(
      [sec({ id: "c", companyId: "co", instrument: "common", holderName: "F", holderType: "founder", series: null, shares: 1, issuedAt: "2020-01-01" })],
      "fully_diluted",
    );
    expect(oneOfOne.rows[0].ownershipPercent).toBe("100");

    const zeroOfOne = runEngine(
      [
        sec({ id: "c", companyId: "co", instrument: "common", holderName: "F", holderType: "founder", series: null, shares: 1, issuedAt: "2020-01-01" }),
        sec({ id: "z", companyId: "co", instrument: "common", holderName: "Z", holderType: "founder", series: null, shares: 0, issuedAt: "2020-01-01" }),
      ],
      "fully_diluted",
    );
    const zRow = zeroOfOne.rows.find((r) => r.holderName === "Z");
    expect(zRow?.ownershipPercent).toBe("0");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D — THROUGH THE REAL HTTP ROUTE (R58: does it reach a caller?)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W72-D — GET /api/founder/rounds/:id/round-math", () => {
  let app: Express;
  const STAMP = String(Date.now());
  const ADMIN = "u_admin";
  const EMPTY_CO = `co_w72_empty_${STAMP}`;

  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  it("W72-D1 — a company with NO recorded shares gets a 422 naming `zero_pricing_denominator`, not a projection", async () => {
    /* THIS IS THE LIVE STATE, not a hypothetical: `W58CD-A4e` proved a company
       with no committed securities really does return zero rows from the endpoint
       the cap-table page reads, and `LIVE_AUDIT_2026_08_15.md` recorded
       "TOTAL SHARES 0 · 0 rows" for every company on live. Before this wave this
       request answered 200 with `pricePerShare: "Infinity"`. */
    const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: EMPTY_CO, name: `W72 Empty ${STAMP}`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31",
      targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 2,
      sharesAuthorized: 40_000_000, fdPreMoneyShares: 13_000_000,
    });
    expect(created.status).toBe(200);
    const id = String((created.body as { id: string }).id);

    const res = await request(app).get(`/api/founder/rounds/${id}/round-math`).set("x-user-id", ADMIN);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("ROUND_MATH_TERM_REFUSED");
    expect(res.body.refusal).toBe("zero_pricing_denominator");
    expect(res.body.refusalName).toBe("ZeroPricingDenominatorRefusal");
    expect(res.body.field).toBe("shares");
    expect(String(res.body.message)).toContain("/founder/rounds");
    /* And it never puts the word on the wire. */
    expect(JSON.stringify(res.body)).not.toContain("Infinity");
  }, 60_000);

  it("W72-D2 — CONTROL POLE: the seeded company's round still answers 200 with a finite price", async () => {
    const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: "co_novapay", name: `W72 Real ${STAMP}`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31",
      targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 2,
      sharesAuthorized: 40_000_000, fdPreMoneyShares: 13_000_000,
    });
    expect(created.status).toBe(200);
    const id = String((created.body as { id: string }).id);
    const res = await request(app).get(`/api/founder/rounds/${id}/round-math`).set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.projectable).toBe(true);
    const pps = String(res.body.postClose?.pricingTrace?.outputs?.pricePerShare ?? "");
    expect(pps).not.toBe("");
    expect(Number.isFinite(Number(pps))).toBe(true);
    expect(Number(pps)).toBeGreaterThan(0);
    expect(res.body.postClose?.pricingTrace?.outputs?.converged).toBe("true");
    expect(JSON.stringify(res.body)).not.toContain("Infinity");
  }, 60_000);
});
