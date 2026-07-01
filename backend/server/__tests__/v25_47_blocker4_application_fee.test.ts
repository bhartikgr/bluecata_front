/**
 * v25.47 BLOCKER-4 (APD-028) — Collective application fee canonical $300 = 30000
 * TRUE minor units.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. Public GET /api/collective/application-fee resolves the canonical
 *      30000 minor units (USD), source="db" (from the seeded config row).
 *   2. Admin GET /api/admin/collective/application-fee reflects the same seed.
 *   3. Admin PUT updates the fee; a fresh DB read (Save→Restart→Load via a new
 *      resolver call) reflects the new value.
 *   4. Non-admin callers cannot PUT (requireAdmin boundary).
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
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    if (payload) headers["content-length"] = String(Buffer.byteLength(payload));
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
    if (payload) r.write(payload);
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

describe("BLOCKER-4 collective application fee = $300 (30000 minor)", () => {
  it("resolves the canonical 30000 minor units publicly", async () => {
    const res = await call("GET", "/api/collective/application-fee");
    expect(res.status).toBe(200);
    expect(res.body.amountMinor).toBe(30000);
    expect(res.body.currency).toBe("USD");
    expect(res.body.source).toBe("db");
  });

  it("admin editor reflects the same canonical seed", async () => {
    const res = await call("GET", "/api/admin/collective/application-fee", { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(res.body.amountMinor).toBe(30000);
  });

  it("persists an admin update (Save→Restart→Load)", async () => {
    const put = await call("PUT", "/api/admin/collective/application-fee", {
      userId: "u_admin",
      body: { amountMinor: 45000, currency: "USD" },
    });
    expect(put.status).toBe(200);
    expect(put.body.amountMinor).toBe(45000);

    const reread = await call("GET", "/api/collective/application-fee");
    expect(reread.status).toBe(200);
    expect(reread.body.amountMinor).toBe(45000);
    expect(reread.body.source).toBe("db");

    // Restore canonical so other suites/ordering see the seed value.
    await call("PUT", "/api/admin/collective/application-fee", {
      userId: "u_admin",
      body: { amountMinor: 30000, currency: "USD" },
    });
  });

  it("rejects a non-admin write", async () => {
    const res = await call("PUT", "/api/admin/collective/application-fee", {
      body: { amountMinor: 1 },
    });
    expect([401, 403]).toContain(res.status);
  });
});
