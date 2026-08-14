/**
 * WAVE 42 · OWNER RULING R6 — the investor-facing valuation serializer.
 *
 * THE DEFECT THIS FILE REPRODUCES (live audit 2026-08-13, finding F-4, HIGH):
 *
 *   > "On investor-facing round terms, the same card shows Pre-money valuation
 *   >  `$0`, Post-money valuation `$0`, Min ticket `$0` — while sibling fields
 *   >  correctly read 'Not set' and 'Not provided'. `$0` pre-money reads as
 *   >  'this company is worth nothing.'"
 *
 * ROOT CAUSE, located by tracing rather than guessing. `rounds.pre_money` is
 * nullable in the schema and `server/roundsStore.ts:112` faithfully preserves
 * that null (`row.pre_money ?? row.preMoney ?? null`). The information is
 * destroyed one layer later, in the RESPONSE PROJECTION:
 *
 *     server/routes.ts   preMoney:  (round?.preMoney  ?? 0) as number
 *                        postMoney: (round?.postMoney ?? 0) as number
 *                        minTicket: (round?.minTicket ?? 0) as number
 *
 * The client cannot recover it: `fmtUSD` already refuses correctly (it returns
 * "—" for null via `safeNumber`), so the ONLY reason the screen says "$0" is
 * that the server told it 0. This is precisely the class Wave 41 was warned
 * about — "a `null` that becomes `0` in a serializer … destroys the information
 * before render".
 *
 * The same file ALREADY contains the correct pattern, applied to the sibling
 * field two lines below, with the reasoning written out:
 *
 *     /* v25.25 Avi-8 — was `?? 0`, which coalesced a genuinely-unset PPS to
 *        zero and rendered "$0.00" in the client (misleading). Surface honest
 *        null … *\/
 *     pricePerShare: (round?.pricePerShare ?? null) as number | null,
 *
 * So this is not a new pattern being invented; it is an established one that
 * was applied to one field of five and never propagated. R6 propagates it.
 *
 * ── BOTH POLES, AND WHY THE SECOND ONE IS NOT OPTIONAL ────────────────────
 * Every field below is asserted TWICE:
 *   POLE A  never entered (NULL in the store)  -> the response carries `null`
 *   POLE B  deliberately entered as ZERO       -> the response carries `0`
 *
 * A test that only proved pole A would pass if the fix replaced every zero
 * everywhere with a refusal. That would be a worse bug than F-4: a founder who
 * genuinely has a $0 min ticket (an open round with no floor) could no longer
 * say so, and the platform would be lying in the other direction. Pole B is the
 * assertion that makes the fix falsifiable in both directions.
 *
 * ── MONEY DISCIPLINE ──────────────────────────────────────────────────────
 * `rounds.pre_money` / `post_money` / `min_ticket` are legacy MAJOR-unit
 * columns, NOT minor units. This file therefore asserts the transport of the
 * stored number and performs NO conversion — no `/ 100`, no `* 100`. The
 * minor-unit + ISO-4217-exponent path (including the JPY exponent-0 fixture
 * that no live data exercises) is proved in
 * `client/src/lib/__tests__/wave42_r6_display.test.ts`, which is where the
 * formatting actually happens. A currency is carried through here so the
 * international requirement (R5: "not all SPVs are US based") is visible: a
 * CAD-denominated round must not be relabelled USD by this projection.
 *
 * ── THE PROBE MUST BE ABLE TO FAIL ────────────────────────────────────────
 * This file drives the REAL `registerRoutes` stack over supertest and reads the
 * REAL HTTP response body. It does not call the projection directly and it does
 * not assert a formula. Before the routes.ts fix, every `toBeNull()` below
 * failed with `expected 0 to be null` — recorded in
 * `build_log/wave42/pole_proofs.txt`. If it cannot fail, it proved nothing.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

/* Force the PRODUCTION invitation path. With the demo gate open the LIST
   handler short-circuits to the in-memory `incomingInvitations` mock array and
   never reaches the projection under test — the check would pass while checking
   nothing. Same reasoning, same mock, as wfix3_f1b_list_companyid.test.ts. */
vi.mock("../lib/demoGate", () => ({
  DEMO_SEED_ENABLED: false,
  isDemoSeedEnabled: () => false,
}));

import { registerRoutes } from "../routes";
import { createRound } from "../roundsStore";
import { _testAccessInvitations } from "../roundInvitationsStore";

let app: Express;
let server: http.Server;

const INVESTOR_ID = "u_lapsed_lp";
const INVESTOR_EMAIL = "lp@lapsed-fund.example";
const STAMP = Date.now();
const COMPANY_ID = `co_w42r6_${STAMP}`;

