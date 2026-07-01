/**
 * v25.47 APD-031 (HIGH-3) — Collective admin settings.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. Admin GET returns the seeded default settings.
 *   2. Admin PUT merge-patches and persists (Save→Restart→Load via fresh GET).
 *   3. The public GET exposes the public subset and never the internal note.
 *   4. A non-admin cannot read the admin settings.
 *   5. PUT validates field types (bad applicationsOpen → 400).
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

describe("APD-031 collective admin settings", () => {
  it("returns default settings to an admin", async () => {
    const res = await call("GET", "/api/admin/collective-settings", { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(res.body.settings.applicationsOpen).toBe(true);
    expect(typeof res.body.settings.membershipHeadline).toBe("string");
  });

  it("persists a merge-patch (Save→Restart→Load)", async () => {
    const put = await call("PUT", "/api/admin/collective-settings", {
      userId: "u_admin",
      body: { applicationsOpen: false, membershipHeadline: "Applications closed", internalNote: "ops only" },
    });
    expect(put.status).toBe(200);
    expect(put.body.settings.applicationsOpen).toBe(false);

    const reread = await call("GET", "/api/admin/collective-settings", { userId: "u_admin" });
    expect(reread.body.settings.applicationsOpen).toBe(false);
    expect(reread.body.settings.membershipHeadline).toBe("Applications closed");
    expect(reread.body.settings.internalNote).toBe("ops only");
  });

  it("exposes only the public subset publicly", async () => {
    const res = await call("GET", "/api/collective/public-settings");
    expect(res.status).toBe(200);
    expect(res.body.settings.applicationsOpen).toBe(false);
    expect(res.body.settings.membershipHeadline).toBe("Applications closed");
    expect(res.body.settings).not.toHaveProperty("internalNote");
  });

  it("rejects a non-admin reading admin settings", async () => {
    const res = await call("GET", "/api/admin/collective-settings");
    expect([401, 403]).toContain(res.status);
  });

  it("validates field types", async () => {
    const res = await call("PUT", "/api/admin/collective-settings", {
      userId: "u_admin",
      body: { applicationsOpen: "nope" },
    });
    expect(res.status).toBe(400);
  });
});
