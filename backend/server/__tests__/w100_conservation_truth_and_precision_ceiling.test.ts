/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 100 — TRUTHFUL CONSERVATION, THE MEASURED PRECISION CEILING, AND MONEY
 * THAT IS REFUSED RATHER THAN NARROWED.
 * ══════════════════════════════════════════════════════════════════════════════
 * Three findings, ONE defect class: the platform asserted something FALSE about
 * its own arithmetic.
 *
 *   1. `conservationExact` was INITIALISED to `true` and `conservationResidualMinor`
 *      to `"0"`, and only the cap-REWRITE branch ever summed anything. An
 *      independent reviewer re-summed 22 published bodies and found SIX whose legs
 *      did not add to the sale price while the payload said they did
 *      (`build_log/final_review_2026_08_21/reviewerA/transcripts/06_independent_conservation_check.txt`,
 *      reproduced by this wave in `build_log/wave100/transcripts/08_conservation_check_BEFORE.txt`).
 *   2. A 39-or-more significant-digit exit valuation was ACCEPTED, changed by one
 *      minor unit, returned HTTP 200 and described as exactly conserving; the cap
 *      self-check — built to refuse rather than publish an unprovable split —
 *      published it, because every term in the check was derived from the already
 *      rounded value. MEASURED boundary: `transcripts/01_precision_ceiling_measured.txt`
 *      and `02_digit_sweep_BEFORE.txt` — exact to 38 significant digits, one minor
 *      unit out from 39. Reviewer A's first demonstrated failure was 41.
 *   3. `parseInt` on a money field in two partner screens
 *      (`client/src/pages/partner/PartnerSpvs.tsx`, `PartnerFunds.tsx`).
 *
 * THREE STANDING HAZARDS THIS FILE RESPECTS.
 *   · The SACRED engine is NOT edited, NOT expected to change, and its 38-digit
 *     ceiling is READ here, never altered. `npm run sacred` is 48/48, nine ratified
 *     waivers.
 *   · `Decimal.set` is NEVER called — it mutates the shared decimal.js instance the
 *     sacred engine imports. This file uses its own `Decimal.clone`.
 *   · `computeConversionProjections` (`server/roundCarryForwardEngine.ts` ~`:770`)
 *     is not touched, not called and not asserted against (R69), and neither is the
 *     `mfn` reader at `:335`/`:430` in the same sacred file.
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
import { wireSafeMinorUnits } from "../../client/src/lib/wireSafeMinorUnits";

const ADMIN = "u_admin";
const STAMP = `w100${Math.random().toString(36).slice(2, 8)}`;
/* THIS TEST'S OWN INSTANCE. `Decimal.clone`, never `Decimal.set`. */
const D120 = Decimal.clone({ precision: 120, toExpNeg: -9e15, toExpPos: 9e15 });

let app: Express;

type ClassSpec = { lp: string; seniority: number; amount: number; shares: number; cap?: number | string };

/** Harness shape is Wave 94's, reused rather than rewritten: real company, real
 *  founder common through the named reachable creator, real priced rounds through
 *  `POST /api/rounds` with the platform's own fences, real committed positions. */
