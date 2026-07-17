/**
 * W-V44 (H2 regression) — audit-chain-health resolve must NOT clear a
 * genuinely broken chain, and must verify the EXACT tenant id (no tenant_
 * prefix stripping). GPT-5.5 deciding-review blocker.
 *
 * Scenario: seed an `incident` health row for `tenant_admin_capavate` and a
 * DELIBERATELY BROKEN audit_log chain for that same tenant id. Posting resolve
 * must return 409 and leave the incident open (the earlier bug stripped the
 * `tenant_` prefix and verified an empty `admin_capavate` chain, wrongly
 * clearing the incident).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";

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

const TENANT = "tenant_admin_capavate";

beforeAll(async () => {
  getDb();
  const db = rawDb();
  // Ensure an incident row exists for the tenant.
  db.prepare(
    `INSERT INTO audit_chain_health (key, status, detail, updated_at)
     VALUES (?, 'incident', 'seeded for test', ?)
     ON CONFLICT(key) DO UPDATE SET status='incident', detail='seeded for test'`,
  ).run(TENANT, new Date().toISOString());
  // Seed a DELIBERATELY BROKEN chain for the EXACT tenant id: an audit_log row
  // whose prev_hash does not match the genesis, so verification must fail.
  db.prepare(
    `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash, created_at)
     VALUES (?, ?, 'system:test', 'test.broken', 'test:target', '{}', ?, ?, ?)`,
  ).run(
    `al_broken_${Date.now()}`,
    TENANT,
    "deadbeef".repeat(8), // wrong prior hash (not the 64-zero genesis) => broken at link 0
    "f".repeat(64),
    new Date().toISOString(),
  );

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

describe("W-V44 H2 — banner resolve cannot clear a genuinely broken chain", () => {
  it("returns 409 and keeps the incident open when the exact tenant chain is broken", async () => {
    const res = await call("POST", "/api/admin/audit-chain-health/resolve", {
      userId: "u_admin",
      body: { key: TENANT, note: "attempt to resolve" },
    });
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("chain_not_clean");

    // The health row must STILL be an incident (not cleared).
    const health = await call("GET", "/api/admin/audit-chain-health", { userId: "u_admin" });
    const row = (health.body.rows ?? []).find((r: any) => r.key === TENANT);
    expect(row).toBeDefined();
    expect(String(row.status).toLowerCase()).not.toBe("ok");
    expect(health.body.incident).toBe(true);
  });

  it("rejects a missing key with 400", async () => {
    const res = await call("POST", "/api/admin/audit-chain-health/resolve", {
      userId: "u_admin",
      body: { note: "no key" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("key_required");
  });
});
