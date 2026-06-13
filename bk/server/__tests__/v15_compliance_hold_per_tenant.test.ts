/**
 * v15 P0-12 — Per-tenant compliance hold.
 *
 * Pre-v15, captableCommitStore used a single global `complianceHold = false`
 * boolean; switching it on blocked EVERY tenant's commits, and any admin
 * action affected the whole platform. v15 replaces it with a per-tenant
 * `compliance_holds` table + Map, with two admin endpoints:
 *
 *   POST   /api/admin/compliance-hold        { tenantId, on, reason }
 *   DELETE /api/admin/compliance-hold/:tenantId
 *   GET    /api/admin/compliance-hold        → list active holds
 *
 * This test confirms:
 *   - Non-admin → 401/403 on the admin endpoints.
 *   - Admin can set a hold on tenant A; tenant B is unaffected.
 *   - Releasing tenant A clears its hold without touching tenant B.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  setComplianceHoldForTenant,
  getComplianceHoldForTenant,
  _resetComplianceHoldsForTests,
} from "../captableCommitStore";

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

function call(
  method: string,
  path: string,
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
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("v15 P0-12: per-tenant compliance hold", () => {
  beforeAll(() => {
    try { _resetComplianceHoldsForTests(); } catch { /* tolerated */ }
  });

  it("non-admin → 401/403 on POST /api/admin/compliance-hold", async () => {
    // Anonymous
    const anon = await call("POST", "/api/admin/compliance-hold", {
      body: { tenantId: "tenant_co_novapay", on: true },
    });
    expect([401, 403]).toContain(anon.status);
    // Founder, not admin
    const founder = await call("POST", "/api/admin/compliance-hold", {
      body: { tenantId: "tenant_co_novapay", on: true },
      userId: "u_maya_chen",
    });
    expect([401, 403]).toContain(founder.status);
  });

  it("store-level: hold on tenant A does not affect tenant B", () => {
    _resetComplianceHoldsForTests();
    setComplianceHoldForTenant("tenant_co_novapay", true, "u_admin_root", "AML escalation");
    expect(getComplianceHoldForTenant("tenant_co_novapay")).toBe(true);
    expect(getComplianceHoldForTenant("tenant_co_forge")).toBe(false);
    setComplianceHoldForTenant("tenant_co_novapay", false, "u_admin_root");
    expect(getComplianceHoldForTenant("tenant_co_novapay")).toBe(false);
    expect(getComplianceHoldForTenant("tenant_co_forge")).toBe(false);
  });

  it("multiple tenants can be held independently", () => {
    _resetComplianceHoldsForTests();
    setComplianceHoldForTenant("tenant_a", true, "u_admin_root");
    setComplianceHoldForTenant("tenant_b", true, "u_admin_root");
    expect(getComplianceHoldForTenant("tenant_a")).toBe(true);
    expect(getComplianceHoldForTenant("tenant_b")).toBe(true);
    setComplianceHoldForTenant("tenant_a", false, "u_admin_root");
    expect(getComplianceHoldForTenant("tenant_a")).toBe(false);
    expect(getComplianceHoldForTenant("tenant_b")).toBe(true);
    _resetComplianceHoldsForTests();
  });
});