async function buildCompany(tag: string, classes: ClassSpec[], founderShares = "8000000"): Promise<string> {
  const companyId = `co_${STAMP}_${tag}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W100 ${tag}`, legalName: `W100 ${tag}, Inc.` });
  expect(co.status, `company create ${tag}`).toBeLessThan(400);
  const foundationId = createRound({
    companyId, name: `${STAMP} foundation ${tag}`, type: "foundation",
    instrument: "common", pricePerShare: null, actorUserId: ADMIN,
  } as never).id;
  const seeded = await request(app).post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({
      companyId, roundId: foundationId, shares: founderShares, amount: "8000", currency: "USD",
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
    expect(created.status, `round create ${tag}${i}`).toBe(200);
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
  remainder: string;
  byShareClass: Array<{ classId: string; className: string; proceeds: string }>;
  byCommonHolder: Array<{ holderId: string; proceeds: string }>;
  participationCaps: {
    conservationExact: boolean;
    conservationResidualMinor: string;
    conservationScope: string;
    capRewriteConservationExact: boolean;
    capRewriteConservationResidualMinor: string;
    precisionCeiling: string;
    precisionCeilingSignificantDigitsMeasured: string;
  };
};

/** Σ every published figure + remainder, INDEPENDENTLY of the payload's own claim.
 *  This is the whole point of §1: the test does the sum itself and then asks the
 *  response whether it agrees. */
const resum = (b: Body): Decimal =>
  b.byShareClass.reduce<Decimal>((a, r) => a.plus(new D120(r.proceeds)), new D120(0))
    .plus(b.byCommonHolder.reduce<Decimal>((a, r) => a.plus(new D120(r.proceeds)), new D120(0)))
    .plus(new D120(b.remainder));

const A_UNCAPPED: ClassSpec = { lp: "1x participating", seniority: 0, amount: 10_000_000, shares: 4_000_000 };
const B = (cap?: number | string): ClassSpec =>
  ({ lp: "1x participating", seniority: 0, amount: 5_000_000, shares: 2_000_000, ...(cap === undefined ? {} : { cap }) });

const routeSrc = (): string =>
  fs.readFileSync(path.resolve(__dirname, "../track1Routes.ts"), "utf8");
/** COMMENTS STRIPPED, exactly as `W77-M3` and `R67F-19` do it and for the same
 *  reason: this platform's source documents every removed defect BY NAME, and
 *  deleting the history to turn a fence green would be the opposite of the point.
 *  A fence on CODE must therefore read code. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const clientSrc = (rel: string): string =>
  fs.readFileSync(path.resolve(__dirname, `../../client/src/${rel}`), "utf8");

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 120_000);

/* ═══════════════════════════════════════════════════════════════════════════
   §1 — THE METADATA STATES WHAT WAS MEASURED, ON EVERY BRANCH.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W100 · ITEM 1 — conservation metadata is measured, not initialised", () => {
  /* THE EXACT SHAPE REVIEWER A CAUGHT. `W94-CAP-03-just-fails`: a 2x cap that does
     NOT bind, one minor unit below the boundary, so the cap-rewrite branch never
     runs — which is precisely why the old code published `exact: true` / `"0"`
     without summing anything. Independently re-summed residual: `+4E-29`. */
  it("W100-C1 · a NON-rewrite response publishes the residual its own rows actually carry", async () => {
    const co = await buildCompany("c1", [A_UNCAPPED, B(2)]);
    const r = await waterfall(co, "4999999999");
    expect(r.status).toBe(200);
    const b = r.body as Body;

    const measured = resum(b).minus(new D120("4999999999"));
    /* The response's own claim must EQUAL the independent re-sum, digit for digit. */
    expect(new D120(b.participationCaps.conservationResidualMinor).eq(measured)).toBe(true);
    expect(b.participationCaps.conservationExact).toBe(measured.isZero());
    /* AND ON THIS FIXTURE THE RESIDUAL IS NOT ZERO — so the old `true`/`"0"` was a
       false statement, not a harmless default. */
    expect(measured.isZero()).toBe(false);
    expect(b.participationCaps.conservationExact).toBe(false);
    /* It is a rounding artefact of a non-terminating price, NOT money: far below one
       payable minor unit. The measured bound across 4,000 sweep fixtures is 1.5e-27
       (`build_log/wave100/W100_CONSERVATION.md`). */
    expect(measured.abs().lt(new D120("1e-20"))).toBe(true);
  }, 180_000);

  /* A response whose figures DO terminate must still say `true` — the fix is not
     "always claim inexact", it is "state the measurement". */
  it("W100-C2 · a response whose rows terminate still reports exact conservation", async () => {
    const co = await buildCompany("c2", [A_UNCAPPED, B(undefined)]);
    const r = await waterfall(co, "5000000000");
    expect(r.status).toBe(200);
    const b = r.body as Body;
    const measured = resum(b).minus(new D120("5000000000"));
    expect(measured.isZero()).toBe(true);
    expect(b.participationCaps.conservationExact).toBe(true);
    expect(b.participationCaps.conservationResidualMinor).toBe("0");
  }, 180_000);

  /* NOTHING WAS DROPPED. The cap-rewrite pass's own self-check figure — the number
     Wave 94 published in this field — is still published, under its own name. */
  it("W100-C3 · the cap-rewrite pass's own residual is still published, additively", async () => {
    const co = await buildCompany("c3", [A_UNCAPPED, B(2)]);
    const b = (await waterfall(co, "5600000000")).body as Body;
    const pc = b.participationCaps;
    expect(typeof pc.capRewriteConservationExact).toBe("boolean");
    expect(typeof pc.capRewriteConservationResidualMinor).toBe("string");
    expect(pc.conservationScope).toContain("as submitted");
    /* And the pinned Wave 94 figures did not move. */
    expect(b.founderProceeds).toBe("2400000000");
  }, 180_000);

  it("W100-C4 · the route no longer initialises the published claim from a constant", () => {
    const s = routeSrc();
    /* The two published fields are assigned from the MEASUREMENT. */
    expect(s).toContain("conservationExact: measuredConservationExact,");
    expect(s).toContain("conservationResidualMinor: measuredConservationResidualMinor,");
    /* The measurement sums the published rows, the remainder AND any cash-out. */
    expect(s).toContain("const publishedTotalDec = exactSum(payouts)");
    expect(s).toContain(".plus(new MoneyDec(engineRemainder))");
    expect(s).toContain(".plus(publishedCashOutTotalDec);");
    /* And it is compared against the SUBMITTED exit, not the engine's rounded one. */
    expect(s).toContain("publishedTotalDec.minus(new MoneyDec(exitMinor))");
    /* The summer is still the module-local clone and the shared instance is untouched.
       A CALL, not the word: the file warns about `Decimal.set` by name in prose. */
    expect(stripComments(s)).not.toMatch(/Decimal\s*\.\s*set\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — THE MEASURED PRECISION CEILING, AND THE REFUSAL AT IT.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W100 · ITEM 2 — an exit the platform cannot represent is refused", () => {
  it("W100-P1 · 38 significant digits — the measured ceiling — still computes and conserves exactly", async () => {
    const co = await buildCompany("p1", []);
    const input = "9".repeat(38);
    const r = await waterfall(co, input);
    expect(r.status).toBe(200);
    const b = r.body as Body;
    expect(b.founderProceeds).toBe(input);
    expect(resum(b).eq(new D120(input))).toBe(true);
    expect(b.participationCaps.conservationExact).toBe(true);
  }, 180_000);

  /* THE BOUNDARY, AT THE DIGIT IT WAS MEASURED AT. 39 is the first length the
     engine moves; reviewer A's counterexample was 41, and a refusal placed at 41
     would have shipped two silently wrong lengths. */
  it("W100-P2 · 39 significant digits is REFUSED by name, with the limit stated", async () => {
    const co = await buildCompany("p2", []);
    const r = await waterfall(co, "9".repeat(39));
    expect(r.status).toBe(422);
    const b = r.body as Record<string, unknown>;
    expect(b.error).toBe("EXIT_VALUATION_EXCEEDS_PRECISION_CEILING");
    expect(b.refusalName).toBe("exit_valuation_exceeds_precision_ceiling");
    expect(b.field).toBe("exitValuationMinor");
    expect(b.submittedSignificantDigits).toBe("39");
    expect(b.precisionCeilingSignificantDigits).toBe("38");
    /* The prose says what to do about it and never quotes an internal identifier
       (R77). */
    expect(String(b.message)).toContain("significant digits");
    expect(String(b.message)).not.toContain("EXIT_VALUATION");
  }, 180_000);

  it("W100-P3 · reviewer A's 41-digit counterexample is refused, and nothing is published", async () => {
    const co = await buildCompany("p3", []);
    const r = await waterfall(co, "9".repeat(41));
    expect(r.status).toBe(422);
    const b = r.body as Record<string, unknown>;
    expect(b.refusalName).toBe("exit_valuation_exceeds_precision_ceiling");
    /* No figure of any kind is emitted with a refusal: there is nothing for a screen
       to render above the sale price. */
    expect(b.founderProceeds).toBeUndefined();
    expect(b.byCommonHolder).toBeUndefined();
    expect(b.participationCaps).toBeUndefined();
  }, 180_000);

  it("W100-P4 · the same refusal fires on the CAPPED route, which reviewer A defeated", async () => {
    const co = await buildCompany("p4", [A_UNCAPPED, B(2)]);
    const r = await waterfall(co, "9".repeat(41));
    expect(r.status).toBe(422);
    expect((r.body as Record<string, unknown>).refusalName)
      .toBe("exit_valuation_exceeds_precision_ceiling");
  }, 180_000);

  it("W100-P5 · the ceiling is READ off the constructors, never hardcoded, and the engine is not edited", () => {
    const s = routeSrc();
    expect(s).toContain("const engineMatchCeiling = EngineMatchDec.precision;");
    expect(s).toContain("const sharedCeiling = Decimal.precision;");
    expect(s).toContain("Math.min(engineMatchCeiling, sharedCeiling)");
    /* The round trip is the test, not a digit count comparison against a literal. */
    expect(s).toContain("new EngineMatchDec(exitMinor).plus(0).toFixed()");
    expect(s).toContain("new Decimal(exitMinor).plus(0).toFixed()");
  });

  it("W100-P6 · the self-check now has the SUBMITTED value as a term, and refuses in absolute minor units", () => {
    const s = routeSrc();
    expect(s).toContain("const cappedVsSubmitted = cappedTotal.plus(cappedCashOutTotal).minus(new MoneyDec(exitMinor));");
    expect(s).toContain("cappedVsSubmitted.abs().lt(new MoneyDec(1))");
    expect(s).toContain("allocation_does_not_reproduce_submitted_exit");
    /* The universal net, on every branch rather than only the rewrite. */
    expect(s).toContain("measuredConservationResidualDec.abs().gte(new MoneyDec(1))");
    expect(s).toContain("WATERFALL_ALLOCATION_NOT_CONSERVING");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — MONEY IS REFUSED AT THE CLIENT BOUNDARY, NOT NARROWED THROUGH A DOUBLE.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W100 · ITEM 3 — parseInt on SPV money", () => {
  it("W100-M1 · the exact boundary reviewer A executed is refused, not silently changed", () => {
    /* 2^53 + 1. This is the value that arrived as ...992 on the wire. */
    const r = wireSafeMinorUnits("9007199254740993");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("9007199254740992");
      expect(r.reason).toContain("cannot be sent without being changed");
    }
  });

  it("W100-M2 · a figure the wire CAN carry exactly is accepted unchanged", () => {
    for (const v of ["0", "1", "5000000", "9007199254740992"]) {
      const r = wireSafeMinorUnits(v);
      expect(r.ok, v).toBe(true);
      if (r.ok) expect(String(r.value)).toBe(v);
    }
  });

  it("W100-M3 · a figure large enough to become an exponent is refused", () => {
    const r = wireSafeMinorUnits("1000000000000000000000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("1e+21");
  });

  it("W100-M4 · non-digits and empty input are refused by name, and leading zeros are not a different number", () => {
    expect(wireSafeMinorUnits("").ok).toBe(false);
    expect(wireSafeMinorUnits("1,000").ok).toBe(false);
    expect(wireSafeMinorUnits("-5").ok).toBe(false);
    expect(wireSafeMinorUnits("1.5").ok).toBe(false);
    const z = wireSafeMinorUnits("000500");
    expect(z.ok).toBe(true);
    if (z.ok) expect(z.value).toBe(500);
  });

  it("W100-M5 · neither partner screen narrows the money field any more", () => {
    for (const f of ["pages/partner/PartnerSpvs.tsx", "pages/partner/PartnerFunds.tsx"]) {
      const s = clientSrc(f);
      /* The CALL is gone from the code; the comment recording that it was there is
         deliberately kept, so the fence reads stripped source. */
      expect(stripComments(s), f).not.toContain("parseInt(form.targetSizeMinor");
      /* NOT a blanket ban on `parseInt`: `PartnerFunds.tsx` also parses
         `vintageYear`, which is a YEAR and legitimately an integer — Wave 86B
         established that non-money integers and ratios are not this defect. The
         fence is on MONEY reaching a double. */
      expect(stripComments(s), f).not.toMatch(/parseInt\([^)]*[Mm]inor/);
      expect(stripComments(s), f).not.toMatch(/parseFloat\([^)]*[Mm]inor/);
      expect(stripComments(s), f).not.toMatch(/Number\([^)]*targetSize/);
      expect(s, f).toContain('import { wireSafeMinorUnits } from "@/lib/wireSafeMinorUnits";');
      expect(s, f).toContain("wireSafeMinorUnits(form.targetSizeMinor)");
      expect(s, f).toContain("TARGET_SIZE_NOT_EXACTLY_REPRESENTABLE");
    }
  });

  it("W100-M6 · the helper does no arithmetic on money and cannot be turned into a converter", () => {
    const s = stripComments(clientSrc("lib/wireSafeMinorUnits.ts"));
    /* Exactly ONE `Number(` call site pair: the round-trip probe and the accepted
       return. No parseInt, no parseFloat, no toFixed, no Math.*, no scaling. */
    expect(s).not.toContain("parseInt");
    expect(s).not.toContain("parseFloat");
    expect(s).not.toContain(".toFixed(");
    expect(s).not.toContain("Math.");
    expect(s).toContain("const roundTrip = String(Number(normalised));");
    expect(s).toContain("if (roundTrip !== normalised)");
  });
});
