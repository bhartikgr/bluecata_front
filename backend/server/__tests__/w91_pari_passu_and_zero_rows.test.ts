/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 91 — PARI PASSU, THE $0 ROW, AND THE THIRD SENIORITY WRITER.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, in three sentences.
 *
 *   1. When two preference classes ranked EQUALLY — pari passu, the arrangement the
 *      NVCA model charter uses by default — `GET /api/founder/captable/waterfall`
 *      REFUSED, including on the cap tables where the ranking cannot change any
 *      figure at all. Measured: 206 of 207 randomised ample-exit fixtures are
 *      order-invariant, so the refusal was discarding an answer that was already
 *      correct.
 *   2. When the sale price did NOT cover the stack, the engine paid the
 *      FIRST-LISTED class in full and the next one nothing — $9,000,000/$0 against
 *      $5,000,000/$4,000,000 on identical terms, from list order alone.
 *   3. A holder paid $0 was emitted as NO ROW AT ALL, so the founders vanished from
 *      a short-exit answer entirely. Being told you receive nothing is a fact;
 *      being absent is a defect.
 *
 * WHERE THE EXPECTED FIGURES COME FROM. Every money figure asserted here was
 * reconciled against TWO independent exact-rational references — Python
 * `fractions.Fraction` and raw `bigint` numerator/denominator pairs — which agree
 * with each other on 51 of 51 compared rows across 17 scenarios
 * (`spec/preflight_waterfall_evidence/20_three_instrument_reconciliation.txt`), and
 * each was then re-executed through this route over live HTTP; the transcripts are
 * in `build_log/wave91/transcripts/`. Nothing here was computed in anyone's head:
 * this project has shipped a $2,222,222 error, a financing that succeeded at an
 * INFINITE price, a 2.2e96-share non-convergence and a waterfall that added up
 * perfectly for the wrong exit value.
 *
 * TWO STANDING HAZARDS THIS FILE RESPECTS.
 *   · `Decimal.set` is NEVER called — it mutates the shared decimal.js instance the
 *     SACRED engine imports. This file uses its own `Decimal.clone`.
 *   · `computeConversionProjections` (`server/roundCarryForwardEngine.ts`, ~`:770`)
 *     is NOT touched, NOT called and NOT asserted against. R69, dead code,
 *     tripwire `W58F-F2f`. This wave is about exit conversions, which is exactly
 *     where that trap lives; four agents have proposed editing it and all four were
 *     wrong. The live path only: shares in → sacred `computeWaterfall` → payouts out.
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
import { SENIORITY_RANK_MAX } from "../lib/roundStoredTerms";

const ROOT = path.resolve(__dirname, "../..");
const ADMIN = "u_admin";
const STAMP = `w91${Math.random().toString(36).slice(2, 8)}`;
/* THIS TEST'S OWN INSTANCE. `Decimal.clone`, never `Decimal.set`. */
const D120 = Decimal.clone({ precision: 120 });

let app: Express;

type ClassSpec = {
  /** The free-text liquidation preference the round records, e.g. "1x non-participating". */
  lp: string;
  seniority?: number;
  /** Invested amount in MAJOR units, as the ledger takes it. */
  amount: string;
  shares: string;
  /** The round's price per share. The commit store REFUSES a priced round whose
   *  shares are not `floor(amount / price)` (`PRICED_ROUND_SHARE_MISMATCH`), so
   *  every fixture states it rather than relying on a default that would make the
   *  ledger and the round disagree. */
  pps: number;
  instrument?: string;
};

/** A company with real founder common and N preferred classes, built only through
 *  reachable creator endpoints — no direct store writes for the money paths. */