/** ids of the two rounds this file creates */
let ROUND_UNSET = "";
let ROUND_REAL_ZERO = "";
let INV_UNSET = "";
let INV_REAL_ZERO = "";

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

  /* POLE A fixture — a round where NOTHING was ever entered. Every valuation
     column is left NULL, which is exactly the live state F-4 describes: rounds
     exist, the founder has not filled in a valuation yet. */
  const unset = createRound({
    companyId: COMPANY_ID,
    name: `W42 R6 unset ${STAMP}`,
    type: "seed",
    state: "open",
    currency: "CAD", /* R5 — not all vehicles are US; the projection must carry this through */
    preMoney: null,
    postMoney: null,
    minTicket: null,
    pricePerShare: null,
  });
  ROUND_UNSET = unset.id;

  /* POLE B fixture — a round where the founder DELIBERATELY entered zero.
     A real, meant, load-bearing zero. It must survive as 0. */
  const realZero = createRound({
    companyId: COMPANY_ID,
    name: `W42 R6 real zero ${STAMP}`,
    type: "seed",
    state: "open",
    currency: "CAD",
    preMoney: 0,
    postMoney: 0,
    minTicket: 0,
  });
  ROUND_REAL_ZERO = realZero.id;

  INV_UNSET = `inv_w42_unset_${STAMP}`;
  INV_REAL_ZERO = `inv_w42_zero_${STAMP}`;
  pushInvitation(INV_UNSET, ROUND_UNSET);
  pushInvitation(INV_REAL_ZERO, ROUND_REAL_ZERO);
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
    `file is asserting against nothing and every result below is meaningless`,
  ).toBeTruthy();
  return row as Record<string, unknown>;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE FIXTURES MUST BE REAL BEFORE ANY VERDICT IS DRAWN FROM THEM.
   This build has 25+ documented instances of "a check that passed while
   checking nothing". A projection test whose fixture never reached the store
   is one of them, so the store is read back first.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 — the fixtures themselves (guard against a vacuous pass)", () => {
  it("the unset round really holds NULL, and the zero round really holds 0, in the store", async () => {
    const { listRounds } = await import("../roundsStore");
    const all = listRounds();
    const unset = all.find((r) => r.id === ROUND_UNSET);
    const zero = all.find((r) => r.id === ROUND_REAL_ZERO);
    expect(unset, "POLE A fixture round must exist in the store").toBeTruthy();
    expect(zero, "POLE B fixture round must exist in the store").toBeTruthy();

    /* If these two blocks were identical the whole file would be tautological. */
    expect(unset!.preMoney).toBeNull();
    expect(unset!.postMoney).toBeNull();
    expect(unset!.minTicket).toBeNull();

    expect(zero!.preMoney).toBe(0);
    expect(zero!.postMoney).toBe(0);
    expect(zero!.minTicket).toBe(0);

    /* and they must be genuinely DIFFERENT states, not two spellings of one */
    expect(unset!.preMoney).not.toBe(zero!.preMoney);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   POLE A — never entered must travel as null, never as 0.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 POLE A — an unset valuation is null on the wire, not 0", () => {
  it("LIST /api/investor/invitations: preMoney / minTicket are null when never entered", async () => {
    const row = await listRow(INV_UNSET);
    expect(
      row.preMoney,
      "F-4: an unset pre-money must NOT be serialised as 0 — an investor reads " +
      '"$0 pre-money" as "this company is worth nothing"',
    ).toBeNull();
    expect(row.minTicket).toBeNull();
  });

  it("DETAIL /api/investor/invitations/:id: preMoney / postMoney / minTicket are null when never entered", async () => {
    const res = await get(`/api/investor/invitations/${INV_UNSET}`);
    expect(res.status).toBe(200);
    expect(res.body.preMoney, "unset pre-money must be null on the DETAIL route").toBeNull();
    expect(res.body.postMoney, "unset post-money must be null on the DETAIL route").toBeNull();
    expect(res.body.minTicket, "unset min ticket must be null on the DETAIL route").toBeNull();
    /* the field that was ALREADY correct (v25.25 Avi-8) must stay correct —
       this fix must not regress the one instance that was right */
    expect(res.body.pricePerShare).toBeNull();
  });

  it("the response never contains the number 0 for any of the three valuation fields", async () => {
    const res = await get(`/api/investor/invitations/${INV_UNSET}`);
    for (const f of ["preMoney", "postMoney", "minTicket"] as const) {
      expect(res.body[f], `${f} must not be 0 for a never-entered value`).not.toBe(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   POLE B — a genuine zero must still be sayable. THIS IS THE HALF OF THE
   TEST THAT STOPS THE FIX FROM BECOMING A WORSE BUG.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 POLE B — a deliberately-entered zero survives as 0", () => {
  it("DETAIL: a stored 0 pre/post-money and 0 min ticket arrive as 0, not as null", async () => {
    const res = await get(`/api/investor/invitations/${INV_REAL_ZERO}`);
    expect(res.status).toBe(200);
    expect(
      res.body.preMoney,
      "a founder who entered 0 must still be able to say 0 — replacing every zero " +
      "with a refusal would be a worse bug than F-4",
    ).toBe(0);
    expect(res.body.postMoney).toBe(0);
    expect(res.body.minTicket).toBe(0);
    /* and 0 is emphatically NOT null */
    expect(res.body.preMoney).not.toBeNull();
  });

  it("LIST: a stored 0 arrives as 0", async () => {
    const row = await listRow(INV_REAL_ZERO);
    expect(row.preMoney).toBe(0);
    expect(row.minTicket).toBe(0);
  });

  it("THE DISTINCTION SURVIVES THE STACK — the two rounds are distinguishable in the response", async () => {
    const unsetRes = await get(`/api/investor/invitations/${INV_UNSET}`);
    const zeroRes = await get(`/api/investor/invitations/${INV_REAL_ZERO}`);
    /* This single assertion is the whole ruling: before the fix both responses
       said `0` and the two states were indistinguishable to every downstream
       consumer, forever. */
    expect(unsetRes.body.preMoney).not.toEqual(zeroRes.body.preMoney);
    expect(unsetRes.body.postMoney).not.toEqual(zeroRes.body.postMoney);
    expect(unsetRes.body.minTicket).not.toEqual(zeroRes.body.minTicket);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   INTERNATIONAL — R5: "Not all SPVs are US based." A projection that drops the
   currency turns a CAD valuation into a USD one on screen, which is a money
   defect wearing a display costume.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 — the projection carries the round's own currency", () => {
  it("a CAD round is reported as CAD, not defaulted to USD", async () => {
    const res = await get(`/api/investor/invitations/${INV_UNSET}`);
    expect(res.body.currency).toBe("CAD");
  });
});
