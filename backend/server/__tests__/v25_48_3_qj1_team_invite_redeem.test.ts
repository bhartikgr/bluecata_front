/**
 * v25.48.3 Q-J1 — team invitations redeem via the working /auth/redeem flow
 * and tag the redeemer as a team MEMBER.
 *
 * Drives the REAL Express routes via supertest:
 *   - GET  /api/auth/redeem/preview?token=…  recognises a team token (kind:"team")
 *   - POST /api/auth/redeem { token, password, agreedToTerms }  creates the
 *     persona, inserts a founder_team_members row (the "tag as team member"),
 *     flips the invitation to accepted, and redirects to /founder/dashboard.
 *   - a NON-team (garbage) token falls through to the investor redeem path
 *     (404), proving the interceptor only claims team tokens.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import crypto from "node:crypto";
import { rawDb } from "../db/connection";

let app: express.Express;

async function buildApp(): Promise<express.Express> {
  const a = express();
  a.use(express.json());
  const server = http.createServer(a);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, a);
  return a;
}

beforeAll(async () => {
  app = await buildApp();
});

function seedCompany(companyId: string): void {
  // Team invites are always for a real company the founder owns. Seed a
  // minimal companies row so addExistingCompanyMembership can attach the
  // redeemer (it fail-closes on COMPANY_NOT_FOUND, which is correct).
  const db: any = rawDb();
  db.prepare(
    `INSERT INTO companies (id, tenant_id, name, legal_name, is_demo)
       VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(id) DO NOTHING`,
  ).run(companyId, `tenant_co_${companyId}`, "QJ1 Test Co", "QJ1 Test Co Ltd");
}

function seedTeamInvite(companyId: string, email: string, role = "member"): string {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const id = `fti_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const db: any = rawDb();
  // Tables are created by registerFounderTeamRoutes (ensureTables) during buildApp.
  db.prepare(
    `INSERT INTO founder_team_invitations
       (id, company_id, invited_by_user_id, invited_email, invited_name, role, status, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(id, companyId, "u_owner_test", email, "Team Member", role, tokenHash, expires, now);
  return raw;
}

describe("v25.48.3 Q-J1 — team invite redeem via /auth/redeem", () => {
  const companyId = `co_qj1_${crypto.randomBytes(4).toString("hex")}`;
  const email = `teammate_${crypto.randomBytes(3).toString("hex")}@test.example`;
  let token: string;

  beforeAll(() => {
    seedCompany(companyId);
    token = seedTeamInvite(companyId, email, "member");
  });

  it("preview recognises the team token (kind:team)", async () => {
    const res = await request(app).get(`/api/auth/redeem/preview?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.invitation.kind).toBe("team");
    expect(res.body.invitation.inviteeEmail).toBe(email);
  });

  it("redeem creates a team member row + returns kind:team → founder dashboard", async () => {
    const res = await request(app)
      .post("/api/auth/redeem")
      .send({ token, password: "hunter2secret", agreedToTerms: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.kind).toBe("team");
    expect(res.body.companyId).toBe(companyId);
    expect(res.body.redirectTo).toBe("/founder/dashboard");

    // The redeemer is now tagged as a team MEMBER of the company.
    const db: any = rawDb();
    const member = db
      .prepare(`SELECT * FROM founder_team_members WHERE company_id = ? AND LOWER(email) = ? AND removed_at IS NULL`)
      .get(companyId, email.toLowerCase());
    expect(member).toBeTruthy();
    expect(member.role).toBe("member");

    // The invitation is now accepted.
    const inv = db
      .prepare(`SELECT status, accepted_at FROM founder_team_invitations WHERE company_id = ? AND invited_email = ?`)
      .get(companyId, email);
    expect(inv.status).toBe("accepted");
    expect(inv.accepted_at).toBeTruthy();
  });

  it("a NON-team token falls through (does NOT get claimed as a team invite)", async () => {
    const garbage = crypto.randomBytes(32).toString("hex");
    const res = await request(app).get(`/api/auth/redeem/preview?token=${encodeURIComponent(garbage)}`);
    // Falls through to the investor preview, which does not know this token → 404.
    expect(res.status).toBe(404);
  });
});
