/**
 * v24.2 Bug 6 — Company profile + default-currency persistence.
 *
 * Root cause (V24_2_ROOTCAUSE.md §Bug 6):
 *   1. `multiCompanyStore.updateCompanyDetails` mirrored `defaultCurrency` into
 *      the in-memory USER_COMPANIES cache but OMITTED it from the DB
 *      write-through (`updates` object) AND `dbRowToMembership` never
 *      re-hydrated it — so a page reload (process restart) reverted the
 *      founder's saved currency.
 *   2. PATCH `/api/companies/:id/profile` (the rich profileStore CompanyProfile)
 *      only wrote into the in-memory `companyProfiles` Map — never durably —
 *      so sector/contact/legal edits vanished on restart.
 *   3. DB write failures were swallowed (logged "non-fatal") and the cache was
 *      updated anyway, so the client believed a save succeeded that never
 *      persisted.
 *
 * The v24.2 fix:
 *   - `defaultCurrency` is persisted to a dedicated `company_default_currency`
 *     side table (the sacred `companies` table is NOT altered) and re-hydrated
 *     in `dbRowToMembership`.
 *   - PATCH `/api/companies/:id/profile` writes DB-FIRST to
 *     `profilestore_company_profile`; on failure it 500s and leaves the cache
 *     untouched; reads re-hydrate from the durable store on a cold cache.
 *   - `updateCompanyDetails` re-throws on DB failure so the route returns 500
 *     and does NOT update the cache.
 *
 * These tests exercise the REAL restart path (hydrateMultiCompanyStore rebuilds
 * the caches from the DB; the profile cache is evicted then re-read) rather than
 * merely hitting the API — a save that only touched memory would FAIL here.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import crypto from "node:crypto";

import { getDb, rawDb } from "../db/connection";
import { registerRoutes } from "../routes";
import {
  addCompanyForFounder,
  getCompaniesForFounder,
  hydrateMultiCompanyStore,
  readDefaultCurrency,
  type FounderCompanyMembership,
} from "../multiCompanyStore";
import { registerProfileRoutes, _testAccess } from "../profileStore";
import { registerFounderUser } from "../lib/userContext";
import { companies as companiesTable, tenants as tenantsTable } from "../../shared/schema";
import installV14TestIdentity from "./_v14TestIdentity";

function mkMembership(companyId: string, name: string): FounderCompanyMembership {
  return {
    companyId,
    companyName: name,
    legalName: `${name}, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "Fintech",
    stage: "Seed",
    hq: "Toronto, ON",
  };
}

/* ───────────────────────── Bug 6.1 — default currency ──────────────────── */

describe("v24.2 Bug 6 — defaultCurrency survives a restart", () => {
  let app: Express;
  let server: http.Server;
  let port: number;

  let FOUNDER = "";
  const COMPANY = `co_b6cur_${Date.now()}`;
  // u_aisha_patel is a seeded, AUTHED investor persona that does NOT own this
  // company — the correct probe for a cross-tenant 403 (an unauthenticated id
  // would 401 instead and not prove tenant isolation).
  const OTHER_FOUNDER = "u_aisha_patel";

  beforeAll(async () => {
    getDb();
    // Register an AUTHED founder persona (so requireAuth passes for x-user-id)
    // and a real DB-persisted company + membership (tenants/companies/
    // company_members rows) so hydrateMultiCompanyStore can rebuild it after a
    // simulated restart.
    const reg = registerFounderUser({ email: `b6cur_${Date.now()}@test.example`, name: "Bug6 Founder", password: "pw-not-used-here" });
    FOUNDER = reg.userId;
    addCompanyForFounder(FOUNDER, mkMembership(COMPANY, "Bug6 Currency Co"));

    app = express();
    app.use(express.json());
    server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise<void>((resolve) => server.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); }));
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function call(method: string, path: string, body: unknown, userId: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const data = body !== undefined ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {};
      if (data) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(data)); }
      headers["x-user-id"] = userId;
      const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
        let raw = ""; res.on("data", (c) => (raw += c));
        res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} }); } catch { resolve({ status: res.statusCode ?? 0, body: raw }); } });
      });
      r.on("error", reject); if (data) r.write(data); r.end();
    });
  }

  it("PATCH /api/companies/:id with defaultCurrency persists to the durable side table", async () => {
    const r = await call("PATCH", `/api/companies/${COMPANY}`, { defaultCurrency: "EUR" }, FOUNDER);
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.company?.defaultCurrency).toBe("EUR");

    // Durable proof: the value is in the DB side table (the bug was it never
    // reached the DB at all — only the in-memory cache).
    expect(readDefaultCurrency(COMPANY)).toBe("EUR");
  });

  it("survives a restart — hydrateMultiCompanyStore re-reads the currency from the DB", async () => {
    // Simulate a process restart: clear + rebuild every in-memory cache from
    // the DB. If the currency only lived in memory it would now be gone.
    await hydrateMultiCompanyStore();
    const fromStore = getCompaniesForFounder(FOUNDER).find((c) => c.companyId === COMPANY);
    expect(fromStore).toBeTruthy();
    expect(fromStore?.defaultCurrency).toBe("EUR");
  });

  it("cross-tenant founder cannot PATCH another founder's company (403)", async () => {
    const r = await call("PATCH", `/api/companies/${COMPANY}`, { defaultCurrency: "GBP" }, OTHER_FOUNDER);
    expect(r.status).toBe(403);
    // The durable currency is unchanged by the rejected write.
    expect(readDefaultCurrency(COMPANY)).toBe("EUR");
  });
});

