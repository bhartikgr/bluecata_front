/**
 * WAVE 74 — R67: THE LIQUIDATION-PREFERENCE REFUSAL IS SCOPED TO PREFERRED SHARES.
 *
 * Owner ruling R67 (2026-08-18), on R66's clarification of Q2. Wave 71's D11
 * refusal was correct and is NOT removed here; it fired on all SEVEN instrument
 * values the platform accepts, and only `preferred` carries a liquidation
 * preference. This file drives BOTH poles R67 condition 5 names, through the real
 * HTTP route, and pins the two properties that make the change safe.
 *
 * WHY EVERY POLE IS HTTP AND NOT A UNIT CALL (R58): the refusal lives inside
 * `handleWaterfall`, a route handler, and the only surface that can reach it is
 * `GET /api/founder/captable/waterfall`. A unit test would have to re-implement
 * the loop it is meant to be checking.
 *
 * R67 CONDITION 3 — `seed-founder-shares` is in the matrix by name. Every company
 * below gets its founder common block through
 * `POST /api/founder/captable/seed-founder-shares`, because that is the reachable
 * creator of the rounds this refusal was firing on, and because the common leg is
 * what every figure below the preference stack is divided by.
 *
 * MUTATION TRANSCRIPTS: build_log/wave74/W74_TESTS.md.
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
/* WAVE 88 — exact reconciliation of the three legs. `Decimal.clone` gives this
   test its OWN instance; `Decimal.set` is NEVER called, because it mutates the
   shared instance the sacred engine imports and once faked a result by ~80 orders
   of magnitude. Same construction as `w79_waterfall_split_seniority_and_clock`. */
import { Decimal } from "decimal.js";
const D120 = Decimal.clone({ precision: 120 });

const ROOT = path.resolve(__dirname, "../..");
const ROUTE_SRC = path.join(ROOT, "server/track1Routes.ts");
const src = (): string => fs.readFileSync(ROUTE_SRC, "utf8");

const ADMIN = "u_admin";
const EXIT_MINOR = "5000000000"; // $50,000,000.00 — the fixed exit value
const STAMP = `w74t${Date.now().toString(36)}`;

let app: Express;

