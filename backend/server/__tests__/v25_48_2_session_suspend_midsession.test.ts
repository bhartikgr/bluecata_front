/**
 * v25.48.2 MF-E — enforce account status for ALREADY-logged-in sessions.
 *
 * MF2/MF-A blocked NEW logins for suspended accounts. This test covers the
 * complementary gap: an EXISTING valid session for a user who is suspended
 * MID-SESSION must be rejected on the next protected request. Enforcement
 * lives in server/lib/authMiddleware.ts (userContext.ts is SACRED and cannot
 * be edited), which every protected route funnels through.
 *
 * Identity is supplied via the x-user-id header — the Vitest-only test-harness
 * convenience that userContext.getUserContext() honours (see userContext.ts:
 * "x-user-id header (test harness / legacy)"). It stands in for a live session
 * cookie: the request carries an authenticated identity, and mid-session
 * suspension of that identity must block the request.
 *
 * Drives the REAL routes via supertest (no mocks):
 *   1. x-user-id=u_admin (canonical admin) + active status → GET
 *      /api/admin/partners (requireAdmin) returns 200.
 *   2. Suspend the persona in auth_users → the SAME request → 403
 *      ACCOUNT_SUSPENDED (denied, session not destroyed).
 *   3. Fail-closed: if the status lookup THROWS → 503 (not a crash, not a pass).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import crypto from "node:crypto";
import { getDb, rawDb } from "../db/connection";

let app: express.Express;

async function buildApp(): Promise<express.Express> {
  const a = express();
  a.use(express.json());
  const server = http.createServer(a);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, a);
  return a;
}

function setStatusById(id: string, status: string): void {
  const db = rawDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, failed_attempts, created_at)
     VALUES (?, ?, 'scrypt-placeholder', 'scrypt-sha256', 'admin', ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
  ).run(id, `${id}_${crypto.randomBytes(4).toString("hex")}@seed.example`, status, now);
}

const ADMIN = "u_admin";
const authed = (path: string) => request(app).get(path).set("x-user-id", ADMIN);

beforeAll(async () => {
  getDb();
  app = await buildApp();
});

describe("v25.48.2 MF-E — suspended mid-session is rejected on the next protected request", () => {
  it("active session passes; suspending the user mid-session yields 403 on the same route", async () => {
    // Active → the protected admin route returns 200 for this identity.
    setStatusById(ADMIN, "active");
    const ok = await authed("/api/admin/partners");
    expect(ok.status).toBe(200);

    // Suspend mid-session — the SAME identity must now be refused (403).
    setStatusById(ADMIN, "suspended");
    const blocked = await authed("/api/admin/partners");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("ACCOUNT_SUSPENDED");
    expect(blocked.body.status).toBe("suspended");

    // Restore so ordering can't leak into other tests.
    setStatusById(ADMIN, "active");
  });

  it("inactive and archived mid-session are also rejected (403)", async () => {
    for (const status of ["inactive", "archived"]) {
      setStatusById(ADMIN, status);
      const res = await authed("/api/admin/partners");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("ACCOUNT_SUSPENDED");
      expect(res.body.status).toBe(status);
      setStatusById(ADMIN, "active");
    }
  });

  it("active status passes (control) after the suspension checks", async () => {
    setStatusById(ADMIN, "active");
    const res = await authed("/api/admin/partners");
    expect(res.status).toBe(200);
  });

  it("fails closed (503) on a protected request when the status lookup throws", async () => {
    setStatusById(ADMIN, "active");
    const db = rawDb();
    db.prepare(`ALTER TABLE auth_users RENAME TO auth_users_mfe_bak`).run();
    try {
      const res = await authed("/api/admin/partners");
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("ACCOUNT_STATUS_UNAVAILABLE");
    } finally {
      db.prepare(`ALTER TABLE auth_users_mfe_bak RENAME TO auth_users`).run();
    }
  });
});
