/**
 * WAVE 182 · ITEM A · R152 — A CLOSED VEHICLE DOES NOT ACCEPT CAPITAL.
 *
 * THE DEFECT THIS TEST FENCES, AS REPRODUCED ON LIVE. An SPV was moved
 * Open → Closed (the toast "Closed to new LPs" was shown, and that close was
 * reported to the vehicle's limited partners). An LP was then committed $50,000
 * through the admin "Commit an LP to the cap table" form. It SUCCEEDED, with no
 * refusal and no warning, and the close statement recomputed from 1 LP / $400,000
 * to 2 LPs / $450,000 AFTER the close. A general partner who closes a vehicle and
 * reports that close to their LPs was still accepting capital into it.
 *
 * WHY THIS TEST IS AT THE ROUTE LAYER. A disabled button is not enforcement, and
 * a store unit test does not prove a partner is refused — R137: a fix that passes
 * tests and never reaches the caller has not been made. This drives the REAL
 * Express routes with supertest, once per write path, and asserts the real
 * response body. The client half (the sentence a GP READS on the form) is proved
 * in client/src/pages/partner/__tests__/w182_itemA_closed_notice_dom.test.tsx.
 *
 * EVERY WRITE PATH, PROVEN INDIVIDUALLY — NOT ASSUMED. The preflight enumerated
 * every sink that can add or increase an LP commitment. The four that write into
 * the canonical LP register, plus the legacy commitments adapter, are each driven
 * here in BOTH directions: refused while closed, accepted while open. Paths that
 * only move an EXISTING row (soft-circle, gp-confirm, PATCH subscription) are not
 * new capacity and are deliberately not gated.
 *
 * THE THREE THINGS THAT MUST NOT BREAK, EACH WITH AN EXPLICIT POSITIVE CONTROL:
 *   1. THE ROLLING CLOSE. closed → reopen → commit must be accepted again. A gate
 *      that made a close permanent would destroy the rolling-close workflow, which
 *      is worse than the defect.
 *   2. SETTLEMENT OF EXISTING COMMITMENTS. Confirming funds for an LP who
 *      committed BEFORE the close must still work WHILE the vehicle is closed.
 *      The rule is: block new capacity, never block settlement.
 *   3. FEE TIMING (R152.2). The SPV fee triggers when the vehicle is marked
 *      Deployed. No refusal, and no accepted commitment, may cause a fee to be
 *      charged at commit or at funds-confirmation. Asserted on the fee obligation
 *      ledger, not inferred.
 *
 * AND ONE THING THAT MUST NOT BE A CODE. R152 item 3 / R149.2: the refusal is a
 * STATED FACT. Every refusal below is asserted to name the vehicle, to say it is
 * closed to new limited partners, to say existing commitments can still be
 * confirmed, and to say it can be reopened for a rolling close — and to contain no
 * ALL-CAPS underscore token in anything a person reads.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import { spvEngineStore } from "../spvEngineStore";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import {
  SPV_CLOSED_TO_NEW_CAPITAL_CODE,
  spvClosedToNewCapitalSentence,
} from "@shared/spvClosedToNewCapital";

/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the
   money-event routes this suite drives, so these requests were refused 400 and
   the proofs below never reached their own assertions. The fixture supplies what
   a real operator supplies, over the same HTTP route; it is NOT a bypass. Read
   the header of `_wave226_attestation_fixture.ts` before changing it. */
import { W226_LP_COMMIT_ATT } from "./_wave226_attestation_fixture";
const MANAGING = "u_avi_managing";
const PARTNER_ID = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}
function get(p: string) {
  return request(app).get(p).set("x-user-id", MANAGING);
}

async function newSpv(name: string, patch: Record<string, unknown> = {}): Promise<string> {
  const c = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(c.status).toBe(201);
  const id = c.body.spv.id as string;
  if (Object.keys(patch).length > 0) spvEngineStore.updateSpv(PARTNER_ID, id, patch, "u_test_seed");
  return id;
}