/** Build one company holding: a founder common block + one round under test. */
async function buildCompany(opts: {
  key: string;
  instrument: string;
  liquidationPreference?: string;
}): Promise<string> {
  const companyId = `co_${STAMP}_${opts.key}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W74 ${opts.key}` });
  expect(co.status, `company create for ${opts.key}`).toBeLessThan(400);

  /* R67 CONDITION 3 — the reachable creator, by name. The foundation round must
     carry no price-per-share (the route refuses a priced one) and is created
     through the store exactly as `v25_54_fixes.test.ts::seedRound` does. */
  const foundationId = createRound({
    companyId, name: `${STAMP} Foundation ${opts.key}`, type: "foundation",
    instrument: "common", pricePerShare: null, actorUserId: ADMIN,
  }).id;
  const seeded = await request(app).post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({
      companyId, roundId: foundationId, shares: "8000000", amount: "8000",
      currency: "USD", holderFirstName: "Founder", holderLastName: opts.key,
    });
  expect(seeded.status, `seed-founder-shares for ${opts.key}`).toBe(201);

  const priced = opts.instrument === "preferred" || opts.instrument === "common";
  const terms: Record<string, unknown> = priced
    ? { pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000 }
    : opts.instrument === "warrant"
      ? { strikePrice: 1.5, sharesAuthorized: 1_000_000, expiryYears: 5 }
      : opts.instrument === "option_pool"
        ? { poolSize: 1_000_000, poolTiming: "post_money", vestingMonths: 48, cliffMonths: 12 }
        : opts.instrument === "convertible_note"
          ? { valuationCap: 20_000_000, discount: 20, interestRate: 8, maturityMonths: 24 }
          : { valuationCap: 20_000_000, discount: 20 };

  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
    companyId, name: `${STAMP} Under Test ${opts.key}`, type: "seed",
    instrument: opts.instrument, openDate: "2026-01-01", closeDate: "2026-12-31",
    targetAmount: 10_000_000, ...terms,
    /* Recorded AT CREATION deliberately: `PATCH /api/rounds/:id/terms` returns
       200 and silently drops this key (W74 finding N-2, see W74_TESTS.md), so
       creation is the only surface that persists it. */
    ...(opts.liquidationPreference ? { liquidationPreference: opts.liquidationPreference } : {}),
  });
  expect(created.status, `round create for ${opts.key}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(200);
  const roundId = String((created.body as { id: string }).id);

  const backfill = await request(app).post("/api/founder/captable/backfill-investor")
    .set("x-user-id", ADMIN)
    .send({
      companyId, roundId,
      /* The commit store's own rules: a priced round couples shares to
         floor(amount/pps); an unpriced one must carry no share count at all. */
      shares: priced ? String(Math.floor(10_000_000 / 2.5))
        : opts.instrument === "warrant" || opts.instrument === "option_pool" ? "4000000" : "0",
      amount: "10000000", currency: "USD",
      holderFirstName: "Invest", holderLastName: opts.key,
      investorEmail: `${STAMP}_${opts.key}@example.invalid`,
    });
  expect(backfill.status, `backfill for ${opts.key}`).toBe(201);
  return companyId;
}

const waterfall = (companyId: string) =>
  request(app).get("/api/founder/captable/waterfall")
    .query({ companyId, exitValuationMinor: EXIT_MINOR })
    .set("x-user-id", ADMIN);

describe("W74 · R67 — the liquidation-preference refusal is scoped to preferred shares", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     POLE 1 (R67 condition 1 and condition 5, first half) — THE HALF THAT IS
     CORRECT TODAY AND MUST NOT MOVE.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W74-R67-A — a `preferred` round with NO recorded preference STILL REFUSES, by name", async () => {
    const co = await buildCompany({ key: "prefNoTerm", instrument: "preferred" });
    const res = await waterfall(co);
    expect(res.status).toBe(422);
    /* By NAME — all four of the refusal's identifying fields, so a rename is a
       failure rather than a silent reshape. */
    expect(res.body.error).toBe("LIQUIDATION_TERM_NOT_ON_RECORD");
    expect(res.body.refusal).toBe("liquidation_term_not_on_record");
    expect(res.body.refusalName).toBe("liquidation_term_not_on_record");
    expect(res.body.field).toBe("liquidationPreference");
    /* And it still EXPLAINS itself — this is the sentence that caught the
       fabrication, and a refusal reduced to a code is a regression (Wave 73). */
    expect(String(res.body.message).length).toBeGreaterThan(200);
    expect(String(res.body.message)).toContain("non-participating");
    /* NO payout schedule is emitted alongside the refusal. */
    expect(res.body.founderProceeds).toBeUndefined();
    expect(res.body.ok).toBe(false);
  }, 60_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     POLE 2 (R67 condition 4 and condition 5, second half) — THE SIX INSTRUMENTS
     THAT CANNOT CARRY THE TERM NO LONGER REFUSE.
     ═══════════════════════════════════════════════════════════════════════════ */
  /* `carriesShares` records a PRE-EXISTING fact this wave measured rather than
     assumed, and it is the reason the poles below differ. `handleWaterfall`
     opens its loop with `if (Number(data.sharesStr) === 0) continue;`, and the
     commit store REFUSES a share count on an unpriced instrument
     (`unexpected_shares_on_unpriced`). So a SAFE or note commit carries zero
     shares and is skipped BEFORE it can reach either the refusal or the new
     condition. Wave 74 did not introduce that and deliberately does not change
     it — R67 authorises narrowing ONE condition, not widening the loop. It is
     recorded as W74 finding N-3 and Owner Question Q4. */
  const NON_PREFERENCE: ReadonlyArray<[string, string, boolean]> = [
    ["safePost", "safe_post", false],
    ["safePre", "safe_pre", false],
    ["note", "convertible_note", false],
    ["warrant", "warrant", true],
    ["optionPool", "option_pool", true],
    ["common", "common", true],
  ];

  /* ════════════════════════════════════════════════════════════════════
     UPDATED BY WAVE 88 — W74 FINDING N-3 IS CLOSED, SO THIS POLE HAD TO MOVE.
     ════════════════════════════════════════════════════════════════════
     The block below used to assert, for the three CONVERTIBLE instruments, that
     the round "appears NOWHERE on the response" and that its $10,000,000 of
     invested capital is "invisible to the waterfall" — recorded deliberately, with
     the instruction that "a future wave that closes it fails HERE and has to say
     so". This is that wave, and this is it saying so.

     WHAT WAS ACTUALLY HAPPENING, and why the recorded gap was worse than it read:
     the SAFE was not merely invisible, it was PAID $0 while the founders were paid
     the entire $50,000,000 exit. A $10,000,000 instrument outstanding on the cap
     table, with its valuation cap on record, was shown nothing and not even named.

     AFTER WAVE 88, per instrument:
       · `safe_post` / `safe_pre` — still HTTP 200, and the SAFE is now NAMED and
         PAID in `byConvertible`. It is deliberately still absent from
         `nonPreferenceClasses`: that array is the preference-stack disclosure, and
         a paid leg is not a disclosure of an exclusion.
       · `convertible_note` — now HTTP 422 `NOTE_EXIT_CLAIM_NOT_DETERMINABLE`. This
         is an INTENTIONAL loss of a 200. A note's claim is principal plus accrued
         interest, this route has no exit date, no day-count convention and no
         change-of-control multiple, and the measured spread between the two ends of
         the range is $1,687,763.71 on one fixture. R67 condition 4 said these
         instruments must not be refused FOR LACKING A LIQUIDATION PREFERENCE, and
         they are not: this refusal names a different, real, missing fact. */
  const CONVERTIBLE_AFTER_W88: ReadonlySet<string> = new Set(["safe_post", "safe_pre"]);

  for (const [key, instrument, carriesShares] of NON_PREFERENCE) {
    if (instrument === "convertible_note") {
      it(`W74-R67-B · ${instrument} — REFUSES BY NAME after Wave 88, and is never paid $0`, async () => {
        const co = await buildCompany({ key: `np_${key}`, instrument });
        const res = await waterfall(co);
        expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(422);
        expect(res.body.error).toBe("NOTE_EXIT_CLAIM_NOT_DETERMINABLE");
        expect(res.body.refusal).toBe("note_exit_claim_not_determinable");
        expect(res.body.refusalName).toBe("note_exit_claim_not_determinable");
        expect(res.body.field).toBe("interestRate");
        /* NOT the liquidation-preference refusal R67 removed for this instrument. */
        expect(res.body.error).not.toBe("LIQUIDATION_TERM_NOT_ON_RECORD");
        /* It NAMES what is missing, machine-readably, so a caller can act on it. */
        expect(res.body.missingFacts).toEqual([
          "exit_date", "day_count_convention", "change_of_control_repayment_multiple",
        ]);
        /* And it explains itself in prose — a refusal reduced to a code is a
           regression (Wave 73). */
        expect(String(res.body.message).length).toBeGreaterThan(200);
        expect(String(res.body.message)).toContain("ACCRUED");
        expect(String(res.body.message)).toContain("NO EXIT DATE");
        expect(String(res.body.message)).toContain("DAY-COUNT CONVENTION");
        /* NO FIGURE IS PUBLISHED. Not a payout schedule, and above all NOT a $0. */
        expect(res.body.founderProceeds).toBeUndefined();
        expect(res.body.convertibleProceeds).toBeUndefined();
        expect(res.body.ok).toBe(false);
      }, 60_000);
      continue;
    }
    it(`W74-R67-B · ${instrument} — computes and no longer refuses (R67 condition 4)`, async () => {
      const co = await buildCompany({ key: `np_${key}`, instrument });
      const res = await waterfall(co);
      /* It COMPUTES. This is the whole of R67 condition 4's second pole, and the
         reason it now computes is that the founder's OWN common-share block —
         seeded by `seed-founder-shares`, 8,000,000 shares, no liquidation
         preference because common stock cannot have one — is no longer refused. */
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
      expect(res.body.ok).toBe(true);
      /* WAVE 77 · R72 — was `"number"`. The money fields are now exact decimal
         TEXT (an authorised interface change; every consumer was enumerated first
         in build_log/wave77/W77_MONEY_CONSUMERS.md). The property this pole
         actually asserts — the route COMPUTES rather than refusing — is unchanged. */
      expect(typeof res.body.founderProceeds).toBe("string");

      /* NO SILENT DROP — the key is ALWAYS present, and the founder's own common
         block is always in it, so a consumer never has to guess whether an
         absent key means "none" or "an older build". */
      expect(Array.isArray(res.body.nonPreferenceClasses)).toBe(true);
      const disclosed = res.body.nonPreferenceClasses as Array<Record<string, unknown>>;
      const foundation = disclosed.find((d) => String(d.className).includes("Foundation"));
      expect(foundation, "the founder's own common block was dropped").toBeDefined();
      expect(String(foundation!.instrument)).toBe("common");
      expect(String(foundation!.reason)).toContain("no liquidation preference");
      expect(Number(foundation!.shares)).toBe(8_000_000);

      const mine = disclosed.find((d) => String(d.className).includes("Under Test"));
      if (carriesShares) {
        /* A share-carrying non-preference round is disclosed in its own right. */
        expect(mine, `${instrument} was dropped from nonPreferenceClasses`).toBeDefined();
        expect(String(mine!.instrument)).toBe(instrument);
        expect(String(mine!.roundId).length).toBeGreaterThan(0);
        /* And it is NOT smuggled into the preference stack. */
        const byClass = res.body.byShareClass as Array<{ classId?: string }>;
        expect(byClass.some((c) => String(c.classId) === String(mine!.roundId))).toBe(false);
      } else {
        /* W74 FINDING N-3, PINNED AS THE PRE-EXISTING BEHAVIOUR IT IS: an
           unpriced SAFE/note commit carries no share count, so the zero-share
           `continue` at the top of the loop skips it and it appears NOWHERE on
           the response — not in `byShareClass`, not in `nonPreferenceClasses`.
           Its $10,000,000 of invested capital is therefore invisible to the
           waterfall. This assertion exists so the gap is a recorded fact rather
           than a surprise, and so a future wave that closes it fails HERE and
           has to say so. */
        /* WAVE 88 — STILL absent from `nonPreferenceClasses`, for a DIFFERENT and
           deliberate reason: a SAFE is no longer a disclosed exclusion, it is a
           PAID LEG. N-3 is closed, and the assertion that closes it is below. */
        expect(mine, `${instrument} must not be in the preference-stack disclosure`).toBeUndefined();
        expect(CONVERTIBLE_AFTER_W88.has(instrument), "unexpected instrument on this path").toBe(true);
        /* ── W74 FINDING N-3, CLOSED AND ASSERTED ────────────────────────────
           The $10,000,000 is no longer invisible: the instrument is NAMED, its
           purchase amount and cap are on the response, and it is PAID a figure
           greater than zero. */
        const byConv = res.body.byConvertible as Array<Record<string, unknown>>;
        expect(Array.isArray(byConv), "byConvertible is missing").toBe(true);
        const paid = byConv.filter((c) => String(c.className).includes("Under Test"))[0];
        expect(paid, `${instrument}: the convertible is STILL not named — N-3 has reopened`).toBeDefined();
        expect(String(paid.instrument)).toBe(instrument);
        expect(paid.purchaseAmountMinor).toBe("1000000000");
        expect(paid.valuationCapMinor).toBe("2000000000");
        expect(String(paid.election)).toBe("as_converted");
        expect(new D120(String(paid.proceeds)).gt(0), "the SAFE is being paid $0 again").toBe(true);
        /* THE FOUNDERS ARE NO LONGER PAID THE WHOLE EXIT. */
        expect(String(res.body.founderProceeds)).not.toBe("5000000000");
        /* And the three legs still reconcile to the exit EXACTLY. */
        expect(
          new D120(String(res.body.founderProceeds))
            .plus(new D120(String(res.body.lpProceeds)))
            .plus(new D120(String(res.body.convertibleProceeds)))
            .toFixed(),
        ).toBe("5000000000");
      }
    }, 60_000);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     THE MONEY — R67 condition 2's figure, asserted rather than merely reported.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W74-R67-C — a `preferred` round WITH a recorded preference computes Wave 71's own verified figure", async () => {
    /* This is the exact fixture D11(3) documented in `server/track1Routes.ts`:
       one $10,000,000 1x non-participating class of 4,000,000 shares, 8,000,000
       REAL founder common shares, a $50,000,000 exit. D11 recorded that the
       fabricated common count of 4,000,000 paid founders $25,000,000 and the real
       count of 8,000,000 pays them $33,333,333.33 — understating them by
       $8,333,333.33. Before R67 this round could not produce a figure AT ALL,
       because the founder's own common block tripped the over-broad refusal
       first. Now it produces D11's number, which is independent corroboration
       that scoping the refusal did not disturb the arithmetic Wave 71 fixed. */
    const co = await buildCompany({
      key: "prefWithTerm", instrument: "preferred",
      liquidationPreference: "1x non-participating",
    });
    const res = await waterfall(co);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    /* $33,333,333.33 in minor units — D11's own figure, reproduced.
       W74 FINDING N-4, recorded rather than rounded away: this route sums minor
       units with `+ Number(p.total)` in a JS float, so the value that actually
       comes back is 3333333333.3333335 — a THIRD of a cent of floating-point
       residue on a payout figure. Pre-existing (the reduce is Wave 71b's, and the
       engine itself works in exact decimals); asserted here to the cent, with the
       residue named, because silently widening the tolerance without saying so is
       how a money defect survives a review. */
    /* ── WAVE 77 · R72 — W74 FINDING N-4 IS NOW FIXED, NOT JUST NAMED ─────────
       The three assertions this block used to make (`toBeCloseTo`, and two
       `Math.round(Number(...))`) existed to name a third of a cent of IEEE-754
       residue that the route could not then avoid. R72 removed the cause: the
       figure is carried as the engine's own decimal string. So the residue value
       `3333333333.3333335` is asserted ABSENT, the exact strings are pinned from
       an executed run (`build_log/wave77/W77_MONEY_TRANSCRIPT_RAW.txt`), and no
       `Number(...)` is applied to a money string here any more — that narrowing is
       the defect R72 condition 4 forbids reintroducing.
       NO MONEY MOVED: 3,333,333,333.33… and 1,666,666,666.66… minor units are the
       same figures Wave 71 verified, to more digits than a double can hold. */
    expect(res.body.founderProceeds).not.toBe(3333333333.3333335);
    expect(res.body.founderProceeds).not.toBe("3333333333.3333335");
/* ── UPDATED BY WAVE 81 · ITEM 1 (D3): 40 SIGNIFICANT DIGITS -> 38 ─────────────
       THIS ASSERTION PINNED AN UNDECLARED CONFIGURATION. The engine declares
       `precision: 38, rounding: ROUND_HALF_EVEN`, but until Wave 81 it set that on
       the SHARED decimal.js constructor, and `packages/math-fns/src/index.ts` set
       the SAME constructor to `precision: 40, rounding: ROUND_HALF_UP`. Six server
       modules import `@capavate/math-fns`, so in the server process — and in this
       test — math-fns loaded LAST and the engine actually ran at 40 / HALF_UP. The
       figure below therefore had 40 significant digits because of an import order,
       not because of anything the engine promised.

       WAVE 81 gives the engine its OWN `Decimal.clone({ 38, ROUND_HALF_EVEN })`, so
       its arithmetic is the same in every process and matches what it declares. The
       string is two significant digits shorter and is otherwise the same number.
       NO MONEY MOVED at any granularity a person or a ledger can see: the change is
       in significant digits 39 and 40 of a minor-unit figure.

       PROVEN NOT TO MOVE A PUBLISHED FIGURE: all 14 engine-executing transcripts of
       the QA document already ran at 38 / HALF_EVEN (their harnesses do not load
       math-fns) and re-run BYTE-IDENTICAL after this wave —
       `build_log/wave81/W81_QA_TRANSCRIPT_DIFF.txt`. The document was right about
       the engine; production was not, and now is.
       ─────────────────────────────────────────────────────────────────────────── */
        expect(res.body.founderProceeds).toBe("3333333333.3333333333333333333333333333");
    /* And the preference leg takes the balance of the exit, not a share of it. */
    expect(res.body.lpProceeds).toBe("1666666666.6666666666666666666666666667");
    /* The two legs reconcile to the exit EXACTLY — in integer arithmetic on the
       decimal strings, so the check itself never touches a float either. */
    {
      const dp = 40;
      const scale = (x: string): bigint => {
        const [i, f = ""] = String(x).split(".");
        return BigInt(i + (f + "0".repeat(dp)).slice(0, dp));
      };
      expect(scale(res.body.founderProceeds) + scale(res.body.lpProceeds))
        .toBe(scale("5000000000"));
    }
    /* The preferred class IS in the preference stack — it was not scoped out. */
    const byClass = res.body.byShareClass as Array<{ className?: string }>;
    expect(byClass.length).toBeGreaterThan(0);
  }, 60_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     THE TWO STRUCTURAL PROPERTIES THAT MAKE THIS SAFE. Read off the source, so
     a future wave that widens the change fails here rather than in review.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W74-R67-D — the refusal, its container and its branch are all still present (R67 condition 1)", () => {
    const s = src();
    /* \"We cannot disable vehicles.\" The refusal is a value replaced, never a
       container removed. */
    expect(s).toContain('error: "LIQUIDATION_TERM_NOT_ON_RECORD"');
    expect(s).toContain('refusal: "liquidation_term_not_on_record"');
    expect(s).toContain('refusalName: "liquidation_term_not_on_record"');
    expect(s).toContain('field: "liquidationPreference"');
    /* The CONDITION is untouched — this is the half R67 says is correct today. */
    expect(s).toContain(
      "if (terms.liquidationPreferenceMultiple === null || terms.participatingPreferred === null) {",
    );
    /* The sibling refusal is untouched too. */
    expect(s).toContain('error: "COMMON_SHARES_NOT_ON_RECORD"');
  });

  it("W74-R67-E — the narrowing is a POSITIVE membership test, so nothing can be moved INTO the refusal", () => {
    /* THE SAFETY ARGUMENT, PINNED. The set is asked \"is this definitely one of
       the six?\" — never \"is this not preferred?\". A round whose instrument is
       absent, empty or unrecognised therefore keeps today's behaviour exactly,
       and the change can only ever turn a refusal into a computation. If a
       future wave inverts this to a negative test (`!== "preferred"`), an
       unrecorded instrument silently starts computing and this fails. */
    const s = src();
    expect(s).toContain("NON_PREFERENCE_INSTRUMENTS");
    expect(s).toContain("if (NON_PREFERENCE_INSTRUMENTS.has(roundInstrument)) {");
    /* The negative forms are ABSENT. */
    expect(s).not.toContain('roundInstrument !== "preferred"');
    expect(s).not.toContain('instrument !== "preferred"');
    /* Exactly the six values, and `preferred` is NOT among them. */
    const set = s.slice(
      s.indexOf("const NON_PREFERENCE_INSTRUMENTS"),
      s.indexOf("]);", s.indexOf("const NON_PREFERENCE_INSTRUMENTS")),
    );
    for (const v of ["safe_post", "safe_pre", "convertible_note", "warrant", "option_pool", "common"]) {
      expect(set, `${v} missing from the set`).toContain(`"${v}"`);
    }
    expect(set).not.toContain('"preferred"');
    /* R16 / the unit discipline: no magnitude heuristic anywhere near this. */
    expect(s).not.toContain("> 1 ? ");
  });

  it("W74-R67-F — the `no ledger data` shortcut cannot hand a founder 100% of an exit it never computed", () => {
    /* That branch returns `founderProceeds: exitMinor` — the ENTIRE exit —
       without ever consulting the common-share count. Before R67 a SAFE-only
       company could not reach it (the refusal stopped first). It must not now
       arrive there and be told it owns the whole exit: that is the fabricated
       money figure class R48 rules out. */
    const s = src();
    /* ── UPDATED BY WAVE 88 ────────────────────────────────────────────────────
       THE FENCE IS STRICTLY STRONGER, AND THAT IS WHY THIS STRING CHANGED. Wave 88
       routes a convertible round out of the classification loop through
       `convertibleRounds`, so it never touches `nonPreferenceClasses` and R67's
       three-clause fence would no longer have stopped a SAFE-only company from
       reaching this branch and being handed 100% of the exit. A FOURTH clause was
       added, `convertibleRounds.length === 0`, and the condition was wrapped over
       two lines. Asserted here clause by clause rather than as one literal, so a
       future reformat does not fail this test while a REMOVED clause still does.
       Wave 88's `R67F-15` asserts the same property at runtime: a SAFE-only
       company with no common on record refuses `COMMON_SHARES_NOT_ON_RECORD`
       rather than reaching this branch. */
    const fence = s.slice(
      s.indexOf("if (\n    totalPrefSharesNum === 0"),
      s.indexOf("// No ledger data — return zero proceeds with empty breakdown"),
    );
    expect(fence.length, "the `no ledger data` fence was not found at all").toBeGreaterThan(0);
    for (const clause of [
      "totalPrefSharesNum === 0",
      "preferred.length === 0",
      "nonPreferenceClasses.length === 0",
      /* WAVE 88 — the new clause. Without it a $10,000,000-SAFE-only company is
         told the founders keep the entire exit. */
      "convertibleRounds.length === 0",
    ]) {
      expect(fence, `${clause} is no longer fencing the \`no ledger data\` branch`).toContain(clause);
    }
  });
});
