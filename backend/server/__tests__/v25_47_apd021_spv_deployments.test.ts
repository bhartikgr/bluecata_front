/**
 * v25.47 APD-021 — Consortium SPV deployment ledger.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. POST /api/admin/consortium/spv-deployments records a deployment with the
 *      DB-resolved fee (created:true, 201).
 *   2. Idempotency: re-POST of the same spvId returns the existing row
 *      (created:false, 200) — no duplicate ledger entry.
 *   3. GET /api/admin/consortium/spv-deployments lists recorded deployments
 *      (Save→Restart→Load: a fresh DB read shows the persisted row).
 *   4. Auth: a non-admin POST is rejected (401/403).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

const SPV_ID = `spv_test_${Date.now()}`;

beforeAll(async () => {
  getDb();
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

describe("APD-021 SPV deployment ledger", () => {
  it("records a deployment with the DB-resolved fee", async () => {
    const res = await call("POST", "/api/admin/consortium/spv-deployments", {
      userId: "u_admin",
      body: { spvId: SPV_ID, note: "first deploy" },
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.deployment.spvId).toBe(SPV_ID);
    expect(res.body.deployment.feeMinor).toBeGreaterThan(0);
    expect(res.body.deployment.currency).toBe("USD");
  });

  it("is idempotent on spvId (no duplicate ledger entry)", async () => {
    const res = await call("POST", "/api/admin/consortium/spv-deployments", {
      userId: "u_admin",
      body: { spvId: SPV_ID, note: "second deploy attempt" },
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.deployment.spvId).toBe(SPV_ID);
  });

  it("lists recorded deployments (fresh DB read)", async () => {
    const res = await call("GET", "/api/admin/consortium/spv-deployments", {
      userId: "u_admin",
    });
    expect(res.status).toBe(200);
    const ids = res.body.deployments.map((d: any) => d.spvId);
    expect(ids).toContain(SPV_ID);
    // exactly one row for our spvId — idempotency held
    expect(ids.filter((id: string) => id === SPV_ID)).toHaveLength(1);
  });

  it("rejects a non-admin POST", async () => {
    const res = await call("POST", "/api/admin/consortium/spv-deployments", {
      body: { spvId: `spv_unauth_${Date.now()}` },
    });
    expect([401, 403]).toContain(res.status);
  });
});