/* The vehicle is closed THROUGH ITS OWN ROUTE, not by writing `status` behind the
   engine's back. A test that fabricated the closed state could pass against a
   store that the real close button never reaches. */
async function closeIt(spvId: string) {
  const r = await post(`/api/partner/me/spv/${spvId}/close`, {});
  expect(r.status).toBeLessThan(300);
  expect(spvEngineStore.getSpv(PARTNER_ID, spvId)!.status).toBe("closed");
}

/* Asserts the FOUR facts the refusal owes a general partner, and asserts that no
   machine code is among the words. `error` keeps the code on purpose — a support
   ticket can still be keyed on it — so only the human fields are screened. */
function expectStatedRefusal(body: Record<string, unknown>, spvName: string) {
  const humanFields = [String(body.message ?? ""), String(body.guidance ?? "")];
  const joined = humanFields.join(" ");
  expect(joined).toContain(spvName);
  expect(joined.toLowerCase()).toContain("closed to new limited partners");
  expect(joined.toLowerCase()).toContain("confirm");
  expect(joined.toLowerCase()).toContain("rolling close");
  for (const field of humanFields) {
    expect(field).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
  }
  expect(body.error).toBe(SPV_CLOSED_TO_NEW_CAPITAL_CODE);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { headers: Record<string, string> }).headers["x-user-id"] =
      (req.headers["x-user-id"] as string) ?? MANAGING;
    next();
  });
  seedTestPartnerSandbox();
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerSpvLegacyAdapterRoutes(app);
});

/* ══ A1 — the exact path the owner reproduced on live ══════════════════════ */
describe("W182 A1 — POST lp-commit (the reproduced defect)", () => {
  it("refuses a NEW LP into a closed vehicle, in words, and writes nothing", async () => {
    const name = "W182 A1 Closed Vehicle";
    const spvId = await newSpv(name);
    /* One LP committed BEFORE the close, so the close statement has a real figure
       to be corrupted — the same shape as the live reproduction. */
    const first = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Preclose", holderLastName: "Tester",
      investorEmail: "preclose@example.com", amount: "400000", shares: "100",
    });
    expect(first.status).toBe(201);
    await closeIt(spvId);
    const before = spvEngineStore.closeSummary(PARTNER_ID, spvId);

    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Postclose", holderLastName: "Tester",
      investorEmail: "postclose@example.com", amount: "50000", shares: "10",
    });

    expect(r.status).toBe(409);
    expectStatedRefusal(r.body, name);
    /* THE CLOSE STATEMENT DID NOT MOVE. This is the assertion that matters to the
       LPs who were sent that statement. */
    const after = spvEngineStore.closeSummary(PARTNER_ID, spvId);
    expect(after).toEqual(before);
    /* AND NO HALF-STATE: the refusal landed before the identity register and
       before the sacred ledger, so the rejected LP exists nowhere. */
    const subs = spvEngineStore.listSubscriptions(PARTNER_ID, spvId);
    expect(subs.length).toBe(1);
  });

  it("accepts the same commit while the vehicle is OPEN (the negative control)", async () => {
    const spvId = await newSpv("W182 A1 Open Vehicle");
    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Postclose", holderLastName: "Tester",
      investorEmail: "openok@example.com", amount: "50000", shares: "10",
    });
    expect(r.status).toBe(201);
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId).length).toBe(1);
  });

  it("refuses an INCREASE to an existing LP's commitment while closed", async () => {
    const name = "W182 A1 Increase While Closed";
    const spvId = await newSpv(name);
    const body = (amount: string) => ({
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Same", holderLastName: "Holder",
      investorEmail: "same@example.com", amount, shares: "10",
    });
    expect((await post(`/api/partner/me/spv/${spvId}/lp-commit`, body("100000"))).status).toBe(201);
    await closeIt(spvId);
    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, body("250000"));
    expect(r.status).toBe(409);
    expectStatedRefusal(r.body, name);
    expect(r.body.closedToNewLps).toEqual({ reason: "increase" });
  });
});

