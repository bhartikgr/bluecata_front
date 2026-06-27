/* v25.45 Bug B ROUND-2 (GPT-5.5 blocker 2) — POST /api/founder/companies is
 * fail-closed on durable-persist failure.
 *
 * GPT-5.5 found that POST /api/founder/companies (SEPARATE from
 * /api/founder/companies/new) caught an addCompanyForFounder() failure as
 * "Non-fatal" and STILL created/returned the subscription with HTTP 201 —
 * recreating the original Bug B class (API success with no durable company /
 * member record).
 *
 * This suite injects a REAL DB write failure by renaming the `company_members`
 * table away for the duration of the request (so addCompanyForFounder's
 * transaction throws), then asserts:
 *   - the route returns HTTP 500 with error "COMPANY_PERSIST_FAILED",
 *   - the response carries a client-safe message (no stack trace),
 *   - NO subscription was created for the company,
 *   - NO durable companies row was committed (transaction rolled back).
 *
 * The table is always restored in a finally block (single-fork serial run).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { reqFactory, recorder } from "./v25_42_helpers.mjs";

const STAMP = Date.now() + "_" + Math.floor(Math.random() * 1e6);
const FOUNDER = `u_bugBr2c_founder_${STAMP}`;
const FOUNDER_EMAIL = `bugBr2c_${STAMP}@v2545.test`;
const COMPANY_ID = `co_bugBr2c_${STAMP}`;
const COMPANY_NAME = "Persist Fail Co " + STAMP;

let server, port, req;
const { results, record } = recorder();
let response = null;

beforeAll(async () => {
  __setRuntimePersona({
    userId: FOUNDER, email: FOUNDER_EMAIL, name: "BugB R2c Founder",
    isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false,
  });
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'founder', 0)`,
  ).run(FOUNDER, `tenant_user_${FOUNDER}`, FOUNDER_EMAIL, "BugB R2c Founder");

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  req = reqFactory(() => port, () => FOUNDER);
}, 60_000);

afterAll(async () => { await new Promise((resolve) => server.close(() => resolve())); });

describe("v25.45 Bug B R2 — POST /api/founder/companies fail-closed on persist failure — E2E", () => {
  it("1. with company_members renamed away, the route returns 500 COMPANY_PERSIST_FAILED", async () => {
    const db = rawDb();
    // Inject a durable-write failure: addCompanyForFounder() inserts into
    // company_members inside its transaction; renaming the table makes the
    // INSERT throw "no such table", which now propagates (fail-closed).
    db.exec(`ALTER TABLE company_members RENAME TO company_members__bugBr2c_bak`);
    try {
      response = await req("POST", "/api/founder/companies", {
        userId: FOUNDER,
        body: { companyId: COMPANY_ID, companyName: COMPANY_NAME, plan: "Founder Free", legalName: COMPANY_NAME },
      });
    } finally {
      db.exec(`ALTER TABLE company_members__bugBr2c_bak RENAME TO company_members`);
    }
    const ok = response.status === 500 && response.body?.error === "COMPANY_PERSIST_FAILED";
    record("route returns 500 COMPANY_PERSIST_FAILED", ok, `status ${response.status} error ${response.body?.error}`);
    expect(ok).toBe(true);
  });

  it("2. the error message is client-safe (no stack trace / internal driver text)", () => {
    const msg = String(response?.body?.message ?? "");
    const leaks = /no such table|sqlite|stack|at Object|node_modules|\.ts:|\.js:/i.test(msg);
    const ok = msg.length > 0 && !leaks;
    record("error message is safe to expose", ok, `message="${msg}"`);
    expect(ok).toBe(true);
  });

  it("3. NO subscription was created (response carries no subscription)", () => {
    const ok = response?.body?.subscription == null && response?.body?.subscriptionCreated == null;
    record("no subscription returned", ok, JSON.stringify(response?.body));
    expect(ok).toBe(true);
  });

  it("4. NO durable companies row exists for the failed create (transaction rolled back)", () => {
    const row = rawDb().prepare(`SELECT id FROM companies WHERE id = ?`).get(COMPANY_ID);
    const ok = !row;
    record("no companies row persisted", ok, `row ${JSON.stringify(row)}`);
    expect(ok).toBe(true);
  });

  it("5. NO subscription row exists in capavate_subscriptions for the failed company", () => {
    let row = null;
    try {
      row = rawDb().prepare(`SELECT * FROM capavate_subscriptions WHERE company_id = ?`).get(COMPANY_ID);
    } catch {
      // table may not exist in this test DB — that still proves no subscription persisted.
      row = null;
    }
    const ok = !row;
    record("no subscription row persisted", ok, `row ${JSON.stringify(row)}`);
    expect(ok).toBe(true);
  });

  it("6. control: with the table restored, a normal create succeeds (happy-path preserved)", async () => {
    const okId = `co_bugBr2c_ok_${STAMP}`;
    const r = await req("POST", "/api/founder/companies", {
      userId: FOUNDER,
      body: { companyId: okId, companyName: "OK Co " + STAMP, plan: "Founder Free", legalName: "OK Co " + STAMP },
    });
    const row = rawDb().prepare(`SELECT id FROM companies WHERE id = ?`).get(okId);
    const ok = r.status === 201 && r.body?.ok === true && !!row;
    record("happy-path create still returns 201 + persists", ok, `status ${r.status} row ${!!row}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 Bug B R2 companies-route persist-failure E2E: ${passed}/${results.length} passed`);
    for (const r of results) if (!r.pass) console.log(`    FAIL: ${r.name}`);
    expect(passed).toBe(results.length);
  });
});
