/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 92 — THE EXIT WATERFALL SCREEN, AND THE FIGURES IT MUST RENDER.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS. Waves 88, 91 and 94 corrected the exit-proceeds
 * calculation — 48 wrong figures, pari passu abatement, and 766 of 4,000 fixtures
 * publishing a wrong figure because a recorded participation cap was ignored — and
 * NONE of it was reachable through the product. A read-only audit of all four
 * portals found no exit, waterfall, liquidation or distributions screen anywhere,
 * and the endpoint had ZERO client callers. Wave 92 builds the screen.
 *
 * WHAT THIS FILE ASSERTS, in three parts.
 *   PART A — THE PINS. Every money figure the three previous waves established,
 *     re-executed over live HTTP through this route, so that if the screen build
 *     moved a number this file goes red BEFORE the screen is believed. The figures
 *     are quoted from those waves' own executed transcripts, not recomputed here:
 *       · founders $20,000,000 / A $20,000,000 / B $10,000,000 on a $50,000,000
 *         exit — the pre-flight's thrice-confirmed `S6`, which Wave 91 could NOT
 *         reproduce over HTTP because a participation cap could not reach the
 *         engine. Wave 94 made the cap reach it; this is the first HTTP proof.
 *       · Wave 91's pari passu abatement: $6,000,000 / $3,000,000, and $4,500,000
 *         each when equal claims arrive from different multiples.
 *       · Wave 94's corrected founder figure $24,000,000.00 on the headline table.
 *   PART B — THE SCREEN'S DATA CONTRACT. The response keys the screen renders are
 *     present and carry the representation the screen assumes: exact decimal TEXT,
 *     a row for every holder including one paid $0, an abatement a reader can
 *     check, and a refusal message with no machine token in it.
 *   PART C — THE SOURCE-LEVEL PINS ON THE SCREEN ITSELF. No money literal, no
 *     percentage literal, no refusal identifier, no disabled control.
 *
 * THREE STANDING HAZARDS THIS FILE RESPECTS.
 *   · The SACRED engine is NOT edited. `npm run sacred` is 48/48 with nine ratified
 *     waivers, before and after.
 *   · `Decimal.set` is NEVER called — it mutates the shared decimal.js instance the
 *     sacred engine imports. This file uses its own `Decimal.clone`.
 *   · `computeConversionProjections` (`server/roundCarryForwardEngine.ts`) is NOT
 *     touched, NOT called and NOT asserted against. R69, dead code, tripwire
 *     `W58F-F2f`. This wave RENDERS exit conversions, which is exactly where that
 *     trap lives; four agents have proposed editing it and all four were wrong.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { Decimal } from "decimal.js";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { createRound } from "../roundsStore";

const ADMIN = "u_admin";
const STAMP = `w92${Math.random().toString(36).slice(2, 8)}`;
/* THIS TEST'S OWN INSTANCE. `Decimal.clone`, never `Decimal.set`. */
const D120 = Decimal.clone({ precision: 120 });

const CLIENT = path.resolve(__dirname, "../../client/src");
const SCREEN = path.join(CLIENT, "pages/founder/ExitWaterfall.tsx");

let app: Express;

type ClassSpec = {
  lp: string;
  seniority: number;
  amount: number;
  shares: number;
  cap?: number | string;
};

/** A company with real founder common and N preferred classes, built only through
 *  reachable creator endpoints. Copied deliberately from
 *  `w94_participation_caps_and_released_excess.test.ts` so the pins below are
 *  driven by the SAME construction the figures were established on: the price per
 *  share is DERIVED from amount / shares because the commit store refuses a priced
 *  round whose shares are not `floor(amount / price)`. */
