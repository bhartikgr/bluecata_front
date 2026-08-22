/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAVE 88 · R67 EXIT PROCEEDS, PER INSTRUMENT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. R67 widened `GET /api/founder/captable/waterfall` from 0-of-112
 * computing to 104-of-112 and that was recorded as a win. 48 of those 104 figures
 * were economically wrong and 16 more were wrong as published:
 *
 *   · 48 (post-money SAFE, pre-money SAFE, convertible note) — a $10,000,000
 *     instrument, OUTSTANDING on the cap table with its valuation cap on record,
 *     was skipped at `track1Routes.ts` BEFORE the disclosure was built. It was paid
 *     **$0 and never even named**, and the founders were paid the entire
 *     $50,000,000 exit. A silent $0 is a founder telling an investor they get
 *     nothing.
 *   · 16 (common) — the engine DID pay the non-founder common investor, but the
 *     whole leg was reported under the name `founderProceeds` with no per-holder
 *     line, overstating founders by $16,666,666.67 — and the response's own
 *     `reason` prose asserted the opposite, falsely, on the wire.
 *
 * WHAT THIS FILE DOES. One case per instrument, plus the boundaries. Every money
 * figure asserted here was produced by an EXECUTED run of the real route through
 * the real sacred engine, and the full 112-fixture census is in
 * `build_log/wave88/W88_CENSUS_AFTER.json`. This project has shipped a $2,222,222
 * error, a zero-share financing that succeeded at an INFINITE price and a
 * non-convergence yielding 2.2e96 shares, so nothing here is asserted from
 * arithmetic done in anyone's head.
 *
 * TWO STANDING HAZARDS THIS FILE RESPECTS.
 *   · `Decimal.set` is NEVER called. It mutates the shared decimal.js instance the
 *     sacred engine imports and eight production consumers read, one of them the
 *     sacred cap-table commit store; it once faked a result by ~80 orders of
 *     magnitude. This file uses its own `Decimal.clone`.
 *   · `computeConversionProjections` (`server/roundCarryForwardEngine.ts:770`) is
 *     NOT touched, NOT called and NOT asserted against as a fix target. R69, dead
 *     code, tripwire `W58F-F2f`. `R67F-18` pins that it is still dead.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { createRound } from "../roundsStore";
import { Decimal } from "decimal.js";

/* THIS TEST'S OWN INSTANCE. `Decimal.clone`, never `Decimal.set`. */
const D120 = Decimal.clone({ precision: 120 });

const ROOT = path.resolve(__dirname, "../..");
const ADMIN = "u_admin";
const EXIT = "5000000000"; // $50,000,000.00 in minor units
const STAMP = `w88${Math.random().toString(36).slice(2, 8)}`;
let app: Express;

const waterfall = (companyId: string, exitMinor: string = EXIT) =>
  request(app).get("/api/founder/captable/waterfall")
    .query({ companyId, exitValuationMinor: exitMinor })
    .set("x-user-id", ADMIN);

/** A company with a real founder common block, created through the reachable creator. */
async function newCompany(key: string, opts?: { seedCommon?: boolean }): Promise<string> {
  const companyId = `co_${STAMP}_${key}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W88 ${key}`, legalName: `W88 ${key}, Inc.` });
  expect(co.status, `company create ${key}`).toBeLessThan(400);
  if (opts?.seedCommon === false) return companyId;
  const foundationId = createRound({
    companyId, name: `${STAMP} Foundation ${key}`, type: "foundation",
    instrument: "common", pricePerShare: null, actorUserId: ADMIN,
  } as never).id;
  const seeded = await request(app).post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({
      companyId, roundId: foundationId, shares: "8000000", amount: "8000", currency: "USD",
      holderFirstName: "Founder", holderLastName: key,
    });
  expect(seeded.status, `seed ${key}`).toBeLessThan(400);
  return companyId;
}

