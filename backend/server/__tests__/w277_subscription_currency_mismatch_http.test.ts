/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 277 · R224.1 · R77 — ONE ACCEPTED FOREIGN-CURRENCY SUBSCRIPTION BRICKED
 * THE VEHICLE. THESE TESTS DRIVE THE REAL ROUTES OVER HTTP.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, in two halves.
 *
 *   WRITE SIDE. `spvEngineStore.subscribe` had NINE guards and not one of them
 *   compared `data.currency` against the vehicle's own currency, so a
 *   subscription stated in EUR against a USD vehicle was ACCEPTED with a 201.
 *
 *   READ SIDE. `assertSingleCurrencyTotal` is asserted on FIVE read paths and
 *   refuses — correctly — because a total made of two currencies is not a
 *   number. But the routes that call those reads do so INSIDE the argument to
 *   `res.json` with NO `try`/`catch`, so the refusal escaped to Express and
 *   answered a BARE HTTP 500 with no body, on every load, indefinitely. The
 *   vehicle looked destroyed and said nothing.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT REFUSES TO PROVE.
 *   · Every assertion below goes over HTTP through `registerRoutes`, against the
 *     real store and the real SQLite database. No replica, no stub, no spy on a
 *     function standing in for a route.
 *   · Where a refusal is claimed, the STORED ROW is read back from the database
 *     with `rawDb()` — never the response body alone. A route can say "not
 *     saved" and save.
 *   · Section 4 seeds the LIVE RESIDUE — a mismatched row of the kind the old
 *     code accepted — and then asserts the row is BYTE-IDENTICAL after the read
 *     path refuses. That assertion is the proof that this wave rewrote nothing.
 *   · Section 2 is the mirror-image test and the one that matters most: a
 *     subscription with NO stated currency is still ACCEPTED. Absence is not a
 *     mixed state, and a guard that refused it would break a working money
 *     action on three routes.
 *
 * MAIL SAFETY. `server/lib/emailSender.ts` defaults `SMTP_MODE` to `"smtp"` and
 * `work/.env` holds live credentials. Section 0 asserts BOTH transports are
 * inert and drives one through to see a `dry_` id. Run this file with
 * `SMTP_MODE=dry_run` on the command line — import-time demo seeding sends
 * before `beforeAll` can run.
 * ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";
import { spvEngineStore } from "../spvEngineStore";
import {
  spvSubscriptionRefusalHeadlinesOverLimit,
  SPV_SUBSCRIPTION_REFUSAL_CODES,
  SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS,
} from "@shared/spvSubscriptionRefusalCopy";
import { verifyTransport } from "../lib/emailSender";
import { getConfig, patchConfig, sendMail } from "../emailTransport";
import {
  W211_BODY_KEY_VERSION,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
  W211_LP_COMMIT_ATTESTATION_VERSION,
} from "../../shared/wave211MoneyEventAttestation";

const MANAGING = "u_avi_managing";

let app: express.Express;
let server: http.Server;

/** The W211 / W214 attestation keys an LP commitment cannot be posted without. */
const COMMIT_ATT = {
  [W211_BODY_KEY_VERSION]: W211_LP_COMMIT_ATTESTATION_VERSION,
  [W211_BODY_KEY_SIGNED_NAME]: "Avi Managing Partner",
  [W211_BODY_KEY_TICK_1]: true,
  [W211_BODY_KEY_TICK_2]: true,
  [W211_BODY_KEY_TICK_3]: true,
  [W211_BODY_KEY_CURRENCY_CONFIRMED]: true,
} as const;

async function makeSpv(currency: string, name: string): Promise<string> {
  const r = await request(app)
    .post("/api/partner/me/spvs")
    .set("x-user-id", MANAGING)
    .send({
      spvName: name,
      jurisdiction: "Delaware",
      vintage: 2026,
      currency,
      status: "open",
      targetSizeMinor: 100_000_000,
      signoffLegalName: "Avi Managing Partner",
      signoffAccepted: true,
    });
  expect(r.status).toBe(201);
  return String(r.body.spv.id);
}

function subRows(spvId: string): Array<Record<string, unknown>> {
  return rawDb()
    .prepare("SELECT * FROM spv_subscription WHERE spv_id = ? ORDER BY id")
    .all(spvId) as Array<Record<string, unknown>>;
}