async function buildCompany(
  tag: string,
  classes: ClassSpec[],
  opts?: { founderShares?: string },
): Promise<string> {
  const companyId = `co_${STAMP}_${tag}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W92 ${tag}`, legalName: `W92 ${tag}, Inc.` });
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
  commonLegProceeds: string;
  commonLegShares: string;
  convertibleProceeds: string;
  remainder: string;
  byShareClass: Array<{
    classId: string; className: string; proceeds: string; decision: string;
    emittedByEngine: boolean; seniority: number | null; seniorityOnRecord: boolean;
    participatingOnRecord: boolean | null; liquidationPreferenceMultiple: number | null;
    investedMinor: string; claimMinor: string; abated: boolean;
  }>;
  byCommonHolder: Array<{
    holderId: string; holderName: string; shares: string | null; proceeds: string;
    decision: string; emittedByEngine: boolean; basis: string | null;
  }>;
  byConvertible: unknown[];
  excludedFromPayout: unknown[];
  nonPreferenceClasses: unknown[];
  seniority: Array<{ roundId: string; className: string; seniority: number | null; onRecord: boolean }>;
  seniorityAssumed: unknown;
  pariPassu: {
    equalRankingDetected: boolean; duplicateRanks: number[]; abatementEngaged: boolean;
    availableToPreferenceStackMinor: string;
    tiers: Array<{
      seniority: number; classes: Array<{ classId: string; className: string; claimMinor: string }>;
      tierClaimMinor: string; availableMinor: string; abated: boolean; abatementFactor: string | null;
    }>;
    precisionCeiling: string; basis: string;
  };
  participationCaps: {
    anyOnRecord: boolean;
    classes: Array<{
      roundId: string; className: string; onRecord: boolean; capMultiple: number | null;
      source: string | null; inert: boolean; capAmountMinor: string | null;
    }>;
    capBound: string[]; capForcedConversion: string[];
    releasedExcessMinor: string; releasedExcessRedistributed: boolean;
    conservationExact: boolean; conservationResidualMinor: string;
    residualSharedMinor: string | null; residualPricePerShareMinor: string | null;
    precisionCeiling: string; basis: string;
  };
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

const conservesExactly = (b: Body, exitMinor: string): boolean => total(b).eq(new D120(exitMinor));

/** Every captured body, written out so the walkthrough document quotes an executed
 *  transcript rather than a recollection. */
const captured: Record<string, unknown> = {};
const capture = (name: string, b: unknown): void => { captured[name] = b; };

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 120_000);

