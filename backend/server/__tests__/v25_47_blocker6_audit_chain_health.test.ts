/**
 * v25.47 BLOCKER-6 (APD-029) — Audit-chain continuity health.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. GET /api/admin/audit-chain-health (admin) returns a healthy row.
 *      Wave A-1 (ADR-3 action 4) flipped the seed from 'incident' to 'ok'
 *      because the v25.47 seed came up P0-red on every fresh install and
 *      every :memory: boot. The real incident (if any) is now detected by
 *      the verifier tick, not pre-seeded.
 *   2. A non-admin caller is rejected (router-level requireAdmin boundary).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

function call(
  method: string,
  apiPath: string,
  opts: { userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
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
    r.end();
  });
}

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

describe("BLOCKER-6 audit-chain health", () => {
  it("returns healthy on a fresh boot (Wave A-1 ADR-3 action 4)", async () => {
    const res = await call("GET", "/api/admin/audit-chain-health", { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Wave A-1 flipped the seed: fresh install must NOT come up P0-red.
    // The endpoint still surfaces the tenant row so admins can see it.
    expect(res.body.incident).toBe(false);
    const healthRow = res.body.rows.find((r: any) => r.key === "tenant_admin_capavate");
    expect(healthRow).toBeTruthy();
    expect(healthRow.status).toBe("ok");
  });

  it("rejects a non-admin caller", async () => {
    const res = await call("GET", "/api/admin/audit-chain-health");
    expect([401, 403]).toContain(res.status);
  });
});