/* ══ A2 — canonical subscribe route ═══════════════════════════════════════ */
describe("W182 A2 — POST /spv/:spvId/subscriptions", () => {
  it("refused while closed, accepted while open", async () => {
    const name = "W182 A2 Subscriptions";
    const spvId = await newSpv(name);
    const sub = (investorId: string) => ({ investorId, commitmentMinor: 25000_00, currency: "USD" });

    const ok = await post(`/api/partner/me/spv/${spvId}/subscriptions`, sub("lp_a2_open"));
    expect(ok.status).toBe(201);

    await closeIt(spvId);
    const refused = await post(`/api/partner/me/spv/${spvId}/subscriptions`, sub("lp_a2_closed"));
    expect(refused.status).toBe(409);
    expectStatedRefusal(refused.body, name);
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId).map((s) => s.investorId)).toEqual(["lp_a2_open"]);
  });
});

/* ══ A3 — legacy "positions" route, same canonical sink ═══════════════════ */
describe("W182 A3 — POST /spvs/:id/positions", () => {
  it("refused while closed with WORDS (not the bare code its catch used to send)", async () => {
    const name = "W182 A3 Positions";
    const spvId = await newSpv(name);
    const body = (lpContactId: string) => ({ lpContactId, positionAmountMinor: 15000_00, currency: "USD" });

    expect((await post(`/api/partner/me/spvs/${spvId}/positions`, body("lp_a3_open"))).status).toBe(201);
    await closeIt(spvId);
    const refused = await post(`/api/partner/me/spvs/${spvId}/positions`, body("lp_a3_closed"));
    expect(refused.status).toBe(409);
    expectStatedRefusal(refused.body, name);
  });
});

/* ══ A4 — fund commitments (a fund IS an SPV with spvType "fund") ═════════ */
describe("W182 A4 — POST /funds/:id/commitments", () => {
  it("refused while closed, accepted while open", async () => {
    const name = "W182 A4 Fund";
    /* Created through the FUND route, not by patching `spvType` onto an SPV: the
       commitments route resolves the vehicle with `spvType !== "fund" -> 404`, so a
       hand-patched row would 404 and the test would prove nothing about the gate. */
    const created = await post("/api/partner/me/funds", {
      fundName: name,
      fundType: "closed_end",
      jurisdiction: "delaware",
      vintage: 2026,
      currency: "USD",
      status: "raising",
      signoffLegalName: "Avi Managing",
      signoffAccepted: true,
    });
    expect(created.status).toBe(201);
    const spvId = String(created.body.fund?.id ?? created.body.spv?.id ?? created.body.id);
    expect(spvEngineStore.getSpv(PARTNER_ID, spvId)!.spvType).toBe("fund");
    const body = (lpContactId: string) => ({ lpContactId, commitmentMinor: 30000_00, currency: "USD" });

    expect((await post(`/api/partner/me/funds/${spvId}/commitments`, body("lp_a4_open"))).status).toBe(201);
    await closeIt(spvId);
    const refused = await post(`/api/partner/me/funds/${spvId}/commitments`, body("lp_a4_closed"));
    expect(refused.status).toBe(409);
    expectStatedRefusal(refused.body, name);
  });
});

/* ══ A5 — legacy commitments adapter (the lesser path, still gated) ═══════
   It writes the legacy `spv_commitments` table, which the close statement does
   NOT read — so it cannot move the figure the LPs were sent. It is gated anyway:
   it is still capital recorded into a vehicle whose GP has told their LPs it is
   closed, and a refusal here must be a refusal (409 with words), not the
   `500 COMMITMENT_FAILED` its catch block used to produce. */
