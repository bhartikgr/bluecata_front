/**
 * v25.48 — Soft-circle authorization guards (BUG-A + BUG-B regression tests).
 *
 * These are the NEGATIVE tests GPT-5.5 flagged as required. They FAIL against the
 * pre-fix code and PASS against the fixed routes:
 *
 *   BUG-A (POST /api/rounds/:id/soft-circle):
 *     A1. Unknown/invalid round id -> 404 round_not_found (no orphan soft-circle).
 *     A2. An UNRELATED founder (owns company B, not this round's company A) supplying
 *         investorUserId must NOT have it honored -> intent self-links to the caller,
 *         never to the injected third-party investor.
 *     A3. The LEGIT owning founder on-behalf still works (positive control).
 *
 *   BUG-B (POST /api/rounds/:id/soft-circle/:scId/validate):
 *     B1. Cross-round: founder A owns round A; a soft-circle scB belongs to round B.
 *         Calling /api/rounds/:roundA/soft-circle/:scB/validate must 404, and scB
 *         must remain NOT confirmed.
 *     B2. Matching (round, sc) validate still works (positive control).
 *
 * Real Express routes via registerRoutes; identities via __setRuntimePersona + x-user-id.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { getDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { addCompanyForFounder } from "../multiCompanyStore.ts";
import { createRound as roundsCreate } from "../roundsStore.ts";
import { getSoftCircle } from "../softCircleStore.ts";

const STAMP = Date.now();
let app, server, port;

function call(method, path, { userId, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = { ...(payload ? { "content-type": "application/json" } : {}), ...(userId ? { "x-user-id": userId } : {}) };
  const qs = userId ? (path.includes("?") ? "&" : "?") + `userId=${encodeURIComponent(userId)}` : "";
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port, path: `${path}${qs}`, method, headers }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode ?? 0, body: j }); });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const FOUNDER_A = `u_authz_founderA_${STAMP}`;
const FOUNDER_B = `u_authz_founderB_${STAMP}`;
const COMPANY_A = `co_authz_A_${STAMP}`;
const COMPANY_B = `co_authz_B_${STAMP}`;
const VICTIM_INVESTOR = `u_authz_victim_${STAMP}`; // third-party investor an attacker might try to inject
let ROUND_A, ROUND_B;

function seedFounder(userId, companyId) {
  __setRuntimePersona({ userId, email: `${userId}@authz.test`, name: userId, isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });
  addCompanyForFounder(userId, {
    companyId, companyName: `Authz ${companyId}`, legalName: `Authz ${companyId}, Inc.`, logoUrl: null,
    role: "founder", lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 1, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 100 },
    collective: { status: "none" }, billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: new Date().toISOString(), cardLast4: null, invoiceCount: 0 },
    sector: "SaaS", stage: "Seed", hq: "SF",
  });
  const round = roundsCreate({ companyId, name: `Round ${companyId}`, type: "priced", state: "active", targetAmount: 1000000, pricePerShare: 0.1, currency: "USD", actorUserId: userId });
  return round.id;
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  getDb();
  app = express(); app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((r) => server.listen(0, () => { port = server.address().port; r(); }));
  ROUND_A = seedFounder(FOUNDER_A, COMPANY_A);
  ROUND_B = seedFounder(FOUNDER_B, COMPANY_B);
  __setRuntimePersona({ userId: VICTIM_INVESTOR, email: `${VICTIM_INVESTOR}@authz.test`, name: "Victim", isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
}, 60_000);

afterAll(async () => { await new Promise((r) => server.close(() => r())); });

describe("v25.48 soft-circle authorization guards (BUG-A + BUG-B)", () => {
  it("A1: unknown round id -> 404 round_not_found (no orphan soft-circle)", async () => {
    const res = await call("POST", `/api/rounds/rnd_does_not_exist_${STAMP}/soft-circle`, {
      userId: FOUNDER_A, body: { amount: 1000, currency: "USD", status: "intent", sourceType: "direct" },
    });
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("round_not_found");
  });

  it("A2: unrelated founder cannot inject investorUserId on another founder's round (self-links to caller)", async () => {
    // Founder B (owns company B) targets ROUND_A (company A) and tries to link the victim investor.
    const res = await call("POST", `/api/rounds/${ROUND_A}/soft-circle`, {
      userId: FOUNDER_B, body: { investorUserId: VICTIM_INVESTOR, amount: 5000, currency: "USD", status: "intent", sourceType: "direct" },
    });
    expect(res.status).toBe(200);
    // The injected investorUserId MUST be ignored -> links to the caller (Founder B), NOT the victim.
    expect(res.body?.softCircle?.investorUserId).toBe(FOUNDER_B);
    expect(res.body?.softCircle?.investorUserId).not.toBe(VICTIM_INVESTOR);
  });

  it("A3 (control): the owning founder CAN act on-behalf on their own round", async () => {
    const res = await call("POST", `/api/rounds/${ROUND_A}/soft-circle`, {
      userId: FOUNDER_A, body: { investorUserId: VICTIM_INVESTOR, amount: 7000, currency: "USD", status: "intent", sourceType: "direct" },
    });
    expect(res.status).toBe(200);
    expect(res.body?.softCircle?.investorUserId).toBe(VICTIM_INVESTOR); // legit on-behalf honored
  });

  it("B1: cross-round validate is rejected and does NOT confirm the foreign soft-circle", async () => {
    // Create a soft-circle on ROUND_B (owned by Founder B).
    const scB = await call("POST", `/api/rounds/${ROUND_B}/soft-circle`, {
      userId: FOUNDER_B, body: { amount: 3000, currency: "USD", status: "intent", sourceType: "direct" },
    });
    const scBId = scB.body?.softCircle?.id;
    expect(scBId).toBeTruthy();
    // Founder A (owns ROUND_A) tries to confirm scB via ROUND_A's path.
    const res = await call("POST", `/api/rounds/${ROUND_A}/soft-circle/${scBId}/validate`, { userId: FOUNDER_A });
    expect(res.status).toBe(404);
    // And scB must remain unconfirmed in the store.
    const after = getSoftCircle(scBId);
    expect(after?.status).not.toBe("confirmed");
  });

  it("B2 (control): validate works for a matching (round, soft-circle) owned by the founder", async () => {
    const scA = await call("POST", `/api/rounds/${ROUND_A}/soft-circle`, {
      userId: FOUNDER_A, body: { amount: 4000, currency: "USD", status: "intent", sourceType: "direct" },
    });
    const scAId = scA.body?.softCircle?.id;
    const res = await call("POST", `/api/rounds/${ROUND_A}/soft-circle/${scAId}/validate`, { userId: FOUNDER_A });
    expect(res.status).toBe(200);
    expect(res.body?.softCircle?.status).toBe("confirmed");
  });
});
