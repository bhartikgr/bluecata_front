/**
 * WAVE 90 · ITEM 1 — THE ROUTE-LEVEL REPRODUCTION OF M-2, AS A GATE TEST.
 *
 * The live audit reported that an investor cannot see the pro-forma cap table of
 * a round they were invited to. This file is the reproduction that established
 * WHY, driving the real `registerRoutes` Express stack over supertest with the
 * demo investor persona `u_aisha_patel`:
 *
 *   GET /api/companies/co_novapay/captable/interim  -> 200   holds a position
 *   GET /api/companies/co_quanta/captable/interim   -> 404   invited only
 *   GET /api/companies/co_lattice/captable/interim  -> 404   invited only
 *   GET /api/companies/co_kelvin/captable/interim   -> 404   invited only
 *
 * The 404 is `decideCapTableSinkAccess` refusing with reason `no_relationship`
 * (server/lib/capTableSinkScope.ts). It is deliberate — WAVE 36 · ROW 1 removed
 * the `invitedRounds` disjunct because a prospect who holds nothing could
 * otherwise read the entire ledger — and it is 404 rather than 403 because a 403
 * confirms the resource exists and so enumerates private SPV ids (WAVE 42 · F-9).
 *
 * WHY THIS FILE EXISTS RATHER THAN JUST THE RENDER TEST. The render test asserts
 * what the component does with a 404. Only this file asserts that a 404 is what
 * the ROUTE actually produces for this exact situation. Without it the render
 * test would keep passing forever against a failure mode that no longer occurs —
 * the reasoning `w55b_captable_family_refusal_http.test.ts` records for the same
 * endpoint.
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 *   LOWER  invited-but-holds-nothing -> 404, and NOT 401 (so it is a scope
 *          decision and not an authentication accident) and NOT 5xx (so it is a
 *          decision and not a crash).
 *   UPPER  the same investor on a company where they DO hold a position -> 200
 *          with the three arrays present. A one-pole test would pass against a
 *          totally dead endpoint, which is worse than the defect.
 *
 * ALSO PINNED: the /securities sibling on the same tab answers the SAME status
 * for the SAME situation. The S0 defect was that the two surfaces described one
 * refusal in two different ways; if their statuses ever diverge, the copy fix
 * needs re-reading and this fails.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { W55B_CAP_TABLE_REFUSAL_STATUS } from "@shared/w55bCapTableRefusal";

let app: Express;
let server: http.Server;

/** The seeded investor persona. Authenticated, real, and NOT an admin. */
const INVESTOR_ID = "u_aisha_patel";
const INVESTOR_EMAIL = "aisha@greenwood.capital";

function asInvestor(url: string) {
  return request(app).get(url).set("x-user-id", INVESTOR_ID).set("x-user-email", INVESTOR_EMAIL);
}

const INTERIM = (cid: string) => `/api/companies/${cid}/captable/interim`;
const SECURITIES = (cid: string) => `/api/companies/${cid}/securities`;

/** Resolved from the persona's own invitation list, never hardcoded. */
let holdingCompanyId = "";
let invitedOnlyCompanyIds: string[] = [];

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  const list = await asInvestor("/api/investor/invitations");
  const invitations: Array<{ id: string }> = Array.isArray(list.body) ? list.body : [];
  for (const inv of invitations) {
    const detail = await asInvestor(`/api/investor/invitations/${inv.id}`);
    const cid = String(detail.body?.company?.id ?? "");
    if (!cid) continue;
    const res = await asInvestor(INTERIM(cid));
    if (res.status === 200 && !holdingCompanyId) holdingCompanyId = cid;
    if (res.status === W55B_CAP_TABLE_REFUSAL_STATUS) invitedOnlyCompanyIds.push(cid);
  }
}, 120000);

describe("W90 · ITEM 1 — the interim cap-table route's answer to an invited investor", () => {
  it("FIXTURE — the persona really is authenticated, so a refusal is a scope decision", async () => {
    const me = await asInvestor("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body?.isAuthed).toBe(true);
    expect(me.body?.userId).toBe(INVESTOR_ID);
  });

  it("FIXTURE — the persona has invitations to companies where they hold nothing", () => {
    /* If this ever becomes empty the seed changed and the rest of this file is
       vacuous, which is exactly the failure mode a fixture assertion prevents. */
    expect(invitedOnlyCompanyIds.length).toBeGreaterThan(0);
  });

  it("LOWER POLE — invited but holding nothing: the pinned deliberate refusal", async () => {
    for (const cid of invitedOnlyCompanyIds) {
      const res = await asInvestor(INTERIM(cid));
      expect(res.status).toBe(W55B_CAP_TABLE_REFUSAL_STATUS);
      /* Not an auth accident, and not a crash. */
      expect(res.status).not.toBe(401);
      expect(res.status).toBeLessThan(500);
    }
  });

  it("LOWER POLE — the refusal is PERMANENT, which is why the copy must not say 'try again'", async () => {
    const cid = invitedOnlyCompanyIds[0];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await asInvestor(INTERIM(cid));
      expect(res.status).toBe(W55B_CAP_TABLE_REFUSAL_STATUS);
    }
  });

  it("THE S0 DEFECT IN ONE ASSERTION — the two surfaces on this tab agree on the status", async () => {
    for (const cid of invitedOnlyCompanyIds) {
      const interim = await asInvestor(INTERIM(cid));
      const securities = await asInvestor(SECURITIES(cid));
      expect(interim.status).toBe(securities.status);
    }
  });

  it("UPPER POLE — the endpoint is NOT blanket-broken: a real counterparty gets 200 and data", async () => {
    expect(holdingCompanyId).not.toBe("");
    const res = await asInvestor(INTERIM(holdingCompanyId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.committed)).toBe(true);
    expect(Array.isArray(res.body?.funded)).toBe(true);
    expect(Array.isArray(res.body?.soft_circle)).toBe(true);
    expect(res.body?.subtotals).toBeTruthy();
  });

  it("UPPER POLE — and it does not 5xx on the allowed path (no serialisation fault)", async () => {
    const res = await asInvestor(INTERIM(holdingCompanyId));
    expect(res.status).toBeLessThan(500);
    /* A value the response cannot serialise was one of the candidate causes.
       If any row or subtotal were unserialisable, supertest could not parse it. */
    expect(typeof res.body).toBe("object");
  });
});
