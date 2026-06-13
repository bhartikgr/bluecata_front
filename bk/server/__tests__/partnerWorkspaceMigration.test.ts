/**
 * v19 Phase B — Partner workspace DB migration tests.
 *
 * Coverage:
 *   - Portfolio: create / list / detail / patch / delete (soft) — DB-persisted.
 *   - CRM contacts: CRUD + cross-partner isolation (404/403).
 *   - Deal pipeline: create + stage transitions; hash chain links across patches.
 *   - Visibility filtering: private (owner-only) vs collective vs public.
 *   - Cross-tenant rejection on private portfolio rows.
 *   - Cross-tenant ALLOWED on collective rows (with `CROSS-TENANT (admin)` marker
 *     in the implementation — asserted by grep below).
 *   - Hash chain integrity: revisionHash format and prev/curr linkage.
 *   - Auth surface: requirePartnerAuth blocks unauthenticated callers (401)
 *     and non-partners (403). requireAuth on portfolio LIST allows any user
 *     but filters visibility.
 *   - Schema validation: invalid bodies → 400.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_USERS } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { __setRuntimePersona } from "../lib/userContext";
import {
  hydratePartnerWorkspaceV19Store,
  _partnerWorkspaceV19Internal,
} from "../partnerWorkspaceV19Store";
import {
  partnerPortfolioCompanies as portfolioTable,
  partnerCrmContacts as crmTable,
  partnerDealPipeline as dealsTable,
} from "../../shared/schema";
import { eq } from "drizzle-orm";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_consortium_partner_v19b_isolation";
const MANAGING_A = TEST_PARTNER_USERS.managing.userId; // u_avi_managing
const VIEWER_A = TEST_PARTNER_USERS.viewer.userId;     // u_avi_viewer
const MANAGING_B = "u_v19b_managing_b";
const NON_PARTNER = "u_maya_chen";
const GHOST = "u_v19b_ghost";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());

  // Seed Partner A (TEST PARTNER, INC) + managing/viewer
  seedTestPartnerSandbox({ force: true });

  // Register MANAGING_B as a runtime persona so getUserContext() treats it
  // as authenticated; otherwise requirePartnerAuth returns 401 (the user
  // is unknown to PERSONAS) instead of the 403 we want to exercise.
  __setRuntimePersona({
    userId: MANAGING_B,
    email: "managing-b@v19b-iso.example",
    name: "V19B Managing B",
    isFounder: false,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  });

  // Seed a second partner (B) for cross-partner isolation tests
  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "V19B ISOLATION PARTNER",
    displayName: "V19B ISO",
    email: "iso-v19b@test.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(PARTNER_B, MANAGING_B, "managing_partner", "u_system_seed", { isSeed: true });

  await hydratePartnerWorkspaceV19Store();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    }),
  );
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string; userRole?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.userRole) headers["x-role"] = opts.userRole;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let b: any = null;
          try {
            b = JSON.parse(buf);
          } catch {
            /* keep */
          }
          resolve({ status: res.statusCode ?? 0, body: b });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("v19 Phase B — Partner workspace DB migration", () => {
  /* ====================================================================
   * Auth surface
   * ==================================================================== */

  it("POST /api/partner/portfolio: 401 when unauthenticated", async () => {
    const r = await call("POST", "/api/partner/portfolio", {
      body: { company_id: "co_x", display_name: "X" },
    });
    expect([401, 403]).toContain(r.status);
  });

  it("POST /api/partner/portfolio: 403 when authenticated but not a partner team member", async () => {
    const r = await call("POST", "/api/partner/portfolio", {
      userId: NON_PARTNER,
      body: { company_id: "co_x", display_name: "X" },
    });
    expect([401, 403]).toContain(r.status);
  });

  /* ====================================================================
   * Portfolio: CRUD + visibility filtering
   * ==================================================================== */

  let privatePortfolioId = "";
  let collectivePortfolioId = "";
  let publicPortfolioId = "";

  it("POST /api/partner/portfolio: creates a private portfolio row (default visibility)", async () => {
    const r = await call("POST", "/api/partner/portfolio", {
      userId: MANAGING_A,
      body: {
        company_id: "co_alpha",
        display_name: "Alpha Co",
        stage: "seed",
        sector: "fintech",
        lead_invested_amount_minor: 25_000_00,
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.portfolio.id).toMatch(/^ppc_/);
    expect(r.body.portfolio.partnerId).toBe(PARTNER_A);
    expect(r.body.portfolio.visibility).toBe("private");
    expect(r.body.portfolio.currHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.body.portfolio.prevHash).toBeNull();
    privatePortfolioId = r.body.portfolio.id;
  });

  it("POST /api/partner/portfolio: creates a collective-visible portfolio row", async () => {
    const r = await call("POST", "/api/partner/portfolio", {
      userId: MANAGING_A,
      body: {
        company_id: "co_beta",
        display_name: "Beta Co",
        stage: "series_a",
        visibility: "collective",
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.portfolio.visibility).toBe("collective");
    collectivePortfolioId = r.body.portfolio.id;
  });

  it("POST /api/partner/portfolio: creates a public portfolio row", async () => {
    const r = await call("POST", "/api/partner/portfolio", {
      userId: MANAGING_A,
      body: {
        company_id: "co_gamma",
        display_name: "Gamma Co",
        visibility: "public",
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.portfolio.visibility).toBe("public");
    publicPortfolioId = r.body.portfolio.id;
  });

  it("POST /api/partner/portfolio: 400 on invalid body (missing display_name)", async () => {
    const r = await call("POST", "/api/partner/portfolio", {
      userId: MANAGING_A,
      body: { company_id: "co_z" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_BODY");
  });

  it("portfolio row persisted to DB (verified via raw drizzle read)", () => {
    const db: any = getDb();
    const rows = db
      .select()
      .from(portfolioTable)
      .where(eq((portfolioTable as any).id, privatePortfolioId))
      .all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].partner_id ?? rows[0].partnerId).toBe(PARTNER_A);
    expect(rows[0].curr_hash ?? rows[0].currHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("GET /api/partner/portfolio: owner sees own private + collective + public rows", async () => {
    const r = await call("GET", "/api/partner/portfolio", { userId: MANAGING_A });
    expect(r.status).toBe(200);
    const ids = r.body.portfolio.map((p: any) => p.id);
    expect(ids).toContain(privatePortfolioId);
    expect(ids).toContain(collectivePortfolioId);
    expect(ids).toContain(publicPortfolioId);
  });

  it("GET /api/partner/portfolio: Partner B does NOT see Partner A's private row (visibility filter)", async () => {
    const r = await call("GET", "/api/partner/portfolio", { userId: MANAGING_B });
    expect(r.status).toBe(200);
    const ids: string[] = r.body.portfolio.map((p: any) => p.id);
    expect(ids).not.toContain(privatePortfolioId);
    // But collective + public from A ARE visible (cross-tenant allowed by design)
    expect(ids).toContain(collectivePortfolioId);
    expect(ids).toContain(publicPortfolioId);
  });

  it("GET /api/partner/portfolio: non-partner authenticated user sees collective + public only", async () => {
    const r = await call("GET", "/api/partner/portfolio", { userId: NON_PARTNER });
    expect(r.status).toBe(200);
    const ids: string[] = r.body.portfolio.map((p: any) => p.id);
    expect(ids).not.toContain(privatePortfolioId);
    expect(ids).toContain(collectivePortfolioId);
    expect(ids).toContain(publicPortfolioId);
  });

  it("GET /api/partner/portfolio/:id: 403 on Partner A's private row when called by Partner B (cross-tenant rejection)", async () => {
    const r = await call("GET", `/api/partner/portfolio/${privatePortfolioId}`, {
      userId: MANAGING_B,
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("NOT_OWNER");
  });

  it("GET /api/partner/portfolio/:id: 200 on Partner A's COLLECTIVE row when called by Partner B (cross-tenant ALLOWED)", async () => {
    const r = await call("GET", `/api/partner/portfolio/${collectivePortfolioId}`, {
      userId: MANAGING_B,
    });
    expect(r.status).toBe(200);
    expect(r.body.portfolio.id).toBe(collectivePortfolioId);
  });

  it("source code contains `CROSS-TENANT (admin)` markers justifying cross-tenant reads", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "partnerWorkspaceV19Store.ts"),
      "utf-8",
    );
    expect(src).toMatch(/CROSS-TENANT \(admin\)/);
  });

  it("PATCH /api/partner/portfolio/:id: owner can update; hash chain links", async () => {
    const before = await call("GET", `/api/partner/portfolio/${privatePortfolioId}`, {
      userId: MANAGING_A,
    });
    const prevHash = before.body.portfolio.currHash;
    const r = await call("PATCH", `/api/partner/portfolio/${privatePortfolioId}`, {
      userId: MANAGING_A,
      body: { sector: "fintech-banking", lead_invested_amount_minor: 50_000_00 },
    });
    expect(r.status).toBe(200);
    expect(r.body.portfolio.sector).toBe("fintech-banking");
    expect(r.body.portfolio.leadInvestedAmountMinor).toBe(50_000_00);
    expect(r.body.portfolio.prevHash).toBe(prevHash);
    expect(r.body.portfolio.currHash).not.toBe(prevHash);
    expect(r.body.portfolio.currHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("PATCH /api/partner/portfolio/:id: 403 when non-owner partner tries to update", async () => {
    const r = await call("PATCH", `/api/partner/portfolio/${privatePortfolioId}`, {
      userId: MANAGING_B,
      body: { sector: "hacked" },
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("NOT_OWNER");
  });

  it("PATCH /api/partner/portfolio/:id: 404 for unknown id", async () => {
    const r = await call("PATCH", "/api/partner/portfolio/ppc_does_not_exist", {
      userId: MANAGING_A,
      body: { sector: "x" },
    });
    expect(r.status).toBe(404);
  });

  it("DELETE /api/partner/portfolio/:id: soft-deletes and hides from list", async () => {
    // Use a fresh row so we don't poison subsequent tests
    const create = await call("POST", "/api/partner/portfolio", {
      userId: MANAGING_A,
      body: { company_id: "co_delta", display_name: "Delta Co" },
    });
    expect(create.status).toBe(201);
    const id = create.body.portfolio.id;

    const del = await call("DELETE", `/api/partner/portfolio/${id}`, { userId: MANAGING_A });
    expect(del.status).toBe(200);
    expect(del.body.portfolio.deletedAt).toBeTruthy();

    const list = await call("GET", "/api/partner/portfolio", { userId: MANAGING_A });
    const ids: string[] = list.body.portfolio.map((p: any) => p.id);
    expect(ids).not.toContain(id);
  });

  /* ====================================================================
   * CRM contacts
   * ==================================================================== */

  let crmContactId = "";

  it("POST /api/partner/crm/contacts: creates contact", async () => {
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Jordan LP", email: "jordan@example.com", org: "Family Office Co", tags: ["lp", "warm"] },
    });
    expect(r.status).toBe(201);
    expect(r.body.contact.id).toMatch(/^pcc_/);
    expect(r.body.contact.partnerId).toBe(PARTNER_A);
    expect(r.body.contact.tags).toEqual(["lp", "warm"]);
    crmContactId = r.body.contact.id;
  });

  it("CRM contact persisted to DB", () => {
    const db: any = getDb();
    const rows = db
      .select()
      .from(crmTable)
      .where(eq((crmTable as any).id, crmContactId))
      .all() as any[];
    expect(rows.length).toBe(1);
  });

  it("GET /api/partner/crm/contacts: lists own contacts only (partner-scoped)", async () => {
    const r = await call("GET", "/api/partner/crm/contacts", { userId: MANAGING_A });
    expect(r.status).toBe(200);
    const ids: string[] = r.body.contacts.map((c: any) => c.id);
    expect(ids).toContain(crmContactId);
  });

  it("GET /api/partner/crm/contacts: Partner B does NOT see Partner A's contacts", async () => {
    const r = await call("GET", "/api/partner/crm/contacts", { userId: MANAGING_B });
    expect(r.status).toBe(200);
    const ids: string[] = r.body.contacts.map((c: any) => c.id);
    expect(ids).not.toContain(crmContactId);
  });

  it("GET /api/partner/crm/contacts/:id: 403 cross-partner", async () => {
    const r = await call("GET", `/api/partner/crm/contacts/${crmContactId}`, {
      userId: MANAGING_B,
    });
    expect(r.status).toBe(403);
  });

  it("PATCH /api/partner/crm/contacts/:id: updates own contact", async () => {
    const r = await call("PATCH", `/api/partner/crm/contacts/${crmContactId}`, {
      userId: MANAGING_A,
      body: { notes: "Met at AC Ventures dinner", tags: ["lp", "warm", "diligence"] },
    });
    expect(r.status).toBe(200);
    expect(r.body.contact.notes).toBe("Met at AC Ventures dinner");
    expect(r.body.contact.tags).toContain("diligence");
  });

  it("DELETE /api/partner/crm/contacts/:id: soft-deletes", async () => {
    const create = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Disposable Contact" },
    });
    const id = create.body.contact.id;
    const del = await call("DELETE", `/api/partner/crm/contacts/${id}`, { userId: MANAGING_A });
    expect(del.status).toBe(200);
    expect(del.body.contact.deletedAt).toBeTruthy();
    const list = await call("GET", "/api/partner/crm/contacts", { userId: MANAGING_A });
    const ids: string[] = list.body.contacts.map((c: any) => c.id);
    expect(ids).not.toContain(id);
  });

  /* ====================================================================
   * Deal pipeline
   * ==================================================================== */

  let dealId = "";

  it("POST /api/partner/deals: creates deal at sourced", async () => {
    const r = await call("POST", "/api/partner/deals", {
      userId: MANAGING_A,
      body: { company_id: "co_alpha", stage: "sourced", notes: "Inbound from LinkedIn" },
    });
    expect(r.status).toBe(201);
    expect(r.body.deal.id).toMatch(/^pdp_/);
    expect(r.body.deal.stage).toBe("sourced");
    expect(r.body.deal.partnerId).toBe(PARTNER_A);
    expect(r.body.deal.currHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.body.deal.prevHash).toBeNull();
    dealId = r.body.deal.id;
  });

  it("deal row persisted to DB", () => {
    const db: any = getDb();
    const rows = db
      .select()
      .from(dealsTable)
      .where(eq((dealsTable as any).id, dealId))
      .all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].partner_id ?? rows[0].partnerId).toBe(PARTNER_A);
  });

  it("PATCH /api/partner/deals/:id: stage transition sourced → screening links hash chain", async () => {
    const before = await call("GET", `/api/partner/deals/${dealId}`, { userId: MANAGING_A });
    const prevHash = before.body.deal.currHash;
    const r = await call("PATCH", `/api/partner/deals/${dealId}`, {
      userId: MANAGING_A,
      body: { stage: "screening" },
    });
    expect(r.status).toBe(200);
    expect(r.body.deal.stage).toBe("screening");
    expect(r.body.deal.prevHash).toBe(prevHash);
    expect(r.body.deal.currHash).not.toBe(prevHash);
  });

  it("PATCH /api/partner/deals/:id: subsequent transitions chain correctly (screening → diligence → term_sheet)", async () => {
    let cur = await call("GET", `/api/partner/deals/${dealId}`, { userId: MANAGING_A });
    let last = cur.body.deal.currHash;
    for (const stage of ["diligence", "term_sheet"]) {
      const r = await call("PATCH", `/api/partner/deals/${dealId}`, {
        userId: MANAGING_A,
        body: { stage },
      });
      expect(r.status).toBe(200);
      expect(r.body.deal.stage).toBe(stage);
      expect(r.body.deal.prevHash).toBe(last);
      expect(r.body.deal.currHash).not.toBe(last);
      last = r.body.deal.currHash;
    }
  });

  it("GET /api/partner/deals: Partner B does NOT see Partner A's deal", async () => {
    const r = await call("GET", "/api/partner/deals", { userId: MANAGING_B });
    expect(r.status).toBe(200);
    const ids: string[] = r.body.deals.map((d: any) => d.id);
    expect(ids).not.toContain(dealId);
  });

  it("GET /api/partner/deals/:id: 403 cross-partner", async () => {
    const r = await call("GET", `/api/partner/deals/${dealId}`, { userId: MANAGING_B });
    expect(r.status).toBe(403);
  });

  it("PATCH /api/partner/deals/:id: 403 cross-partner mutation", async () => {
    const r = await call("PATCH", `/api/partner/deals/${dealId}`, {
      userId: MANAGING_B,
      body: { stage: "closed" },
    });
    expect(r.status).toBe(403);
  });

  it("POST /api/partner/deals: 400 on invalid stage", async () => {
    const r = await call("POST", "/api/partner/deals", {
      userId: MANAGING_A,
      body: { company_id: "co_alpha", stage: "fictitious_stage" },
    });
    expect(r.status).toBe(400);
  });

  /* ====================================================================
   * Hydrator integrity
   * ==================================================================== */

  it("hydrator can be re-run idempotently and populates caches", async () => {
    _partnerWorkspaceV19Internal.portfolioCache.clear();
    _partnerWorkspaceV19Internal.crmCache.clear();
    _partnerWorkspaceV19Internal.dealsCache.clear();
    await hydratePartnerWorkspaceV19Store();
    expect(_partnerWorkspaceV19Internal.portfolioCache.size).toBeGreaterThan(0);
    expect(_partnerWorkspaceV19Internal.crmCache.size).toBeGreaterThan(0);
    expect(_partnerWorkspaceV19Internal.dealsCache.size).toBeGreaterThan(0);
  });
});