/** A committed round of any instrument, with its own terms, exactly as the platform fences them. */
async function addRound(
  companyId: string, key: string, instrument: string,
  terms: Record<string, unknown>,
  commit: { shares: string; amount: string },
): Promise<string> {
  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
    companyId, name: `${STAMP} Under Test ${key}`, type: "seed", instrument,
    openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
    ...terms,
  });
  expect(created.status, `round create ${key}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(200);
  const roundId = String((created.body as { id: string }).id);
  const backfill = await request(app).post("/api/founder/captable/backfill-investor")
    .set("x-user-id", ADMIN)
    .send({
      companyId, roundId, shares: commit.shares, amount: commit.amount, currency: "USD",
      holderFirstName: "Invest", holderLastName: key,
      investorEmail: `${STAMP}_${key}@example.invalid`,
    });
  expect(backfill.status, `backfill ${key}: ${JSON.stringify(backfill.body).slice(0, 300)}`).toBe(201);
  return roundId;
}

const SAFE_TERMS = (cap: number | null) => ({
  ...(cap === null ? {} : { valuationCap: cap }), discount: 20,
});

describe("W88 · R67 — exit proceeds, per instrument", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  /* ═════════════════════════════════════════════════════════════════════════════
     THE TWO THINGS THAT MUST NOT MOVE, PINNED FIRST.
     ═════════════════════════════════════════════════════════════════════════════ */

  it("R67F-01 — preferred WITH a term on record: the R67 win is preserved, to the digit", async () => {
    const co = await newCompany("f01");
    await addRound(co, "f01pref", "preferred", {
      pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000,
      fdPreMoneyShares: 13_000_000, liquidationPreference: "1x non-participating",
    }, { shares: "4000000", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    /* BYTE-IDENTICAL to Wave 75/77's pinned figures. This is one of the 8 census
       fixtures that were already CORRECT and are not allowed to regress. */
    expect(res.body.founderProceeds).toBe("3333333333.3333333333333333333333333333");
    expect(res.body.lpProceeds).toBe("1666666666.6666666666666666666666666667");
    /* No convertible on this cap table, so the third leg is exactly zero and the
       two-term identity Wave 77 pinned still holds unchanged. */
    expect(res.body.convertibleProceeds).toBe("0");
    expect(res.body.byConvertible).toEqual([]);
  }, 60_000);

  it("R67F-02 — preferred with NO term: still refuses by name (one of the 8 correct refusals)", async () => {
    const co = await newCompany("f02");
    await addRound(co, "f02pref", "preferred", {
      pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
    }, { shares: "4000000", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("LIQUIDATION_TERM_NOT_ON_RECORD");
    expect(res.body.refusalName).toBe("liquidation_term_not_on_record");
    expect(res.body.founderProceeds).toBeUndefined();
  }, 60_000);

  /* ═════════════════════════════════════════════════════════════════════════════
     THE COMMON LEG — CORRECTLY ALLOCATED ALL ALONG, WRONGLY PUBLISHED.
     ═════════════════════════════════════════════════════════════════════════════ */

  it("R67F-03 — a founders-only cap table paying the founders everything is CORRECT and stays 200", async () => {
    const co = await newCompany("f03");
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.founderProceeds).toBe("5000000000");
    expect(res.body.commonLegProceeds).toBe("5000000000");
    const holders = res.body.byCommonHolder as Array<Record<string, unknown>>;
    expect(holders.length).toBe(1);
    expect(String(holders[0].proceeds)).toBe("5000000000");
    /* Here `founderProceeds` really IS the founders' figure, because the leg has
       exactly one holder and they are the founder. That is the case the old name
       was true for, and the reason the mislabelling went unnoticed. */
  }, 60_000);

  it("R67F-04 — common + a NON-FOUNDER common holder: the leg is ATTRIBUTED and the false sentence is gone", async () => {
    const co = await newCompany("f04");
    await addRound(co, "f04common", "common", {
      pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
    }, { shares: "4000000", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);

    /* THE LEG TOTAL IS UNCHANGED — no money moved. What changed is that a reader
       can now see whose it is. */
    expect(res.body.founderProceeds).toBe("5000000000");
    /* OQ-R67-5 — the name is KEPT and the alias is BYTE-IDENTICAL. */
    expect(res.body.commonLegProceeds).toBe(res.body.founderProceeds);

    /* THE $16,666,666.67 THAT WAS BEING REPORTED AS THE FOUNDERS'. */
    const holders = res.body.byCommonHolder as Array<{ holderName: string; shares: string; proceeds: string }>;
    expect(holders.length, "the non-founder common holder is not attributed").toBe(2);
    const founder = holders.filter((h) => h.holderName.startsWith("Founder"))[0];
    const investor = holders.filter((h) => h.holderName.startsWith("Invest"))[0];
    expect(founder, "the founder line is missing").toBeDefined();
    expect(investor, "the investor line is missing").toBeDefined();
    expect(founder.shares).toBe("8000000");
    expect(investor.shares).toBe("4000000");
    expect(founder.proceeds).toBe("3333333333.3333333333333333333333333333");
    expect(investor.proceeds).toBe("1666666666.6666666666666666666666666667");
    /* The attributed lines sum to the leg total EXACTLY. */
    expect(
      holders.reduce<Decimal>((a, h) => a.plus(new D120(h.proceeds)), new D120(0)).toFixed(),
    ).toBe("5000000000");

    /* THE FALSE STATEMENT IS ABSENT FROM THE RESPONSE. It said the round's shares
       "are not added to the common leg". They are — proved by the discriminating
       probe — and it was prose on the wire asserting the opposite. */
    const body = JSON.stringify(res.body);
    expect(body, "the false disclosure sentence is back on the wire")
      .not.toContain("not added to the common leg");
    /* And the replacement text says what is true and points at the evidence. */
    const disclosed = res.body.nonPreferenceClasses as Array<{ instrument: string; reason: string }>;
    const commonEntry = disclosed.filter((d) => d.instrument === "common")[0];
    expect(commonEntry.reason).toContain("Common stock IS paid through the common leg");
    expect(commonEntry.reason).toContain("byCommonHolder");
  }, 60_000);

  /* ═════════════════════════════════════════════════════════════════════════════
     THE SAFE — THE INSTRUMENT THAT WAS PAID $0 AND NEVER NAMED.
     ═════════════════════════════════════════════════════════════════════════════ */

  it("R67F-05 — POST-MONEY SAFE with a cap on record: computed, named, and paid $25,000,000", async () => {
    const co = await newCompany("f05");
    await addRound(co, "f05safe", "safe_post", SAFE_TERMS(20_000_000), { shares: "0", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(200);

    /* BEFORE WAVE 88: founders 5000000000, SAFE 0, SAFE not even named. */
    expect(res.body.founderProceeds).toBe("2500000000");
    expect(res.body.convertibleProceeds).toBe("2500000000");
    expect(res.body.convertibleProceedsExact).toBe(res.body.convertibleProceeds);

    const conv = res.body.byConvertible as Array<Record<string, unknown>>;
    expect(conv.length).toBe(1);
    /* IT IS NAMED. This is the whole point: an investor holding a $10,000,000 SAFE
       was shown nothing and not even listed. */
    expect(String(conv[0].holderName)).toContain("Invest");
    expect(String(conv[0].instrument)).toBe("safe_post");
    expect(String(conv[0].convention)).toBe("post_money_cap");
    expect(conv[0].purchaseAmountMinor).toBe("1000000000");
    expect(conv[0].valuationCapMinor).toBe("2000000000");
    /* $10m purchase / $20m post-money cap = 50% of the post-money capitalisation,
       so 8,000,000 existing shares become 8,000,000 SAFE shares. */
    expect(conv[0].convertedShares).toBe("8000000");
    expect(String(conv[0].election)).toBe("as_converted");
    expect(conv[0].proceeds).toBe("2500000000");
    /* THE CASH-OUT FLOOR IT WAS COMPARED AGAINST IS PUBLISHED, not implied. */
    expect(conv[0].cashOutFloorMinor).toBe("1000000000");
    /* THE DISCOUNT IS NOT APPLIED, and the response says so rather than leaving the
       next reader to guess whether it was forgotten. */
    expect(String(conv[0].conversionBasis)).toContain("discount is NOT applied");
  }, 60_000);

  it("R67F-06 — PRE-MONEY SAFE with a cap on record: $2.50 liquidity price, 4,000,000 shares", async () => {
    const co = await newCompany("f06");
    await addRound(co, "f06safe", "safe_pre", SAFE_TERMS(20_000_000), { shares: "0", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(200);
    expect(res.body.founderProceeds).toBe("3333333333.3333333333333333333333333333");
    expect(res.body.convertibleProceeds).toBe("1666666666.6666666666666666666666666667");
    const conv = res.body.byConvertible as Array<Record<string, unknown>>;
    expect(String(conv[0].convention)).toBe("pre_money_cap");
    /* $20,000,000 cap over 8,000,000 pre-money shares = $2.50/share;
       $10,000,000 / $2.50 = 4,000,000 shares. */
    expect(conv[0].convertedShares).toBe("4000000");
    expect(String(conv[0].conversionBasis)).toContain("PRE-MONEY SAFE");
    /* THE CONVENTION CAME FROM THE ROUND'S INSTRUMENT VALUE, not from `safeCapType`
       — which is null on every SAFE the product's own writer creates (OQ-R67-4). */
    expect(String(conv[0].conversionBasis)).toContain("safe_pre");
  }, 60_000);

  it("R67F-07 — SAFE with NO CAP: refuses by name, and says the floor is not zero", async () => {
    const co = await newCompany("f07");
    await addRound(co, "f07safe", "safe_pre", SAFE_TERMS(null), { shares: "0", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(422);
    expect(res.body.error).toBe("SAFE_CONVERSION_PRICE_NOT_DETERMINABLE");
    expect(res.body.refusal).toBe("safe_conversion_price_not_determinable");
    expect(res.body.refusalName).toBe("safe_conversion_price_not_determinable");
    expect(res.body.field).toBe("valuationCap");
    expect(res.body.missingFacts).toEqual(["valuationCap"]);
    /* IT SAYS THE HOLDER IS NOT OWED NOTHING. That sentence is the difference
       between this refusal and the silent $0 it replaced. */
    expect(String(res.body.message)).toContain("not owed nothing");
    expect(String(res.body.message)).toContain("purchase amount");
    expect(String(res.body.message).length).toBeGreaterThan(200);
    expect(res.body.founderProceeds).toBeUndefined();
  }, 60_000);

  it("R67F-08 — TWO convertibles with `mfn` unrecorded: refuses by name", async () => {
    const co = await newCompany("f08");
    await addRound(co, "f08safeA", "safe_post", SAFE_TERMS(20_000_000), { shares: "0", amount: "10000000" });
    await addRound(co, "f08safeB", "safe_post", SAFE_TERMS(30_000_000), { shares: "0", amount: "5000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(422);
    expect(res.body.error).toBe("SAFE_MFN_STATUS_NOT_ON_RECORD");
    expect(res.body.refusalName).toBe("safe_mfn_status_not_on_record");
    expect(res.body.field).toBe("mfn");
    expect(res.body.missingFacts).toEqual(["mfn"]);
    /* It names WHICH instruments are outstanding, rather than saying "some". */
    expect((res.body.convertiblesOutstanding as unknown[]).length).toBe(2);
    expect(String(res.body.message)).toContain("MOST-FAVORED-NATION");
    expect(res.body.founderProceeds).toBeUndefined();
  }, 60_000);

  /* ═════════════════════════════════════════════════════════════════════════════
     THE NOTE — REFUSED, BECAUSE THE NUMBER IS NOT DETERMINABLE.
     ═════════════════════════════════════════════════════════════════════════════ */

  it("R67F-09 — convertible note outstanding: 422 by name, NEVER a 200 paying it $0", async () => {
    const co = await newCompany("f09");
    await addRound(co, "f09note", "convertible_note", {
      valuationCap: 20_000_000, discount: 20, interestRate: 8, maturityMonths: 24,
    }, { shares: "0", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(422);
    expect(res.body.error).toBe("NOTE_EXIT_CLAIM_NOT_DETERMINABLE");
    expect(res.body.refusal).toBe("note_exit_claim_not_determinable");
    expect(res.body.refusalName).toBe("note_exit_claim_not_determinable");
    expect(res.body.field).toBe("interestRate");
    /* THE THREE ABSENT FACTS, NAMED — so a user can supply them (the whole point of
       a refusal that is not a dead end). */
    expect(res.body.missingFacts).toEqual([
      "exit_date", "day_count_convention", "change_of_control_repayment_multiple",
    ]);
    /* The prose states the seniority fact, the claim's composition, the two bounds
       and what to record. */
    const m = String(res.body.message);
    expect(m).toContain("AHEAD of the equity");
    expect(m).toContain("ACCRUED");
    expect(m).toContain("NO EXIT DATE");
    expect(m).toContain("DAY-COUNT CONVENTION");
    expect(m).toContain("CHANGE-OF-CONTROL REPAYMENT MULTIPLE");
    expect(m).toContain("$10,000,000");
    expect(m).toContain("$11,600,000");
    /* R77 — the identifier is a PAYLOAD value. The prose does not contain it. */
    expect(m).not.toContain("NOTE_EXIT_CLAIM_NOT_DETERMINABLE");
    /* AND NO FIGURE AT ALL. Not $0, not a bounded guess. */
    expect(res.body.founderProceeds).toBeUndefined();
    expect(res.body.convertibleProceeds).toBeUndefined();
    expect(res.body.byConvertible).toBeUndefined();
  }, 60_000);

  /* ═════════════════════════════════════════════════════════════════════════════
     WARRANT AND OPTION POOL — EXCLUDED, WITH THE MISSING FACTS NAMED.
     ═════════════════════════════════════════════════════════════════════════════ */

  it("R67F-10 — warrant: 200, excluded, and the missing facts are machine-readable", async () => {
    const co = await newCompany("f10");
    await addRound(co, "f10warrant", "warrant", {
      strikePrice: 1.5, sharesAuthorized: 1_000_000, expiryYears: 5,
    }, { shares: "4000000", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const ex = res.body.excludedFromPayout as Array<{ instrument: string; missingFacts: string[]; reason: string }>;
    const w = ex.filter((e) => e.instrument === "warrant")[0];
    expect(w, "the warrant is not disclosed as excluded").toBeDefined();
    expect(w.missingFacts).toEqual([
      "exercise_election_at_exit", "exercise_mode_cash_or_net",
      "strike_proceeds_treatment", "shares_authorized_reconciliation",
    ]);
    expect(w.reason).toContain("RIGHT to buy shares");
    expect(w.reason).toContain("net (cashless) exercise");
    /* Still disclosed in `nonPreferenceClasses` too — nothing was removed. */
    const npc = res.body.nonPreferenceClasses as Array<{ instrument: string; reason: string }>;
    expect(npc.some((d) => d.instrument === "warrant")).toBe(true);
    expect(npc.filter((d) => d.instrument === "warrant")[0].reason).toContain("excludedFromPayout");
  }, 60_000);

  it("R67F-11 — option pool: 200, excluded, and the allocated/unallocated gap is named", async () => {
    const co = await newCompany("f11");
    await addRound(co, "f11pool", "option_pool", {
      poolSize: 1_000_000, poolTiming: "post_money", vestingMonths: 48, cliffMonths: 12,
    }, { shares: "4000000", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const ex = res.body.excludedFromPayout as Array<{ instrument: string; missingFacts: string[]; reason: string }>;
    const p = ex.filter((e) => e.instrument === "option_pool")[0];
    expect(p, "the option pool is not disclosed as excluded").toBeDefined();
    expect(p.missingFacts).toEqual([
      "grants", "vesting_status_at_exit", "strike_prices", "allocated_vs_unallocated_split",
    ]);
    /* THE DISTINCTION THAT MATTERS: $0 to an unallocated pool is CORRECT; $0 to
       vested in-the-money grants is WRONG; no grant record exists, so neither can
       be shown, and the response says exactly that. */
    expect(p.reason).toContain("UNALLOCATED pool");
    expect(p.reason).toContain("VESTED");
  }, 60_000);

  /* ═════════════════════════════════════════════════════════════════════════════
     THE BOUNDARIES.
     ═════════════════════════════════════════════════════════════════════════════ */

  it("R67F-12 — EXACT TIE between cash-out and as-converted resolves to CASH-OUT, from both sides", async () => {
    /* CONSTRUCTION, stated so the pole is reproducible. A pre-money SAFE with cap C
       on 8,000,000 pre-money shares converts into P*8,000,000/C shares out of a
       total of 8,000,000 + that, so its as-converted value at exit E is
       E*P/(C+P)... in minor units. Choosing C = P = the exit's half makes the
       as-converted value exactly half the exit. Concretely: purchase $10,000,000
       (1,000,000,000 minor), cap $10,000,000, exit $20,000,000 (2,000,000,000
       minor) -> converted shares 8,000,000, total 16,000,000, as-converted =
       1,000,000,000 = the cash-out floor EXACTLY. */
    const co = await newCompany("f12tie");
    await addRound(co, "f12safe", "safe_pre", SAFE_TERMS(10_000_000), { shares: "0", amount: "10000000" });
    const tie = await waterfall(co, "2000000000");
    expect(tie.status, JSON.stringify(tie.body).slice(0, 500)).toBe(200);
    const tieConv = (tie.body.byConvertible as Array<Record<string, unknown>>)[0];
    expect(tieConv.convertedShares).toBe("8000000");
    expect(tieConv.cashOutFloorMinor).toBe("1000000000");
    /* THE TIE. A tie resolves to cash-out (OQ-R67-7): deterministic, lower
       variance, and what a rational holder takes when indifferent. */
    expect(String(tieConv.election), "a tie must resolve to cash-out").toBe("cash_out");
    expect(tieConv.proceeds).toBe("1000000000");
    expect(tie.body.convertibleProceeds).toBe("1000000000");
    expect(tie.body.founderProceeds).toBe("1000000000");
    /* The modelling choice a cash-out rests on is DISCLOSED, not left in source. */
    expect(String(tie.body.convertibleCashOutBasis)).toContain("ahead of the equity");

    /* ONE MINOR UNIT THE OTHER WAY FLIPS THE BRANCH. At an exit one minor unit
       HIGHER the as-converted value exceeds the floor and the SAFE converts. */
    const above = await waterfall(co, "2000000002");
    expect(above.status).toBe(200);
    const aboveConv = (above.body.byConvertible as Array<Record<string, unknown>>)[0];
    expect(String(aboveConv.election), "one minor unit above the tie must convert").toBe("as_converted");
    expect(new D120(String(aboveConv.proceeds)).gt(new D120("1000000000"))).toBe(true);

    /* AND ONE MINOR UNIT BELOW STAYS ON CASH-OUT. */
    const below = await waterfall(co, "1999999998");
    expect(below.status).toBe(200);
    const belowConv = (below.body.byConvertible as Array<Record<string, unknown>>)[0];
    expect(String(belowConv.election)).toBe("cash_out");
    expect(belowConv.proceeds).toBe("1000000000");
    /* The legs still reconcile exactly on the cash-out branch. */
    expect(
      new D120(String(below.body.founderProceeds))
        .plus(new D120(String(below.body.lpProceeds)))
        .plus(new D120(String(below.body.convertibleProceeds)))
        .toFixed(),
    ).toBe("1999999998");
  }, 90_000);

  it("R67F-13 — a ZERO-SHARE non-convertible round: the writer refuses it, and the route discloses it if one ever exists", async () => {
    /* ════════════════════════════════════════════════════════════════
       MEASURED, AND REPORTED AS MEASURED RATHER THAN AS PLANNED.
       ════════════════════════════════════════════════════════════════
       The Wave 88 spec asked for a zero-share NON-convertible round to be disclosed
       rather than skipped. Executing it establishes something better: the commit
       store REFUSES a zero-share commit on a non-convertible round by name
       (`invalid_shares`), so the state cannot be created through the platform's own
       writer at all. A silent $0 therefore cannot arise this way today.

       BOTH HALVES ARE ASSERTED, because the second is what makes the first safe:
         (a) the writer refuses the commit, by name; and
         (b) the route's classification loop carries the disclosure branch anyway, so
             if any other path ever produces such a row — a migration, a direct
             ledger write, a future writer — it is DISCLOSED with
             `committed_share_count` named rather than dropped.
       The old unconditional `continue` had neither guarantee, and that is how a
       $10,000,000 SAFE came to be paid nothing without appearing on the response. */
    const co = await newCompany("f13");
    const zeroRoundId = createRound({
      companyId: co, name: `${STAMP} zero share f13`, type: "seed",
      instrument: "option_pool", pricePerShare: null, actorUserId: ADMIN,
    } as never).id;
    const backfill = await request(app).post("/api/founder/captable/backfill-investor")
      .set("x-user-id", ADMIN)
      .send({
        companyId: co, roundId: zeroRoundId, shares: "0", amount: "10000000", currency: "USD",
        holderFirstName: "Invest", holderLastName: "f13zero",
        investorEmail: `${STAMP}_f13zero@example.invalid`,
      });
    /* (a) THE WRITER REFUSES IT. A zero-share commit on a non-convertible round is
       not a thing the platform will record. */
    expect(backfill.status, JSON.stringify(backfill.body).slice(0, 300)).toBe(400);
    expect(String(backfill.body.error)).toBe("invalid_shares");
    /* Nothing was committed, so the waterfall computes exactly as before. */
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.founderProceeds).toBe("5000000000");
    /* The key is ALWAYS present, empty rather than absent. */
    expect(res.body.excludedFromPayout).toEqual([]);

    /* (b) THE DISCLOSURE BRANCH EXISTS, and the old unconditional skip is gone. */
    const route = fs.readFileSync(path.join(ROOT, "server/track1Routes.ts"), "utf8");
    const loop = route.slice(
      route.indexOf("for (const rid of byRoundKeys) {"),
      route.indexOf("const terms = roundStoredTerms(rid);"),
    );
    expect(loop.length).toBeGreaterThan(0);
    /* The zero-share test is still there — R67 forbids removing a branch — but it
       now DISCLOSES instead of returning silently.

       ── RE-POINTED BY WAVE 86B, AND WHY THE PROPERTY IS UNCHANGED ─────────────
       This pinned the LITERAL `if (Number(data.sharesStr) === 0) {`. WAVE 86B made
       the two per-round accumulators exact, so `data.sharesStr` is now an exact
       integer decimal string and the branch reads
       `if (BigInt(data.sharesStr) === BigInt(0)) {`. An exact-zero test done in
       floating point was the last narrowing on this loop: above 2^53 a share count
       that is NOT zero could compare equal to zero, which would push a paid round
       into `excludedFromPayout` — the opposite of what R67F-13 exists to guarantee.
       So this re-point makes the branch STRONGER, not weaker. Nothing else on the
       branch moved: the disclosure, the reason sentence, the `missingFacts` key and
       the convertible-before-zero-share ORDERING are all asserted below, unchanged.
       Evidence: build_log/wave86b/W86B_MONEY_EXACTNESS.md. */
    const ZERO_SHARE_TEST = "if (BigInt(data.sharesStr) === BigInt(0)) {";
    expect(loop).toContain(ZERO_SHARE_TEST);
    /* And the FLOATING-POINT form cannot come back. */
    expect(loop).not.toContain("if (Number(data.sharesStr) === 0) {");
    expect(loop).toContain("excludedFromPayout.push({");
    expect(loop).toContain('missingFacts: ["committed_share_count"]');
    /* And a convertible is classified BEFORE that test — the whole defect in one
       line of ordering. */
    expect(loop.indexOf("CONVERTIBLE_INSTRUMENTS.has(preInstrument)"))
      .toBeLessThan(loop.indexOf(ZERO_SHARE_TEST));
  }, 60_000);

  it("R67F-14 — a SAFE whose converted count floors to ZERO refuses rather than being paid $0", async () => {
    /* A pre-money SAFE whose purchase is tiny relative to its cap, so the converted
       count floors to zero: a $20,000,000 cap over 8,000,000 pre-money shares is
       $2.50 a share (250 minor units), and a $1 purchase (100 minor units) buys
       0.4 of a share. The cap is inside the platform's own recorded domain
       (max 1,000,000,000,000) — this pole is reached with values the product
       accepts, not with a value its writer would reject. */
    const co = await newCompany("f14");
    await addRound(co, "f14safe", "safe_pre", SAFE_TERMS(20_000_000), { shares: "0", amount: "1" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(422);
    expect(res.body.error).toBe("SAFE_CONVERSION_YIELDS_ZERO_SHARES");
    expect(res.body.refusalName).toBe("safe_conversion_yields_zero_shares");
    /* The unrounded count is published so the reader can see how close it was. */
    expect(String(res.body.convertedSharesUnrounded).length).toBeGreaterThan(0);
    expect(String(res.body.message)).toContain("infinite price");
    /* NEVER a 200 paying this holder nothing. */
    expect(res.body.founderProceeds).toBeUndefined();
  }, 60_000);

  it("R67F-15 — a SAFE-only company with NO common on record refuses COMMON_SHARES_NOT_ON_RECORD", async () => {
    /* THE TRAP THIS CLOSES. A convertible round no longer touches
       `nonPreferenceClasses`, so without the fourth clause on the "no ledger data"
       fence this company would be handed `founderProceeds = exitMinor` — told the
       founders keep 100% of an exit while a $10,000,000 SAFE sits on the cap table.
       That is a WORSE version of the defect this wave exists to fix. */
    const co = await newCompany("f15", { seedCommon: false });
    await addRound(co, "f15safe", "safe_post", SAFE_TERMS(20_000_000), { shares: "0", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(422);
    expect(res.body.error).toBe("COMMON_SHARES_NOT_ON_RECORD");
    /* AND EMPHATICALLY NOT the "no ledger data" branch. */
    expect(res.body.founderProceeds).toBeUndefined();
    expect(res.body.ok).toBe(false);
  }, 60_000);

  it("R67F-16 — LEG-SUM IDENTITY: founder + lp + convertible === exit, exactly, on every shape", async () => {
    /* Wave 77 pins `founder + lp === exit` on a preferred fixture. That identity was
       only ever true BECAUSE the convertible leg was missing; with a third leg it
       becomes a three-term identity, and it is asserted here on a cap table that has
       all three at once. */
    const co = await newCompany("f16");
    await addRound(co, "f16pref", "preferred", {
      pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000,
      fdPreMoneyShares: 13_000_000, liquidationPreference: "1x non-participating",
    }, { shares: "4000000", amount: "10000000" });
    await addRound(co, "f16safe", "safe_pre", SAFE_TERMS(20_000_000), { shares: "0", amount: "10000000" });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(200);
    const sum = new D120(String(res.body.founderProceeds))
      .plus(new D120(String(res.body.lpProceeds)))
      .plus(new D120(String(res.body.convertibleProceeds)))
      .toFixed();
    expect(sum).toBe("5000000000");
    /* Nothing is left over inside the engine either. */
    expect(String(res.body.remainder)).toBe("0");
    /* All three legs are non-zero, so this is a real three-term test. */
    expect(new D120(String(res.body.lpProceeds)).gt(0)).toBe(true);
    expect(new D120(String(res.body.convertibleProceeds)).gt(0)).toBe(true);
    expect(new D120(String(res.body.founderProceeds)).gt(0)).toBe(true);
  }, 60_000);

  /* ═════════════════════════════════════════════════════════════════════════════
     R77, R69 AND THE EXACTNESS FENCES.
     ═════════════════════════════════════════════════════════════════════════════ */

  it("R67F-17 — R77: every new identifier is a PAYLOAD value and appears in NO rendered text", () => {
    const IDENTIFIERS = [
      "NOTE_EXIT_CLAIM_NOT_DETERMINABLE",
      "SAFE_CONVERSION_PRICE_NOT_DETERMINABLE",
      "SAFE_MFN_STATUS_NOT_ON_RECORD",
      "SAFE_CONVERSION_YIELDS_ZERO_SHARES",
      "CONVERTIBLE_CASH_OUT_ORDER_NOT_ON_RECORD",
      "CONVERTIBLE_ELECTION_NOT_CONVERGENT",
      "note_exit_claim_not_determinable",
      "safe_conversion_price_not_determinable",
      "safe_mfn_status_not_on_record",
      "safe_conversion_yields_zero_shares",
      "convertible_cash_out_order_not_on_record",
      "convertible_election_not_convergent",
    ];
    /* Every one of them EXISTS on the route \u2014 a fence that passes because the
       identifiers were never emitted would be worthless. */
    const route = fs.readFileSync(path.join(ROOT, "server/track1Routes.ts"), "utf8");
    for (const id of IDENTIFIERS) {
      expect(route, `${id} is not emitted by the route at all`).toContain(id);
    }
    /* And NONE of them appears anywhere under `client/src` \u2014 not in a JSX text
       node, a `title`, an `aria-label`, a `placeholder`, a toast string or a table
       cell. There is no screen for this endpoint today, which is exactly why this
       is cheap to guarantee now. */
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
        const text = fs.readFileSync(p, "utf8");
        for (const id of IDENTIFIERS) if (text.indexOf(id) >= 0) hits.push(`${p}: ${id}`);
      }
    };
    walk(path.join(ROOT, "client/src"));
    expect(hits, `a refusal identifier reached a client surface: ${hits.join(", ")}`).toEqual([]);
  });

  it("R67F-18 — R69: `computeConversionProjections` is untouched and still has no non-test caller", () => {
    /* FOUR AGENTS HAVE PROPOSED EDITING THIS FUNCTION AND ALL FOUR WERE WRONG. This
       wave works on SAFE conversion at exit \u2014 the task most likely to reach for it \u2014
       and did not read it as a fix target, does not call it and does not edit it.
       The live conversion path is the route's own: shares in, sacred engine, payouts
       out. This test exists so that remains checkable. */
    const engineSrc = fs.readFileSync(path.join(ROOT, "server/roundCarryForwardEngine.ts"), "utf8");
    expect(engineSrc).toContain("computeConversionProjections");
    /* The route neither CALLS it nor IMPORTS it. It does MENTION it, by name, in a
       comment warning the next reader off — which is the point, so the check is for
       a call and an import rather than for the string. */
    const route = fs.readFileSync(path.join(ROOT, "server/track1Routes.ts"), "utf8");
    expect(route).not.toContain("computeConversionProjections(");
    expect(route).not.toMatch(/from\s+["']\.\/roundCarryForwardEngine["']/);
    expect(route).not.toMatch(/import\(["']\.\/roundCarryForwardEngine["']\)/);
    /* And it names the ruling, so the next reader is warned in the same place. */
    expect(route).toContain("R69");
  });

  it("R67F-19 — EXACTNESS: no `Decimal.set` and no `Number()` on a money string on the new legs", () => {
    /* COMMENTS STRIPPED, exactly as `W77-M3` does it and for the same reason: this
       file's own comments document the removed defects by name, and deleting the
       history to turn a fence green would be the opposite of the point. */
    const route = fs.readFileSync(path.join(ROOT, "server/track1Routes.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    /* `Decimal.set` mutates the SHARED instance the sacred engine imports and eight
       production consumers read, one of them the sacred cap-table commit store. It
       once faked a result by ~80 orders of magnitude. It is called nowhere here. */
    /* A CALL, not the string: the source warns about `Decimal.set` by name in a
       comment, and a fence that banned the word would have to delete the warning. */
    expect(route, "Decimal.set is called on the waterfall path again").not.toMatch(/Decimal\s*\.\s*set\s*\(/);
    expect(route, "a Decimal clone is being reconfigured on this path").not.toMatch(/\.\s*set\s*\(\s*\{\s*precision/);
    /* And the new legs never coerce a money string to a double (R72 condition 4). */
    for (const forbidden of [
      "Number(c.proceeds)",
      "Number(p.total)",
      "Number(cv.investedMinor)",
      "Number(row.cap)",
      "Number(c.cashOutFloorMinor)",
      "convertibleProceedsExactDec.toNumber()",
      "Number(convertibleProceeds)",
      "Number(res.body.convertibleProceeds)",
    ]) {
      expect(route, `${forbidden} is on the money path`).not.toContain(forbidden);
    }
    /* The convertible leg is summed in Decimal, in ONE place. */
    expect(route).toContain("const convertibleProceedsExactDec = convertibleLeg.reduce<Decimal>(");
  });

  it("R67F-20 — JPY: the convertible leg's minor units come from the round's own currency", async () => {
    /* JPY has an ISO 4217 exponent of ZERO. A hardcoded *100 anywhere on this path
       inflates the cap or the purchase amount 100x and inverts the greater-of test.
       The exponent is derived from the round's currency, exactly as the invested
       figure above it already does. */
    const co = await newCompany("f20jpy", { seedCommon: false });
    const foundationId = createRound({
      companyId: co, name: `${STAMP} Foundation f20jpy`, type: "foundation",
      instrument: "common", pricePerShare: null, currency: "JPY", actorUserId: ADMIN,
    } as never).id;
    const seeded = await request(app).post("/api/founder/captable/seed-founder-shares")
      .set("x-user-id", ADMIN)
      .send({
        companyId: co, roundId: foundationId, shares: "8000000", amount: "8000", currency: "JPY",
        holderFirstName: "Founder", holderLastName: "f20jpy",
      });
    expect(seeded.status, JSON.stringify(seeded.body).slice(0, 300)).toBeLessThan(400);
    const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: co, name: `${STAMP} Under Test f20jpy`, type: "seed", instrument: "safe_pre",
      openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
      currency: "JPY", valuationCap: 20_000_000, discount: 20,
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(200);
    const backfill = await request(app).post("/api/founder/captable/backfill-investor")
      .set("x-user-id", ADMIN)
      .send({
        companyId: co, roundId: String((created.body as { id: string }).id),
        shares: "0", amount: "10000000", currency: "JPY",
        holderFirstName: "Invest", holderLastName: "f20jpy",
        investorEmail: `${STAMP}_f20jpy@example.invalid`,
      });
    expect(backfill.status, JSON.stringify(backfill.body).slice(0, 300)).toBe(201);
    const res = await waterfall(co, "50000000");
    expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(200);
    const conv = (res.body.byConvertible as Array<Record<string, unknown>>)[0];
    /* EXPONENT 0: \u00a520,000,000 of cap is 20,000,000 MINOR units, not 2,000,000,000.
       A hardcoded exponent of 2 would show the latter here. */
    expect(conv.valuationCapMinor).toBe("20000000");
    expect(conv.purchaseAmountMinor).toBe("10000000");
    /* \u00a520,000,000 cap over 8,000,000 shares = \u00a52.50/share -> 4,000,000 shares. */
    expect(conv.convertedShares).toBe("4000000");
    /* And the legs still reconcile exactly at the JPY exit. */
    expect(
      new D120(String(res.body.founderProceeds))
        .plus(new D120(String(res.body.lpProceeds)))
        .plus(new D120(String(res.body.convertibleProceeds)))
        .toFixed(),
    ).toBe("50000000");
  }, 60_000);

  /* ═════════════════════════════════════════════════════════════════════════════
     THE STANDARD ITSELF, AS AN ASSERTION.
     ═════════════════════════════════════════════════════════════════════════════ */

  it("R67F-21 — NO INSTRUMENT IS EVER PAID $0 BY OMISSION: every leg is computed, refused, or disclosed", async () => {
    /* The invariant the whole wave rests on, checked across every instrument the
       platform accepts. For each: either the response REFUSES by name, or the
       instrument appears in a PAID leg, or it appears in `excludedFromPayout` with
       its missing facts named. What is not allowed is silence. */
    const CASES: ReadonlyArray<[string, string, Record<string, unknown>, string]> = [
      ["s21post", "safe_post", SAFE_TERMS(20_000_000), "0"],
      ["s21pre", "safe_pre", SAFE_TERMS(20_000_000), "0"],
      ["s21note", "convertible_note", { valuationCap: 20_000_000, discount: 20, interestRate: 8, maturityMonths: 24 }, "0"],
      ["s21warr", "warrant", { strikePrice: 1.5, sharesAuthorized: 1_000_000, expiryYears: 5 }, "4000000"],
      ["s21pool", "option_pool", { poolSize: 1_000_000, poolTiming: "post_money", vestingMonths: 48, cliffMonths: 12 }, "4000000"],
      ["s21common", "common", { pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000 }, "4000000"],
      ["s21pref", "preferred", { pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000, liquidationPreference: "1x non-participating" }, "4000000"],
    ];
    for (const [key, instrument, terms, shares] of CASES) {
      const co = await newCompany(key);
      const roundId = await addRound(co, key, instrument, terms, { shares, amount: "10000000" });
      const res = await waterfall(co);
      if (res.status === 422) {
        /* A REFUSAL IS AN ACCEPTABLE OUTCOME — and it must name itself and explain. */
        expect(String(res.body.error).length, `${instrument}: refusal has no name`).toBeGreaterThan(0);
        expect(String(res.body.message).length, `${instrument}: refusal has no prose`).toBeGreaterThan(200);
        expect(res.body.founderProceeds, `${instrument}: a figure was published with a refusal`).toBeUndefined();
        continue;
      }
      expect(res.status, `${instrument}: neither 200 nor 422`).toBe(200);
      const paidLegs = [
        ...(res.body.byConvertible as Array<{ roundId: string; proceeds: string }>),
      ];
      const excluded = res.body.excludedFromPayout as Array<{ roundId: string; missingFacts: string[] }>;
      const npc = res.body.nonPreferenceClasses as Array<{ roundId: string }>;
      const byClass = res.body.byShareClass as Array<{ classId?: string }>;
      const accountedFor =
        paidLegs.some((c) => c.roundId === roundId) ||
        excluded.some((e) => e.roundId === roundId) ||
        npc.some((d) => d.roundId === roundId) ||
        byClass.some((c) => String(c.classId) === roundId);
      expect(
        accountedFor,
        `${instrument}: the round is paid $0 BY OMISSION — it appears in no leg, no exclusion and no disclosure`,
      ).toBe(true);
      /* And where it is excluded, the exclusion states WHY. */
      for (const e of excluded) {
        expect(e.missingFacts.length, `${instrument}: an exclusion with no missing facts named`).toBeGreaterThan(0);
      }
    }
  }, 180_000);
});