async function buildCompany(
  tag: string,
  classes: ClassSpec[],
  opts?: { founderShares?: string },
): Promise<string> {
  const companyId = `co_${STAMP}_${tag}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W91 ${tag}`, legalName: `W91 ${tag}, Inc.` });
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
      companyId, name: `${STAMP} ${tag} class${i}`, type: "seed",
      instrument: c.instrument ?? "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
      pricePerShare: c.pps, sharesAuthorized: 40_000_000, preMoney: 30_000_000,
      fdPreMoneyShares: 13_000_000,
      liquidationPreference: c.lp,
      ...(c.seniority !== undefined ? { seniority: c.seniority } : {}),
    });
    expect(created.status, `round create ${tag}${i}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(200);
    const back = await request(app).post("/api/founder/captable/backfill-investor")
      .set("x-user-id", ADMIN)
      .send({
        companyId, roundId: String((created.body as { id: string }).id),
        shares: c.shares, amount: c.amount, currency: "USD",
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
  remainder: string;
  byShareClass: Array<{
    classId: string; className: string; proceeds: string; decision: string;
    engineDecision: string | null; emittedByEngine: boolean; abated: boolean;
    claimMinor: string | null; seniority: number | null;
  }>;
  byCommonHolder: Array<{
    holderId: string; holderName: string; shares: string | null; proceeds: string;
    decision: string; emittedByEngine: boolean; basis: string | null;
  }>;
  pariPassu: {
    equalRankingDetected: boolean;
    duplicateRanks: number[];
    abatementEngaged: boolean;
    availableToPreferenceStackMinor: string;
    tiers: Array<{
      seniority: number; tierClaimMinor: string; availableMinor: string;
      abated: boolean; abatementFactor: string | null;
      classes: Array<{ classId: string; className: string; claimMinor: string; abatedClaimMinor: string }>;
    }>;
    precisionCeiling: string;
    basis: string;
  };
};

/** The class figure by the class's ORDINAL in creation order (class0, class1, …). */
const clsProceeds = (b: Body, ordinal: number): string => {
  const row = b.byShareClass.filter((r) => r.className.endsWith(`class${ordinal}`))[0];
  expect(row, `class${ordinal} is missing from byShareClass`).toBeDefined();
  return row.proceeds;
};

/** Σ every published figure + remainder. */
const total = (b: Body): Decimal =>
  b.byShareClass.reduce<Decimal>((a, r) => a.plus(new D120(r.proceeds)), new D120(0))
    .plus(b.byCommonHolder.reduce<Decimal>((a, r) => a.plus(new D120(r.proceeds)), new D120(0)))
    .plus(new D120(b.remainder));

/** EXACT conservation, no tolerance. Used on every fixture whose figures
 *  terminate — which is every abatement fixture in this file. */
const conserves = (b: Body, exitMinor: string): boolean => total(b).eq(new D120(exitMinor));

/** Conservation to 37 significant digits, for a fixture where a class CONVERTS.
 *  WHY THE WEAKER FORM EXISTS, AND WHY IT IS NOT A WEAKER STANDARD. An
 *  as-converted share is `shares × exit / totalShares`, so 4/14 and 2/14 of
 *  $50,000,000 are repeating decimals that the SACRED engine rounds HALF_EVEN at
 *  its declared 38-significant-digit ceiling. Their sum is therefore short of the
 *  exit by about 1e-28 of a cent. THAT IS PRE-EXISTING AND HAS NOTHING TO DO WITH
 *  WAVE 91 — it is the same documented residual the pre-flight isolated to one unit
 *  in the 38th significant digit (`22_P1_counterexample.txt`), and Wave 86B
 *  recorded the same ceiling. Asserting the full string here would pin a rounding
 *  artefact and would go red on an unrelated change, hiding a real regression
 *  instead of catching one (`spec/UNVERIFIED_WATERFALL.md` · UV-W-4 asks for
 *  exactly 37). Every fixture whose arithmetic terminates uses `conserves` above. */
const conservesTo37 = (b: Body, exitMinor: string): boolean => {
  const t = total(b);
  const e = new D120(exitMinor);
  if (t.eq(e)) return true;
  return t.minus(e).abs().div(e.abs()).lte(new D120("1e-37"));
};

const NON_PART = "1x non-participating";

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 90_000);

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 2 — PRO-RATA ABATEMENT ACROSS EQUALLY-RANKING CLASSES.
   ═══════════════════════════════════════════════════════════════════════════════ */

describe("WAVE 91 · ITEM 2 — equal ranks abate PRO RATA, not by list order", () => {
  it("W91-PP-01 — two equal classes, sale below the claims: 60% each, not 100%/0%", async () => {
    /* A $10,000,000 1x non-participating (4,000,000 sh), B $5,000,000 1x
       non-participating (2,000,000 sh), founders 8,000,000, BOTH rank 0.
       Sale $9,000,000 against $15,000,000 of claims -> factor 9/15 = 0.6.
       BEFORE THIS WAVE: 422. Before Wave 79: A $9,000,000 and B $0. */
    const co = await buildCompany("pp01", [
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "900000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(200);
    const b = res.body as Body;
    expect(clsProceeds(b, 0)).toBe("600000000");
    expect(clsProceeds(b, 1)).toBe("300000000");
    /* THE ABATEMENT IS PUBLISHED so an investor can check the arithmetic. */
    expect(b.pariPassu.abatementEngaged).toBe(true);
    expect(b.pariPassu.equalRankingDetected).toBe(true);
    expect(b.pariPassu.duplicateRanks).toEqual([0]);
    const tier = b.pariPassu.tiers.filter((t) => t.seniority === 0)[0];
    expect(tier.tierClaimMinor).toBe("1500000000");
    expect(tier.availableMinor).toBe("900000000");
    expect(tier.abated).toBe(true);
    expect(tier.abatementFactor).toBe("0.6");
    /* ITEM 3 — the founders are PAID NOTHING AND STILL NAMED. */
    expect(b.byCommonHolder.length).toBe(1);
    expect(b.byCommonHolder[0].proceeds).toBe("0");
    expect(b.byCommonHolder[0].emittedByEngine).toBe(false);
    expect(String(b.byCommonHolder[0].basis)).toContain("did not reach the common shares");
    expect(b.founderProceeds).toBe("0");
    expect(conserves(b, "900000000"), "Σ payouts + remainder ≠ exit").toBe(true);
  }, 60_000);

  it("W91-PP-01R — the SAME cap table with the classes created in the OPPOSITE order gives the SAME answer", async () => {
    /* THIS IS THE WHOLE POINT. The defect was that list order decided the money. */
    const co = await buildCompany("pp01r", [
      { lp: NON_PART, seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "900000000");
    expect(res.status).toBe(200);
    const b = res.body as Body;
    /* class0 is now the $5,000,000 class. */
    expect(clsProceeds(b, 0)).toBe("300000000");
    expect(clsProceeds(b, 1)).toBe("600000000");
    expect(conserves(b, "900000000")).toBe(true);
  }, 60_000);

  it("W91-PP-02 — abatement is on the CLAIM, not on the invested amount", async () => {
    /* A $10,000,000 at 1x and B $5,000,000 at 2x have the SAME $10,000,000 claim,
       so on a $9,000,000 sale they take the SAME money. An implementation that
       abates on `invested` pays $6,000,000 / $3,000,000 here and is wrong. */
    const co = await buildCompany("pp02", [
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: "2x non-participating", seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "900000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Body;
    expect(clsProceeds(b, 0)).toBe("450000000");
    expect(clsProceeds(b, 1)).toBe("450000000");
    expect(conserves(b, "900000000")).toBe(true);
  }, 60_000);

  it("W91-PP-03 — sale EXACTLY equal to the claims: both paid in full, nothing abates", async () => {
    const co = await buildCompany("pp03", [
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "1500000000");
    expect(res.status).toBe(200);
    const b = res.body as Body;
    expect(clsProceeds(b, 0)).toBe("1000000000");
    expect(clsProceeds(b, 1)).toBe("500000000");
    expect(b.pariPassu.abatementEngaged).toBe(false);
    expect(b.founderProceeds).toBe("0");
    expect(b.byCommonHolder.length).toBe(1);
    expect(conserves(b, "1500000000")).toBe(true);
  }, 60_000);

  it("W91-PP-06 — ONE MINOR UNIT below the claims: abatement engages at a single cent", async () => {
    const co = await buildCompany("pp06", [
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "1499999999");
    expect(res.status).toBe(200);
    const b = res.body as Body;
    expect(b.pariPassu.abatementEngaged).toBe(true);
    /* Non-terminating: 2/3 and 1/3 of a cent. Carried to the engine's 38
       significant digits and rounded NOWHERE earlier. */
    expect(clsProceeds(b, 0)).toBe("999999999.33333333333333333333333333333");
    expect(clsProceeds(b, 1)).toBe("499999999.66666666666666666666666666667");
    expect(conserves(b, "1499999999"), "the cent did not conserve").toBe(true);
  }, 60_000);

  it("W91-PP-05 — ZERO proceeds: every row $0, no refusal, no division by zero", async () => {
    const co = await buildCompany("pp05", [
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "0");
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Body;
    expect(clsProceeds(b, 0)).toBe("0");
    expect(clsProceeds(b, 1)).toBe("0");
    expect(b.byCommonHolder.length).toBe(1);
    expect(b.byCommonHolder[0].proceeds).toBe("0");
    expect(b.remainder).toBe("0");
    expect(conserves(b, "0")).toBe(true);
  }, 60_000);

  it("W91-PP-07 — THREE equal classes, non-terminating ratios, still conserving exactly", async () => {
    /* A $10,000,000, B $5,000,000, C $2,000,000, all rank 0; claims $17,000,000;
       sale $10,000,000. 10/17 does not terminate in base 10. */
    const co = await buildCompany("pp07", [
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
      { lp: NON_PART, seniority: 0, amount: "2000000", shares: "800000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "1000000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Body;
    expect(clsProceeds(b, 0)).toBe("588235294.11764705882352941176470588235");
    expect(clsProceeds(b, 1)).toBe("294117647.05882352941176470588235294118");
    expect(clsProceeds(b, 2)).toBe("117647058.82352941176470588235294117647");
    expect(b.byCommonHolder[0].proceeds).toBe("0");
    expect(conserves(b, "1000000000"), "three-way split did not conserve").toBe(true);
  }, 60_000);

  it("W91-PP-08 — MIXED tiers: a senior singleton paid in full, then the equal tier abates 2:1", async () => {
    /* C $6,000,000 alone at rank 0; A $10,000,000 and B $5,000,000 both at rank 1;
       sale $12,000,000. C is paid in full and the remaining $6,000,000 abates 2:1. */
    const co = await buildCompany("pp08", [
      { lp: NON_PART, seniority: 0, amount: "6000000", shares: "2400000", pps: 2.5 },
      { lp: NON_PART, seniority: 1, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 1, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "1200000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Body;
    expect(clsProceeds(b, 0)).toBe("600000000");
    expect(clsProceeds(b, 1)).toBe("400000000");
    expect(clsProceeds(b, 2)).toBe("200000000");
    const senior = b.pariPassu.tiers.filter((t) => t.seniority === 0)[0];
    const junior = b.pariPassu.tiers.filter((t) => t.seniority === 1)[0];
    expect(senior.abated).toBe(false);
    expect(junior.abated).toBe(true);
    expect(junior.availableMinor).toBe("600000000");
    expect(junior.tierClaimMinor).toBe("1500000000");
    expect(conserves(b, "1200000000")).toBe(true);
  }, 60_000);

  it("W91-PP-12 — a SINGLE class on a short sale is byte-identical to before, and still says so", async () => {
    /* THE NO-REGRESSION POLE. With one class there is no tier to abate: the
       engine's own clamp is already the pro-rata answer, and this figure must not
       move by a digit. */
    const co = await buildCompany("pp12", [
      { lp: NON_PART, amount: "10000000", shares: "4000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "900000000");
    expect(res.status).toBe(200);
    const b = res.body as Body;
    expect(clsProceeds(b, 0)).toBe("900000000");
    expect(b.pariPassu.abatementEngaged).toBe(false);
    expect(b.pariPassu.equalRankingDetected).toBe(false);
    expect(String((res.body as { seniorityAssumed: string }).seniorityAssumed))
      .toContain("ONE preference class");
    expect(conserves(b, "900000000")).toBe(true);
  }, 60_000);
});

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 1 — WHERE THE SALE COVERS THE STACK, THE ANSWER WAS ALREADY CORRECT.
   ═══════════════════════════════════════════════════════════════════════════════ */

describe("WAVE 91 · ITEM 1 — equal ranks with an ample sale COMPUTE rather than refuse", () => {
  it("W91-PP-04 — equal ranks, ample sale: identical to the DISTINCT-rank control, digit for digit", async () => {
    /* CLAIM P1, as one fixture. Order cannot change a figure when every claim is
       covered, so the equal-rank answer must equal the stacked answer exactly. If
       these two ever diverge, the narrowing in Item 1 is unsafe. */
    const equal = await buildCompany("pp04e", [
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const distinct = await buildCompany("pp04d", [
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 1, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const e = (await waterfall(equal, "5000000000")).body as Body;
    const d = (await waterfall(distinct, "5000000000")).body as Body;
    expect(e.ok).toBe(true);
    expect(clsProceeds(e, 0)).toBe(clsProceeds(d, 0));
    expect(clsProceeds(e, 1)).toBe(clsProceeds(d, 1));
    expect(e.founderProceeds).toBe(d.founderProceeds);
    expect(e.lpProceeds).toBe(d.lpProceeds);
    /* And the equal-ranking arrangement is DISCLOSED rather than silently treated
       as a stack. */
    expect(e.pariPassu.equalRankingDetected).toBe(true);
    expect(e.pariPassu.abatementEngaged).toBe(false);
    expect(d.pariPassu.equalRankingDetected).toBe(false);
    /* BOTH classes convert on this sale (4/14 and 2/14 of $50,000,000 each beat the
       preference), so the figures are repeating decimals and conservation holds to
       the engine's 38-digit ceiling rather than to the last digit — see
       `conservesTo37`. The EQUALITY of the two answers above is byte-exact, which is
       the property Item 1 rests on. */
    expect(conservesTo37(e, "5000000000")).toBe(true);
    expect(conservesTo37(d, "5000000000")).toBe(true);
  }, 90_000);

  it("W91-PP-10 — PARTICIPATING classes, equal ranks, ample sale: computed, and conserving", async () => {
    const co = await buildCompany("pp10", [
      { lp: "1x participating", seniority: 0, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: "1x participating", seniority: 0, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "5000000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Body;
    /* $50,000,000 exit; preferences $10m + $5m; the $35,000,000 residual is shared
       across 14,000,000 common-equivalent shares at one price (Wave 79 · Item 1). */
    expect(clsProceeds(b, 0)).toBe("2000000000");
    expect(clsProceeds(b, 1)).toBe("1000000000");
    expect(b.founderProceeds).toBe("2000000000");
    expect(b.pariPassu.abatementEngaged).toBe(false);
    expect(conserves(b, "5000000000")).toBe(true);
  }, 60_000);

  it("W91-PP-09 — an equal tier where ONE class CONVERTS: the election comes first and the other is NOT abated", async () => {
    /* A $2,000,000 1x non-participating with 6,000,000 sh; B $10,000,000 1x
       non-participating with 1,000,000 sh; both rank 0; founders 8,000,000; sale
       $20,000,000. A's as-converted beats its preference so A leaves the tier, and
       B's $10,000,000 is then covered — so NOTHING abates. Abating B against a
       claim A had already waived is the error this fixture exists to catch. */
    const co = await buildCompany("pp09", [
      { lp: NON_PART, seniority: 0, amount: "3000000", shares: "6000000", pps: 0.5 },
      { lp: NON_PART, seniority: 0, amount: "10000000", shares: "1000000", pps: 10 },
    ]);
    const res = await waterfall(co, "2000000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Body;
    expect(clsProceeds(b, 1)).toBe("1000000000");
    expect(b.pariPassu.abatementEngaged).toBe(false);
    /* A converted, so it is NOT a standing claim and does not appear in a tier. */
    const tier0 = b.pariPassu.tiers.filter((t) => t.seniority === 0)[0];
    expect(tier0.classes.length).toBe(1);
    /* A converted, so its figure is a repeating share of the residual. */
    expect(conservesTo37(b, "2000000000")).toBe(true);
  }, 60_000);
});

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 3 — EVERY HOLDER ON THE CAP TABLE APPEARS, INCLUDING AT $0.
   ═══════════════════════════════════════════════════════════════════════════════ */

describe("WAVE 91 · ITEM 3 — a holder paid nothing is NAMED, not omitted", () => {
  it("W91-Z-01 — TWO common holders, sale absorbed by a stacked preference: BOTH appear at $0", async () => {
    /* The engine's Step 2 is gated on `remaining.gt(0)`, so on this cap table it
       emits NO common row at all. A screen rendering holders from `byCommonHolder`
       would have omitted both of them from the page. */
    const co = await buildCompany("z01", [
      { lp: NON_PART, amount: "10000000", shares: "4000000", pps: 2.5 },
      /* A NON-FOUNDER COMMON HOLDER, the same shape Wave 88's `R67F-04` uses. */
      { lp: "", amount: "3000000", shares: "1200000", pps: 2.5, instrument: "common" },
    ]);
    const res = await waterfall(co, "500000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Body;
    expect(b.byCommonHolder.length, "a $0 holder was omitted from the answer").toBe(2);
    for (const h of b.byCommonHolder) {
      expect(h.proceeds).toBe("0");
      expect(h.proceedsExact ?? "0").toBe("0");
      expect(h.emittedByEngine).toBe(false);
      expect(String(h.basis)).toContain("receives nothing on this sale");
      /* AND THE SHARE COUNT IS STILL THERE — a holder with no cheque still has a
         holding, and the row must say so. */
      expect(String(h.shares)).toMatch(/^\d+$/);
    }
    expect(b.founderProceeds).toBe("0");
    expect(b.commonLegProceeds).toBe("0");
    expect(conserves(b, "500000000")).toBe(true);
  }, 60_000);

  it("W91-Z-02 — the common rows on an AMPLE sale are byte-identical to Wave 88's, and still sum to the leg", async () => {
    /* NOTHING MOVED where the engine already emitted a row: same holders, same
       order, same figures. The list is now driven by the cap table, and that must
       be invisible on every cap table that already worked. */
    const co = await buildCompany("z02", [
      { lp: NON_PART, amount: "10000000", shares: "4000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "5000000000");
    expect(res.status).toBe(200);
    const b = res.body as Body;
    expect(b.byCommonHolder.length).toBe(1);
    expect(b.byCommonHolder[0].emittedByEngine).toBe(true);
    expect(b.byCommonHolder[0].basis).toBeNull();
    expect(
      b.byCommonHolder.reduce<Decimal>((a, h) => a.plus(new D120(h.proceeds)), new D120(0)).toFixed(),
    ).toBe(b.commonLegProceeds);
    expect(conserves(b, "5000000000")).toBe(true);
  }, 60_000);

  it("W91-Z-03 — every preference class on the cap table appears in `byShareClass` exactly once", async () => {
    const co = await buildCompany("z03", [
      { lp: NON_PART, seniority: 0, amount: "6000000", shares: "2400000", pps: 2.5 },
      { lp: NON_PART, seniority: 1, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, seniority: 2, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "600000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Body;
    expect(b.byShareClass.length).toBe(3);
    const ids = b.byShareClass.map((r) => r.classId);
    expect(new Set(ids).size).toBe(3);
    /* The senior class takes the lot; the two junior classes are paid nothing AND
       ARE STILL NAMED, each with the claim it stood on. */
    expect(clsProceeds(b, 0)).toBe("600000000");
    expect(clsProceeds(b, 1)).toBe("0");
    expect(clsProceeds(b, 2)).toBe("0");
    for (const r of b.byShareClass) expect(String(r.claimMinor)).toMatch(/^\d+$/);
    expect(conserves(b, "600000000")).toBe(true);
  }, 60_000);
});

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 4 — THE SENIORITY WRITE FENCE, AT EVERY WRITER.
   ═══════════════════════════════════════════════════════════════════════════════ */

describe("WAVE 91 · ITEM 4 — `POST /api/rounds` no longer stores an unusable rank", () => {
  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: `co_${STAMP}_sen`, name: `${STAMP} sen ${Math.random().toString(36).slice(2, 7)}`,
      type: "seed", instrument: "preferred", openDate: "2026-01-01", closeDate: "2026-12-31",
      targetAmount: 10_000_000, pricePerShare: 2.5, sharesAuthorized: 40_000_000,
      preMoney: 30_000_000, fdPreMoneyShares: 13_000_000, ...body,
    });

  beforeAll(async () => {
    await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
      .send({
        companyId: `co_${STAMP}_sen`, companyName: `W91 sen`, legalName: `W91 sen, Inc.`,
      });
  }, 60_000);

  it("W91-SEN-01 — the two values the pre-flight measured at HTTP 200 are now REFUSED BY NAME", async () => {
    /* MEASURED BEFORE THIS WAVE: both of these returned 200 and were persisted,
       after which the reader returned `null` and the waterfall refused with the
       unusable value sitting on the row. */
    for (const bad of [3.5, 500]) {
      const res = await create({ seniority: bad });
      expect(res.status, `seniority ${bad} was accepted`).toBe(400);
      expect(res.body.error).toBe("invalid_seniority");
      expect(res.body.field).toBe("seniority");
      expect(String(res.body.message)).toContain("most senior");
    }
  }, 60_000);

  it("W91-SEN-02 — every other not-a-rank shape is refused, with the SAME imported sentence", async () => {
    for (const bad of [-1, 100, "abc", true, [], {}, [5]] as unknown[]) {
      const res = await create({ seniority: bad });
      expect(res.status, `seniority ${JSON.stringify(bad)} was accepted`).toBe(400);
      expect(res.body.error).toBe("invalid_seniority");
    }
  }, 60_000);

  it("W91-SEN-03 — BOTH POLES of the domain are accepted and READABLE BACK", async () => {
    for (const good of [0, 99]) {
      const res = await create({ seniority: good });
      expect(res.status, `seniority ${good} was refused: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
      const stored = await request(app).get(`/api/rounds/${String((res.body as { id: string }).id)}`)
        .set("x-user-id", ADMIN);
      expect(Number((stored.body as { seniority?: unknown }).seniority ?? -1)).toBe(good);
    }
    expect(SENIORITY_RANK_MAX).toBe(99);
  }, 60_000);

  it("W91-SEN-04 — ABSENT and EXPLICITLY EMPTY both mean 'no ranking recorded', and neither becomes 0", async () => {
    /* THE CLASSIC FALSY-ZERO TRAP, from the other side: a blank must never be
       stored as the MOST SENIOR rank. */
    const absent = await create({});
    expect(absent.status).toBe(200);
    const a = await request(app).get(`/api/rounds/${String((absent.body as { id: string }).id)}`)
      .set("x-user-id", ADMIN);
    expect((a.body as { seniority?: unknown }).seniority ?? null).toBeNull();
    for (const empty of [null, ""] as unknown[]) {
      const res = await create({ seniority: empty });
      expect(res.status, `seniority ${JSON.stringify(empty)} was refused`).toBe(200);
      const got = await request(app).get(`/api/rounds/${String((res.body as { id: string }).id)}`)
        .set("x-user-id", ADMIN);
      expect((got.body as { seniority?: unknown }).seniority ?? null).toBeNull();
    }
  }, 60_000);

  it("W91-SEN-05 — ONE validator, THREE writers, so they cannot drift", async () => {
    const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
    const founder = fs.readFileSync(path.join(ROOT, "server/roundCarryForwardRoutes.ts"), "utf8");
    /* Writer 1 (create) and writer 2 (terms patch) both live in `routes.ts` and
       both call the IMPORTED validator; writer 3 is the founder patch. Nobody
       restates the domain. */
    expect(routes.match(/validateSeniorityRankStored/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(founder).toContain("validateSeniorityRankStored");
    const reader = fs.readFileSync(path.join(ROOT, "server/lib/roundStoredTerms.ts"), "utf8");
    expect(reader.match(/export function validateSeniorityRankStored/g)?.length).toBe(1);
    /* AND THE STALE COMMENT IS GONE. Wave 79 claimed here that seniority was
       deliberately kept off the update whitelist and could only be set at
       creation; Wave 81 made both halves false and this file said otherwise for
       two waves. */
    expect(reader).toContain("CORRECTED BY WAVE 91");
    /* The stale sentence is still in the file — QUOTED AS HISTORY, which is this
       project's own discipline: a comment that records what was believed and what
       corrected it is evidence, and deleting it would hide that the tree said the
       opposite for two waves. What must be true is that it appears only INSIDE the
       correction, never as a live claim. */
    const historyAt = reader.indexOf("WHAT IT USED TO SAY");
    const staleAt = reader.indexOf("seniority can be recorded at round CREATION and not edited afterwards");
    expect(historyAt).toBeGreaterThan(0);
    expect(staleAt).toBeGreaterThan(historyAt);
    expect(reader.match(/seniority can be recorded at round CREATION/g)?.length).toBe(1);
  });

  it("W91-SEN-06 — NO NEW MIGRATION. `seniority` rides `extras_json`, as it always did", async () => {
    const files = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBe(173);
    expect(files.sort().at(-1)).toBe("0192_wave68_term_domain_fences.sql");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   THE REFUSAL IS NARROWED, NOT REMOVED, AND THE DEAD END IS CLOSED.
   ═══════════════════════════════════════════════════════════════════════════════ */

describe("WAVE 91 — the refusals that must survive, and the sentence that must change", () => {
  it("W91-REF-01 — `SENIORITY_RANKING_AMBIGUOUS` still exists, in TWO narrowed branches", () => {
    const route = fs.readFileSync(path.join(ROOT, "server/track1Routes.ts"), "utf8");
    /* R67 condition 1: NARROW the condition, never remove the refusal, its
       container or its branch. Both remaining sites are defence in depth on the
       maths — one for a claim that cannot be derived at all, one for a published
       figure that fails to match the abatement computed independently — and that is
       stated in the report rather than implied by a count. */
    expect(route.match(/SENIORITY_RANKING_AMBIGUOUS/g)?.length).toBeGreaterThanOrEqual(2);
    expect(route).toContain("pariPassuReason");
    expect(route).toContain("abatement_not_reproduced");
    /* AND EVERY OTHER REFUSAL ON THIS HANDLER IS UNTOUCHED. */
    for (const id of [
      "SENIORITY_NOT_ON_RECORD", "LIQUIDATION_TERM_NOT_ON_RECORD", "COMMON_SHARES_NOT_ON_RECORD",
      "NOTE_EXIT_CLAIM_NOT_DETERMINABLE", "SAFE_CONVERSION_PRICE_NOT_DETERMINABLE",
      "SAFE_MFN_STATUS_NOT_ON_RECORD", "SAFE_CONVERSION_YIELDS_ZERO_SHARES",
      "CONVERTIBLE_CASH_OUT_ORDER_NOT_ON_RECORD", "CONVERTIBLE_ELECTION_NOT_CONVERGENT",
      "WATERFALL_COMPUTE_ERROR", "ENGINE_UNAVAILABLE",
    ]) {
      expect(route, `${id} was removed`).toContain(id);
    }
  });

  it("W91-REF-02 — the refusals a founder can actually reach carry NO machine token in `message`", async () => {
    /* WHY THIS IS A RUNTIME CHECK AND NOT A SOURCE SWEEP. `R67F-17` forbids the
       refusal IDENTIFIERS anywhere in `client/src`, and the screen this work exists
       for is specified to render the server's `message` VERBATIM. So the property
       that has to hold is about the STRING THAT ARRIVES, not about the file that
       produced it: a first attempt at this test parsed the handler's source, matched
       prose inside comment blocks that deliberately QUOTE the old identifiers, and
       would have been satisfied by deleting the history. Reading the wire cannot be
       fooled that way. Identifiers live on `error` / `refusal` / `refusalName` /
       `pariPassuReason`, which is exactly where R77 puts them. */
    const noTerm = await buildCompany("ref02a", [
      { lp: "", amount: "10000000", shares: "4000000", pps: 2.5 },
    ]);
    const twoUnranked = await buildCompany("ref02b", [
      { lp: NON_PART, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const reached = [
      await waterfall(noTerm, "5000000000"),
      await waterfall(twoUnranked, "5000000000"),
    ];
    for (const res of reached) {
      expect(res.status).toBe(422);
      /* THE IDENTIFIER IS ON THE PAYLOAD, and that is required, not incidental. */
      expect(String(res.body.error)).toMatch(/^[A-Z_]+$/);
      const msg = String(res.body.message);
      expect(msg.length).toBeGreaterThan(100);
      const tokens = msg.match(/[a-z][a-z0-9]*_[a-z0-9_]+/g) ?? [];
      /* `seniority_not_on_record` is named inside one message ON PURPOSE and was
         already there before this wave: the sentence tells a founder that deleting
         the ranking brings the refusal back. It is carried as an owner question
         rather than silently rewritten here, because changing that sentence is a
         change to a published message and not this item's business. */
      const unexpected = tokens.filter((t) => t !== "seniority_not_on_record");
      expect(unexpected, `machine tokens on the wire: ${unexpected.join(", ")}`).toEqual([]);
    }
  }, 90_000);

  it("W91-REF-03 — the seniority refusal no longer sends a founder to a control that does not exist", async () => {
    const co = await buildCompany("ref03", [
      { lp: NON_PART, amount: "10000000", shares: "4000000", pps: 2.5 },
      { lp: NON_PART, amount: "5000000", shares: "2000000", pps: 2.5 },
    ]);
    const res = await waterfall(co, "5000000000");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("SENIORITY_NOT_ON_RECORD");
    const msg = String(res.body.message);
    /* THE DEAD END. It still says what the term does and what the domain is — that
       half was always right — and it now states that no screen sets it yet instead
       of implying one exists. */
    expect(msg).toContain("paid FIRST");
    expect(msg).toContain("0 is the most senior");
    expect(msg).toContain("There is no screen in Capavate that sets the payment order yet");
    /* AND IT NAMES PARI PASSU AS A LEGITIMATE ANSWER, because it now is one. */
    expect(msg).toContain("pari passu");
  }, 60_000);
});