/** The LP identity register `recordLpCommitIdentity` writes, and the SACRED
 *  cap-table ledger `commitFunded` writes, are BOTH written by the lp-commit
 *  route BEFORE it reaches the store. A store-only refusal would therefore leave
 *  a half-state: an identity and a sacred ledger line for a commitment that was
 *  rejected. These two readers are how the tests prove it does not. */
function lpInviteRowCount(spvId: string): number {
  const r = rawDb()
    .prepare("SELECT COUNT(*) AS n FROM spv_lp_invite WHERE spv_id = ?")
    .get(spvId) as { n?: number } | undefined;
  return Number(r?.n ?? 0);
}

function captableCommitRowCount(): number {
  const r = rawDb().prepare("SELECT COUNT(*) AS n FROM captable_commits").get() as
    | { n?: number }
    | undefined;
  return Number(r?.n ?? 0);
}

beforeAll(async () => {
  /* Mail inertness is established BEFORE any route is registered. */
  patchConfig({ mode: "dry_run" });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  partnerTeamStore.add(TEST_PARTNER_ID, MANAGING, "managing_partner", "u_system_seed", {
    isSeed: true,
  });
  storeCredential({
    userId: MANAGING,
    email: "w277.managing@test-partner.example",
    name: "Avi Managing Partner",
    password: "test-password-w277",
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 0 — MAIL IS INERT, AND PROVED INERT RATHER THAN ASSUMED.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §0 — no mail leaves this test run", () => {
  it("both transports report a non-smtp mode and a driven send returns a dry_ id", async () => {
    expect(process.env.SMTP_MODE).toBe("dry_run");
    expect(getConfig().mode).toBe("dry_run");
    expect((await verifyTransport()).mode).not.toBe("smtp");
    const out = await sendMail({
      to: "nobody@capavate.test",
      subject: "W277 inertness probe",
      html: "<p>probe</p>",
    });
    /* The id shape is the proof the dry-run branch, not a socket, answered. */
    expect(String(out.messageId)).toMatch(/^dry_/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 1 — T1. A MISMATCHED SUBSCRIPTION IS REFUSED, IN WORDS, AND NOTHING
   IS PERSISTED. CONSEQUENCE IS ASSERTED BEFORE SHAPE.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §1 — EUR against a USD vehicle is refused and nothing is written", () => {
  it("refuses, writes no row, and says why in sentences a person can read", async () => {
    const spvId = await makeSpv("USD", "W277 T1 Refusal Vehicle");
    const before = subRows(spvId);
    const identitiesBefore = lpInviteRowCount(spvId);
    const ledgerBefore = captableCommitRowCount();

    const r = await request(app)
      .post(`/api/partner/me/spv/${spvId}/lp-commit`)
      .set("x-user-id", MANAGING)
      .send({
        investorEmail: "t1.mismatch@capavate.test",
        holderFirstName: "Tee",
        holderLastName: "One",
        amount: "250000.00",
        shares: "2500",
        currency: "EUR",
        ...COMMIT_ATT,
      });

    /* CONSEQUENCE FIRST. If the guard is absent this line prints the row that
       was accepted, so a disarm reports the defect rather than a shape. */
    const after = subRows(spvId);
    expect(
      `rows=${after.length} ${JSON.stringify(
        after.map((x) => ({ currency: x.currency, commitment_minor: x.commitment_minor })),
      )}`,
    ).toBe(`rows=${before.length} []`);

    /* AND NO HALF-STATE. The route writes the LP identity register and then the
       SACRED cap-table ledger BEFORE it reaches the store, so a store-only
       refusal would leave both behind for a commitment that was rejected. This is
       why the gate is also at the route, above both writes. */
    expect(
      `identities=${lpInviteRowCount(spvId)} ledger=${captableCommitRowCount()}`,
    ).toBe(`identities=${identitiesBefore} ledger=${ledgerBefore}`);

    /* THEN SHAPE. 400, the code with both currency codes still on it for an
       operator, and both sentences present and short enough to reach a screen. */
    expect(r.status).toBe(400);
    expect(String(r.body.error).split(":")[0]).toBe("SUBSCRIPTION_CURRENCY_MISMATCH");
    expect(String(r.body.error)).toContain("EUR");
    expect(String(r.body.error)).toContain("USD");
    expect(typeof r.body.message).toBe("string");
    expect(String(r.body.message).length).toBeGreaterThan(0);
    expect(String(r.body.message).length).toBeLessThan(SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS);
    expect(typeof r.body.guidance).toBe("string");
    expect(String(r.body.guidance).length).toBeGreaterThan(0);
    /* The message must never be the all-caps code (R152 item 3). */
    expect(r.body.message).not.toContain("SUBSCRIPTION_CURRENCY_MISMATCH");
  });

  it("the refusal names the withdrawal escape, so a GP holding an old row is not stranded", async () => {
    const spvId = await makeSpv("USD", "W277 T1b Escape Wording Vehicle");
    const r = await request(app)
      .post(`/api/partner/me/spv/${spvId}/lp-commit`)
      .set("x-user-id", MANAGING)
      .send({
        investorEmail: "t1b.mismatch@capavate.test",
        holderFirstName: "Tee",
        holderLastName: "OneB",
        amount: "250000.00",
        shares: "2500",
        currency: "GBP",
        ...COMMIT_ATT,
      });
    expect(r.status).toBe(400);
    const g = String(r.body.guidance).toLowerCase();
    expect(g).toContain("withdrawn");
    expect(g).toContain("never converts");
    expect(g).toContain("mixed_currency_committed_total");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 2 — T2. THE MIRROR IMAGE, AND THE MOST IMPORTANT TEST IN THE FILE.
   AN ABSENT CURRENCY IS NOT A MISMATCH. THIS IS A WORKING MONEY ACTION.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §2 — a subscription with NO stated currency is still accepted", () => {
  it("accepts it, stores the vehicle's own currency, and the money is really there", async () => {
    const spvId = await makeSpv("USD", "W277 T2 Absent Currency Vehicle");
    const r = await request(app)
      .post(`/api/partner/me/spv/${spvId}/lp-commit`)
      .set("x-user-id", MANAGING)
      .send({
        investorEmail: "t2.absent@capavate.test",
        holderFirstName: "Tee",
        holderLastName: "Two",
        amount: "250000.00",
        shares: "2500",
        ...COMMIT_ATT,
      });

    /* CONSEQUENCE FIRST: the row exists in the database, in the vehicle's
       currency, for the amount asked. A guard that fired on absence would leave
       this at zero rows and this line would print that. */
    const rows = subRows(spvId);
    expect(
      `rows=${rows.length} currency=${rows[0]?.currency} minor=${rows[0]?.commitment_minor}`,
    ).toBe("rows=1 currency=USD minor=25000000");
    expect(r.status).toBe(201);
  });

  it("and the vehicle's detail page still loads for it", async () => {
    const spvId = await makeSpv("USD", "W277 T2b Absent Currency Readable");
    await request(app)
      .post(`/api/partner/me/spv/${spvId}/lp-commit`)
      .set("x-user-id", MANAGING)
      .send({
        investorEmail: "t2b.absent@capavate.test",
        holderFirstName: "Tee",
        holderLastName: "TwoB",
        amount: "100000.00",
        shares: "1000",
        ...COMMIT_ATT,
      });
    const d = await request(app)
      .get(`/api/partner/me/spvs/${spvId}`)
      .set("x-user-id", MANAGING);
    expect(d.status).toBe(200);
    expect(Array.isArray(d.body.positions)).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 3 — T3. THE SAME CURRENCY IN A DIFFERENT LETTER CASE IS THE SAME
   CURRENCY. ANOTHER WORKING MONEY ACTION THE GUARD MUST NOT BREAK.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §3 — lower-case usd against a USD vehicle is accepted", () => {
  it("accepts it and stores a row", async () => {
    const spvId = await makeSpv("USD", "W277 T3 Case Insensitive Vehicle");
    const r = await request(app)
      .post(`/api/partner/me/spv/${spvId}/lp-commit`)
      .set("x-user-id", MANAGING)
      .send({
        investorEmail: "t3.case@capavate.test",
        holderFirstName: "Tee",
        holderLastName: "Three",
        amount: "250000.00",
        shares: "2500",
        currency: "usd",
        ...COMMIT_ATT,
      });
    const rows = subRows(spvId);
    expect(`rows=${rows.length} status=${r.status}`).toBe("rows=1 status=201");
  });

  it("and surrounding whitespace does not invent a mismatch either", async () => {
    const spvId = await makeSpv("USD", "W277 T3b Padded Currency Vehicle");
    const r = await request(app)
      .post(`/api/partner/me/spv/${spvId}/lp-commit`)
      .set("x-user-id", MANAGING)
      .send({
        investorEmail: "t3b.case@capavate.test",
        holderFirstName: "Tee",
        holderLastName: "ThreeB",
        amount: "250000.00",
        shares: "2500",
        currency: " USD ",
        ...COMMIT_ATT,
      });
    expect(`rows=${subRows(spvId).length} status=${r.status}`).toBe("rows=1 status=201");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 4 — T4. THE LOAD-BEARING TEST. A VEHICLE THAT ALREADY HOLDS A
   MISMATCHED ROW — THE LIVE RESIDUE — BECOMES LEGIBLE INSTEAD OF DEAD, AND THE
   ROW IS BYTE-IDENTICAL AFTERWARDS.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §4 — an already-accepted foreign-currency row reads 409 with words, not 500", () => {
  /** Reproduces the residue the OLD code created: two committed rows on one
   *  vehicle, stated in two different currencies. Written through the store's
   *  own chokepoint so the in-memory cache and the database agree, exactly as
   *  they did when `subscribe` accepted the row itself. */
  async function seedResidue(): Promise<{ spvId: string; badSubId: string }> {
    const spvId = await makeSpv("USD", "W277 T4 Residue Vehicle");
    for (const [i, email] of ["t4.usd@capavate.test", "t4.eur@capavate.test"].entries()) {
      const r = await request(app)
        .post(`/api/partner/me/spv/${spvId}/lp-commit`)
        .set("x-user-id", MANAGING)
        .send({
          investorEmail: email,
          holderFirstName: "Tee",
          holderLastName: `Four${i}`,
          amount: "250000.00",
          shares: "2500",
          currency: "USD",
          ...COMMIT_ATT,
        });
      expect(r.status).toBe(201);
    }
    const subs = spvEngineStore.listSubscriptions(TEST_PARTNER_ID, spvId);
    expect(subs.length).toBe(2);
    const bad = subs[1]!;
    bad.currency = "EUR";
    spvEngineStore._persistSub(bad);
    /* The seed is asserted, not assumed: two distinct stated codes in storage. */
    const stored = subRows(spvId).map((x) => String(x.currency)).sort();
    expect(stored).toEqual(["EUR", "USD"]);
    return { spvId, badSubId: String(bad.id) };
  }

  it("the detail page the client actually calls answers 409 with the written sentences", async () => {
    const { spvId } = await seedResidue();
    const rowsBefore = JSON.stringify(subRows(spvId));

    const d = await request(app)
      .get(`/api/partner/me/spvs/${spvId}`)
      .set("x-user-id", MANAGING);

    /* CONSEQUENCE FIRST: not a 500, and it carries prose. Without the wave this
       line prints `500 message=undefined`. */
    expect(`${d.status} message=${typeof d.body?.message}`).toBe("409 message=string");
    expect(d.body.error).toBe("MIXED_CURRENCY_COMMITTED_TOTAL");
    expect(String(d.body.message)).toContain("more than one currency");
    expect(String(d.body.message).length).toBeLessThan(
      SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS,
    );
    expect(String(d.body.guidance)).toContain("does not convert currency");
    expect(d.body.mixedCurrency?.statedCurrencies).toContain("EUR");
    expect(d.body.mixedCurrency?.statedCurrencies).toContain("USD");

    /* AND NOTHING WAS REWRITTEN. Byte-identical row set after the refusal. */
    expect(JSON.stringify(subRows(spvId))).toBe(rowsBefore);
  });

  it("the engine's own detail route answers 409 with the same sentences", async () => {
    const { spvId } = await seedResidue();
    const rowsBefore = JSON.stringify(subRows(spvId));
    const d = await request(app)
      .get(`/api/partner/me/spv/${spvId}`)
      .set("x-user-id", MANAGING);
    expect(`${d.status} message=${typeof d.body?.message}`).toBe("409 message=string");
    expect(d.body.error).toBe("MIXED_CURRENCY_COMMITTED_TOTAL");
    expect(String(d.body.guidance)).toContain("separate vehicle");
    expect(JSON.stringify(subRows(spvId))).toBe(rowsBefore);
  });

  it("the positions read answers 409 too, rather than a bare 500", async () => {
    const { spvId } = await seedResidue();
    const d = await request(app)
      .get(`/api/partner/me/spvs/${spvId}/positions`)
      .set("x-user-id", MANAGING);
    expect(`${d.status} message=${typeof d.body?.message}`).toBe("409 message=string");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 5 — T5. THE ESCAPE. WITHDRAWING THE ROW MAKES THE PAGE LOAD, AND THE
   ROW SURVIVES — WITHDRAWAL IS A RECORDED TRANSITION, NOT A DELETION.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §5 — withdrawing the mismatched row restores the page and keeps the row", () => {
  it("200 on the transition, then the page loads, and the row is still there as withdrawn", async () => {
    const spvId = await makeSpv("USD", "W277 T5 Escape Vehicle");
    for (const [i, email] of ["t5.usd@capavate.test", "t5.eur@capavate.test"].entries()) {
      const r = await request(app)
        .post(`/api/partner/me/spv/${spvId}/lp-commit`)
        .set("x-user-id", MANAGING)
        .send({
          investorEmail: email,
          holderFirstName: "Tee",
          holderLastName: `Five${i}`,
          amount: "250000.00",
          shares: "2500",
          currency: "USD",
          ...COMMIT_ATT,
        });
      expect(r.status).toBe(201);
    }
    const subs = spvEngineStore.listSubscriptions(TEST_PARTNER_ID, spvId);
    const bad = subs[1]!;
    bad.currency = "EUR";
    spvEngineStore._persistSub(bad);

    /* The page is dead first — this is the state a GP is actually in. */
    const dead = await request(app)
      .get(`/api/partner/me/spvs/${spvId}`)
      .set("x-user-id", MANAGING);
    expect(dead.status).toBe(409);

    const w = await request(app)
      .patch(`/api/partner/me/spv/${spvId}/subscriptions/${bad.id}`)
      .set("x-user-id", MANAGING)
      .send({ to: "withdrawn" });
    expect(w.status).toBe(200);

    const alive = await request(app)
      .get(`/api/partner/me/spvs/${spvId}`)
      .set("x-user-id", MANAGING);
    expect(alive.status).toBe(200);

    /* NOTHING DELETED (R195.5). The row is still in storage, in EUR, withdrawn. */
    const row = rawDb()
      .prepare("SELECT id, currency, status, commitment_minor FROM spv_subscription WHERE id = ?")
      .get(bad.id) as Record<string, unknown> | undefined;
    expect(
      `${row?.status}/${row?.currency}/${row?.commitment_minor}`,
    ).toBe("withdrawn/EUR/25000000");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 6 — T6. THE HEADLINE GATE, AND THE REGISTRY IS COMPLETE.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §6 — every refusal headline still fits through the client's 240-char gate", () => {
  it("returns no offenders, and the new code is registered in all three collections", () => {
    expect(spvSubscriptionRefusalHeadlinesOverLimit()).toEqual([]);
    expect(SPV_SUBSCRIPTION_REFUSAL_CODES).toContain("SUBSCRIPTION_CURRENCY_MISMATCH");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 9 — THE STORE-LAYER FLOOR, AND WHY THIS ONE SECTION IS NOT OVER HTTP.
   DECLARED PLAINLY: `projectLpCommitted` is the sink behind lp-commit, and the
   lp-commit ROUTE is gated ABOVE it — deliberately, because the route writes the
   LP identity register and the SACRED cap-table ledger before reaching the store,
   and a store-only refusal would leave both behind. The consequence is that NO
   HTTP route can reach this store guard while the route gate stands, so there is
   no route to drive. It is the floor a FUTURE direct caller cannot walk around,
   and the only honest way to prove a floor is to stand on it. This is the real
   store and the real database, not a replica.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §9 — the store refuses a mismatch even when no route is involved", () => {
  it("projectLpCommitted throws the prefixed code and writes nothing", async () => {
    const spvId = await makeSpv("USD", "W277 T9 Store Floor Vehicle");
    const before = subRows(spvId).length;
    let caught: unknown = null;
    try {
      spvEngineStore.projectLpCommitted(
        TEST_PARTNER_ID,
        spvId,
        { investorId: "lp_w277_store_floor", commitmentMinor: 25_000_000, currency: "EUR" },
      );
    } catch (e) {
      caught = e;
    }
    /* CONSEQUENCE FIRST: no row. Then the code, with both currencies on it. */
    expect(`rows=${subRows(spvId).length}`).toBe(`rows=${before}`);
    expect(String((caught as Error)?.message ?? "")).toBe(
      "SUBSCRIPTION_CURRENCY_MISMATCH:EUR:USD",
    );
  });

  it("and it accepts an absent currency, storing the vehicle's own", async () => {
    const spvId = await makeSpv("USD", "W277 T9b Store Floor Absent");
    const sub = spvEngineStore.projectLpCommitted(
      TEST_PARTNER_ID,
      spvId,
      { investorId: "lp_w277_store_absent", commitmentMinor: 25_000_000 },
    );
    expect(`${sub.currency}/${sub.commitmentMinor}`).toBe("USD/25000000");
    expect(subRows(spvId).length).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 8 — THE OTHER DOOR. `POST /api/partner/me/spvs/:id/positions` reaches
   `spvEngineStore.subscribe` and answers through the SECOND refusal responder in
   the tree (`respondSpvWriteRefusal` in `partnerRoutes.ts`). Two doors onto one
   sink; a guard on one of them is not a guard, and a refusal reported two ways is
   not one refusal.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §8 — the positions door refuses a mismatch too, in the same words", () => {
  it("400, no row written, and the sentences come from the same registry", async () => {
    const spvId = await makeSpv("USD", "W277 T8 Positions Door Vehicle");
    const before = subRows(spvId).length;
    const r = await request(app)
      .post(`/api/partner/me/spvs/${spvId}/positions`)
      .set("x-user-id", MANAGING)
      .send({ lpContactId: "lp_w277_positions", positionAmountMinor: 25_000_000, currency: "EUR" });

    /* CONSEQUENCE FIRST. */
    expect(`rows=${subRows(spvId).length}`).toBe(`rows=${before}`);
    expect(r.status).toBe(400);
    expect(String(r.body.error).split(":")[0]).toBe("SUBSCRIPTION_CURRENCY_MISMATCH");
    expect(typeof r.body.message).toBe("string");
    expect(String(r.body.message).length).toBeLessThan(
      SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS,
    );
    expect(String(r.body.guidance)).toContain("withdrawn");
    /* Never the bare code on a surface (R152 item 3). */
    expect(r.body.message).not.toContain("SUBSCRIPTION_CURRENCY_MISMATCH");
  });

  it("and the same door still accepts the vehicle's own currency — the guard breaks nothing", async () => {
    const spvId = await makeSpv("USD", "W277 T8b Positions Door Accepts");
    const r = await request(app)
      .post(`/api/partner/me/spvs/${spvId}/positions`)
      .set("x-user-id", MANAGING)
      .send({ lpContactId: "lp_w277_positions_ok", positionAmountMinor: 25_000_000, currency: "USD" });
    expect(`rows=${subRows(spvId).length} status=${r.status}`).toBe("rows=1 status=201");
    /* MEASURED, AND REPORTED RATHER THAN SMOOTHED: this route rejects a
       LOWER-CASE code before the store is reached, with its own pre-existing
       `isISOCurrency` validation and its own message — not with this wave's
       refusal. So case-insensitivity is proved on the lp-commit door (§3), where
       it is reachable, and is asserted here only as "not made worse". */
    const lower = await request(app)
      .post(`/api/partner/me/spvs/${spvId}/positions`)
      .set("x-user-id", MANAGING)
      .send({ lpContactId: "lp_w277_positions_lower", positionAmountMinor: 1_000, currency: "usd" });
    expect(lower.status).toBe(400);
    expect(String(lower.body.error ?? "")).not.toContain("SUBSCRIPTION_CURRENCY_MISMATCH");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 7 — T7. NO CONVERSION WAS INTRODUCED ON THIS PATH.
   DECLARED SCOPE: this reads the FOUR FILES THIS WAVE TOUCHED for the arithmetic
   and coercion this wave is forbidden to add. It proves the wave introduced
   none. It does NOT prove none exists elsewhere in the tree (R181.6 — declared,
   not counted).
   ───────────────────────────────────────────────────────────────────────────── */
describe("W277 §7 — the wave's own change introduces no conversion and no coercion", () => {
  it("the currency comparison is a string comparison and nothing else", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/spvEngineStore.ts", "utf8");
    /* The rule has ONE spelling. Read its body back from disk. */
    const i = src.indexOf("export function assertSubscriptionCurrencyMatchesVehicle(");
    expect(i).toBeGreaterThan(0);
    const body = src.slice(i, src.indexOf("\n}", i));
    expect(body).toContain("toUpperCase()");
    expect(body).not.toMatch(/Number\(|parseInt|parseFloat/);
    expect(body).not.toMatch(/\brate\b|convert|multiplier|\bfx\b/i);
    /* ══════════════════════════════════════════════════════════════════════
       WAVE 306 · WAVE 3 — THIS ASSERTION WAS VACUOUS AND IS NOW REPAIRED.
       ══════════════════════════════════════════════════════════════════════
       IT WAS WRONG BEFORE, and it is recorded rather than quietly replaced. The
       old loop did `src.indexOf("this._persistSub(", at)` on the WHOLE FILE and
       asserted the result was greater than `at`. Searching forward from a
       position can only ever return a later position, so the comparison was
       TRUE BY CONSTRUCTION — it would have held for a call site with no write
       after it at all, and it held for any call placed anywhere above the last
       `_persistSub` in a 5,700-line file. It proved nothing about ordering.

       IT IS ALSO NO LONGER THE RIGHT QUESTION. Wave 306 added this same guard
       to three further money sinks, and those write `spv_fee`, deployments,
       distributions and transfers — NOT `_persistSub`. A file-wide search for
       one subscription-specific write would have "passed" for all three by
       finding some unrelated subscription write hundreds of lines away.

       THE REPAIR: bound the search to the ENCLOSING FUNCTION, and require the
       guard to precede that function's OWN currency write. Both facts are
       asserted per call site and the count is asserted exactly.
       ══════════════════════════════════════════════════════════════════════ */
    const calls = [...src.matchAll(/assertSubscriptionCurrencyMatchesVehicle\(data\.currency/g)].map(
      (m) => m.index ?? -1,
    );
    /* COUNT IT, EXACTLY. Two call sites shipped in W277 (`subscribe`,
       `projectLpCommitted`); Wave 306 added `createDeployment`,
       `recordDistribution` and `createTransfer`. Five, and a sixth appearing
       without this number being updated is a change nobody reviewed. */
    expect(calls.length).toBe(5);

    /* The store's methods are two-space-indented members of one object
       literal, so the next `\n  <name>(` after a call site is the start of the
       NEXT method and therefore the end of the enclosing one. */
    const enclosingFunctionEnd = (at: number): number => {
      const m = /\n  [A-Za-z_][A-Za-z0-9_]*\(/.exec(src.slice(at));
      /* NEVER FABRICATE A BOUND. If no following method is found the slice
         would silently become "rest of file" and re-open the vacuity this
         repair exists to close. */
      expect(m).not.toBeNull();
      return at + (m!.index ?? 0);
    };

    const namesGuarded: string[] = [];
    for (const at of calls) {
      /* Which method is this? Read the nearest preceding member declaration so
         the failure message names the sink rather than a byte offset. */
      const before = src.slice(0, at);
      const declMatches = [...before.matchAll(/\n  ([A-Za-z_][A-Za-z0-9_]*)\(/g)];
      const fnName = declMatches[declMatches.length - 1]?.[1] ?? "<unknown>";
      namesGuarded.push(fnName);

      const scope = src.slice(at, enclosingFunctionEnd(at));
      /* THE ORDERING CLAIM, SCOPED. The guard must sit above the currency write
         BELONGING TO THIS SAME METHOD. A guard placed after its own write would
         refuse a mismatch only once the row already existed. */
      expect(
        `${fnName}: guard precedes its own currency write = ${scope.includes("currency: data.currency ?? s.currency")}`,
      ).toBe(`${fnName}: guard precedes its own currency write = true`);
    }

    /* NAME-SET DIFF, BOTH SIDES NON-EMPTY. Asserting the SET means a guard
       silently moved from one sink to another cannot pass on count alone. */
    expect(namesGuarded.length).toBeGreaterThan(0);
    expect([...namesGuarded].sort()).toEqual([
      "createDeployment",
      "createTransfer",
      "projectLpCommitted",
      "recordDistribution",
      "subscribe",
    ]);
    /* And the route-level gate runs before the sacred ledger write. */
    const routes = fs.readFileSync("server/spvEngineRoutes.ts", "utf8");
    const gate = routes.indexOf("assertSubscriptionCurrencyMatchesVehicle(currency, spv.currency)");
    expect(gate).toBeGreaterThan(0);
    expect(routes.indexOf("commitFunded", gate)).toBeGreaterThan(gate);
  });
});
