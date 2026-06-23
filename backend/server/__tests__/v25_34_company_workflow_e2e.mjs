/* v25.34 Phase 4 — E2E: Company workflow across migrated Collective stores.
 *
 * Follows a portfolio company through the founder/company surface that the
 * Collective exposes, asserting DB state at every step against the migrated
 * stores: reportsStore (investor reports — fail-closed UPSERT persist),
 * screeningEventsStore (the company's screening), and a cross-store read so we
 * prove the reports/screening_events tables — not in-memory Maps — are the
 * source of truth.
 *
 * Coverage:
 *   1. Create an investor report for the company → row in `reports` (DB), correct kind/title.
 *   2. GET reports2 lists it DB-first (readReportsForCompany).
 *   3. GET reports2/:id reads the single report DB-first.
 *   4. Schedule a screening for the SAME company → row in screening_events scoped to company.
 *   5. Cross-store: the company appears in BOTH reports and screening_events tables (DB join-by-company).
 *   6. Fail-closed sanity: a report create persists before cache (row present immediately after 200).
 *
 * COLLECTIVE_ENABLED=1; admin persona bypasses founder-ownership + chapter gates.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";

let app, server, port;
const ADMIN = `u_v2534_co_admin_${Date.now()}`;
const COMPANY = `co_v2534_wf_${Date.now()}`;
const CHAPTER = "chap_demo";
const results = [];

function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`);
}

function req(method, path, { body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": ADMIN };
    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function one(sql, ...p) { try { return rawDb().prepare(sql).get(...p); } catch { return null; } }

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2534.test`, name: "v25.34 Company Workflow Admin",
    isFounder: true, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.34 Company workflow (migrated Collective stores) — E2E", () => {
  let reportId, eventId;

  it("1. create investor report → row in reports table (fail-closed persist)", async () => {
    const res = await req("POST", "/api/founder/reports2", {
      body: { companyId: COMPANY, template: "investor_update", title: "NovaPay — H1 2026 Investor Update", period: "2026-H1" },
    });
    record("POST reports2 200 + report id", res.status === 200 && !!res.body?.id, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,80)}`);
    expect(res.status).toBe(200);
    reportId = res.body.id;

    // Fail-closed contract: persist happens BEFORE cache.push, so the row must
    // exist in the DB the instant the 200 returns.
    const row = one(`SELECT id, company_id, title, status FROM reports WHERE id = ?`, reportId);
    const ok = row && row.company_id === COMPANY && row.title === "NovaPay — H1 2026 Investor Update";
    record("report row persisted in `reports` table immediately (fail-closed)", !!ok, JSON.stringify(row));
    expect(!!ok).toBe(true);
  });

  it("2. GET reports2 lists it DB-first (readReportsForCompany)", async () => {
    const res = await req("GET", `/api/founder/reports2?companyId=${COMPANY}`);
    const arr = Array.isArray(res.body) ? res.body : (res.body?.reports ?? res.body?.items ?? []);
    const seen = arr.some((r) => r.id === reportId);
    record("reports list (DB-first) includes the new report", res.status === 200 && seen, `status ${res.status}, count ${arr.length}`);
    expect(seen).toBe(true);
  });

  it("3. GET reports2/:id reads single report DB-first", async () => {
    const res = await req("GET", `/api/founder/reports2/${reportId}?companyId=${COMPANY}`);
    const r = res.body?.report ?? res.body;
    const ok = res.status === 200 && (r?.id === reportId || res.body?.id === reportId);
    record("single report read DB-first", ok, `status ${res.status}`);
    expect(res.status).toBe(200);
  });

  it("4. schedule a screening for the same company → row in screening_events", async () => {
    const future = Math.floor(Date.now() / 1000) + 10 * 24 * 3600;
    const res = await req("POST", "/api/collective/screening-events", {
      body: {
        title: "Diligence Screening — NovaPay", scheduled_for: future, duration_minutes: 60,
        event_type: "screening", company_id: COMPANY, chapter_id: CHAPTER, attendee_user_ids: [],
      },
    });
    record("POST screening-event for company 200/201", res.status === 200 || res.status === 201, `status ${res.status}`);
    expect(res.status === 200 || res.status === 201).toBe(true);
    eventId = res.body?.event?.id ?? res.body?.id;
    const row = one(`SELECT id, company_id FROM screening_events WHERE id = ?`, eventId);
    record("screening row scoped to company in DB", !!row && row.company_id === COMPANY, JSON.stringify(row));
    expect(row?.company_id).toBe(COMPANY);
  });

  it("5. cross-store: company present in BOTH reports and screening_events tables", () => {
    const rep = one(`SELECT COUNT(*) AS n FROM reports WHERE company_id = ?`, COMPANY);
    const scr = one(`SELECT COUNT(*) AS n FROM screening_events WHERE company_id = ?`, COMPANY);
    const ok = (rep?.n ?? 0) >= 1 && (scr?.n ?? 0) >= 1;
    record("company joins across reports + screening_events (DB source of truth)", ok, `reports=${rep?.n}, screenings=${scr?.n}`);
    expect(ok).toBe(true);
  });

  it("6. fail-closed sanity: a second report also persists before responding", async () => {
    const res = await req("POST", "/api/founder/reports2", {
      body: { companyId: COMPANY, template: "kpi_snapshot", title: "NovaPay — June KPI Snapshot" },
    });
    const row = res.body?.id ? one(`SELECT id FROM reports WHERE id = ?`, res.body.id) : null;
    record("2nd report row exists at 200 (no cache-before-DB window)", res.status === 200 && !!row, `status ${res.status}`);
    expect(!!row).toBe(true);
  });

  it("E2E SUMMARY", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n=== v25_34_company_workflow_e2e: ${passed}/${results.length} assertions PASSED ===\n`);
    expect(passed).toBe(results.length);
  });
});
