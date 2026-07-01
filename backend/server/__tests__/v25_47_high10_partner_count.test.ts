/**
 * v25.47 APD-036 (HIGH-10) — GET /api/admin/partners exposes a numeric total.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. GET returns a numeric `total` equal to partners.length.
 *   2. Creating a partner increments the total by exactly one.
 *   3. A non-admin cannot read the partner list.
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

describe("APD-036 admin partners total", () => {
  it("returns a numeric total equal to partners.length", async () => {
    const res = await call("GET", "/api/admin/partners", { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.total).toBe(res.body.partners.length);
  });

  it("increments the total after creating a partner", async () => {
    const before = await call("GET", "/api/admin/partners", { userId: "u_admin" });
    const created = await call("POST", "/api/admin/partners", {
      userId: "u_admin",
      body: { legalName: `High10 Partner ${Date.now()}`, email: `high10_${Date.now()}@example.com` },
    });
    expect(created.status).toBe(201);

    const after = await call("GET", "/api/admin/partners", { userId: "u_admin" });
    expect(after.body.total).toBe(before.body.total + 1);
    expect(after.body.total).toBe(after.body.partners.length);
  });

  it("rejects a non-admin", async () => {
    const res = await call("GET", "/api/admin/partners");
    expect([401, 403]).toContain(res.status);
  });
});
