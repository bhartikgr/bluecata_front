/**
 * v25.47 APD-034 (HIGH-2) — terminal-state idempotency on Collective
 * approve/reject.
 *
 * Applications are SEEDED directly into the collective_apps table (Save), every
 * ASSERTION hits a REAL Express route (Load):
 *   POST /api/admin/collective/applications/:id/approve
 *   POST /api/admin/collective/applications/:id/reject
 *
 *   1. Approving a submitted application transitions it to accepted.
 *   2. Re-approving an accepted application is an idempotent no-op (idempotent:true).
 *   3. Rejecting a submitted application transitions it to rejected.
 *   4. Re-rejecting a rejected application is an idempotent no-op (idempotent:true).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

const APPROVE_ID = `app_high2_appr_${Date.now()}`;
const REJECT_ID = `app_high2_rej_${Date.now()}`;

function seedApp(id: string, userId: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO collective_apps (id, tenant_id, chapter_id, user_id, status, payload_json, submitted_at, created_at)
         VALUES (?, ?, ?, ?, 'submitted', '{}', ?, ?)`,
    )
    .run(id, "tenant_chap_default", "default", userId, now, now);
}

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
  seedApp(APPROVE_ID, "u_high2_appr");
  seedApp(REJECT_ID, "u_high2_rej");
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

describe("APD-034 collective approve/reject idempotency", () => {
  it("approves a submitted application", async () => {
    const res = await call("POST", `/api/admin/collective/applications/${APPROVE_ID}/approve`, {
      userId: "u_admin",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.idempotent).toBeUndefined();
    expect(res.body.application.status).toBe("accepted");
  });

  it("re-approving an accepted application is idempotent", async () => {
    const res = await call("POST", `/api/admin/collective/applications/${APPROVE_ID}/approve`, {
      userId: "u_admin",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.application.status).toBe("accepted");
  });

  it("rejects a submitted application", async () => {
    const res = await call("POST", `/api/admin/collective/applications/${REJECT_ID}/reject`, {
      userId: "u_admin",
      body: { reason: "Not at this time." },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.idempotent).toBeUndefined();
    expect(res.body.application.status).toBe("rejected");
  });

  it("re-rejecting a rejected application is idempotent", async () => {
    const res = await call("POST", `/api/admin/collective/applications/${REJECT_ID}/reject`, {
      userId: "u_admin",
      body: { reason: "Not at this time." },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.application.status).toBe("rejected");
  });
});
