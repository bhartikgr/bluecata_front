/**
 * Wave C — FIX C5 — Activity Log strict tenant isolation (extended).
 *
 * Extends `activityLogTenantIsolation.test.ts` with the additional cases
 * documented in the Wave C scope:
 *
 *  - A brand-new founder (no companies) returns an EMPTY list (or only
 *    their own platform-tenant rows) \u2014 never another founder's rows.
 *  - Founder A creates events under their own company tenant; only A
 *    sees them, never founder B.
 *  - Admin sees BOTH founders' events (CROSS-TENANT marker preserved).
 *  - Defense-in-depth: missing/empty userId in ctx yields 401 (verified
 *    indirectly via requireAuth + the new isAuthed && userId guard).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { appendAdminAudit } from "../adminPlatformStore";
import { __setRuntimePersona } from "../lib/userContext";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function get(
  path: string,
  userId?: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (userId) headers["x-user-id"] = userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

describe("Wave C FIX C5 — Activity Log strict tenant isolation", () => {
  const founderA = `u_c5_founderA_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const founderB = `u_c5_founderB_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const freshFounder = `u_c5_fresh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = `u_c5_admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const consentA = `consent_c5_a_${Math.random().toString(36).slice(2, 10)}`;
  const consentB = `consent_c5_b_${Math.random().toString(36).slice(2, 10)}`;

  beforeAll(() => {
    __setRuntimePersona({
      userId: founderA,
      email: `${founderA}@c5.test`,
      name: "C5 Founder A",
      isFounder: true,
      isInvestor: false,
      isAdmin: false,
      hasInvitations: false,
    });
    __setRuntimePersona({
      userId: founderB,
      email: `${founderB}@c5.test`,
      name: "C5 Founder B",
      isFounder: true,
      isInvestor: false,
      isAdmin: false,
      hasInvitations: false,
    });
    __setRuntimePersona({
      userId: freshFounder,
      email: `${freshFounder}@c5.test`,
      name: "C5 Brand-new founder (no companies, no events)",
      isFounder: true,
      isInvestor: false,
      isAdmin: false,
      hasInvitations: false,
    });
    __setRuntimePersona({
      userId: admin,
      email: `${admin}@c5.test`,
      name: "C5 Admin",
      isFounder: false,
      isInvestor: false,
      isAdmin: true,
      hasInvitations: false,
    });

    // Seed each founder's own platform-tenant consent row.
    appendAdminAudit(founderA, `consent:${consentA}`, "legal_consent.recorded", {
      consentId: consentA,
      userId: founderA,
      documentId: "terms_of_service",
    });
    appendAdminAudit(founderB, `consent:${consentB}`, "legal_consent.recorded", {
      consentId: consentB,
      userId: founderB,
      documentId: "terms_of_service",
    });
  });

  it("brand-new founder with no companies sees NO other founders' rows", async () => {
    const res = await get("/api/activity", freshFounder);
    expect(res.status).toBeLessThan(500);
    expect(Array.isArray(res.body)).toBe(true);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(consentA);
    expect(bodyStr).not.toContain(consentB);
    expect(bodyStr).not.toContain(founderA);
    expect(bodyStr).not.toContain(founderB);
    // Either empty, or only legacy demo-seed fixture rows (no tenantId).
    const rows: Array<{ tenantId?: string; actor?: string }> = res.body;
    for (const r of rows) {
      if (r.tenantId === "tenant_platform") {
        expect(r.actor).toBe(freshFounder);
      } else if (r.tenantId && r.tenantId.startsWith("tenant_co_")) {
        // freshFounder has no companies — should never see tenant_co_* rows.
        throw new Error(`Fresh founder saw a company-tenant row: ${r.tenantId}`);
      }
    }
  });

  it("founder A's own consent visible to A, never to B", async () => {
    const aRes = await get("/api/activity", founderA);
    const bRes = await get("/api/activity", founderB);
    const aStr = JSON.stringify(aRes.body);
    const bStr = JSON.stringify(bRes.body);
    expect(aStr).toContain(consentA);
    expect(aStr).not.toContain(consentB);
    expect(bStr).toContain(consentB);
    expect(bStr).not.toContain(consentA);
  });

  it("admin sees BOTH consent rows (CROSS-TENANT marker preserved)", async () => {
    const res = await get("/api/activity", admin);
    expect(res.status).toBeLessThan(500);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).toContain(consentA);
    expect(bodyStr).toContain(consentB);
  });

  // Wave F4 FIX F4-1 (E2E-2, P0): brand-new founder must see EXACTLY zero
  // rows from the legacy demo-seed `activity` array (those Maya-Chen rows
  // had no tenantId and were leaking into every founder's response).
  it("brand-new founder sees NO legacy demo-seed activity rows (no tenantId leak)", async () => {
    const res = await get("/api/activity", freshFounder);
    expect(res.status).toBeLessThan(500);
    expect(Array.isArray(res.body)).toBe(true);
    const rows: Array<{ id?: string; ts?: string; actor?: string; tenantId?: string }> = res.body;
    // Legacy seed row ids are ac_1..ac_8 — NONE of them must appear.
    const legacyIds = rows
      .map((r) => r.id)
      .filter((id): id is string => typeof id === "string" && /^ac_\d+$/.test(id));
    expect(legacyIds, `Fresh founder leaked legacy seed rows: ${legacyIds.join(",")}`).toEqual([]);
    // Sanity: no row should be attributed to "Maya Chen" (the demo seed actor).
    const mayaRows = rows.filter((r) => typeof r.actor === "string" && /^maya\s/i.test(r.actor));
    expect(mayaRows.length, `Fresh founder saw ${mayaRows.length} rows attributed to Maya`).toBe(0);
  });

  it("unauthenticated request to /api/activity returns 401", async () => {
    // No x-user-id header, no cookie, and DISABLE_DEV_BYPASS forces production-mode
    // resolution so requireAuth blocks the request.
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const res = await get("/api/activity");
      expect(res.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
    }
  });
});
