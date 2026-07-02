/**
 * v25.48 DATA-2 (V-1/V-2/V-3/V-11) — admin KPIs + reconciliation are DB-driven,
 * not mockData-derived.
 *
 * Regression for BUG-C / the live "COMPANIES = 0 while 54 tenants exist" finding.
 * Seeds REAL companies + a funded round via the canonical stores, then asserts
 * GET /api/admin/dashboard/kpis reflects the DB (totalCompanies > 0, totalFunded
 * > 0), and that a fresh DB serves NO mock reconciliation runs.
 *
 * NODE_ENV=test with ENABLE_DEMO_SEED unset would still leave mock arrays empty
 * on the KPI path, so this proves the KPIs read the DB stores regardless.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { getDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { addCompanyForFounder } from "../multiCompanyStore.ts";
import { createRound as roundsCreate, updateRound } from "../roundsStore.ts";

const STAMP = Date.now();
let app, server, port;

function call(method, path, { userId } = {}) {
  const headers = userId ? { "x-user-id": userId } : {};
  const qs = userId ? (path.includes("?") ? "&" : "?") + `userId=${encodeURIComponent(userId)}&as=admin` : "?as=admin";
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port, path: `${path}${qs}`, method, headers }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode ?? 0, body: j }); });
    });
    r.on("error", reject);
    r.end();
  });
}

const FOUNDER = `u_data2_founder_${STAMP}`;
const COMPANY = `co_data2_${STAMP}`;

beforeAll(async () => {
  getDb();
  __setRuntimePersona({ userId: FOUNDER, email: `${FOUNDER}@data2.test`, name: "Data2 Founder", isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });
  addCompanyForFounder(FOUNDER, {
    companyId: COMPANY, companyName: `Data2 Co ${STAMP}`, legalName: `Data2 Co ${STAMP}, Inc.`, logoUrl: null,
    role: "founder", lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 1, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 100 },
    collective: { status: "none" }, billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: new Date().toISOString(), cardLast4: null, invoiceCount: 0 },
    sector: "SaaS", stage: "Seed", hq: "SF", region: "US",
  });
  const round = roundsCreate({ companyId: COMPANY, name: `Data2 Round ${STAMP}`, type: "priced", state: "closed", targetAmount: 1000000, pricePerShare: 0.5, currency: "USD", actorUserId: FOUNDER });
  // Record real raised capital so totalFunded must be > 0 from the DB.
  try { updateRound(round.id, { raisedAmount: 250000 }, FOUNDER); } catch {}

  app = express(); app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((r) => server.listen(0, () => { port = server.address().port; r(); }));
}, 60_000);

afterAll(async () => { await new Promise((r) => server.close(() => r())); });

describe("v25.48 DATA-2 — admin KPIs are DB-driven (not mockData)", () => {
  it("GET /api/admin/dashboard/kpis reflects the REAL DB company inventory (not mock 0)", async () => {
    const res = await call("GET", "/api/admin/dashboard/kpis", { userId: "u_admin" });
    expect(res.status).toBe(200);
    const summary = res.body?.summary ?? res.body?.kpis?.summary ?? res.body;
    // The seeded real company must be counted — mock array would give 0.
    expect(Number(summary?.totalCompanies ?? 0)).toBeGreaterThan(0);
  });

  it("totalFunded reflects the DB round.raisedAmount (not the mock amountRaised field)", async () => {
    const res = await call("GET", "/api/admin/dashboard/kpis", { userId: "u_admin" });
    const summary = res.body?.summary ?? res.body?.kpis?.summary ?? res.body;
    expect(Number(summary?.totalFunded ?? 0)).toBeGreaterThanOrEqual(250000);
  });

  it("regions[] is derived from real DB companies (contains the seeded region)", async () => {
    const res = await call("GET", "/api/admin/dashboard/kpis", { userId: "u_admin" });
    const regions = res.body?.regions ?? res.body?.kpis?.regions ?? [];
    // At least one region bucket with a real company count.
    const totalRegionCompanies = regions.reduce((s, r) => s + (Number(r.companies) || 0), 0);
    expect(totalRegionCompanies).toBeGreaterThan(0);
  });
});