/* ─────────────────── Bug 6.2/6.3 — profile persistence + 500 ───────────── */

describe("v24.2 Bug 6 — company profile survives a restart; DB failure → 500", () => {
  let app: Express;
  const CO_ID = `co_b6prof_${Date.now()}`;
  const TENANT_ID = `tenant_co_${CO_ID}`;

  beforeAll(() => {
    const db = getDb();
    // A company row with NO profileStore entry so the profile starts empty.
    try {
      db.insert(tenantsTable).values({
        id: TENANT_ID, name: "Bug6 Profile Co", kind: "company", status: "active",
        isDemo: 0, billingEmail: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null,
      }).onConflictDoNothing({ target: tenantsTable.id }).run();
    } catch { /* tolerated */ }
    db.insert(companiesTable).values({
      id: CO_ID, tenantId: TENANT_ID, name: "Bug6 Profile Co", legalName: "Bug6 Profile Co, Inc.",
      sector: null, stage: null, hq: null, websiteUrl: null, description: null, logoUrl: null,
      founded: null, employees: null, isDemo: 0, deletedAt: null,
    }).onConflictDoNothing({ target: companiesTable.id }).run();

    app = express();
    app.use(express.json());
    // x-company-id makes installV14TestIdentity put this company in
    // userContext.founder.companies so the PATCH ownership check passes.
    installV14TestIdentity(app);
    registerProfileRoutes(app);
  });

  const HEADLINE = `Bug6 persisted headliner ${Date.now()}`;

  it("PATCH /api/companies/:id/profile then restart (evict cache) → edit still present", async () => {
    // First GET synthesises + caches an empty profile for the existing company.
    const seed = await request(app).get(`/api/companies/${CO_ID}/profile`).set("x-company-id", CO_ID);
    expect(seed.status).toBe(200);

    const patch = await request(app)
      .patch(`/api/companies/${CO_ID}/profile`)
      .set("x-company-id", CO_ID)
      .send({ contact: { oneSentenceHeadliner: HEADLINE } });
    expect(patch.status).toBe(200);
    expect(patch.body?.contact?.oneSentenceHeadliner).toBe(HEADLINE);

    // Simulate a process restart: evict the in-memory profile entry. A read
    // must now re-hydrate from the durable `profilestore_company_profile` row.
    expect(_testAccess.companyProfiles.delete(CO_ID)).toBe(true);
    expect(_testAccess.companyProfiles.has(CO_ID)).toBe(false);

    const after = await request(app).get(`/api/companies/${CO_ID}/profile`).set("x-company-id", CO_ID);
    expect(after.status).toBe(200);
    expect(after.body?.contact?.oneSentenceHeadliner).toBe(HEADLINE);
  });

  it("DB write failure → 500 and the in-memory cache is NOT updated", async () => {
    // Establish a known-good baseline profile and let it cache.
    await request(app)
      .patch(`/api/companies/${CO_ID}/profile`)
      .set("x-company-id", CO_ID)
      .send({ contact: { oneSentenceHeadliner: "Baseline headliner" } });
    const before = _testAccess.companyProfiles.get(CO_ID) as any;
    expect(before?.contact?.oneSentenceHeadliner).toBe("Baseline headliner");
    const beforeSnapshot = JSON.stringify(before);

    // Force the durable write to fail. rawDb().prepare(...).run() throws.
    const conn = await import("../db/connection");
    const spy = vi.spyOn(conn, "rawDb").mockImplementation(() => ({
      prepare: () => ({ run: () => { throw new Error("simulated db_write_failed"); }, get: () => undefined, all: () => [] }),
    }) as any);

    try {
      const fail = await request(app)
        .patch(`/api/companies/${CO_ID}/profile`)
        .set("x-company-id", CO_ID)
        .send({ contact: { oneSentenceHeadliner: "SHOULD NOT PERSIST" } });
      expect(fail.status).toBe(500);
      expect(fail.body?.error).toBe("PROFILE_PERSIST_FAILED");
    } finally {
      spy.mockRestore();
    }

    // CRITICAL: the cache must be byte-identical to before — the failed write
    // must NOT have updated it with "SHOULD NOT PERSIST".
    const afterFail = _testAccess.companyProfiles.get(CO_ID);
    expect(JSON.stringify(afterFail)).toBe(beforeSnapshot);
  });
});
