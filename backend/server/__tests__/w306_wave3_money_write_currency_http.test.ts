/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 306 · BAND "MONEY & CURRENCY" · WAVE 3 — THE FOUR MONEY WRITES CHECK
 * THEIR OWN DENOMINATION. STORED ROWS DECIDE, NOT RETURN VALUES.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG.
 *   Four sinks in `server/spvEngineStore.ts` persisted a caller-supplied
 *   currency with NO equality check against the vehicle's own denomination,
 *   each of them literally `currency: data.currency ?? s.currency`:
 *
 *     addFee              · writes `spv_fee`
 *     createDeployment    · writes `spv_deployment`
 *     recordDistribution  · writes `spv_distribution`
 *     createTransfer      · writes `spv_transfer`
 *
 *   A caller could therefore state ANY currency and have it written verbatim
 *   onto a money row belonging to a vehicle denominated in something else.
 *   Because R156.2/R10 forbid ever converting or summing across currencies,
 *   such a row does not produce a WRONG total — it makes the total
 *   UNCOMPUTABLE. One mistyped code silently removes a figure from the GP's
 *   screen permanently.
 *
 * WHAT WAS *NOT* BUILT, AND WHY — a premise this wave corrected.
 *   The specification asked for the equality guard on all FOUR sinks. Applying
 *   it to `addFee` would have been DESTRUCTIVE, and this was measured, not
 *   guessed: a separate fee denomination is a RATIFIED, SHIPPED FEATURE.
 *   `client/src/pages/partner/PartnerSpvEngine.tsx` presents two independent
 *   `<select>` controls (`spv-w-fee-currency` in step 2 and `spv-w-currency` in
 *   step 3), the launch payload sends the fee one to `addFee`, the review step
 *   prints its own "Fee currency" row, and the source states the fee currency is
 *   "a SEPARATE selection from the SPV currency … shown when it can differ".
 *   An equality guard there would have refused a configuration the product
 *   actively offers. So `addFee` is held to the question it CAN be held to —
 *   is the stated code a currency at all? — via
 *   `assertStatedCurrencyIsRealIfPresent`. §4 proves BOTH halves of that
 *   ruling: a non-currency is refused, and a DIFFERENT REAL currency is
 *   ACCEPTED AND STORED.
 *
 * NO NEW ERROR CODE WAS INVENTED. The equality guard is the one that already
 * shipped in W277 — `assertSubscriptionCurrencyMatchesVehicle` — which already
 * owns its wire code, its 400 mapping and its investor-facing sentence. This
 * wave added CALL LINES, not a vocabulary.
 *
 * HOW THIS FILE REFUSES TO CHEAT.
 *   · Every refusal is asserted on the STORED ROW COUNT via `rawDb()`, read
 *     BEFORE the status code, so a disarm reports the row that should not exist
 *     rather than a number.
 *   · EVERY SINK HAS A CONTROL PROVING THE GUARD IS NOT A WALL. A guard that
 *     blocks everything is an outage, not a fix. For `addFee` the control is a
 *     stored row. For the other three, whose full happy paths require
 *     deployment readiness, a settled fee table and a committed LP register,
 *     the control asserts the matching-currency call is refused for a
 *     DIFFERENT, NAMED, NON-CURRENCY reason — which proves the currency guard
 *     let it through. "Passed the guard" and "blocked by the guard" are
 *     distinguished by the NAME of the refusal, never by its absence.
 *   · An ABSENT currency must still be accepted on every sink (`?? s.currency`
 *     supplies the vehicle's own), and that is asserted too — the change
 *     refuses a STATED MISMATCH only.
 * ══════════════════════════════════════════════════════════════════════════════ */

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";
import { patchConfig } from "../emailTransport";
import { spvEngineStore } from "../spvEngineStore";
import { SPV_CURRENCY_UNKNOWN_CODE } from "@shared/currencyDomain";
/* WAVE 211 made a typed operator attestation MANDATORY on the distributions
   route, and it answers BEFORE the currency guard — measured, not assumed: this
   section first observed `WAVE211_ATTESTATION_...` where it expected the
   currency refusal. The attestation is supplied the way a real operator's
   browser supplies it, through the shipped shared fixture. It is NOT a bypass;
   read that module's header. The ordering is correct and stays: an operator
   must attest a money event before the platform inspects its denomination. */
import { W226_DISTRIBUTION_ATT } from "./_wave226_attestation_fixture";

const MANAGING = "u_avi_managing";
/** The wire code, verified against the shipped constant's VALUE — the exported
 *  TS name carries an `SPV_` prefix the wire code does not have. */
const MISMATCH = "SUBSCRIPTION_CURRENCY_MISMATCH";

let app: express.Express;
let server: http.Server;

beforeAll(async () => {
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
    email: "w306w3.managing@test-partner.example",
    name: "Avi Managing Partner",
    password: "test-password-w306",
  });
});

