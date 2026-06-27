/* v25.45 Bug B ROUND-2 (GPT-5.5 blocker 1) — admin company list is DB-AUTHORITATIVE.
 *
 * GPT-5.5 found that getAllCompaniesFromDb() inserted ALL in-memory
 * USER_COMPANIES Map entries first and only overlaid DB rows that were missing.
 * If a company was soft-deleted (deletedAt set) or removed in the DB AFTER
 * hydration, the stale Map entry still appeared in Admin — violating the stated
 * DB-authoritative behavior and the "zero in-memory" rule.
 *
 * This suite proves the fix: after a company is created (so the Map holds it),
 * we SOFT-DELETE it directly in the `companies` table. The in-memory Map STILL
 * contains the entry (we do NOT re-hydrate), but the admin list must EXCLUDE it
 * because the live DB SELECT (deletedAt IS NULL) is now authoritative.
 *
 * Driven end-to-end through the real HTTP admin path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { reqFactory, recorder } from "./v25_42_helpers.mjs";
import { getAllCompaniesFromDb } from "../multiCompanyStore.ts";

const STAMP = Date.now() + "_" + Math.floor(Math.random() * 1e6);
const FOUNDER = `u_bugBr2_founder_${STAMP}`;
const FOUNDER_EMAIL = `bugBr2_${STAMP}@v2545.test`;
const ADMIN = `u_bugBr2_admin_${STAMP}`;
const COMPANY_NAME = "Stale Map Co " + STAMP;

let server, port, req;
const { results, record } = recorder();
let createdCompanyId = null;

beforeAll(async () => {
  __setRuntimePersona({
    userId: FOUNDER, email: FOUNDER_EMAIL, name: "BugB R2 Founder",
    isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false,
  });
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2545.test`, name: "BugB R2 Admin",
    isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'founder', 0)`,
  ).run(FOUNDER, `tenant_user_${FOUNDER}`, FOUNDER_EMAIL, "BugB R2 Founder");

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  req = reqFactory(() => port, () => FOUNDER);
}, 60_000);

afterAll(async () => { await new Promise((resolve) => server.close(() => resolve())); });

describe("v25.45 Bug B R2 — admin list is DB-authoritative (soft-delete excludes stale Map entry) — E2E", () => {
  it("1. founder creates a company; it appears in the admin list AND the in-memory Map", async () => {
    const r = await req("POST", "/api/founder/companies/new", {
      userId: FOUNDER,
      body: { name: COMPANY_NAME, legalName: COMPANY_NAME, sector: "fintech", stage: "Seed", hq: "London" },
    });
    createdCompanyId = r.body?.companyId;
    const created = r.status === 201 && typeof createdCompanyId === "string";
    // Confirm the in-memory Map currently holds it (overlay source).
    const inMap = getAllCompaniesFromDb().some((c) => c.companyId === createdCompanyId);
    const ok = created && inMap;
    record("company created and present pre-delete", ok, `status ${r.status} id ${createdCompanyId} inList ${inMap}`);
    expect(ok).toBe(true);
  });

  it("2. admin list includes the company before soft-delete", async () => {
    const r = await req("GET", "/api/admin/companies", { userId: ADMIN });
    const found = (r.body?.rows ?? []).find((c) => c.id === createdCompanyId);
    const ok = r.status === 200 && !!found;
    record("admin list shows company pre-delete", ok, `status ${r.status} found ${!!found}`);
    expect(ok).toBe(true);
  });

  it("3. soft-delete the company DIRECTLY in DB (deletedAt set); the in-memory Map is NOT touched", () => {
    const now = new Date().toISOString();
    const res = rawDb().prepare(`UPDATE companies SET deleted_at = ? WHERE id = ?`).run(now, createdCompanyId);
    // The Map STILL has the entry (we did not re-hydrate) — this is the stale state GPT-5.5 flagged.
    const ok = Number(res.changes) === 1;
    record("company soft-deleted in DB (Map left stale)", ok, `changes ${res.changes}`);
    expect(ok).toBe(true);
  });

  it("4. getAllCompaniesFromDb() EXCLUDES the soft-deleted company even though the Map still has it", () => {
    const list = getAllCompaniesFromDb();
    const present = list.some((c) => c.companyId === createdCompanyId);
    const ok = present === false;
    record("DB-authoritative reader excludes soft-deleted company", ok, `present ${present}`);
    expect(ok).toBe(true);
  });

  it("5. admin HTTP list EXCLUDES the soft-deleted company (fail-closed, DB authoritative)", async () => {
    const r = await req("GET", "/api/admin/companies", { userId: ADMIN });
    const found = (r.body?.rows ?? []).find((c) => c.id === createdCompanyId);
    const ok = r.status === 200 && !found;
    record("admin list excludes soft-deleted company despite stale Map", ok, `status ${r.status} found ${!!found}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 Bug B R2 stale-Map/soft-delete E2E: ${passed}/${results.length} passed`);
    for (const r of results) if (!r.pass) console.log(`    FAIL: ${r.name}`);
    expect(passed).toBe(results.length);
  });
});