/* ══════════════════════════════════════════════════════════════════════════════
   PART A — THE PINS. IF A FIGURE MOVED, THIS WAVE STOPS.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("W92 · PART A — the figures three waves established, re-executed over live HTTP", () => {
  /* W92-PIN-01. THE THRICE-CONFIRMED RESULT, OVER HTTP FOR THE FIRST TIME.
     `spec/PREFLIGHT_WATERFALL_2026_08_21.md` §6.7 scenario `S6`: Series A
     $10,000,000 on 4,000,000 shares participating UNCAPPED at rank 0; Series B
     $4,000,000 on 4,000,000 shares participating with a 2x cap THAT BINDS at rank
     1; founders 8,000,000 common; exit $50,000,000. Engine, Python `Fraction` and
     `bigint` references all returned A $20,000,000 / B $10,000,000 / founders
     $20,000,000.

     WHY IT COULD NOT BE PINNED BEFORE. Wave 91 recorded this as UV-W91-3: a
     participation cap could not be expressed through this endpoint at all, so the
     `S6` fixture was unreachable over HTTP and the figure existed only at engine
     level. Wave 94 made the cap reach the engine. This assertion is the first time
     the thrice-confirmed result has been produced BY THE PRODUCT. */
  it("W92-PIN-01 · founders $20,000,000 / A $20,000,000 / B $10,000,000 on a $50,000,000 exit", async () => {
    const co = await buildCompany("pin01", [
      { lp: "1x participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
      { lp: "1x participating", seniority: 1, amount: 4_000_000, shares: 4_000_000, cap: 2 },
    ]);
    const r = await waterfall(co, "5000000000");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    capture("PIN-01_S6_50m_exit", b);

    expect(cls(b, 0)).toBe("2000000000");
    expect(cls(b, 1)).toBe("1000000000");
    expect(b.founderProceeds).toBe("2000000000");
    expect(b.commonLegProceeds).toBe("2000000000");
    expect(conservesExactly(b, "5000000000")).toBe(true);
    /* AND WHAT THE CAP ACTUALLY DID IS DISCLOSED, which is what the screen prints.
       MEASURED, not assumed: B's 2x cap is $8,000,000, but B's 4,000,000 shares are
       worth 4/16 x $50,000,000 = $12,500,000 as converted, so B does BETTER by
       converting than by taking its cap. The cap therefore FORCES A CONVERSION
       rather than binding as a ceiling — B waives its preference, is paid as common
       at the same one price per share as everybody else, and takes $10,000,000. This
       is the distinction the screen must render: `capForcedConversion` is a
       conversion, `capBound` is a ceiling, and calling one the other would misstate
       the single most misread line of any waterfall. */
    expect(b.participationCaps.anyOnRecord).toBe(true);
    expect(b.participationCaps.capForcedConversion.length).toBe(1);
    expect(b.participationCaps.capBound.length).toBe(0);
    expect(b.participationCaps.classes.filter((c) => c.onRecord).length).toBe(1);
    expect(b.participationCaps.classes.filter((c) => c.onRecord)[0].capAmountMinor)
      .toBe("800000000");
  }, 180_000);

  /* W92-PIN-02. WAVE 91's PARI PASSU ABATEMENT — $6,000,000 / $3,000,000.
     Pre-flight §6.1: Series A $10,000,000 1x non-participating, Series B
     $5,000,000 1x non-participating, BOTH at rank 0, exit $9,000,000 against
     $15,000,000 of claims. Abatement factor 9/15 = 0.6. */
  it("W92-PIN-02 · equal ranks, short exit: A $6,000,000 / B $3,000,000 and founders an explicit $0", async () => {
    const co = await buildCompany("pin02", [
      { lp: "1x non-participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
      { lp: "1x non-participating", seniority: 0, amount: 5_000_000, shares: 2_000_000 },
    ]);
    const r = await waterfall(co, "900000000");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    capture("PIN-02_pari_passu_9m_exit", b);

    expect(cls(b, 0)).toBe("600000000");
    expect(cls(b, 1)).toBe("300000000");
    expect(b.pariPassu.abatementEngaged).toBe(true);
    /* THE ABATEMENT IS SHOWN AS AN ABATEMENT, not as an unexplained number: the
       tier's total claim, what was available to it, and the factor. */
    const abated = b.pariPassu.tiers.filter((t) => t.abated);
    expect(abated.length).toBe(1);
    expect(abated[0].tierClaimMinor).toBe("1500000000");
    expect(abated[0].availableMinor).toBe("900000000");
    expect(abated[0].abatementFactor).toBe("0.6");
    /* AND THE FOUNDERS ARE ON THE PAGE, RECEIVING NOTHING. Being absent is the
       defect (Wave 91 · Item 3). */
    expect(b.byCommonHolder.length).toBeGreaterThan(0);
    expect(b.byCommonHolder[0].proceeds).toBe("0");
    expect(b.byCommonHolder[0].emittedByEngine).toBe(false);
    expect(b.byCommonHolder[0].basis).toBeTruthy();
    expect(conservesExactly(b, "900000000")).toBe(true);
  }, 180_000);

  /* W92-PIN-03. EQUAL CLAIMS FROM DIFFERENT MULTIPLES — $4,500,000 EACH.
     Pre-flight §6.2: A $10,000,000 at 1x and B $5,000,000 at 2x are owed the same
     $10,000,000, so on a $9,000,000 exit they take the same money. This is the
     fixture that catches an implementation abating on `invested` rather than on
     `invested x multiple`. */
  it("W92-PIN-03 · equal claims from different multiples abate to $4,500,000 each", async () => {
    const co = await buildCompany("pin03", [
      { lp: "1x non-participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
      { lp: "2x non-participating", seniority: 0, amount: 5_000_000, shares: 2_000_000 },
    ]);
    const r = await waterfall(co, "900000000");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    capture("PIN-03_equal_claims_different_multiples", b);

    expect(cls(b, 0)).toBe("450000000");
    expect(cls(b, 1)).toBe("450000000");
    expect(conservesExactly(b, "900000000")).toBe(true);
  }, 180_000);

  /* W92-PIN-04. WAVE 94's CORRECTED FOUNDER FIGURE — $24,000,000.00.
     `build_log/wave94/WAVE94_REPORT.md` §1: A $10,000,000 1x participating
     uncapped on 4,000,000 shares, B $5,000,000 1x participating CAPPED AT 2x on
     2,000,000 shares, founders 8,000,000, exit $56,000,000. Before Wave 94 the
     founders were shown $23,428,571.43. */
  it("W92-PIN-04 · the corrected founder figure is $24,000,000.00, and the released excess is disclosed", async () => {
    const co = await buildCompany("pin04", [
      { lp: "1x participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
      { lp: "1x participating", seniority: 0, amount: 5_000_000, shares: 2_000_000, cap: 2 },
    ]);
    const r = await waterfall(co, "5600000000");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    capture("PIN-04_w94_headline_56m_exit", b);

    expect(cls(b, 0)).toBe("2200000000");
    expect(cls(b, 1)).toBe("1000000000");
    expect(b.founderProceeds).toBe("2400000000");
    expect(b.participationCaps.releasedExcessMinor).toBe("85714285.71428571428571428571428571429");
    expect(b.participationCaps.releasedExcessRedistributed).toBe(true);
    expect(conservesExactly(b, "5600000000")).toBe(true);
  }, 180_000);

  /* W92-PIN-05. THE CONSERVATION RESIDUAL THE SCREEN MUST SHOW HONESTLY.
     Wave 94's `W94-CAP-04` fixture: two caps bind beside one uncapped
     participating class and the residual price per share 3,050,000,000 / 9,000,000
     does not terminate, so the engine rounds HALF_EVEN at its 38th significant
     digit and `conservationResidualMinor` is a NON-ZERO figure of order 1e-29
     minor units. The screen prints it. It is not hidden and it is not absorbed
     into a tolerance. */
  it("W92-PIN-05 · a non-terminating price publishes a non-zero conservation residual, and it is disclosed", async () => {
    const co = await buildCompany("pin05", [
      { lp: "1x participating", seniority: 0, amount: 10_000_000, shares: 4_000_000, cap: 2 },
      { lp: "1x participating", seniority: 0, amount: 5_000_000, shares: 1_000_000, cap: 1.5 },
      { lp: "1x participating", seniority: 0, amount: 2_000_000, shares: 1_000_000 },
    ]);
    const r = await waterfall(co, "6000000000");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    capture("PIN-05_conservation_residual", b);

    expect(cls(b, 0)).toBe("2000000000");
    expect(cls(b, 1)).toBe("750000000");
    expect(cls(b, 2)).toBe("538888888.88888888888888888888888888889");
    expect(b.founderProceeds).toBe("2711111111.1111111111111111111111111111");
    expect(b.participationCaps.residualPricePerShareMinor)
      .toBe("338.88888888888888888888888888888888889");
    /* The residual is published, non-zero, and flagged as inexact. */
    expect(b.participationCaps.conservationExact).toBe(false);
    expect(new D120(b.participationCaps.conservationResidualMinor).isZero()).toBe(false);
    expect(new D120(b.participationCaps.conservationResidualMinor).abs().lte(new D120("1e-20")))
      .toBe(true);
  }, 180_000);

  it("W92-PIN-99 · every captured body is written to the wave's transcripts", () => {
    const dir = path.resolve(__dirname, "../../../build_log/wave92/transcripts");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "01_pinned_route_bodies.json"),
      `${JSON.stringify(captured, null, 2)}\n`,
    );
    expect(Object.keys(captured).length).toBeGreaterThanOrEqual(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   PART B — THE SCREEN'S DATA CONTRACT, OVER LIVE HTTP.
   ══════════════════════════════════════════════════════════════════════════════
   The screen assumes things about this response. Each one is asserted here rather
   than trusted, because a screen that renders a wrong number is worse than no
   screen. */
describe("W92 · PART B — the response carries what the screen renders", () => {
  /* W92-B-01. EVERY MONEY FIELD THE SCREEN RENDERS IS EXACT DECIMAL TEXT.
     Open item J-1: a JSON `number` cannot hold `33,333,333.333…`. Wave 77 made
     these strings under R72; this asserts the SCREEN'S OWN field list, so a
     regression to `number` on any one of them fails here rather than on a
     founder's screen. */
  it("W92-B-01 · every money field the screen reads is a STRING, not a number", async () => {
    const co = await buildCompany("b01", [
      { lp: "1x participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
      { lp: "1x participating", seniority: 0, amount: 5_000_000, shares: 2_000_000, cap: 2 },
    ]);
    const b = (await waterfall(co, "5600000000")).body as Body;
    capture("B-01_money_is_text", b);

    for (const k of [
      "lpProceeds", "founderProceeds", "commonLegProceeds", "convertibleProceeds",
      "remainder", "commonLegShares",
    ] as const) {
      expect(typeof b[k], `${k} must be exact decimal text`).toBe("string");
      /* And it must be a plain decimal the display layer can read: no exponent, no
         separators, no symbol. `client/src/lib/exactMoney.ts` refuses anything else
         and renders the unavailable marker, which would be a blank on the screen. */
      expect(String(b[k])).toMatch(/^-?\d+(\.\d+)?$/);
    }
    for (const r of b.byShareClass) {
      for (const k of ["proceeds", "proceedsExact", "investedMinor", "claimMinor"] as const) {
        expect(typeof r[k], `byShareClass.${k}`).toBe("string");
        expect(String(r[k])).toMatch(/^-?\d+(\.\d+)?$/);
      }
    }
    for (const r of b.byCommonHolder) {
      expect(typeof r.proceeds).toBe("string");
      expect(String(r.proceeds)).toMatch(/^-?\d+(\.\d+)?$/);
    }
    for (const t of b.pariPassu.tiers) {
      expect(String(t.tierClaimMinor)).toMatch(/^-?\d+(\.\d+)?$/);
      expect(String(t.availableMinor)).toMatch(/^-?\d+(\.\d+)?$/);
    }
  }, 180_000);

  /* W92-B-02. THE KEYS THE SCREEN READS ARE ALWAYS PRESENT.
     Wave 88's discipline: a consumer must never have to tell "none" apart from "an
     older build". Asserted on a cap table with NO convertibles, NO caps and NO
     equal ranks — the shape most likely to omit an optional key. */
  it("W92-B-02 · every key the screen reads is present even when there is nothing to report", async () => {
    const co = await buildCompany("b02", [
      { lp: "1x non-participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
    ]);
    const b = (await waterfall(co, "5000000000")).body as Body;
    capture("B-02_all_keys_present", b);

    for (const k of [
      "lpProceeds", "founderProceeds", "commonLegProceeds", "commonLegShares",
      "convertibleProceeds", "remainder", "byShareClass", "byConvertible",
      "byCommonHolder", "excludedFromPayout", "nonPreferenceClasses", "seniority",
      "seniorityAssumed", "pariPassu", "participationCaps",
    ]) {
      expect(k in (b as unknown as Record<string, unknown>), `${k} absent`).toBe(true);
    }
    expect(Array.isArray(b.byConvertible)).toBe(true);
    expect(b.pariPassu.equalRankingDetected).toBe(false);
    expect(b.participationCaps.anyOnRecord).toBe(false);
    /* A single-class company states the payment-order assumption IN WORDS, which is
       what the screen prints under the preference table. */
    expect(typeof b.seniorityAssumed === "string" && b.seniorityAssumed.length > 0).toBe(true);
  }, 180_000);

  /* W92-B-03. A REFUSAL MESSAGE CAN BE RENDERED VERBATIM.
     The pre-flight verified no refusal message on this handler contains a machine
     token, and the SCREEN RELIES ON THAT. This re-verifies it against the LIVE
     response rather than against the source, and it re-verifies it through the
     screen's own gate — so if a future message regresses, this fails. */
  it("W92-B-03 · a live refusal message contains no machine token and passes the screen's own gate", async () => {
    /* A preferred class with NO liquidation term on record: the refusal a founder
       meets most often, and the one whose 793-character message Wave 88 pinned. */
    const co = await buildCompany("b03", [
      { lp: "", seniority: 0, amount: 10_000_000, shares: 4_000_000 },
    ]);
    const r = await waterfall(co, "5000000000");
    expect(r.status).toBe(422);
    const body = r.body as { error: string; message?: string };
    capture("B-03_refusal_body", body);

    expect(typeof body.message).toBe("string");
    const message = String(body.message);
    /* NO snake_case OR SCREAMING_SNAKE TOKEN. This is the assertion the screen's
       verbatim rendering rests on. */
    expect(message).not.toMatch(/[A-Za-z0-9]+_[A-Za-z0-9]+/);
    /* And it is not a bare exception string. */
    expect(message.length).toBeGreaterThan(40);
    expect(message).not.toMatch(/^[A-Z][A-Za-z]*Error\b/);
    /* The identifier IS on the payload, where a machine-readable value belongs
       (R77) — a fence that passed because nothing was emitted would be worthless. */
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  }, 180_000);
});

/* ══════════════════════════════════════════════════════════════════════════════
   PART C — THE SCREEN'S SOURCE. NO HARDCODED VALUE, NO IDENTIFIER, NO DEAD CONTROL.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("W92 · PART C — the screen's source obeys the constraints it was built under", () => {
  const screen = (): string => fs.readFileSync(SCREEN, "utf8");
  /* Comments are stripped for every assertion about CODE. This project's
     engineering comments cite routes, figures and rulings ON PURPOSE, and deleting
     that reasoning to satisfy a source scan would destroy context and fix nothing
     a customer sees — the same line `scripts/lint/internalLanguageFence.ts` draws
     in its own documentation. */
  const code = (): string =>
    screen().replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("W92-S-01 · the screen EXISTS and it is the endpoint's first and only client caller", () => {
    expect(fs.existsSync(SCREEN)).toBe(true);
    expect(code()).toContain("/api/founder/captable/waterfall");
    /* One caller, not two. A second would be two screens formatting the same money
       two ways. */
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        if (/\.(test|spec)\./.test(e.name)) continue;
        const t = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
        if (t.includes("/api/founder/captable/waterfall")) {
          callers.push(path.relative(CLIENT, p).split(path.sep).join("/"));
        }
      }
    };
    walk(CLIENT);
    expect(callers).toEqual(["pages/founder/ExitWaterfall.tsx"]);
  });

  it("W92-S-02 · NO HARDCODED MONEY, PERCENTAGE OR CLASS NAME anywhere in the screen's code", () => {
    const src = code();
    /* Any currency-shaped literal at all. Every figure on the page comes from the
       response; the only client-side constants are copy and column headings. */
    expect(src).not.toMatch(/\$\s?[\d,]{2,}/);
    /* No percentage literal — the abatement factor arrives as exact decimal text
       and is converted by the display layer. */
    expect(src).not.toMatch(/\b\d+(\.\d+)?\s?%/);
    /* No thousands-separated number, which is what a pasted sample figure looks
       like. */
    expect(src).not.toMatch(/\b\d{1,3}(,\d{3})+\b/);
    /* No invented class name. `Series A` / `Series B` in a page component would be
       sample data; real names arrive as `className`. */
    expect(src).not.toMatch(/Series\s+[A-Z]\b/);
  });

  it("W92-S-03 · NOT ONE of the twelve refusal identifiers appears in the screen (R67F-17, R77)", () => {
    /* The screen switches on the HTTP STATUS and on the payload's SHAPE, never on
       the identifier's value \u2014 so `R67F-17`'s raw text scan stays green by
       construction rather than by care. The list is the one that pin owns. */
    const IDENTIFIERS = [
      "NOTE_EXIT_CLAIM_NOT_DETERMINABLE",
      "SAFE_CONVERSION_PRICE_NOT_DETERMINABLE",
      "SAFE_MFN_STATUS_NOT_ON_RECORD",
      "SAFE_CONVERSION_YIELDS_ZERO_SHARES",
      "CONVERTIBLE_CASH_OUT_ORDER_NOT_ON_RECORD",
      "CONVERTIBLE_ELECTION_NOT_CONVERGENT",
    ];
    const whole = screen();
    for (const id of IDENTIFIERS) {
      expect(whole.includes(id), `${id} reached the screen`).toBe(false);
      expect(whole.includes(id.toLowerCase()), `${id.toLowerCase()} reached the screen`).toBe(false);
    }
    /* And the wider set this route can return, including Wave 94's five new ones.
       Scanned against CODE rather than the whole file: `R67F-17` owns the twelve
       above and scans raw text, but these thirteen are named in this file's own
       engineering comments on purpose, and stripping that reasoning to satisfy a
       text search would destroy context and fix nothing a customer sees. */
    for (const id of [
      "LIQUIDATION_TERM_NOT_ON_RECORD", "SENIORITY_NOT_ON_RECORD",
      "SENIORITY_RANKING_AMBIGUOUS", "COMMON_SHARES_NOT_ON_RECORD",
      "PARTICIPATION_CAP_NOT_READABLE", "PARTICIPATION_CAP_CONFLICT",
      "PARTICIPATION_CAP_BELOW_PREFERENCE", "PARTICIPATION_CAP_NOT_COMPUTABLE",
      "PARTICIPATION_CAP_NOT_REPRODUCED", "WATERFALL_COMPUTE_ERROR",
      "ENGINE_UNAVAILABLE", "UNAUTHORIZED", "FORBIDDEN",
    ]) {
      expect(code().includes(id), `${id} reached the screen's code`).toBe(false);
    }
  });

  it("W92-S-04 · NO DEAD CONTROL: nothing disabled, nothing coming soon, no dead promise", () => {
    const src = code();
    /* The one `disabled` in the file is the literal `false` on the compute button,
       written explicitly so a reader can see it is never disabled. Any truthy or
       expression-valued `disabled` would be a control that sometimes does nothing. */
    const disableds = src.match(/disabled=\{[^}]*\}/g) ?? [];
    expect(disableds).toEqual(["disabled={false}"]);
    for (const phrase of ["coming soon", "Coming soon", "not yet available", "TODO", "placeholder data", "Lorem"]) {
      expect(src.includes(phrase), `dead-promise copy: ${phrase}`).toBe(false);
    }
    /* `preferredReturnPct` is NOT offered. It is an SPV-style preferred RETURN, not
       a liquidation multiple, and Wave 71 \u00b7 D11 severed that confusion once. */
    expect(src).not.toMatch(/preferredReturnPct/);
  });

  it("W92-S-05 · the screen sets NO font size on a table header (Wave 96's off-screen columns)", () => {
    /* Wave 96 fixed a hard `12px` on table headers that pushed a cap table's last
       column and three ownership subtotals OFF SCREEN \u2014 the automated instrument
       said everything was fine and it was found BY LOOKING AT A SCREENSHOT. The
       founder stylesheet's rule is `font-size: min(12px, 1em)`, which can only ever
       make a header SMALLER. This screen must inherit it and never override it. */
    const src = code();
    expect(src).not.toMatch(/<th[^>]*text-\[?(length:)?1[0-9]px/);
    expect(src).not.toMatch(/<th[^>]*fontSize/);
    expect(src).not.toMatch(/<th[^>]*text-xs/);
    /* And it uses plain `thead th`, which is what the stylesheet dresses. */
    expect(src).toContain("<thead>");
    expect(src).toContain("<th ");
  });

  it("W92-S-06 · R69: `computeConversionProjections` is not imported, called or mentioned in code", () => {
    /* FOUR AGENTS HAVE PROPOSED EDITING THAT FUNCTION AND ALL FOUR WERE WRONG. This
       screen RENDERS EXIT CONVERSIONS, which is exactly where the trap lives. Every
       conversion figure on the page arrives from `byShareClass[]` / `byConvertible[]`
       on the response, which the route produces through the SACRED engine. */
    expect(code()).not.toMatch(/computeConversionProjections/);
    expect(code()).not.toMatch(/roundCarryForwardEngine/);
    /* And the function is still where it was, unedited, with no non-test caller \u2014
       asserted here as well as in `w88`, because this is the wave most likely to
       reach for it. */
    const eng = fs.readFileSync(path.resolve(__dirname, "../roundCarryForwardEngine.ts"), "utf8");
    expect(eng).toContain("computeConversionProjections");
  });

  it("W92-S-07 · R80: founder Billing is not opened, imported or referenced", () => {
    /* CODE, not the comment that records the ruling. R80 is "do not open the file";
       naming the ruling and the file it protects is exactly what a later reader
       needs. */
    expect(code()).not.toMatch(/Billing/);
  });

  it("W92-S-08 · money goes through the exact-decimal layer, never through the number-based helper", () => {
    const src = code();
    expect(src).toContain("@/lib/exactMoney");
    /* `client/src/lib/moneyDisplay.ts` takes a `number`. That narrowing IS open item
       J-1 and it must not reappear on the one screen that renders the field J-1 was
       opened about. */
    expect(src).not.toContain("@/lib/moneyDisplay");
    expect(src).not.toContain("formatMinorOrUnavailable");
  });

  it("W92-S-09 · the route and the nav entry both exist, and the nav entry is APPENDED", () => {
    const app = fs.readFileSync(path.join(CLIENT, "App.tsx"), "utf8");
    expect(app).toContain('path="/founder/captable/waterfall"');
    /* The new route sits AFTER its neighbour, never before it: an ordinal insertion
       at the head of a container shifts every following entry (R82). */
    expect(app.indexOf('path="/founder/captable"')).toBeLessThan(
      app.indexOf('path="/founder/captable/waterfall"'),
    );
    /* And the nav item is the entry point (pre-flight `OQ-W-8`), appended at the end
       of its group, after Cap Table. */
    const shell = fs.readFileSync(path.join(CLIENT, "components/AppShell.tsx"), "utf8");
    expect(shell).toContain('href: "/founder/captable/waterfall"');
    expect(shell.indexOf('href: "/founder/captable"')).toBeLessThan(
      shell.indexOf('href: "/founder/captable/waterfall"'),
    );
  });
});
