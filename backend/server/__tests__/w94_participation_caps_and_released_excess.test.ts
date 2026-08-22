/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 94 — PARTICIPATION CAPS, AND THE RELEASED EXCESS OF A BINDING CAP.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, in two sentences.
 *
 *   1. `handleWaterfall` NEVER set `participationCapMultiple` on the classes it
 *      handed the sacred engine, so "1x participating, capped at 2x" — an ordinary
 *      market term — was silently modelled as UNCAPPED. That OVERPAYS the capped
 *      class and UNDERPAYS THE FOUNDERS, and it published a wrong figure rather
 *      than refusing. Measured on 4,000 randomised fixtures: 766 published a wrong
 *      figure and on 556 of them the founders' common leg was UNDERPAID. On ZERO
 *      was it overpaid.
 *   2. When a cap DOES bind, the participation the capped class no longer receives
 *      fell entirely to common holders and converters — never back to the other
 *      still-participating preference classes (open item J-3). Measured: 200 of the
 *      same 4,000 fixtures.
 *
 * WHY BOTH ARE IN ONE FILE AND ONE WAVE. R83.2. Fixing the cap ALONE would have
 * moved the founders from one wrong number to a DIFFERENT wrong number: on the
 * headline fixture below the founders go 23,428,571.43 → 24,285,714.29 → and the
 * correct figure is 24,000,000.00. Founder money moves ONCE, in ONE measured step.
 *
 * WHERE THE EXPECTED FIGURES COME FROM. Every money figure asserted here was
 * computed on THREE independent instruments and reconciled before it was written
 * down: the shipped sacred engine, a Python `fractions.Fraction` exact-rational
 * reference, and a raw `bigint` numerator/denominator reference that solves the
 * capped split by a DIFFERENT algorithm (a residual price-per-share solve rather
 * than iterative removal). The two references agree with each other on 53 of 53
 * rows across 18 scenarios and on 4,000 of 4,000 sweep fixtures
 * (`build_log/wave94/transcripts/01_three_instrument_reconciliation.txt`,
 * `10_sweep_4000_report.txt`). Each figure was then re-executed through this route
 * over live HTTP; those bodies are in `build_log/wave94/transcripts/03_route_bodies.json`.
 * Nothing here was computed in anyone's head: this project has shipped a $2,222,222
 * error, a financing that succeeded at an INFINITE price, a 2.2e96-share
 * non-convergence, an investor shown $0 on a $10,000,000 SAFE, and a waterfall that
 * added up perfectly for the wrong exit value.
 *
 * THREE STANDING HAZARDS THIS FILE RESPECTS.
 *   · The SACRED engine is NOT edited and NOT expected to change. Every figure here
 *     is produced by the unmodified `packages/cap-table-engine`; the correction is
 *     entirely in the caller. `npm run sacred` is 48/48 with nine ratified waivers.
 *   · `Decimal.set` is NEVER called — it mutates the shared decimal.js instance the
 *     sacred engine imports. This file uses its own `Decimal.clone`.
 *   · `computeConversionProjections` (`server/roundCarryForwardEngine.ts`, ~`:770`)
 *     is NOT touched, NOT called and NOT asserted against. R69, dead code, tripwire
 *     `W58F-F2f`. This wave is exit conversions, which is exactly where that trap
 *     lives; four agents have proposed editing it and all four were wrong. The live
 *     path only: shares in → sacred `computeWaterfall` → payouts out.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { Decimal } from "decimal.js";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { createRound, updateRound } from "../roundsStore";
import { PARTICIPATION_CAP_MAX, validateParticipationCapStored } from "../lib/roundStoredTerms";

const ADMIN = "u_admin";
const STAMP = `w94${Math.random().toString(36).slice(2, 8)}`;
/* THIS TEST'S OWN INSTANCE. `Decimal.clone`, never `Decimal.set`. */
const D120 = Decimal.clone({ precision: 120 });

let app: Express;

type ClassSpec = {
  /** The free-text liquidation preference the round records. */
  lp: string;
  seniority: number;
  /** Invested amount in MAJOR units, as the ledger takes it. */
  amount: number;
  shares: number;
  /** The participation cap, sent to `POST /api/rounds` as the founder would. */
  cap?: number | string;
  /** A cap written STRAIGHT TO THE STORE, bypassing every route fence — which is
   *  what a row created before this wave's fence can hold. */
  capDirect?: unknown;
};

/** A company with real founder common and N preferred classes, built only through
 *  reachable creator endpoints. The price per share is DERIVED from amount ÷ shares
 *  because the commit store refuses a priced round whose shares are not
 *  `floor(amount / price)` (`PRICED_ROUND_SHARE_MISMATCH`). */
