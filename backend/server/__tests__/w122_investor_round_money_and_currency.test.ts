/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 122 · FINDINGS 1 & 2 — THE TWO INVESTOR-FACING ROUND PAYLOADS.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * FINDING 1 (Reviewer C, C-01/C-02 — the owner's original complaint, still live).
 * `rounds.raised_amount` is `NOT NULL DEFAULT 0`, is inserted as the literal `0`
 * (`server/roundsStore.ts:278,326`), and is EXCLUDED from the accepted patch keys
 * of the round-terms route (`server/routes.ts:7773`). Nothing in the product
 * writes it. Both investor-facing projections published it anyway:
 *
 *     server/routes.ts:4262   raisedAmount: round?.raisedAmount ?? 0     (LIST)
 *     server/routes.ts:4371   raisedAmount: round?.raisedAmount ?? 0     (DETAIL)
 *
 * so every real round showed an invited investor "$0 soft-circled of $5M · 0%"
 * with an empty progress bar that could never fill. Two lines below the LIST
 * occurrence, `minTicket` and `preMoney` had already been changed `?? 0` -> `??
 * null` under owner ruling R6, with the reasoning in a comment. This wave applies
 * the same principle to the field between them and adds the DERIVED figure the
 * founder side has carried since Wave 114 (`server/lib/roundRaisedTotals.ts` via
 * the in-scope `roundMoneyOnRecordForRound` helper) — reused, not reinvented, so
 * no sixth committed register is created.
 *
 * FINDING 2 (C-20). The DETAIL projection sent `currency: round?.currency ?? "USD"`
 * — a guess about the denomination of someone else's money — and the LIST payload
 * type in the browser had no `currency` field at all, so a €2,000,000 round was
 * shown as $2,000,000. The guess is gone; a genuinely recorded currency still
 * travels unchanged.
 *
 * ── HOW THIS FILE FAILS ON THE OLD CODE ─────────────────────────────────────
 * It drives the REAL `registerRoutes` stack over supertest and reads the REAL
 * HTTP body. Against the pre-change tree:
 *   · `expect(row.raisedAmount).toBeNull()`        fails with `expected 0 to be null`
 *   · every `moneyOnRecord` assertion               fails with `undefined`
 *   · `expect(res.body.currency).toBeNull()`        fails with `expected 'USD' to be null`
 * Recorded verbatim in build_log/wave122/W122_TESTS.md.
 *
 * ── BOTH POLES ──────────────────────────────────────────────────────────────
 * POLE A  a round with a REAL BOOK  -> a NON-ZERO figure, with the state NAMED,
 *                                      and a derived progress ratio.
 * POLE B  a round with NOTHING on record -> a SENTENCE, NO figure, and a null
 *                                      progress ratio so no bar can be drawn.
 * A fix that only satisfied pole A could print a confident $0 again; a fix that
 * only satisfied pole B could refuse on every round and hide real money. Both
 * halves run against real fixture rows.
 *
 * ── WHAT IS NOT TOUCHED ─────────────────────────────────────────────────────
 * `computeConversionProjections` is not imported. No sacred file is read into a
 * mutation. No authentication or session behaviour is exercised or changed (R90):
 * every request below authenticates exactly the way the existing
 * `wave42_r6_valuation_serializer.test.ts` does.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

/* Force the PRODUCTION invitation path. With the demo gate open the LIST handler
   short-circuits to the in-memory `incomingInvitations` mock array and never
   reaches the projection under test — the check would pass while checking
   nothing. Same reasoning and same mock as the Wave 42 R6 serializer test. */
vi.mock("../lib/demoGate", () => ({
  DEMO_SEED_ENABLED: false,
  isDemoSeedEnabled: () => false,
}));

import { registerRoutes } from "../routes";
import { createRound } from "../roundsStore";
import { _testAccessInvitations } from "../roundInvitationsStore";
import { createSoftCircle } from "../softCircleStore";
import {
  readRoundMoneyOnRecord,
  progressBarPercent,
  ROUND_MONEY_STATE_LABEL,
} from "../../shared/roundMoneyOnRecordView";

let app: Express;
let server: http.Server;

const INVESTOR_ID = "u_lapsed_lp";
const INVESTOR_EMAIL = "lp@lapsed-fund.example";
const STAMP = Date.now();
const COMPANY_ID = `co_w122_${STAMP}`;

/** A EUR round with a real book. €2,000,000 target. */
let ROUND_BOOK = "";
/** A USD round with an empty book — nothing has been entered on it at all. */
let ROUND_EMPTY = "";
/** A round whose currency was never recorded. */
let ROUND_NO_CURRENCY = "";

let INV_BOOK = "";
let INV_EMPTY = "";
let INV_NO_CURRENCY = "";

function pushInvitation(id: string, roundId: string) {
  const now = new Date().toISOString();
  _testAccessInvitations.rows.push({
    id,
    tenantId: `tenant_${STAMP}`,
    roundId,
    companyId: COMPANY_ID,
    investorEmail: INVESTOR_EMAIL,
    investorName: "Lapsed LP",
    investorFirstName: null,
    investorLastName: null,
    state: "sent",
    classification: null,
    tokenHash: `hash_${id}`,
    invitedByUserId: null,
    note: null,
    sentAt: now,
    viewedAt: null,
    redeemedAt: null,
    redeemedByUserId: null,
    expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    createdAt: now,
    updatedAt: now,
  } as any);
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  /* POLE A — a round with money genuinely on its book, denominated in EUR so
     Finding 2 is exercised by the same fixture. €2,000,000 target. */
  const withBook = createRound({
    companyId: COMPANY_ID,
    name: `W122 book ${STAMP}`,
    type: "seed",
    state: "open",
    currency: "EUR",
    targetAmount: 2_000_000,
    preMoney: 8_000_000,
    minTicket: 50_000,
  });
  ROUND_BOOK = withBook.id;

  /* One non-binding intent, one signed commitment, one recorded wire, and one
     declined row that must be excluded. Exactly the shape Wave 114 fixtures use. */
  createSoftCircle({ roundId: ROUND_BOOK, companyId: COMPANY_ID, investorName: "Intent Ida", amount: 50_000, currency: "EUR", status: "intent" });
  createSoftCircle({ roundId: ROUND_BOOK, companyId: COMPANY_ID, investorName: "Committed Cara", amount: 150_000, currency: "EUR", status: "confirmed" });
  createSoftCircle({ roundId: ROUND_BOOK, companyId: COMPANY_ID, investorName: "Wired Walt", amount: 300_000, currency: "EUR", status: "wired" });
  createSoftCircle({ roundId: ROUND_BOOK, companyId: COMPANY_ID, investorName: "Declined Dana", amount: 999_000, currency: "EUR", status: "declined" });

  /* POLE B — a real, open round on which NOTHING has been entered. This is the
     common case in a fresh workspace, and the case that used to print "$0". */
  const empty = createRound({
    companyId: COMPANY_ID,
    name: `W122 empty ${STAMP}`,
    type: "seed",
    state: "open",
    currency: "USD",
    targetAmount: 5_000_000,
  });
  ROUND_EMPTY = empty.id;

  /* FINDING 2 pole — no currency on record. The DETAIL projection used to call
     this one "USD". */
  const noCurrency = createRound({
    companyId: COMPANY_ID,
    name: `W122 no currency ${STAMP}`,
    type: "seed",
    state: "open",
    currency: null,
    targetAmount: 1_000_000,
  });
  ROUND_NO_CURRENCY = noCurrency.id;

  INV_BOOK = `inv_w122_book_${STAMP}`;
  INV_EMPTY = `inv_w122_empty_${STAMP}`;
  INV_NO_CURRENCY = `inv_w122_nocur_${STAMP}`;
  pushInvitation(INV_BOOK, ROUND_BOOK);
  pushInvitation(INV_EMPTY, ROUND_EMPTY);
  pushInvitation(INV_NO_CURRENCY, ROUND_NO_CURRENCY);
});

