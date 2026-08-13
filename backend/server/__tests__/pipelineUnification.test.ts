/**
 * CP Phase A — Pipeline unification tests (CP-019).
 *
 * Coverage:
 *   - legacy_id column accepts text values without error (smoke).
 *   - POST /api/partner/deals writes to partner_deal_pipeline (single DB table).
 *   - Hydrate restores state across cache clears.
 *   - Cross-tenant isolation: partner A's deals invisible to partner B.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { eq, sql } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { __setRuntimePersona } from "../lib/userContext";
import {
  hydratePartnerWorkspaceV19Store,
  _partnerWorkspaceV19Internal,
} from "../partnerWorkspaceV19Store";
import { partnerDealPipeline as dealsTable } from "../../shared/schema";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_pipeline_unif_b";
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;
const MANAGING_B = "u_pipeline_unif_managing_b";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  __setRuntimePersona({
    userId: MANAGING_B,
    email: "managing-b@pipeline-unif.example",
    name: "Pipeline Unif B",
    isFounder: false,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  });

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "PIPELINE UNIF PARTNER B",
    displayName: "PIPE B",
    email: "pipe-b@test.example",
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
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let b: any = null;
          try { b = JSON.parse(buf); } catch { /* keep */ }
          resolve({ status: res.statusCode ?? 0, body: b });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("CP Phase A — partner deal pipeline unification (CP-019)", () => {
  let dealAId = "";

  it("POST /api/partner/deals: deal row persisted to partner_deal_pipeline (single table)", async () => {
    const r = await call("POST", "/api/partner/deals", {
      userId: MANAGING_A,
      body: { company_id: "co_unif_alpha", stage: "sourced", notes: "Unification smoke" },
    });
    expect(r.status).toBe(201);
    expect(r.body.deal.id).toMatch(/^pdp_/);
    expect(r.body.deal.partnerId).toBe(PARTNER_A);
    dealAId = r.body.deal.id;

    // Verify the row landed in partner_deal_pipeline (no shadow table writes).
    const db: any = getDb();
    const rows = db.select().from(dealsTable).where(eq((dealsTable as any).id, dealAId)).all() as any[];
    expect(rows.length).toBe(1);
  });

  it("partner_deal_pipeline.legacy_id column accepts text values without schema error (smoke)", () => {
    // Direct UPDATE to set legacy_id (the column exists post-migration 0043).
    const db: any = getDb();
    expect(() => {
      db.run(sql`UPDATE partner_deal_pipeline SET legacy_id = ${"legacy_xyz_001"} WHERE id = ${dealAId}`);
    }).not.toThrow();
    // And the value reads back.
    const rows = db.all(sql`SELECT legacy_id FROM partner_deal_pipeline WHERE id = ${dealAId}`) as Array<{ legacy_id: string | null }>;
    expect(rows[0]?.legacy_id).toBe("legacy_xyz_001");
  });

  it("PATCH /api/partner/deals/:id: state transition persists to partner_deal_pipeline", async () => {
    const r = await call("PATCH", `/api/partner/deals/${dealAId}`, {
      userId: MANAGING_A,
      body: { stage: "screening" },
    });
    expect(r.status).toBe(200);
    expect(r.body.deal.stage).toBe("screening");

    // Direct DB read confirms the unified table holds the latest state.
    const db: any = getDb();
    const rows = db.select().from(dealsTable).where(eq((dealsTable as any).id, dealAId)).all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].stage).toBe("screening");
  });

  it("hydrate: clear cache and rehydrate restores all deal rows from DB", async () => {
    const beforeSize = _partnerWorkspaceV19Internal.dealsCache.size;
    expect(beforeSize).toBeGreaterThan(0);
    _partnerWorkspaceV19Internal.dealsCache.clear();
    expect(_partnerWorkspaceV19Internal.dealsCache.size).toBe(0);
    await hydratePartnerWorkspaceV19Store();
    expect(_partnerWorkspaceV19Internal.dealsCache.size).toBe(beforeSize);
    // And our created deal is back.
    expect(_partnerWorkspaceV19Internal.dealsCache.has(dealAId)).toBe(true);
  });

  it("cross-tenant: Partner B does not see Partner A's deal in list", async () => {
    const r = await call("GET", "/api/partner/deals", { userId: MANAGING_B });
    expect(r.status).toBe(200);
    const ids: string[] = (r.body.deals ?? []).map((d: any) => d.id);
    expect(ids).not.toContain(dealAId);
  });

  /* WAVE 37 — STALE TEST. The code implements the RULING; the test pinned the
   * behaviour the ruling replaced.
   *
   * THE RULING. Review A `FINAL_REVIEW_v26_16_A.md` §F9 — a cross-tenant refusal
   * that answers 403 while a nonexistent id answers 404 is an ENUMERATION
   * ORACLE: the status code alone tells an outsider that the id is real.
   * `server/routes.ts` already carried the platform's own stated policy in a
   * comment — 404 "so we don't even leak the existence of the company id".
   * WAVE 35 Row 6 extended that to the partner-tenant sinks, of which this
   * route is one: `server/partnerWorkspaceV19Store.ts` now answers
   * `PARTNER_TENANT_REFUSAL_STATUS` / `PARTNER_TENANT_REFUSAL`, marked
   * `// WAVE 35 · F9`. So 404 here is correct and 403 would be the regression.
   *
   * STRENGTHENED, not loosened. Asserting `toBe(404)` alone would be WEAKER
   * than the old 403 pin, because a route that 404s on everything — including
   * the owner's own deal — would pass it. The case therefore asserts the
   * property the ruling is actually about: the refusal for "exists, but not
   * yours" must be INDISTINGUISHABLE from the refusal for "does not exist",
   * while the owner still gets their deal. Three poles:
   *   (1) the legitimate owner gets 200 and the real row — so a blanket-404
   *       route fails;
   *   (2) the cross-tenant caller and a ghost-id caller get byte-identical
   *       status AND body — so a 403, a distinct error code, or a distinct
   *       message all fail;
   *   (3) the refusal body carries no trace of the real deal.
   * The probe is a REAL-BUT-WRONG identity (MANAGING_B, a genuine managing
   * partner of another firm), never anonymous and never a demo persona: an
   * anonymous caller would be refused by `requirePartnerAuth` before the
   * tenant predicate is ever reached, and would prove nothing. */
  it("cross-tenant: Partner B's refusal for Partner A's deal is 404 and byte-identical to a ghost id (F9 — no enumeration oracle)", async () => {
    // POLE 1 — the route is not simply broken: its real owner still gets it.
    const owner = await call("GET", `/api/partner/deals/${dealAId}`, { userId: MANAGING_A });
    expect(owner.status).toBe(200);
    expect(owner.body?.deal?.id).toBe(dealAId);

    // POLE 2 — "exists but not yours" vs "does not exist": same answer.
    const ghostId = `deal_w37_does_not_exist_${Date.now()}`;
    const crossTenant = await call("GET", `/api/partner/deals/${dealAId}`, { userId: MANAGING_B });
    const ghost = await call("GET", `/api/partner/deals/${ghostId}`, { userId: MANAGING_B });

    expect(crossTenant.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect(crossTenant.status).toBe(ghost.status);
    expect(JSON.stringify(crossTenant.body)).toBe(JSON.stringify(ghost.body));

    // POLE 3 — and the refusal leaks nothing about the deal it is hiding.
    expect(JSON.stringify(crossTenant.body)).not.toContain(dealAId);
  });
});