async function buildCompany(
  tag: string,
  classes: ClassSpec[],
  opts?: { founderShares?: string },
): Promise<string> {
  const companyId = `co_${STAMP}_${tag}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W94 ${tag}`, legalName: `W94 ${tag}, Inc.` });
  expect(co.status, `company create ${tag}`).toBeLessThan(400);
  const foundationId = createRound({
    companyId, name: `${STAMP} foundation ${tag}`, type: "foundation",
    instrument: "common", pricePerShare: null, actorUserId: ADMIN,
  } as never).id;
  const seeded = await request(app).post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({
      companyId, roundId: foundationId, shares: opts?.founderShares ?? "8000000",
      amount: "8000", currency: "USD",
      holderFirstName: "Founder", holderLastName: tag,
    });
  expect(seeded.status, `seed ${tag}`).toBeLessThan(400);
  let i = 0;
  for (const c of classes) {
    const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId, name: `${STAMP} ${tag} class${i}`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: c.amount,
      pricePerShare: c.amount / c.shares, sharesAuthorized: 40_000_000,
      preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
      liquidationPreference: c.lp, seniority: c.seniority,
      ...(c.cap === undefined ? {} : { capParticipation: c.cap }),
    });
    expect(created.status, `round create ${tag}${i}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(200);
    const roundId = String((created.body as { id: string }).id);
    if (c.capDirect !== undefined) {
      updateRound(roundId, { capParticipation: c.capDirect }, { actorUserId: ADMIN } as never);
    }
    const back = await request(app).post("/api/founder/captable/backfill-investor")
      .set("x-user-id", ADMIN)
      .send({
        companyId, roundId, shares: String(c.shares), amount: String(c.amount), currency: "USD",
        holderFirstName: "Invest", holderLastName: `${tag}${i}`,
        investorEmail: `${STAMP}_${tag}_${i}@example.invalid`,
      });
    expect(back.status, `backfill ${tag}${i}`).toBeLessThan(400);
    i++;
  }
  return companyId;
}

const waterfall = (companyId: string, exitMinor: string) =>
  request(app).get("/api/founder/captable/waterfall")
    .query({ companyId, exitValuationMinor: exitMinor }).set("x-user-id", ADMIN);

type Body = {
  ok: boolean;
  lpProceeds: string;
  founderProceeds: string;
  remainder: string;
  byShareClass: Array<{ classId: string; className: string; proceeds: string; decision: string }>;
  byCommonHolder: Array<{ holderId: string; holderName: string; proceeds: string }>;
  participationCaps: {
    anyOnRecord: boolean;
    classes: Array<{
      roundId: string; className: string; onRecord: boolean; capMultiple: number | null;
      source: string | null; inert: boolean; capAmountMinor: string | null;
    }>;
    capBound: string[];
    capForcedConversion: string[];
    releasedExcessMinor: string;
    releasedExcessRedistributed: boolean;
    residualSharedMinor: string | null;
    residualPricePerShareMinor: string | null;
    conservationExact: boolean;
    conservationResidualMinor: string;
    precisionCeiling: string;
    basis: string;
  };
  pariPassu: { abatementEngaged: boolean };
};

/** The class figure by the class's ORDINAL in creation order. */
const cls = (b: Body, ordinal: number): string => {
  const row = b.byShareClass.filter((r) => r.className.endsWith(`class${ordinal}`))[0];
  expect(row, `class${ordinal} is missing from byShareClass`).toBeDefined();
  return row.proceeds;
};

/** Σ every published figure + remainder. */
const total = (b: Body): Decimal =>
  b.byShareClass.reduce<Decimal>((a, r) => a.plus(new D120(r.proceeds)), new D120(0))
    .plus(b.byCommonHolder.reduce<Decimal>((a, r) => a.plus(new D120(r.proceeds)), new D120(0)))
    .plus(new D120(b.remainder));

/** EXACT conservation, no tolerance. Asserted wherever the figures terminate. */
const conservesExactly = (b: Body, exitMinor: string): boolean => total(b).eq(new D120(exitMinor));

/** Conservation to 30 significant digits, for a fixture whose residual price per
 *  share does NOT terminate. The engine's declared ceiling is 38 significant digits
 *  and a chained division rounds HALF_EVEN there, so a full-string assertion would
 *  go red on a rounding artefact and hide a real regression instead of catching it
 *  (`spec/UNVERIFIED_WATERFALL.md` · UV-W-4). A REAL conservation failure moves
 *  whole minor units; this leaves 1e30 of headroom. */
const conservesTo30 = (b: Body, exitMinor: string): boolean => {
  const t = total(b);
  const e = new D120(exitMinor);
  if (t.eq(e)) return true;
  if (e.isZero()) return false;
  return t.minus(e).abs().div(e.abs()).lte(new D120("1e-30"));
};

/* THE HEADLINE CAP TABLE, used by several assertions below.
   Series A $10,000,000 1x participating UNCAPPED on 4,000,000 shares;
   Series B $5,000,000 1x participating on 2,000,000 shares;
   founders 8,000,000 common. */
const A_UNCAPPED: ClassSpec = { lp: "1x participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 };
const B = (cap?: number | string, seniority = 0): ClassSpec =>
  ({ lp: "1x participating", seniority, amount: 5_000_000, shares: 2_000_000, ...(cap === undefined ? {} : { cap }) });

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 120_000);

describe("W94 · ITEM 1 — a recorded participation cap reaches the engine", () => {
  /* W94-CAP-01. THE DEFECT AND ITS CORRECTION, ON ONE CAP TABLE, IN ONE TEST.
     Exit $56,000,000. B's cap is 2x = $10,000,000 and it BINDS. B's as-converted
     value is 2/14 × $56,000,000 = $8,000,000, which is BELOW the cap, so B does not
     convert — which is precisely open item J-3's precondition. */
  it("W94-CAP-01 · the cap binds, the capped class stops at its cap, and the founders receive the difference", async () => {
    const uncapped = await buildCompany("cap01u", [A_UNCAPPED, B(undefined)]);
    const capped = await buildCompany("cap01c", [A_UNCAPPED, B(2)]);

    const u = (await waterfall(uncapped, "5600000000")).body as Body;
    const c = (await waterfall(capped, "5600000000")).body as Body;

    /* BEFORE — the cap ignored, which is what this route published for every capped
       class until this wave. */
    expect(cls(u, 0)).toBe("2171428571.4285714285714285714285714286");
    expect(cls(u, 1)).toBe("1085714285.7142857142857142857142857143");
    expect(u.founderProceeds).toBe("2342857142.8571428571428571428571428571");

    /* AFTER — the cap honoured AND its released excess redistributed. Series B
       stops at its $10,000,000 cap; Series A and the FOUNDERS take the difference. */
    expect(cls(c, 1)).toBe("1000000000");
    expect(cls(c, 0)).toBe("2200000000");
    expect(c.founderProceeds).toBe("2400000000");

    /* THE MOVEMENT, stated as money: B was overpaid $857,142.86, the founders were
       underpaid $571,428.57 and Series A was underpaid $285,714.29. */
    expect(new D120(cls(u, 1)).minus(new D120(cls(c, 1))).toFixed())
      .toBe("85714285.7142857142857142857142857143");
    expect(new D120(c.founderProceeds).minus(new D120(u.founderProceeds)).toFixed())
      .toBe("57142857.1428571428571428571428571429");
    expect(new D120(cls(c, 0)).minus(new D120(cls(u, 0))).toFixed())
      .toBe("28571428.5714285714285714285714285714");

    /* CONSERVATION, exactly, on both. */
    expect(conservesExactly(u, "5600000000"), "uncapped conserves").toBe(true);
    expect(conservesExactly(c, "5600000000"), "capped conserves").toBe(true);

    /* AND IT IS DISCLOSED, not silently applied. */
    expect(c.participationCaps.anyOnRecord).toBe(true);
    expect(c.participationCaps.capBound.length).toBe(1);
    expect(c.participationCaps.releasedExcessMinor).toBe("85714285.71428571428571428571428571429");
    expect(c.participationCaps.releasedExcessRedistributed).toBe(true);
    expect(c.participationCaps.conservationExact).toBe(true);
    expect(u.participationCaps.anyOnRecord).toBe(false);
    expect(u.participationCaps.releasedExcessRedistributed).toBe(false);
  }, 120_000);

  /* W94-CAP-14. The SAME figures with the cap recorded inside the free-text
     liquidation-preference wording instead of in the cap key. Two homes, one
     answer — or the two would be a rule that diverges (R21). */
  it("W94-CAP-14 · a cap written into the liquidation-preference wording gives the identical figures", async () => {
    const co = await buildCompany("cap14", [
      A_UNCAPPED,
      { lp: "1x participating, capped at 2x", seniority: 0, amount: 5_000_000, shares: 2_000_000 },
    ]);
    const b = (await waterfall(co, "5600000000")).body as Body;
    expect(cls(b, 0)).toBe("2200000000");
    expect(cls(b, 1)).toBe("1000000000");
    expect(b.founderProceeds).toBe("2400000000");
    expect(b.participationCaps.classes[1].source).toBe("liquidationPreference");
    expect(b.participationCaps.classes[1].capMultiple).toBe(2);
    expect(conservesExactly(b, "5600000000")).toBe(true);
  }, 120_000);

  /* W94-CAP-13. A capped class at a DISTINCT, junior rank. The senior preference is
     paid first and the cap then binds on the junior — same figures, different
     stacking, so the correction is not an artefact of equal ranks. */
  it("W94-CAP-13 · a capped junior class on stacked ranks", async () => {
    const co = await buildCompany("cap13", [A_UNCAPPED, B(2, 1)]);
    const b = (await waterfall(co, "5600000000")).body as Body;
    expect(cls(b, 0)).toBe("2200000000");
    expect(cls(b, 1)).toBe("1000000000");
    expect(b.founderProceeds).toBe("2400000000");
    expect(conservesExactly(b, "5600000000")).toBe(true);
  }, 120_000);
});

describe("W94 · ITEM 2 — the released excess goes to the other still-participating classes", () => {
  /* W94-CAP-04. TWO caps at DIFFERENT multiples, both binding, beside one uncapped
     participating class. This is the fixture that separates the correct treatment
     from "the excess falls to common": Series C is a PREFERENCE class and it takes
     part of what the two capped classes released.

     The residual price per share here is 3,050,000,000 ÷ 9,000,000, which does not
     terminate — so this fixture also exercises the precision ceiling. */
  it("W94-CAP-04 · two caps at different multiples both bind, and an uncapped preference class takes a share of what they released", async () => {
    const spec: ClassSpec[] = [
      { lp: "1x participating", seniority: 0, amount: 10_000_000, shares: 4_000_000, cap: 2 },
      { lp: "1x participating", seniority: 0, amount: 5_000_000, shares: 1_000_000, cap: 1.5 },
      { lp: "1x participating", seniority: 0, amount: 2_000_000, shares: 1_000_000 },
    ];
    const capped = await buildCompany("cap04c", spec);
    const control = await buildCompany("cap04n", spec.map((s) => ({ ...s, cap: undefined })));

    const c = (await waterfall(capped, "6000000000")).body as Body;
    const n = (await waterfall(control, "6000000000")).body as Body;

    /* Both caps bind exactly at their multiples. */
    expect(cls(c, 0)).toBe("2000000000");   // 2x of $10,000,000
    expect(cls(c, 1)).toBe("750000000");    // 1.5x of $5,000,000
    /* AND THIS IS ITEM 2: Series C, a PREFERENCE class, is paid MORE than it would
       have been if the released excess had fallen to common alone. */
    expect(cls(c, 2)).toBe("538888888.88888888888888888888888888889");
    expect(new D120(cls(c, 2)).gt(new D120("507142857.14285714285714285714285714286")))
      .toBe(true);
    expect(c.founderProceeds).toBe("2711111111.1111111111111111111111111111");

    /* The control, with no caps on record, is what the route published before. */
    expect(cls(n, 0)).toBe("2228571428.5714285714285714285714285714");
    expect(cls(n, 1)).toBe("807142857.14285714285714285714285714286");
    expect(cls(n, 2)).toBe("507142857.14285714285714285714285714286");
    expect(n.founderProceeds).toBe("2457142857.1428571428571428571428571428");

    /* One price per share for everybody who is still sharing. */
    expect(c.participationCaps.residualPricePerShareMinor)
      .toBe("338.88888888888888888888888888888888889");
    expect(c.participationCaps.capBound.length).toBe(2);
    expect(c.participationCaps.releasedExcessRedistributed).toBe(true);

    /* CONSERVATION. The price does not terminate, so the engine's own rows differ
       from the exact total in about the 38th significant digit. That residual is
       PUBLISHED rather than absorbed, and it is 1e-29 minor units. */
    expect(conservesTo30(c, "6000000000"), "capped conserves to 30 sig digits").toBe(true);
    expect(c.participationCaps.conservationExact).toBe(false);
    expect(new D120(c.participationCaps.conservationResidualMinor).abs().lt(new D120("1e-25")))
      .toBe(true);
    expect(conservesTo30(n, "6000000000"), "control conserves").toBe(true);
  }, 180_000);
});

describe("W94 · the boundaries", () => {
  /* A cap that binds EXACTLY at its multiple releases nothing, so the answer must be
     byte-identical to the same cap table with no cap on record. Exit $50,000,000:
     B takes $5,000,000 preference + 2/14 × $35,000,000 = exactly $10,000,000 = 2x. */
  it("W94-CAP-02 · a cap that binds exactly at its multiple changes nothing", async () => {
    const capped = await buildCompany("cap02c", [A_UNCAPPED, B(2)]);
    const control = await buildCompany("cap02n", [A_UNCAPPED, B(undefined)]);
    const c = (await waterfall(capped, "5000000000")).body as Body;
    const n = (await waterfall(control, "5000000000")).body as Body;
    expect(cls(c, 1)).toBe("1000000000");
    expect(cls(c, 0)).toBe(cls(n, 0));
    expect(cls(c, 1)).toBe(cls(n, 1));
    expect(c.founderProceeds).toBe(n.founderProceeds);
    expect(c.participationCaps.capBound).toEqual([]);
    expect(c.participationCaps.releasedExcessMinor).toBe("0");
    expect(conservesExactly(c, "5000000000")).toBe(true);
  }, 120_000);

  /* One minor unit below the exact-bind point: the cap does not bind at all. */
  it("W94-CAP-03 · one minor unit below, the cap just fails to bind", async () => {
    const co = await buildCompany("cap03", [A_UNCAPPED, B(2)]);
    const b = (await waterfall(co, "4999999999")).body as Body;
    expect(new D120(cls(b, 1)).lt(new D120("1000000000"))).toBe(true);
    expect(cls(b, 1)).toBe("999999999.85714285714285714285714285714");
    expect(b.participationCaps.capBound).toEqual([]);
    /* The figures here divide by 14 and do not terminate, so the engine's own rows
       sum to 4e-29 minor units above the exit at its declared 38-significant-digit
       ceiling. MEASURED, and PRE-EXISTING: nothing about this fixture is touched by
       Wave 94, because no cap binds and the redistribution never runs. Asserted to
       30 significant digits, which leaves 1e30 of headroom over a real failure. */
    expect(conservesTo30(b, "4999999999")).toBe(true);
    expect(new D120(total(b)).minus(new D120("4999999999")).abs().lt(new D120("1e-25"))).toBe(true);
  }, 120_000);

  it("W94-CAP-05 · a capped class beside an uncapped one, the cap nowhere near binding, is byte-identical", async () => {
    const capped = await buildCompany("cap05c", [A_UNCAPPED, B(3)]);
    const control = await buildCompany("cap05n", [A_UNCAPPED, B(undefined)]);
    const c = (await waterfall(capped, "2000000000")).body as Body;
    const n = (await waterfall(control, "2000000000")).body as Body;
    expect(cls(c, 0)).toBe(cls(n, 0));
    expect(cls(c, 1)).toBe(cls(n, 1));
    expect(c.founderProceeds).toBe(n.founderProceeds);
    /* This fixture's figures divide by 7 and do not terminate, so `Σ rows` sits
       3e-29 minor units BELOW the exit at the engine's 38-digit ceiling. The
       assertion that matters is not a tolerance but an IDENTITY: the residual is
       byte-identical with and without the cap on record, which proves Wave 94
       changed nothing here rather than merely staying inside a tolerance. */
    expect(conservesTo30(c, "2000000000")).toBe(true);
    expect(total(c).minus(new D120("2000000000")).toFixed())
      .toBe(total(n).minus(new D120("2000000000")).toFixed());
  }, 120_000);

  it("W94-CAP-07 · zero proceeds with a cap on record: every figure zero, no division by zero", async () => {
    const co = await buildCompany("cap07", [A_UNCAPPED, B(2)]);
    const r = await waterfall(co, "0");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    expect(cls(b, 0)).toBe("0");
    expect(cls(b, 1)).toBe("0");
    expect(b.founderProceeds).toBe("0");
    expect(b.participationCaps.capBound).toEqual([]);
    expect(conservesExactly(b, "0")).toBe(true);
  }, 120_000);

  it("W94-CAP-08 · proceeds exactly equal to the claims: residual zero, so no cap can bind", async () => {
    const co = await buildCompany("cap08", [A_UNCAPPED, B(2)]);
    const b = (await waterfall(co, "1500000000")).body as Body;
    expect(cls(b, 0)).toBe("1000000000");
    expect(cls(b, 1)).toBe("500000000");
    expect(b.founderProceeds).toBe("0");
    expect(b.participationCaps.capBound).toEqual([]);
    expect(conservesExactly(b, "1500000000")).toBe(true);
  }, 120_000);

  /* THE INTERACTION WAVE 91 COULD NOT TEST, because a cap was unreachable through
     this route at all (`W91_UNVERIFIED.md` · UV-W91-3). Wave 91 argued structurally
     that an abating tier leaves a zero residual so no cap can bind. Now measured. */
  it("W94-CAP-06 · pari passu abatement WITH a cap on record reproduces Wave 91's pinned figures and binds nothing", async () => {
    const co = await buildCompany("cap06", [
      { ...A_UNCAPPED, cap: 2 },
      B(2),
    ]);
    const b = (await waterfall(co, "900000000")).body as Body;
    /* Wave 91's `W91-PP-01`: $15,000,000 of equal claims on a $9,000,000 exit. */
    expect(cls(b, 0)).toBe("600000000");
    expect(cls(b, 1)).toBe("300000000");
    expect(b.founderProceeds).toBe("0");
    expect(b.pariPassu.abatementEngaged).toBe(true);
    expect(b.participationCaps.anyOnRecord).toBe(true);
    expect(b.participationCaps.capBound, "an abating tier leaves no residual, so no cap can bind").toEqual([]);
    expect(b.participationCaps.releasedExcessMinor).toBe("0");
    expect(conservesExactly(b, "900000000")).toBe(true);
  }, 120_000);
});

describe("W94 · a recorded cap is never silently dropped", () => {
  /* The value this project has actually persisted unvalidated before now. A legacy
     row can hold it, because the write fence is NEW — so the READER must refuse it
     rather than read the class as uncapped, which is the whole defect. */
  it.each([
    ["FULL_RATCHET", "the string this project has persisted unvalidated before"],
    [50, "outside the (0, 10] domain"],
    [0, "a zero cap would pay the class less than its own preference"],
    [-1, "negative"],
  ])("W94-CAP-R1 · a legacy row holding %s is REFUSED, not read as uncapped", async (bad, _why) => {
    const co = await buildCompany(`r1${String(bad).replace(/[^a-z0-9]/gi, "")}`.toLowerCase(), [
      A_UNCAPPED,
      { ...B(undefined), capDirect: bad },
    ]);
    const r = await waterfall(co, "5600000000");
    expect(r.status).toBe(422);
    const b = r.body as { error: string; refusalName: string; recordedValue: string; message: string };
    expect(b.error).toBe("PARTICIPATION_CAP_NOT_READABLE");
    expect(b.refusalName).toBe("participation_cap_not_readable");
    /* The refusal QUOTES what it found, so a founder can see the offending value. */
    expect(String(b.recordedValue)).toBe(String(bad));
    expect(b.message).toContain(String(bad));
    /* And it says why refusing beats modelling it as uncapped. */
    expect(b.message.toLowerCase()).toContain("uncapped");
  }, 120_000);

  /* THE OTHER POLE, which is what makes the fence a fence and not a blanket ban:
     `7` is INSIDE the domain, so it is READ and applied. It simply does not bind
     here. This project once persisted `7` unvalidated; being in domain, `7` is a
     real term and must compute. */
  it("W94-CAP-R1e · a 7x cap is INSIDE the domain, so it is read and applied rather than refused", async () => {
    const co = await buildCompany("r1seven", [A_UNCAPPED, { ...B(undefined), capDirect: 7 }]);
    const r = await waterfall(co, "5600000000");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    expect(b.participationCaps.classes[1].onRecord).toBe(true);
    expect(b.participationCaps.classes[1].capMultiple).toBe(7);
    expect(b.participationCaps.classes[1].capAmountMinor).toBe("3500000000");
    /* A 7x cap on a $5,000,000 class is $35,000,000 and does not bind on this exit,
       so the figures are the uncapped ones. */
    expect(cls(b, 1)).toBe("1085714285.7142857142857142857142857143");
    expect(b.participationCaps.capBound).toEqual([]);
  }, 120_000);

  it("W94-CAP-R2 · two DIFFERENT caps on record is refused rather than resolved", async () => {
    const co = await buildCompany("r2", [
      A_UNCAPPED,
      { lp: "1x participating, capped at 3x", seniority: 0, amount: 5_000_000, shares: 2_000_000, cap: 2 },
    ]);
    const r = await waterfall(co, "5600000000");
    expect(r.status).toBe(422);
    expect((r.body as { error: string }).error).toBe("PARTICIPATION_CAP_CONFLICT");
  }, 120_000);

  it("W94-CAP-R3 · a cap BELOW the preference multiple is refused, because both readings move money", async () => {
    const co = await buildCompany("r3", [
      { lp: "2x participating", seniority: 0, amount: 10_000_000, shares: 4_000_000, cap: 1.5 },
      B(undefined, 1),
    ]);
    const r = await waterfall(co, "5000000000");
    expect(r.status).toBe(422);
    const b = r.body as { error: string; capMultiple: number; liquidationPreferenceMultiple: number };
    expect(b.error).toBe("PARTICIPATION_CAP_BELOW_PREFERENCE");
    expect(b.capMultiple).toBe(1.5);
    expect(b.liquidationPreferenceMultiple).toBe(2);
  }, 120_000);

  it("W94-CAP-15 · a cap on a NON-participating class cannot bind, is not a refusal, and is disclosed as inert", async () => {
    const co = await buildCompany("cap15", [
      A_UNCAPPED,
      { lp: "1x non-participating", seniority: 1, amount: 5_000_000, shares: 2_000_000, cap: 2 },
    ]);
    const r = await waterfall(co, "5600000000");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    expect(b.participationCaps.classes[1].onRecord).toBe(true);
    expect(b.participationCaps.classes[1].inert).toBe(true);
    expect(b.participationCaps.capBound).toEqual([]);
  }, 120_000);
});

describe("W94 · the three write fences, and the domain they share", () => {
  /* The validator itself, so the domain is pinned independently of any route. */
  it("W94-CAP-W0 · the fence accepts the whole domain and refuses everything outside it", () => {
    for (const ok of [1, 1.5, 2, 2.5, 7, 10, "2", "2x", "2X", " 2 x ", PARTICIPATION_CAP_MAX]) {
      expect(validateParticipationCapStored(ok).ok, `should accept ${String(ok)}`).toBe(true);
    }
    for (const bad of [0, -1, 10.0001, 50, "FULL_RATCHET", "x2", "2xx", true, false, [], {}, [2], NaN, Infinity]) {
      expect(validateParticipationCapStored(bad as unknown).ok, `should refuse ${JSON.stringify(bad)}`).toBe(false);
    }
    /* ABSENT stays absent, tested on the LITERAL value — `String([])` is `""`, so
       the tree's usual trim idiom would read an empty ARRAY as "no cap". */
    for (const absent of [null, undefined, "", "   "]) {
      const v = validateParticipationCapStored(absent);
      expect(v.ok && v.value === "", `${JSON.stringify(absent)} means absent`).toBe(true);
    }
    expect(validateParticipationCapStored([]).ok, "an empty array is a client bug, not an absent cap").toBe(false);
  });

  it("W94-CAP-W1 · POST /api/rounds refuses an out-of-domain cap and stores an in-domain one", async () => {
    const companyId = `co_${STAMP}_w1`;
    await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
      .send({ companyId, companyName: "W94 w1", legalName: "W94 w1, Inc." });
    const body = {
      companyId, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 5_000_000,
      pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000,
      fdPreMoneyShares: 13_000_000, liquidationPreference: "1x participating",
    };
    const bad = await request(app).post("/api/rounds").set("x-user-id", ADMIN)
      .send({ ...body, name: `${STAMP} w1 bad`, capParticipation: "FULL_RATCHET" });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toBe("invalid_capParticipation");

    const zero = await request(app).post("/api/rounds").set("x-user-id", ADMIN)
      .send({ ...body, name: `${STAMP} w1 zero`, capParticipation: 0 });
    expect(zero.status, "0 is refused rather than read as no cap").toBe(400);

    const good = await request(app).post("/api/rounds").set("x-user-id", ADMIN)
      .send({ ...body, name: `${STAMP} w1 good`, capParticipation: "2x" });
    expect(good.status).toBe(200);
    /* Readable back, NORMALISED TO A NUMBER — the same shape the other two writers
       store, so the three cannot drift (R21). */
    const read = await request(app).get(`/api/rounds/${String((good.body as { id: string }).id)}`)
      .set("x-user-id", ADMIN);
    expect(Number((read.body as Record<string, unknown>).capParticipation)).toBe(2);
  }, 120_000);

  it("W94-CAP-W2 · PATCH /api/rounds/:id/terms fences the cap and round-trips it", async () => {
    const companyId = `co_${STAMP}_w2`;
    await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
      .send({ companyId, companyName: "W94 w2", legalName: "W94 w2, Inc." });
    const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId, name: `${STAMP} w2`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 5_000_000,
      pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000,
      fdPreMoneyShares: 13_000_000, liquidationPreference: "1x participating",
    });
    expect(created.status).toBe(200);
    const id = String((created.body as { id: string }).id);

    const bad = await request(app).patch(`/api/rounds/${id}/terms`).set("x-user-id", ADMIN)
      .send({ capParticipation: 50 });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toBe("invalid_capParticipation");

    /* PERSISTS — before this wave the key was on neither this route's list nor the
       store's whitelist, so it was a 200 that stored nothing (the J-6 pattern). */
    const good = await request(app).patch(`/api/rounds/${id}/terms`).set("x-user-id", ADMIN)
      .send({ capParticipation: 2.5 });
    expect(good.status).toBeLessThan(400);
    const read = await request(app).get(`/api/rounds/${id}`).set("x-user-id", ADMIN);
    expect(Number((read.body as Record<string, unknown>).capParticipation)).toBe(2.5);

    /* Explicit removal means UNCAPPED, which is a real term and not a gap. */
    const removed = await request(app).patch(`/api/rounds/${id}/terms`).set("x-user-id", ADMIN)
      .send({ capParticipation: null });
    expect(removed.status).toBeLessThan(400);
    const read2 = await request(app).get(`/api/rounds/${id}`).set("x-user-id", ADMIN);
    const back = (read2.body as Record<string, unknown>).capParticipation;
    expect(back === null || back === undefined || String(back) === "").toBe(true);
  }, 120_000);

  it("W94-CAP-W3 · PATCH /api/founder/rounds/:id fences the cap", async () => {
    const companyId = `co_${STAMP}_w3`;
    await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
      .send({ companyId, companyName: "W94 w3", legalName: "W94 w3, Inc." });
    const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId, name: `${STAMP} w3`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 5_000_000,
      pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000,
      fdPreMoneyShares: 13_000_000, liquidationPreference: "1x participating",
    });
    const id = String((created.body as { id: string }).id);
    const bad = await request(app).patch(`/api/founder/rounds/${id}`).set("x-user-id", ADMIN)
      .send({ capParticipation: "FULL_RATCHET" });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toBe("invalid_capParticipation");
  }, 120_000);
});

describe("W94 · what must not move", () => {
  /* THE THRICE-CONFIRMED RESULT. Founders $20,000,000 / A $20,000,000 /
     B $10,000,000 on a $50,000,000 exit, with B's 2x cap binding AND forcing
     conversion (as-converted $12,500,000 beats the $8,000,000 cap).

     Wave 91 could not reach this over HTTP AT ALL, because the route could not
     express a cap (`W91_UNVERIFIED.md` · UV-W91-3). It has been verified at engine
     level on all three instruments by the pre-flight; this is the first time it is
     pinned THROUGH THE ROUTE. */
  it("W94-MNM-S6 · the thrice-confirmed result, reproduced over HTTP for the first time", async () => {
    const co = await buildCompany("mnms6", [
      A_UNCAPPED,
      { lp: "1x participating", seniority: 1, amount: 4_000_000, shares: 4_000_000, cap: 2 },
    ]);
    const b = (await waterfall(co, "5000000000")).body as Body;
    expect(cls(b, 0)).toBe("2000000000");
    expect(cls(b, 1)).toBe("1000000000");
    expect(b.founderProceeds).toBe("2000000000");
    /* The cap forced a CONVERSION rather than binding as a ceiling, so nothing was
       released and nothing was redistributed. */
    expect(b.participationCaps.capBound).toEqual([]);
    expect(b.participationCaps.capForcedConversion.length).toBe(1);
    expect(b.participationCaps.releasedExcessRedistributed).toBe(false);
    expect(conservesTo30(b, "5000000000")).toBe(true);
  }, 120_000);

  it("W94-MNM-W91 · Wave 91's pari passu and participating figures are unmoved", async () => {
    /* $10m at 1x and $5m at 2x are the same $10m claim; a $9m exit pays $4.5m each. */
    const equal = await buildCompany("mnmeq", [
      { lp: "1x non-participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
      { lp: "2x non-participating", seniority: 0, amount: 5_000_000, shares: 2_000_000 },
    ]);
    const e = (await waterfall(equal, "900000000")).body as Body;
    expect(cls(e, 0)).toBe("450000000");
    expect(cls(e, 1)).toBe("450000000");

    /* $15m of equal claims on a $9m exit pays $6m / $3m. */
    const short = await buildCompany("mnmsh", [
      { lp: "1x non-participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
      { lp: "1x non-participating", seniority: 0, amount: 5_000_000, shares: 2_000_000 },
    ]);
    const s = (await waterfall(short, "900000000")).body as Body;
    expect(cls(s, 0)).toBe("600000000");
    expect(cls(s, 1)).toBe("300000000");

    /* Uncapped participating, ample exit: $20m / $10m / $20m. */
    const ample = await buildCompany("mnmam", [A_UNCAPPED, B(undefined)]);
    const a = (await waterfall(ample, "5000000000")).body as Body;
    expect(cls(a, 0)).toBe("2000000000");
    expect(cls(a, 1)).toBe("1000000000");
    expect(a.founderProceeds).toBe("2000000000");

    /* W79-B5: 1x participating $10m rank 0 and 1x non-participating $4m rank 1. */
    const b5 = await buildCompany("mnmb5", [
      A_UNCAPPED,
      { lp: "1x non-participating", seniority: 1, amount: 4_000_000, shares: 4_000_000 },
    ]);
    const f = (await waterfall(b5, "5000000000")).body as Body;
    expect(f.lpProceeds).toBe("3000000000");
    expect(f.founderProceeds).toBe("2000000000");
  }, 180_000);

  /* A cap table with NO cap on record must not even build a redistribution plan, so
     every fixture that computed before this wave is untouched BY CONSTRUCTION. */
  it("W94-CAP-NOOP · with no cap on record the cap machinery does nothing at all", async () => {
    const co = await buildCompany("noop", [A_UNCAPPED, B(undefined)]);
    const b = (await waterfall(co, "5600000000")).body as Body;
    expect(b.participationCaps.anyOnRecord).toBe(false);
    expect(b.participationCaps.capBound).toEqual([]);
    expect(b.participationCaps.releasedExcessMinor).toBe("0");
    expect(b.participationCaps.releasedExcessRedistributed).toBe(false);
    expect(b.participationCaps.residualSharedMinor).toBeNull();
    expect(b.participationCaps.conservationExact).toBe(true);
    expect(b.participationCaps.conservationResidualMinor).toBe("0");
  }, 120_000);
});

describe("W94 · the response says what it did", () => {
  it("W94-CAP-DISC · the cap disclosure names the class, the cap, the source and the money released", async () => {
    const co = await buildCompany("disc", [A_UNCAPPED, B(2)]);
    const b = (await waterfall(co, "5600000000")).body as Body;
    const pc = b.participationCaps;
    expect(pc.classes.length).toBe(2);
    expect(pc.classes[0].onRecord).toBe(false);
    expect(pc.classes[0].capMultiple).toBeNull();
    expect(pc.classes[1].onRecord).toBe(true);
    expect(pc.classes[1].capMultiple).toBe(2);
    expect(pc.classes[1].source).toBe("capParticipation");
    expect(pc.classes[1].capAmountMinor).toBe("1000000000");
    expect(pc.precisionCeiling).toBe("38");
    /* The basis is plain English a founder can read, cites the standard, and holds
       no machine token. */
    expect(pc.basis).toContain("NVCA");
    expect(pc.basis.toLowerCase()).toContain("one price per share");
    expect(pc.basis).not.toMatch(/participationCapMultiple|[A-Z_]{6,}/);
  }, 120_000);
});
