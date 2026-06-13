/**
 * v24.2 Bug 1+2 — Password persistence regression proof.
 *
 * Root cause (V24_2_ROOTCAUSE.md §Bug 1+2): `/api/auth/secure/redeem` wrote the
 * new password hash to `auth_users.password_hash`, but the browser login form
 * posts to `/api/auth/login`, whose handler reads the bcrypt hash from the
 * `user_credentials` table (via verifyPassword → lookupByEmail). The two stores
 * diverged, so a reset/invite password NEVER worked at the browser login form.
 *
 * The v24.2 fix makes both `/api/auth/secure/redeem` and the legacy
 * `/api/auth/redeem` ALSO persist the password into `user_credentials` (the
 * store `/api/auth/login` reads). These tests drive the REAL handlers end to
 * end — redeem, then log in through the exact endpoint the browser uses — so a
 * future divergence between the writer and reader is caught here, not in prod.
 *
 * No mocks. No fake-success shims. Identity flows through the production
 * routes; tokens are inserted into auth_redeem_tokens the same way the
 * forgot/invite flows mint them.
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
  // registerRoutes wires /api/auth/login, legacy /api/auth/redeem, and the
  // secure routes (with their CSRF middleware) exactly as production does.
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, a);
  return a;
}

/** Insert a redeem token directly (same shape forgot/invite flows mint). */
function insertRedeemToken(args: { token: string; email: string; intent: string }): void {
  const db = rawDb();
  const tokenHash = crypto.createHash("sha256").update(args.token).digest("hex");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO auth_redeem_tokens (id, token_hash, email, intent, consumed_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
  ).run(`rdt_${crypto.randomBytes(6).toString("hex")}`, tokenHash, args.email, args.intent, expires, now);
}

/** Insert an active auth_users row so a `reset` token has a user to reset. */
function insertAuthUser(email: string): string {
  const db = rawDb();
  const id = `usr_${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(
    `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, failed_attempts, created_at)
     VALUES (?, ?, ?, 'scrypt-sha256', 'investor', 'active', 0, ?)`,
  ).run(id, email, "scrypt-placeholder-hash", new Date().toISOString());
  return id;
}

const E = (s: string) => `${s}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}@test.example`;

beforeAll(async () => {
  getDb();
  app = await buildApp();
});

describe("v24.2 Bug 1+2 — secure redeem RESET → browser login", () => {
  it("reset via /api/auth/secure/redeem → /api/auth/login with NEW password → 200", async () => {
    const email = E("reset_ok");
    insertAuthUser(email); // reset requires an existing user
    const token = `tok_${crypto.randomBytes(16).toString("hex")}`;
    insertRedeemToken({ token, email, intent: "reset" });

    const newPw = "BrandNewReset9!";
    const redeem = await request(app).post("/api/auth/secure/redeem").send({ token, password: newPw });
    expect(redeem.status).toBe(200);

    // The browser login form posts here — this is the read path that was broken.
    const login = await request(app).post("/api/auth/login").send({ email, password: newPw });
    expect(login.status).toBe(200);
    expect(login.body.ok).toBe(true);
  });

  it("reset via /api/auth/secure/redeem → /api/auth/login with OLD password → 401", async () => {
    const email = E("reset_oldpw");
    insertAuthUser(email);
    const token = `tok_${crypto.randomBytes(16).toString("hex")}`;
    insertRedeemToken({ token, email, intent: "reset" });

    const oldPw = "ThisWasNeverSet0!"; // the user never logged in with this
    const newPw = "TheActualNew7!";
    const redeem = await request(app).post("/api/auth/secure/redeem").send({ token, password: newPw });
    expect(redeem.status).toBe(200);

    const login = await request(app).post("/api/auth/login").send({ email, password: oldPw });
    expect(login.status).toBe(401);
  });
});

describe("v24.2 Bug 1+2 — secure redeem INVITE → browser login", () => {
  it("invite via /api/auth/secure/redeem → /api/auth/login with NEW password → 200", async () => {
    const email = E("invite_ok");
    const token = `tok_${crypto.randomBytes(16).toString("hex")}`;
    insertRedeemToken({ token, email, intent: "invite" });

    const newPw = "InviteSetup4!";
    const redeem = await request(app).post("/api/auth/secure/redeem").send({ token, password: newPw });
    expect(redeem.status).toBe(200);

    // user_credentials must now carry the bcrypt hash that /api/auth/login reads.
    const login = await request(app).post("/api/auth/login").send({ email, password: newPw });
    expect(login.status).toBe(200);
    expect(login.body.ok).toBe(true);
  });
});

describe("v24.2 Bug 1+2 — legacy /api/auth/redeem → browser login", () => {
  it("legacy /api/auth/redeem → /api/auth/login with NEW password → 200", async () => {
    // The legacy redeem consumes an in-memory invitation token. Mint one via
    // the founder CRM invitation store, then redeem it through the legacy route.
    const { createInvitation } = await import("../roundInvitationsStore");
    const { registerFounderUser } = await import("../lib/userContext");
    const { addCompanyForFounder } = await import("../multiCompanyStore");

    const founder = registerFounderUser({
      email: E("legacy_founder"),
      name: "Legacy Founder",
      password: "FounderPass1A",
    });
    const companyId = `co_v242_legacy_${crypto.randomBytes(4).toString("hex")}`;
    addCompanyForFounder(founder.userId, {
      companyId,
      companyName: "v24.2 Legacy Co",
      legalName: "v24.2 Legacy Co, Inc.",
      logoUrl: null,
      role: "founder",
      lastActiveAt: new Date().toISOString(),
      kpi: {
        capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0,
        dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0,
      },
      collective: { status: "none" },
      billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
      sector: "fintech",
      stage: "seed",
      hq: "Toronto, ON",
    });

    const inviteeEmail = E("legacy_investor");
    const inv = await createInvitation({
      roundId: `rnd_v242_legacy_${crypto.randomBytes(4).toString("hex")}`,
      companyId,
      investorEmail: inviteeEmail,
      investorName: "Legacy Investor",
      invitedByUserId: founder.userId,
    });
    // Extract the raw token from the redeemUrl (…/invite/<token>).
    const rawToken = inv.redeemUrl.split("/").pop() as string;
    expect(rawToken.length).toBeGreaterThan(16);

    const newPw = "LegacyRedeem8!";
    const redeem = await request(app)
      .post("/api/auth/redeem")
      .send({ token: rawToken, password: newPw, agreedToTerms: true });
    expect(redeem.status).toBe(200);
    expect(redeem.body.ok).toBe(true);

    // Now log in through the browser endpoint with the redeemed password.
    const login = await request(app).post("/api/auth/login").send({ email: inviteeEmail, password: newPw });
    expect(login.status).toBe(200);
    expect(login.body.ok).toBe(true);
  });
});