function get(path: string) {
  return request(app).get(path).set("x-user-id", INVESTOR_ID);
}

async function listRow(invId: string) {
  const res = await get("/api/investor/invitations");
  expect(res.status).toBe(200);
  const rows = Array.isArray(res.body) ? res.body : [];
  const row = rows.find((r: any) => r?.id === invId);
  expect(
    row,
    `invitation ${invId} must appear in the LIST response — if it does not, this ` +
    `file is asserting against nothing and every verdict below is meaningless`,
  ).toBeTruthy();
  return row as Record<string, unknown>;
}

/* ══════════════════════════════════════════════════════════════════════════
   0 · THE FIXTURES MUST BE REAL BEFORE ANY VERDICT IS DRAWN FROM THEM.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W122 · the fixtures themselves (guard against a vacuous pass)", () => {
  it("W122-F0-01 · the book round really holds three countable rows and one excluded one", async () => {
    const { listForRound } = await import("../softCircleStore");
    const rows = listForRound(ROUND_BOOK);
    expect(rows.length, "four rows were written for the book round").toBe(4);
    expect(rows.filter((r) => r.status === "declined").length).toBe(1);
    /* Money is stored in MINOR units. €150,000 = 15,000,000 minor. No
       arithmetic on money happens in this file beyond reading those integers. */
    expect(rows.find((r) => r.status === "confirmed")?.amountMinor).toBe(15_000_000);
    expect(rows.find((r) => r.status === "wired")?.amountMinor).toBe(30_000_000);
  });

  it("W122-F0-02 · the empty round really has NO rows, and the two fixtures are different states", async () => {
    const { listForRound } = await import("../softCircleStore");
    expect(listForRound(ROUND_EMPTY).length).toBe(0);
    expect(ROUND_BOOK).not.toBe(ROUND_EMPTY);
  });

  it("W122-F0-03 · the store itself still holds the writer-less column at 0 — the defect is real, not historical", async () => {
    const { listRounds } = await import("../roundsStore");
    const book = listRounds().find((r) => r.id === ROUND_BOOK);
    expect(book, "fixture round must exist in the store").toBeTruthy();
    /* This is the whole finding in one line: €450,000 is genuinely subscribed on
       this round, and the column both screens used to print still says 0. */
    expect(book!.raisedAmount ?? 0).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · FINDING 1, POLE A — a real book yields a NON-ZERO figure with the state
   NAMED. Asserted on BOTH payloads.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W122 · FINDING 1 POLE A — a real book produces a non-zero, labelled figure", () => {
  it("W122-F1-01 · LIST carries a determined projection whose subscribed total is NOT zero", async () => {
    const row = await listRow(INV_BOOK);
    const view = readRoundMoneyOnRecord(row.moneyOnRecord);
    expect(view.canPrintFigures, "a round with three real rows must be printable").toBe(true);
    /* committed €150,000 + funded €300,000 = €450,000 -> 45,000,000 minor. The
       intent is excluded from `subscribed` on purpose: a soft circle is not a
       subscription. The declined row is excluded entirely. */
    expect(view.money?.subscribedMinor).toBe("45000000");
    expect(view.money?.subscribedDisplay).not.toBe("€0.00");
    expect(view.money?.subscribedDisplay).toContain("450,000");
  });

  it("W122-F1-02 · the three states are SEPARATE and each figure carries its own label", async () => {
    const row = await listRow(INV_BOOK);
    const view = readRoundMoneyOnRecord(row.moneyOnRecord);
    const byKey = Object.fromEntries(view.buckets.map((b) => [b.key, b]));
    /* Soft-circled, committed and funded are three different facts. Collapsing
       them into one word called "raised" is how the wrong number reached the
       founder's front page in Wave 114, and this screen must not repeat it. */
    expect(byKey.softCircled.minor).toBe("5000000");   // €50,000 intent
    expect(byKey.committed.minor).toBe("15000000");    // €150,000 signed
    expect(byKey.funded.minor).toBe("30000000");       // €300,000 wired
    expect(byKey.softCircled.minor).not.toBe(byKey.committed.minor);
    expect(byKey.committed.minor).not.toBe(byKey.funded.minor);
    /* The words travel WITH the figures. */
    expect(byKey.softCircled.label).toBe(ROUND_MONEY_STATE_LABEL.softCircled);
    expect(byKey.committed.label).toBe(ROUND_MONEY_STATE_LABEL.committed);
    expect(byKey.funded.label).toBe(ROUND_MONEY_STATE_LABEL.funded);
    expect(new Set(view.buckets.map((b) => b.label)).size).toBe(3);
  });

  it("W122-F1-03 · DETAIL carries the same non-zero derived figure (both screens, one derivation)", async () => {
    const res = await get(`/api/investor/invitations/${INV_BOOK}`);
    expect(res.status).toBe(200);
    const view = readRoundMoneyOnRecord(res.body.moneyOnRecord);
    expect(view.canPrintFigures).toBe(true);
    expect(view.money?.subscribedMinor).toBe("45000000");
    /* The two screens must not be able to disagree. */
    const row = await listRow(INV_BOOK);
    expect(readRoundMoneyOnRecord(row.moneyOnRecord).money?.subscribedMinor)
      .toBe(view.money?.subscribedMinor);
  });

  it("W122-F1-04 · the progress ratio is DERIVED and non-zero, and the old ratio was wrong for the same rows", async () => {
    const row = await listRow(INV_BOOK);
    const view = readRoundMoneyOnRecord(row.moneyOnRecord);
    /* THE BEFORE-STATE, computed here from the very same payload: the old screen
       divided the writer-less column by the target. */
    const OLD_PCT = ((row.raisedAmount as number | null) ?? 0) / (row.targetAmount as number) * 100;
    expect(OLD_PCT, "the old ratio was structurally zero on every real round").toBe(0);
    /* €450,000 of a €2,000,000 target = 22.5% = 2250 basis points. */
    expect(view.money?.progressBp?.subscribed).toBe(2250);
    expect(progressBarPercent(view.money?.progressBp?.subscribed)).toBeCloseTo(22.5, 5);
    expect(progressBarPercent(view.money?.progressBp?.subscribed)).not.toBe(0);
  });

  it("W122-F1-05 · the writer-less column is NEVER published as 0 again, on either payload", async () => {
    const row = await listRow(INV_BOOK);
    const res = await get(`/api/investor/invitations/${INV_BOOK}`);
    /* R6, as applied two lines below this field in the same object literal since
       Wave 42. `expected 0 to be null` is the pre-change failure. */
    expect(row.raisedAmount).toBeNull();
    expect(res.body.raisedAmount).toBeNull();
    expect(row.raisedAmount).not.toBe(0);
    expect(res.body.raisedAmount).not.toBe(0);
  });

  it("W122-F1-06 · NO SIXTH REGISTER — the projection names the one derivation it came from", async () => {
    const row = await listRow(INV_BOOK);
    const view = readRoundMoneyOnRecord(row.moneyOnRecord);
    /* If a future wave hand-rolls a second total for these screens, this breaks. */
    expect(typeof view.money?.source).toBe("string");
    expect(view.money?.source).toBeTruthy();
    const { roundMoneyOnRecord } = await import("../lib/roundRaisedTotals");
    const direct = roundMoneyOnRecord({ roundId: ROUND_BOOK, rows: [], fallbackCurrency: "EUR" });
    expect(view.money?.source, "the endpoint must use the SAME source token as the shared derivation")
      .toBe(direct.source);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · FINDING 1, POLE B — nothing on record means a SENTENCE, no figure, and
   no bar. This is the half that stops the fix from printing a confident $0.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W122 · FINDING 1 POLE B — nothing on record prints a sentence, not a number", () => {
  it("W122-F1-07 · LIST refuses with a NAMED reason and a full sentence", async () => {
    const row = await listRow(INV_EMPTY);
    const view = readRoundMoneyOnRecord(row.moneyOnRecord);
    expect(view.canPrintFigures, "an empty book must not be printable as figures").toBe(false);
    expect(view.reason).toBe("no_rows_on_record");
    expect(view.statement.length, "the refusal must be a sentence, not a dash").toBeGreaterThan(40);
    expect(view.statement).toMatch(/not the same as zero/i);
    /* No figure may be offered to the screen at all. */
    expect(view.buckets.length).toBe(0);
  });

  it("W122-F1-08 · there is NO progress ratio, so no bar can be drawn at 0%", async () => {
    const row = await listRow(INV_EMPTY);
    const view = readRoundMoneyOnRecord(row.moneyOnRecord);
    expect(view.money?.progressBp?.subscribed).toBeNull();
    /* `progressBarPercent(null)` is null, and the screens render no bar element
       for a null. A bar drawn at 0% would be a false statement as a picture. */
    expect(progressBarPercent(view.money?.progressBp?.subscribed)).toBeNull();
    expect(progressBarPercent(view.money?.progressBp?.subscribed)).not.toBe(0);
    /* And the note explains WHY, in words. */
    expect(String(view.money?.progressBp?.targetNote ?? "").length).toBeGreaterThan(20);
  });

  it("W122-F1-09 · DETAIL refuses identically — the two screens cannot disagree", async () => {
    const res = await get(`/api/investor/invitations/${INV_EMPTY}`);
    expect(res.status).toBe(200);
    const view = readRoundMoneyOnRecord(res.body.moneyOnRecord);
    expect(view.canPrintFigures).toBe(false);
    expect(view.reason).toBe("no_rows_on_record");
    expect(res.body.raisedAmount).toBeNull();
  });

  it("W122-F1-10 · POLE A AND POLE B ARE GENUINELY DISTINGUISHABLE — the point of the whole wave", async () => {
    const withBook = readRoundMoneyOnRecord((await listRow(INV_BOOK)).moneyOnRecord);
    const empty = readRoundMoneyOnRecord((await listRow(INV_EMPTY)).moneyOnRecord);
    /* Before this change both rounds published `raisedAmount: 0` and the two
       states — "€450,000 is subscribed" and "nothing has been entered" — were
       indistinguishable to the investor, forever. */
    expect(withBook.canPrintFigures).not.toBe(empty.canPrintFigures);
    expect(withBook.money?.determined).not.toBe(empty.money?.determined);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · FINDING 2 — the round's OWN currency, or a refusal. R5: "not all SPVs
   are US based."
   ══════════════════════════════════════════════════════════════════════════ */
describe("W122 · FINDING 2 — a EUR round is EUR on both payloads, and an unrecorded currency is not guessed", () => {
  it("W122-F2-01 · LIST carries the round's currency, and the derived figures are denominated in it", async () => {
    const row = await listRow(INV_BOOK);
    expect(row.currency).toBe("EUR");
    const view = readRoundMoneyOnRecord(row.moneyOnRecord);
    expect(view.money?.currency).toBe("EUR");
    /* The preformatted display must not carry a dollar sign for a euro round. */
    expect(view.money?.subscribedDisplay).not.toContain("$");
  });

  it("W122-F2-02 · DETAIL carries EUR too", async () => {
    const res = await get(`/api/investor/invitations/${INV_BOOK}`);
    expect(res.body.currency).toBe("EUR");
  });

  it("W122-F2-03 · a round with NO recorded currency is NOT relabelled USD", async () => {
    const res = await get(`/api/investor/invitations/${INV_NO_CURRENCY}`);
    expect(res.status).toBe(200);
    /* `expected 'USD' to be null` is the pre-change failure of this line: the
       DETAIL projection read `round?.currency ?? "USD"`. */
    expect(res.body.currency).toBeNull();
    const row = await listRow(INV_NO_CURRENCY);
    expect(row.currency).toBeNull();
  });

  it("W122-F2-04 · the currency reader refuses rather than defaulting, and accepts a real code", async () => {
    const { readRoundCurrency } = await import("../../shared/roundCurrencyOnRecordView");
    const refused = readRoundCurrency(null);
    expect(refused.canDenominate).toBe(false);
    expect(refused.currency).toBeNull();
    expect(refused.statement).toMatch(/no currency recorded/i);
    /* It must not invent USD, which is exactly what the old default did. */
    expect(refused.currency).not.toBe("USD");
    for (const junk of ["", "  ", "euros", 2000000, undefined, {}]) {
      expect(readRoundCurrency(junk).canDenominate, `${String(junk)} is not a currency code`).toBe(false);
    }
    expect(readRoundCurrency("eur").currency).toBe("EUR");
    expect(readRoundCurrency("USD").canDenominate).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · NOTHING WAS REMOVED FROM THE WIRE. An honest fix must not become a
   silent drop of a field other readers depend on.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W122 · the payloads are ADDITIVE — no field disappeared", () => {
  it("W122-F3-01 · every field the LIST payload carried is still present", async () => {
    const row = await listRow(INV_BOOK);
    for (const k of ["id", "state", "targetAmount", "raisedAmount", "minTicket", "preMoney", "currency", "roundState", "closeDate"]) {
      expect(Object.prototype.hasOwnProperty.call(row, k), `LIST payload must still carry \`${k}\``).toBe(true);
    }
  });

  it("W122-F3-02 · the DETAIL payload still carries its valuation fields, and R6 is intact on them", async () => {
    const res = await get(`/api/investor/invitations/${INV_BOOK}`);
    for (const k of ["targetAmount", "raisedAmount", "minTicket", "preMoney", "postMoney", "pricePerShare", "currency", "instrument"]) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k), `DETAIL payload must still carry \`${k}\``).toBe(true);
    }
    /* Wave 42's R6 behaviour on the neighbouring fields must not regress: this
       round HAS a real pre-money and min ticket, and they arrive as numbers. */
    expect(res.body.preMoney).toBe(8_000_000);
    expect(res.body.minTicket).toBe(50_000);
    /* while the round with nothing entered still refuses */
    const bare = await get(`/api/investor/invitations/${INV_NO_CURRENCY}`);
    expect(bare.body.preMoney).toBeNull();
    expect(bare.body.minTicket).toBeNull();
  });
});
