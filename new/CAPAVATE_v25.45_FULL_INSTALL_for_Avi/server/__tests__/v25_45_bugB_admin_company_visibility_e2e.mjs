/* v25.45 Bug B — Admin company visibility (founder-reported: "My BluePrint
 * Catalyst Limited data does not seem to be recorded in the Admin area").
 *
 * ROOT CAUSE (see build_spec/v25_45_bugB_rootcause.md):
 *   - The admin company list (adminCompaniesFullHandler in routes.ts) read the
 *     in-memory USER_COMPANIES Map via getAllCompanies().
 *   - That Map is rebuilt at boot by iterating `company_members`, so any
 *     company with a `companies` row but no membership row was dropped from the
 *     admin view after every restart.
 *   - addCompanyForFounder() swallowed DB-write failures yet still mirrored the
 *     company into the Map + returned 201, so a company could appear in admin
 *     for one process and then vanish on restart.
 *
 * FIX:
 *   - adminCompaniesFullHandler now reads getAllCompaniesFromDb() (DB-authoritative).
 *   - hydrateMultiCompanyStore() backfills member-less companies.
 *   - addCompanyForFounder() is now DB-authoritative (throws on persist failure).
 *
 * This suite drives the REAL HTTP path end-to-end and proves the data survives
 * a process restart (DB-only persistence) — no in-memory shortcuts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { reqFactory, recorder } from "./v25_42_helpers.mjs";
import { hydrateMultiCompanyStore } from "../multiCompanyStore.ts";

const STAMP = Date.now() + "_" + Math.floor(Math.random() * 1e6);
const FOUNDER = `u_bugB_founder_${STAMP}`;
const FOUNDER_EMAIL = `ozan_bugB_${STAMP}@v2545.test`;
const ADMIN = `u_bugB_admin_${STAMP}`;
const COMPANY_NAME = "BluePrint Catalyst Limited";

let server, port, req;
const { results, record } = recorder();
let createdCompanyId = null;

beforeAll(async () => {
  // Founder persona (the reporter) + a real admin persona.
  __setRuntimePersona({
    userId: FOUNDER, email: FOUNDER_EMAIL, name: "Ozan Isinak",
    isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false,
  });
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2545.test`, name: "Bug B Admin",
    isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  // Persist the founder's users row (signup-equivalent) so admin /users can see them.
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'founder', 0)`,
  ).run(FOUNDER, `tenant_user_${FOUNDER}`, FOUNDER_EMAIL, "Ozan Isinak");
  rawDb().prepare(
    `INSERT OR IGNORE INTO auth_users (id, email, password_hash, password_algo, role, status, created_at)
     VALUES (?, ?, 'x', 'scrypt', 'founder', 'active', ?)`,
  ).run(FOUNDER, FOUNDER_EMAIL, new Date().toISOString());

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  req = reqFactory(() => port, () => FOUNDER);
}, 60_000);

afterAll(async () => { await new Promise((resolve) => server.close(() => resolve())); });

describe("v25.45 Bug B — admin company visibility (DB-driven, restart-proof) — E2E", () => {
  it("1. founder creates BluePrint Catalyst Limited via POST /api/founder/companies/new", async () => {
    const r = await req("POST", "/api/founder/companies/new", {
      userId: FOUNDER,
      body: { name: COMPANY_NAME, legalName: COMPANY_NAME, sector: "fintech", stage: "Seed", hq: "London" },
    });
    createdCompanyId = r.body?.companyId;
    const ok = r.status === 201 && r.body?.ok === true && typeof createdCompanyId === "string";
    record("create company returns 201 + companyId", ok, `status ${r.status} id ${createdCompanyId}`);
    expect(ok).toBe(true);
  });

  it("2. `companies` table row exists with correct tenant_id, name, sector, and is non-deleted", () => {
    const row = rawDb().prepare(
      `SELECT id, tenant_id, name, sector, deleted_at FROM companies WHERE id = ?`,
    ).get(createdCompanyId);
    const ok = !!row
      && row.name === COMPANY_NAME
      && row.sector === "fintech"
      && row.tenant_id === `tenant_co_${createdCompanyId}`
      && row.deleted_at == null;
    record("companies row persisted with correct tenant/name/sector", ok, JSON.stringify(row));
    expect(ok).toBe(true);
  });

  it("3. founder→company linkage row exists in company_members (founder user_id, founder role)", () => {
    const row = rawDb().prepare(
      `SELECT id, company_id, user_id, role, tenant_id FROM company_members WHERE company_id = ? AND user_id = ?`,
    ).get(createdCompanyId, FOUNDER);
    const ok = !!row && row.user_id === FOUNDER && row.role === "founder" && row.tenant_id === `tenant_co_${createdCompanyId}`;
    record("company_members linkage row exists", ok, JSON.stringify(row));
    expect(ok).toBe(true);
  });

  it("4. GET /api/admin/companies (as admin) returns the new company", async () => {
    const r = await req("GET", "/api/admin/companies", { userId: ADMIN });
    const found = (r.body?.rows ?? []).find((c) => c.id === createdCompanyId);
    const ok = r.status === 200 && !!found && found.name === COMPANY_NAME && found.sector === "fintech";
    record("admin company list includes the new company", ok, `status ${r.status} found ${JSON.stringify(found?.name)}`);
    expect(ok).toBe(true);
  });

  it("5. GET /api/admin/users (as admin) returns the founder", async () => {
    const r = await req("GET", "/api/admin/users", { userId: ADMIN });
    const found = (r.body?.users ?? []).find((u) => u.id === FOUNDER || u.email === FOUNDER_EMAIL);
    const ok = r.status === 200 && !!found;
    record("admin user list includes the founder", ok, `status ${r.status} found ${JSON.stringify(found?.email)}`);
    expect(ok).toBe(true);
  });

  it("6. data survives a process restart — admin still sees the company after re-hydration (DB-only proof)", async () => {
    // Simulate a fresh boot: hydrateMultiCompanyStore() clears + rebuilds the
    // in-memory Map purely from the DB. If the company only lived in memory it
    // would now disappear; with the fix it is reloaded from the `companies`
    // table even though the admin reader queries the DB directly.
    await hydrateMultiCompanyStore();
    const r = await req("GET", "/api/admin/companies", { userId: ADMIN });
    const found = (r.body?.rows ?? []).find((c) => c.id === createdCompanyId);
    const ok = r.status === 200 && !!found && found.name === COMPANY_NAME;
    record("company survives restart (DB-only persistence)", ok, `status ${r.status} found ${JSON.stringify(found?.name)}`);
    expect(ok).toBe(true);
  });

  it("7. company also persists when its company_members link is missing (orphan-backfill regression)", async () => {
    // Hard-prove the root-cause class: a company row with NO membership link
    // must still be visible to admin after restart. Insert a member-less company
    // directly, re-hydrate, and assert the admin list shows it.
    const orphanId = `co_bugB_orphan_${STAMP}`;
    rawDb().prepare(
      `INSERT OR IGNORE INTO companies (id, tenant_id, name, legal_name, sector, stage, hq, is_demo)
       VALUES (?, ?, ?, ?, 'biotech', 'Series A', 'Boston', 0)`,
    ).run(orphanId, `tenant_co_${orphanId}`, "Orphan Labs Inc", "Orphan Labs Inc");
    await hydrateMultiCompanyStore();
    const r = await req("GET", "/api/admin/companies", { userId: ADMIN });
    const found = (r.body?.rows ?? []).find((c) => c.id === orphanId);
    const ok = r.status === 200 && !!found && found.name === "Orphan Labs Inc";
    record("member-less company is visible to admin after restart", ok, `status ${r.status} found ${JSON.stringify(found?.name)}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 Bug B Admin Company Visibility E2E: ${passed}/${results.length} passed`);
    for (const r of results) if (!r.pass) console.log(`    FAIL: ${r.name}`);
    expect(passed).toBe(results.length);
  });
});
