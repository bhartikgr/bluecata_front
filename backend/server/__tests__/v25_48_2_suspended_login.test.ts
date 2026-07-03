/**
 * v25.48.2 Q5 (Ozan) — a suspended / inactive / archived account MUST NOT be
 * able to log in. The check is DB-driven (auth_users.status) and runs BEFORE
 * any session cookie is issued.
 *
 * Drives the REAL /api/auth/login route via supertest (no mocks). A runtime
 * founder is registered (user_credentials, active → 200). Marking that email
 * suspended in auth_users makes the same login return 403 with a clear error;
 * an untouched active user still logs in.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import crypto from "node:crypto";
import { getDb, rawDb } from "../db/connection";
import { registerFounderUser } from "../lib/userContext";

let app: express.Express;

async function buildApp(): Promise<express.Express> {
  const a = express();
  a.use(express.json());
  const server = http.createServer(a);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, a);
  return a;
}

const E = (s: string) => `${s}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}@test.example`;

function upsertAuthUserStatus(email: string, status: string): void {
  const db = rawDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, failed_attempts, created_at)
     VALUES (?, ?, 'scrypt-placeholder', 'scrypt-sha256', 'founder', ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET status = excluded.status`,
  ).run(`usr_${crypto.randomBytes(8).toString("hex")}`, email.toLowerCase(), status, now);
}

// MF-A — set (or create) the auth_users.status row keyed by the canonical
// persona ID (not email). Conflict on the id PK so an existing seeded row is
// updated in place; a fresh row gets a unique throwaway email to avoid the
// email UNIQUE constraint.
function upsertAuthUserStatusById(id: string, status: string): void {
  const db = rawDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, failed_attempts, created_at)
     VALUES (?, ?, 'scrypt-placeholder', 'scrypt-sha256', 'admin', ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
  ).run(id, `${id}_${crypto.randomBytes(4).toString("hex")}@seed.example`, status, now);
}

beforeAll(async () => {
  getDb();
  app = await buildApp();
});

describe("v25.48.2 Q5 — suspended account cannot log in", () => {
  it("active founder logs in (200), then suspending the account blocks login (403)", async () => {
    const email = E("suspend_me");
    const password = "ActivePass9!";
    registerFounderUser({ email, name: "Suspend Me", password });

    // Active → 200.
    const ok = await request(app).post("/api/auth/login").send({ email, password });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    // Suspend in the DB, then the SAME credentials must be refused with 403.
    upsertAuthUserStatus(email, "suspended");
    const blocked = await request(app).post("/api/auth/login").send({ email, password });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("ACCOUNT_NOT_ACTIVE");
    expect(blocked.body.status).toBe("suspended");
  });

  it("inactive and archived accounts are also blocked (403)", async () => {
    for (const status of ["inactive", "archived"]) {
      const email = E(`status_${status}`);
      const password = "ActivePass9!";
      registerFounderUser({ email, name: `Status ${status}`, password });
      upsertAuthUserStatus(email, status);
      const res = await request(app).post("/api/auth/login").send({ email, password });
      expect(res.status).toBe(403);
      expect(res.body.status).toBe(status);
    }
  });

  it("an active account with an auth_users row still logs in (200)", async () => {
    const email = E("still_active");
    const password = "ActivePass9!";
    registerFounderUser({ email, name: "Still Active", password });
    upsertAuthUserStatus(email, "active");
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // v25.48.2 MF-A — canonical-persona login by {userId, password} with NO email.
  // The status gate MUST be keyed on the RESOLVED persona id, not on the (absent)
  // email — otherwise getAccountStatusByEmail("") returns null → "allow" and a
  // SUSPENDED canonical/admin persona logs in via userId+password. The suspended
  // persona must be refused (403/503) and NO session cookie issued.
  it("MF-A: suspended canonical persona cannot log in via {userId,password} with no email", async () => {
    // u_admin is a canonical persona (MOCK_PASSWORDS: adminpass) when the demo
    // seed is enabled (ENABLE_DEMO_SEED=1 in the test runner).
    const personaId = "u_admin";
    const password = "adminpass";

    // Sanity: active → userId-only login succeeds and sets a session cookie.
    upsertAuthUserStatusById(personaId, "active");
    const okBefore = await request(app).post("/api/auth/login").send({ userId: personaId, password });
    expect(okBefore.status).toBe(200);
    expect(okBefore.body.ok).toBe(true);

    // Suspend by ID, then the SAME userId-only credentials must be refused.
    upsertAuthUserStatusById(personaId, "suspended");
    const blocked = await request(app).post("/api/auth/login").send({ userId: personaId, password });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("ACCOUNT_NOT_ACTIVE");
    expect(blocked.body.status).toBe("suspended");
    // No session cookie on the blocked path.
    const setCookie = blocked.headers["set-cookie"];
    expect(setCookie === undefined || setCookie.length === 0).toBe(true);

    // Restore active so ordering can't leak into other tests.
    upsertAuthUserStatusById(personaId, "active");
  });

  // MF-A fail-closed — the by-ID status lookup on the canonical path must also
  // deny (503, no session) when the auth_users read THROWS.
  it("MF-A: canonical userId-only login fails closed (503, no session) when status lookup throws", async () => {
    const personaId = "u_admin";
    const password = "adminpass";
    upsertAuthUserStatusById(personaId, "active");

    const db = rawDb();
    db.prepare(`ALTER TABLE auth_users RENAME TO auth_users_mfa_bak`).run();
    try {
      const res = await request(app).post("/api/auth/login").send({ userId: personaId, password });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("ACCOUNT_STATUS_UNAVAILABLE");
      const setCookie = res.headers["set-cookie"];
      expect(setCookie === undefined || setCookie.length === 0).toBe(true);
    } finally {
      db.prepare(`ALTER TABLE auth_users_mfa_bak RENAME TO auth_users`).run();
    }
  });

  // v25.48.2 MF2 — the status lookup must FAIL CLOSED. When the auth_users read
  // THROWS (schema/DB error, not a legitimate "no row"), login is denied with a
  // non-200 and NO session cookie is issued.
  it("fails closed (no session) when the account-status lookup throws", async () => {
    const email = E("db_error");
    const password = "ActivePass9!";
    registerFounderUser({ email, name: "DB Error", password });

    // Sanity: with the table present the same creds log in fine.
    const okBefore = await request(app).post("/api/auth/login").send({ email, password });
    expect(okBefore.status).toBe(200);

    const db = rawDb();
    // Force the auth_users SELECT in getAccountStatusByEmail() to throw by
    // temporarily removing the table. Restore it in finally so later tests pass.
    db.prepare(`ALTER TABLE auth_users RENAME TO auth_users_mf2_bak`).run();
    try {
      const res = await request(app).post("/api/auth/login").send({ email, password });
      expect(res.status).not.toBe(200);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("ACCOUNT_STATUS_UNAVAILABLE");
      // No session cookie must be set on the fail-closed path.
      const setCookie = res.headers["set-cookie"];
      expect(setCookie === undefined || setCookie.length === 0).toBe(true);
      expect(res.body.ok).toBeFalsy();
    } finally {
      db.prepare(`ALTER TABLE auth_users_mf2_bak RENAME TO auth_users`).run();
    }
  });
});