/* ── STORED-ROW READERS. Every claim below is settled through these. ───────── */

function rowsFor(table: string, spvId: string): Array<Record<string, unknown>> {
  return rawDb()
    .prepare(`SELECT * FROM ${table} WHERE spv_id = ?`)
    .all(spvId) as Array<Record<string, unknown>>;
}
function countFor(table: string, spvId: string): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE spv_id = ?`)
    .get(spvId) as { n: number };
  return r.n;
}

let spvSeq = 0;
/** A real, ATTESTED vehicle denominated in a NON-USD currency on purpose, so a
 *  guard that silently compares against "USD" cannot pass by accident.
 *
 *  CREATED OVER THE HTTP ROUTE, NOT THROUGH THE STORE. The money sinks below
 *  are gated by Wave 189's attestation rule — no fee, LP or commitment may
 *  attach to a vehicle with no durable launch sign-off — and only the route
 *  records and links that sign-off. Building the fixture through the store
 *  would have produced an UNATTESTED vehicle, every success control would have
 *  been refused `SPV_ATTESTATION_REQUIRED`, and the suite would have been
 *  measuring the attestation gate while claiming to measure currency. The gate
 *  is correct and stays; the fixture meets it the way an operator does. */
async function makeVehicle(currency: string): Promise<{ spvId: string; currency: string }> {
  const r = await request(app)
    .post("/api/partner/me/spv")
    .set("x-user-id", MANAGING)
    .send({
      name: `W306 W3 Vehicle ${currency} ${Date.now()}_${spvSeq++}`,
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      status: "open",
      currency,
      signoffLegalName: "Avi Managing Partner",
      signoffAccepted: true,
    });
  /* If the fixture itself is refused, say so loudly with the body rather than
     letting a later assertion fail for an unrelated-looking reason. */
  expect(`status=${r.status} body=${JSON.stringify(r.body)}`).toContain("status=201");
  const spvId = String(r.body.spv.id);

  /* NEVER TRUST A RETURN VALUE FOR A FACT ABOUT THE DATABASE. Read the row. */
  const row = rawDb()
    .prepare(`SELECT currency FROM spv WHERE id = ?`)
    .get(spvId) as { currency?: string } | undefined;
  expect(row?.currency).toBe(currency);
  return { spvId, currency };
}

/** Call a sink and return the thrown message, or `null` if it did not throw. */
function messageFrom(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 1 — createDeployment
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 W3 §1 — createDeployment refuses a stated currency the vehicle does not hold", () => {
  it("a MISMATCHED currency is refused and NO deployment row is written", async () => {
    const v = await makeVehicle("EUR");
    const before = countFor("spv_deployment", v.spvId);

    const msg = messageFrom(() =>
      spvEngineStore.createDeployment(TEST_PARTNER_ID, v.spvId, {
        companyId: "co_novapay",
        companyRoundId: "round_x",
        amountMinor: 5_000_00,
        currency: "USD",
      }),
    );

    /* CONSEQUENCE FIRST — the row, then the reason. */
    const rows = rowsFor("spv_deployment", v.spvId);
    expect(
      `rows=${rows.length} ${JSON.stringify(rows.map((r) => ({ currency: r.currency })))}`,
    ).toBe("rows=0 []");
    expect(countFor("spv_deployment", v.spvId)).toBe(before);

    /* THE REASON, NAMED. The code carries the stated and the vehicle currency,
       so the refusal is readable without re-deriving anything. */
    expect(msg).toBe(`${MISMATCH}:USD:EUR`);
  });

  it("CONTROL — a MATCHING currency passes the guard and is refused only by a LATER, DIFFERENT precondition", async () => {
    /* THE CONTROL THAT MAKES THIS A FIX RATHER THAN AN OUTAGE. The identical
       call with only the currency changed must get PAST the currency guard.
       It is still refused — this vehicle has no eligible company or round —
       but by a check with a DIFFERENT NAME, which is the observable difference
       between "allowed through" and "blocked here". */
    const v = await makeVehicle("EUR");
    const msg = messageFrom(() =>
      spvEngineStore.createDeployment(TEST_PARTNER_ID, v.spvId, {
        companyId: "",
        companyRoundId: "",
        amountMinor: 5_000_00,
        currency: "EUR",
      }),
    );
    expect(msg).toBe("COMPANY_AND_ROUND_REQUIRED");
    /* Stated explicitly so this control cannot be misread as a pass-through. */
    expect(msg).not.toContain(MISMATCH);
  });

  it("an ABSENT currency is still accepted by the guard — no default was removed", async () => {
    const v = await makeVehicle("JPY");
    const msg = messageFrom(() =>
      spvEngineStore.createDeployment(TEST_PARTNER_ID, v.spvId, {
        companyId: "",
        companyRoundId: "",
        amountMinor: 5_000_00,
      }),
    );
    expect(msg).toBe("COMPANY_AND_ROUND_REQUIRED");
    expect(msg).not.toContain(MISMATCH);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 2 — recordDistribution
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 W3 §2 — recordDistribution refuses a stated currency the vehicle does not hold", () => {
  it("a MISMATCHED currency is refused and NO distribution row is written", async () => {
    const v = await makeVehicle("GBP");
    const before = countFor("spv_distribution", v.spvId);

    const msg = messageFrom(() =>
      spvEngineStore.recordDistribution(TEST_PARTNER_ID, v.spvId, {
        event: "exit",
        grossProceedsMinor: 1_000_00,
        costBasisMinor: 500_00,
        currency: "USD",
      }, MANAGING),
    );

    const rows = rowsFor("spv_distribution", v.spvId);
    expect(
      `rows=${rows.length} ${JSON.stringify(rows.map((r) => ({ currency: r.currency })))}`,
    ).toBe("rows=0 []");
    expect(countFor("spv_distribution", v.spvId)).toBe(before);
    expect(msg).toBe(`${MISMATCH}:USD:GBP`);
  });

  it("CONTROL — a MATCHING currency passes the guard and is refused only by a LATER, DIFFERENT precondition", async () => {
    const v = await makeVehicle("GBP");
    const msg = messageFrom(() =>
      spvEngineStore.recordDistribution(TEST_PARTNER_ID, v.spvId, {
        event: "",
        grossProceedsMinor: 1_000_00,
        currency: "GBP",
      }, MANAGING),
    );
    /* Either the fee-view fence or the event requirement answers first. Both are
       NAMED, neither is the currency guard, and the assertion says which. */
    expect(["FEE_STATE_UNKNOWN", "EVENT_REQUIRED"]).toContain(msg);
    expect(msg).not.toContain(MISMATCH);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 3 — createTransfer
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 W3 §3 — createTransfer refuses a stated currency the vehicle does not hold", () => {
  it("a MISMATCHED currency is refused and NO transfer row is written", async () => {
    const v = await makeVehicle("CHF");
    const before = countFor("spv_transfer", v.spvId);

    const msg = messageFrom(() =>
      spvEngineStore.createTransfer(
        TEST_PARTNER_ID,
        v.spvId,
        {
          fromInvestorId: "inv_a",
          toInvestorId: "inv_b",
          amountMinor: 100_00,
          currency: "USD",
        },
        MANAGING,
      ),
    );

    const rows = rowsFor("spv_transfer", v.spvId);
    expect(
      `rows=${rows.length} ${JSON.stringify(rows.map((r) => ({ currency: r.currency })))}`,
    ).toBe("rows=0 []");
    expect(countFor("spv_transfer", v.spvId)).toBe(before);
    expect(msg).toBe(`${MISMATCH}:USD:CHF`);
  });

  it("CONTROL — a MATCHING currency passes the guard and is refused only by a LATER, DIFFERENT precondition", async () => {
    const v = await makeVehicle("CHF");
    const msg = messageFrom(() =>
      spvEngineStore.createTransfer(
        TEST_PARTNER_ID,
        v.spvId,
        { fromInvestorId: "", toInvestorId: "", amountMinor: 100_00, currency: "CHF" },
        MANAGING,
      ),
    );
    expect(msg).toBe("TRANSFER_PARTIES_REQUIRED");
    expect(msg).not.toContain(MISMATCH);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 4 — addFee: THE VOCABULARY RULING, BOTH HALVES OF IT.
   ─────────────────────────────────────────────────────────────────────────────
   This section is the one that would fail if a future agent "completed" the
   specification by adding the equality guard to `addFee`. It is here to make
   that regression loud.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 W3 §4 — addFee refuses a NON-CURRENCY but ALLOWS a different real currency", () => {
  it("a stated NON-CURRENCY is refused and NO fee row is written", async () => {
    const v = await makeVehicle("EUR");
    const before = countFor("spv_fee", v.spvId);

    const msg = messageFrom(() =>
      spvEngineStore.addFee(
        TEST_PARTNER_ID,
        v.spvId,
        { layer: "management", feeType: "fixed", fixedAmountMinor: 1_000_00, currency: "ZZZ" },
        MANAGING,
        {},
      ),
    );

    const rows = rowsFor("spv_fee", v.spvId);
    expect(
      `rows=${rows.length} ${JSON.stringify(rows.map((r) => ({ currency: r.currency })))}`,
    ).toBe("rows=0 []");
    expect(countFor("spv_fee", v.spvId)).toBe(before);
    expect(msg).toBe(`${SPV_CURRENCY_UNKNOWN_CODE}:ZZZ`);
  });

  it("A DIFFERENT REAL CURRENCY IS ACCEPTED AND STORED — the ratified separate fee denomination survives", async () => {
    /* THE ANTI-REGRESSION ASSERTION. The vehicle is EUR and the fee is USD.
       This MUST succeed: the wizard offers exactly this configuration through a
       dedicated `spv-w-fee-currency` control. If someone later applies the
       equality guard here, this stored row disappears and this test fails. */
    const v = await makeVehicle("EUR");

    spvEngineStore.addFee(
      TEST_PARTNER_ID,
      v.spvId,
      { layer: "management", feeType: "fixed", fixedAmountMinor: 2_500_00, currency: "USD" },
      MANAGING,
      {},
    );

    const rows = rowsFor("spv_fee", v.spvId);
    expect(rows.length).toBe(1);
    /* THE POINT, ON THE ROW: a USD fee on a EUR vehicle, persisted, unconverted,
       and NOT summed with anything. */
    expect(rows[0].currency).toBe("USD");
    const vehicle = rawDb()
      .prepare(`SELECT currency FROM spv WHERE id = ?`)
      .get(v.spvId) as { currency: string };
    expect(vehicle.currency).toBe("EUR");
    expect(rows[0].currency).not.toBe(vehicle.currency);
  });

  it("an ABSENT fee currency still inherits the vehicle's own denomination", async () => {
    const v = await makeVehicle("JPY");
    spvEngineStore.addFee(
      TEST_PARTNER_ID,
      v.spvId,
      { layer: "management", feeType: "fixed", fixedAmountMinor: 3_000_00 },
      MANAGING,
      {},
    );
    const rows = rowsFor("spv_fee", v.spvId);
    expect(rows.length).toBe(1);
    /* `?? s.currency` — unchanged behaviour, asserted so the wave cannot be
       accused of having removed a default it deliberately kept. */
    expect(rows[0].currency).toBe("JPY");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 5 — THE HTTP 400 THAT ALREADY EXISTED, OVER THE REAL ROUTE.
   ─────────────────────────────────────────────────────────────────────────────
   The owner's requirement is that a mismatched write is refused "with the
   EXISTING 400". That mapping shipped in W277 and this wave did not touch it.
   Asserted here over HTTP so the claim rests on a response a client can
   actually receive, not on a thrown string.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 W3 §5 — the refusal reaches a client as the existing 400, with words", () => {
  it("POST /distributions with a mismatched currency answers 400 and writes no row", async () => {
    const v = await makeVehicle("EUR");

    const r = await request(app)
      .post(`/api/partner/me/spv/${v.spvId}/distributions`)
      .set("x-user-id", MANAGING)
      .send({
        ...W226_DISTRIBUTION_ATT,
        event: "exit",
        grossProceedsMinor: 1_000_00,
        costBasisMinor: 500_00,
        currency: "USD",
      });

    const rows = rowsFor("spv_distribution", v.spvId);
    expect(
      `rows=${rows.length} ${JSON.stringify(rows.map((x) => ({ currency: x.currency })))}`,
    ).toBe("rows=0 []");

    /* THE STATUS IS 400 — a client error, because the client stated a currency
       the vehicle does not hold. Printed with the body so a disarm shows what
       the client would actually have received. */
    expect(`status=${r.status} error=${String(r.body?.error ?? "")}`).toBe(
      `status=400 error=${MISMATCH}:USD:EUR`,
    );

    /* R77 — NO CODE REACHES A PAYING CLIENT NAKED. This copy is W277's, reused
       and not rewritten, and this asserts it is actually attached here. */
    const message = String(r.body?.message ?? "");
    expect(message.length).toBeGreaterThan(20);
    expect(message).not.toContain("SUBSCRIPTION_CURRENCY_MISMATCH");
  });
});