describe("W182 A5 — POST /spvs/:id/commitments (legacy adapter)", () => {
  it("a declined write is a 409 with a sentence, not a 500 with a code", async () => {
    const name = "W182 A5 Legacy Commitments";
    const spvId = await newSpv(name);
    await closeIt(spvId);
    const refused = await post(`/api/partner/me/spvs/${spvId}/commitments`, {
      lp_user_id: "lp_a5_closed",
      amount_minor: 12000_00,
    });
    /* NO ESCAPE HATCH. An earlier draft of this test tolerated a 404 in case the
       adapter were feature-gated off; that would have let the test pass while
       proving nothing. `CONSORTIUM_ENABLED` defaults to on, `routes.ts` registers
       THIS adapter (and never `registerSpvFundRoutes`), so a 404 here is a real
       failure and is reported as one. */
    expect(refused.status).toBe(409);
    expectStatedRefusal(refused.body, name);
    expect(refused.body.error).not.toBe("COMMITMENT_FAILED");
  });
});

/* ══ POSITIVE CONTROL 1 — THE ROLLING CLOSE MUST STILL WORK ══════════════ */
describe("W182 A · POSITIVE CONTROL — closed → reopen → commit", () => {
  it("a reopened vehicle accepts new capital again, and the new LP lands on the register", async () => {
    const name = "W182 Rolling Close";
    const spvId = await newSpv(name);
    expect((await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "First", holderLastName: "Lp",
      investorEmail: "rolling-first@example.com", amount: "100000", shares: "10",
    })).status).toBe(201);

    await closeIt(spvId);

    /* Refused while closed … */
    const refused = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Second", holderLastName: "Lp",
      investorEmail: "rolling-second@example.com", amount: "75000", shares: "8",
    });
    expect(refused.status).toBe(409);

    /* … reopened for a rolling close, exactly as the refusal told the GP to do … */
    const reopen = await post(`/api/partner/me/spv/${spvId}/reopen`, {});
    expect(reopen.status).toBeLessThan(300);
    expect(spvEngineStore.getSpv(PARTNER_ID, spvId)!.status).toBe("open");

    /* … and the SAME request now succeeds. */
    const accepted = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Second", holderLastName: "Lp",
      investorEmail: "rolling-second@example.com", amount: "75000", shares: "8",
    });
    expect(accepted.status).toBe(201);
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId).length).toBe(2);

    /* And it can be closed AGAIN — a rolling close is a cycle, not one shot. */
    await closeIt(spvId);
    const refusedAgain = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Third", holderLastName: "Lp",
      investorEmail: "rolling-third@example.com", amount: "50000", shares: "5",
    });
    expect(refusedAgain.status).toBe(409);
    expectStatedRefusal(refusedAgain.body, name);
  });
});

/* ══ POSITIVE CONTROL 2 — SETTLEMENT IS NOT NEW CAPACITY ═════════════════ */
describe("W182 A · POSITIVE CONTROL — confirm funds WHILE the vehicle is closed", () => {
  it("an LP who committed before the close can still have their funds confirmed, and no fee is charged", async () => {
    const spvId = await newSpv("W182 Settlement While Closed");
    const committed = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Settling", holderLastName: "Lp",
      investorEmail: "settling@example.com", amount: "200000", shares: "20",
    });
    expect(committed.status).toBe(201);
    const investorId = spvEngineStore.listSubscriptions(PARTNER_ID, spvId)[0].investorId;

    await closeIt(spvId);

    /* THE WHOLE POINT: blocking new capacity must never block settlement of a
       commitment the vehicle already accepted. */
    const confirm = await post(
      `/api/partner/me/spv/${spvId}/subscriptions/${investorId}/confirm-funds`,
      { receivedMinor: 200000_00, reference: "WIRE-W182" },
    );
    expect(confirm.status).toBe(201);
    expect(spvEngineStore.confirmedByInvestor(PARTNER_ID, spvId)[investorId]).toBeDefined();

    /* R152.2 — AND IT CHANGED NO FEE FIGURE. The SPV fee triggers when the
       vehicle is marked Deployed. Confirming funds must not pull it earlier, and
       nothing in this wave may make it do so. Asserted on the obligation ledger. */
    const feeRes = await get(`/api/partner/me/spv/${spvId}/fee-obligations`);
    expect(feeRes.status).toBe(200);
    expect((feeRes.body.obligations as unknown[]).length).toBe(0);
  });
});
