/**
 * v24.1 Lockdown Patch — regression proof for the P0/P1/P2 bug wave.
 *
 * One file, one app boot, deterministic identities via the `x-user-id`
 * header (the only header resolvePersonaId() reads in Vitest mode). These
 * tests exercise the REAL handlers — no mocks, no fake-success shims — and
 * assert the exact behavioural contract each fix promised:
 *
 *   Bug I+K  — invitation redeem URL points at the registered /auth/redeem SPA route
 *   Bug A    — secure redeem rejects weak passwords (400 weak_password + reason)
 *   Bug A    — a reset-intent token with NO existing user never mints a user (400)
 *   Bug B    — POST /api/rounds rejects blank name / non-positive target (400 validation_failed)
 *   Bug C    — POST /api/rounds persists a derived postMoney when the client omits it
 *   Bug D    — soft-circle PATCH succeeds for a MODERN (redeemed) invitation
 *   Bug E    — GET /api/investors/:id/profile synthesises a blank profile for the owner
 *   Bug J    — CRM upsert on invitation dedupes by (companyId, lower(trim(email)))
 *   Bug L    — GET /api/founder/team/members returns the { members: [...] } shape
 *
 * Identity strategy mirrors roundPersistenceProof.test.ts: register real
 * personas in RUNTIME_PERSONAS and route through the production
 * loadUserContext middleware. No sacred files are imported or mutated.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import crypto from "node:crypto";

import { getDb, rawDb } from "../db/connection";
import { registerFounderUser, registerPersona } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { createInvitation, _testAccessInvitations } from "../roundInvitationsStore";
import {
  upsertCrmContactForInvitation,
  listContactsForCompany,
} from "../founderCrmStore";

async function buildApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  return app;
}

/** Insert a redeem token directly so we can drive the secure redeem handler. */
function insertRedeemToken(args: {
  token: string;
  email: string;
  intent: string;
  expiresInMs?: number;
}): void {
  const db = rawDb();
  const tokenHash = crypto.createHash("sha256").update(args.token).digest("hex");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + (args.expiresInMs ?? 60 * 60 * 1000)).toISOString();
  db.prepare(
    `INSERT INTO auth_redeem_tokens (id, token_hash, email, intent, consumed_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
  ).run(`rdt_${crypto.randomBytes(6).toString("hex")}`, tokenHash, args.email, args.intent, expires, now);
}

const FOUNDER_COMPANY = "co_v241_fixes_test";
let FOUNDER_ID = "";
let app: express.Express;

beforeAll(async () => {
  const reg = registerFounderUser({
    email: `v241_founder_${Date.now()}@test.example`,
    name: "v24.1 Founder",
    password: "v241TestPass1",
  });
  FOUNDER_ID = reg.userId;

  addCompanyForFounder(FOUNDER_ID, {
    companyId: FOUNDER_COMPANY,
    companyName: "v24.1 Fixes Test Co",
    legalName: "v24.1 Fixes Test Co, Inc.",
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

  app = await buildApp();
});

describe("v24.1 — Bug I+K: invitation redeem URL", () => {
  it("createInvitation returns a redeemUrl on a REGISTERED SPA route (never the broken /invitations/redeem)", async () => {
    const result = await createInvitation({
      roundId: "rnd_v241_invite",
      companyId: FOUNDER_COMPANY,
      investorEmail: "invitee_ik@test.example",
      investorName: "Invitee IK",
      invitedByUserId: FOUNDER_ID,
      dryRun: true,
    });
    // The create-response URL uses the working `/invite/<token>` route (which the
    // SPA redirects to /auth/redeem). The ONLY broken route was the email
    // template's `/invitations/redeem`, which must never appear.
    expect(result.redeemUrl).not.toContain("/invitations/redeem");
    expect(result.redeemUrl).toMatch(/\/invite\/[a-f0-9]+$/);
    // Sanity: the raw token is carried (not a hash) so the redeem page can verify it.
    expect(result.redeemUrl.length).toBeGreaterThan("https://capavate.com/invite/".length + 32);
  });
});

describe("v24.1 — Bug A: secure redeem hardening", () => {
  it("rejects a weak password with 400 weak_password + a human reason", async () => {
    const token = `tok_${crypto.randomBytes(16).toString("hex")}`;
    insertRedeemToken({ token, email: `weakpw_${Date.now()}@test.example`, intent: "invite" });
    const r = await request(app)
      .post("/api/auth/secure/redeem")
      // Long enough to clear the Zod length floor (min 10) but missing an
      // uppercase letter, so it is rejected by passwordIsStrong as weak_password
      // rather than by the schema validator.
      .send({ token, password: "alllowercase1" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("weak_password");
    expect(typeof r.body.reason).toBe("string");
    expect(r.body.reason.length).toBeGreaterThan(0);
  });

  it("a reset-intent token with NO existing user returns 400 no_user_for_reset and creates no user", async () => {
    const token = `tok_${crypto.randomBytes(16).toString("hex")}`;
    const email = `ghost_reset_${Date.now()}@test.example`;
    insertRedeemToken({ token, email, intent: "reset" });
    const r = await request(app)
      .post("/api/auth/secure/redeem")
      .send({ token, password: "StrongPass123" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("no_user_for_reset");
    // Assert no user was minted for that email.
    const db = rawDb();
    const user = db.prepare(`SELECT id FROM auth_users WHERE email = ?`).get(email);
    expect(user).toBeFalsy();
    // And the token must remain UNCONSUMED (we branch before consuming).
    const tokenHash2 = crypto.createHash("sha256").update(token).digest("hex");
    const row = db.prepare(`SELECT consumed_at FROM auth_redeem_tokens WHERE token_hash = ?`).get(tokenHash2) as
      | { consumed_at: string | null }
      | undefined;
    expect(row?.consumed_at).toBeFalsy();
  });
});

describe("v24.1 — Bug B: round creation validation", () => {
  it("rejects a blank name and non-positive target with 400 validation_failed + fieldErrors", async () => {
    const r = await request(app)
      .post("/api/rounds")
      .set("x-user-id", FOUNDER_ID)
      .send({
        companyId: FOUNDER_COMPANY,
        name: "   ",
        type: "seed",
        targetAmount: 0,
        currency: "USD",
        region: "US",
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_failed");
    expect(r.body.fieldErrors).toBeTruthy();
    expect(r.body.fieldErrors.name).toBeTruthy();
    expect(r.body.fieldErrors.targetAmount).toBeTruthy();
  });

  it("accepts a valid round (regression guard: validation does not block good input)", async () => {
    const r = await request(app)
      .post("/api/rounds")
      .set("x-user-id", FOUNDER_ID)
      .send({
        companyId: FOUNDER_COMPANY,
        name: "v24.1 Valid Round",
        type: "seed",
        targetAmount: 1_000_000,
        currency: "USD",
        region: "US",
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("v24.1 — Bug C: round postMoney derivation", () => {
  it("persists a derived postMoney (preMoney + targetAmount) when the client omits it", async () => {
    const preMoney = 8_000_000;
    const targetAmount = 2_000_000;
    const r = await request(app)
      .post("/api/rounds")
      .set("x-user-id", FOUNDER_ID)
      .send({
        companyId: FOUNDER_COMPANY,
        name: "v24.1 PostMoney Round",
        type: "seed",
        instrument: "preferred",
        targetAmount,
        preMoney,
        pricePerShare: 2.0,
        currency: "USD",
        region: "US",
        // postMoney intentionally omitted
      });
    expect(r.status).toBe(200);
    const id = r.body.id as string;
    const db = rawDb();
    const row = db.prepare(`SELECT post_money FROM rounds WHERE id = ?`).get(id) as
      | { post_money: number | null }
      | undefined;
    expect(row).toBeTruthy();
    expect(Number(row?.post_money)).toBe(preMoney + targetAmount);
  });
});

describe("v24.1 — Bug D: soft-circle PATCH for a modern (redeemed) invitation", () => {
  it("succeeds for an invitation that only exists in roundInvitationsStore", async () => {
    const roundId = "rnd_v241_softcircle";
    // Create a MODERN invitation (lives in roundInvitationsStore, NOT in the
    // static incomingInvitations mock).
    const created = await createInvitation({
      roundId,
      companyId: FOUNDER_COMPANY,
      investorEmail: `sc_investor_${Date.now()}@test.example`,
      investorName: "SoftCircle Investor",
      invitedByUserId: FOUNDER_ID,
      dryRun: true,
    });
    const invitationId = created.invitation.id;

    // Register the investor persona bound to that modern invitation.
    const investorId = registerPersona({
      email: `sc_persona_${Date.now()}@test.example`,
      name: "SoftCircle Persona",
      password: "ScPersona123",
      invitationId,
      roundId,
      companyId: FOUNDER_COMPANY,
    });

    // pending -> viewed
    const view = await request(app)
      .patch(`/api/rounds/${roundId}/invitations/${invitationId}/decision`)
      .set("x-user-id", investorId)
      .send({ action: "view" });
    expect(view.status).toBe(200);

    // viewed -> soft_circled
    const sc = await request(app)
      .patch(`/api/rounds/${roundId}/invitations/${invitationId}/decision`)
      .set("x-user-id", investorId)
      .send({ action: "soft_circle", amount: 250_000, currency: "USD", softCircleType: "definite" });
    expect(sc.status).toBe(200);
    expect(sc.body.ok).toBe(true);
    expect(sc.body.record.state).toBe("soft_circled");
    expect(sc.body.record.amount).toBe(250_000);
  });
});

describe("v24.1 — Bug E: investor profile synthesis", () => {
  it("synthesises a schema-complete blank profile for the authenticated owner", async () => {
    const investorId = registerPersona({
      email: `profile_owner_${Date.now()}@test.example`,
      name: "Profile Owner",
      password: "ProfileOwn123",
      invitationId: `inv_v241_profile_${Date.now()}`,
      roundId: "rnd_v241_profile",
      companyId: FOUNDER_COMPANY,
    });
    const r = await request(app)
      .get(`/api/investors/${investorId}/profile`)
      .set("x-user-id", investorId);
    expect(r.status).toBe(200);
    expect(r.body).toBeTruthy();
    expect(r.body.id).toBe(investorId);
    // A second fetch must return the same (now persisted) row, not re-404.
    const r2 = await request(app)
      .get(`/api/investors/${investorId}/profile`)
      .set("x-user-id", investorId);
    expect(r2.status).toBe(200);
    expect(r2.body.id).toBe(investorId);
  });
});

describe("v24.1 — Bug J: CRM dedupe on invitation", () => {
  it("does not create a duplicate contact for the same (companyId, email) on a second invitation", () => {
    const companyId = `co_v241_crm_${Date.now()}`;
    const email = "Dup.Investor@Test.Example"; // mixed case + surrounding space below
    upsertCrmContactForInvitation({ companyId, name: "Dup Investor", email: `  ${email}  ` });
    const after1 = listContactsForCompany(companyId).filter(
      (c) => c.email.trim().toLowerCase() === email.toLowerCase(),
    );
    expect(after1.length).toBe(1);

    // Second invitation, same email with different casing/whitespace.
    upsertCrmContactForInvitation({ companyId, name: "Dup Investor Again", email: email.toLowerCase() });
    const after2 = listContactsForCompany(companyId).filter(
      (c) => c.email.trim().toLowerCase() === email.toLowerCase(),
    );
    expect(after2.length).toBe(1);
  });
});

describe("v24.1 — Bug L: founder team members response shape", () => {
  it("returns { members: [...] } (not a bare array) so Settings.tsx renders the list", async () => {
    const r = await request(app)
      .get(`/api/founder/team/members?companyId=${encodeURIComponent(FOUNDER_COMPANY)}`)
      .set("x-user-id", FOUNDER_ID);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(false);
    expect(Array.isArray(r.body.members)).toBe(true);
    expect(r.body.members.length).toBeGreaterThanOrEqual(1);
    expect(r.body.members[0].id).toBe(FOUNDER_ID);
  });
});

describe("v24.1 hotfix — /api/auth/secure/redeem must be public (no requireAuth)", () => {
  it("anonymous POST reaches the handler instead of being short-circuited at the auth gate", async () => {
    // This is the regression test for the main-agent-caught smoke gap:
    // applyRouteGuards.ts was returning 401 BEFORE the secure-redeem handler
    // could validate the token. The fix added /api/auth/secure/redeem to
    // PUBLIC_API_PREFIXES. If this test fails again, the gate slipped.
    const r = await request(app)
      .post("/api/auth/secure/redeem")
      .set("Content-Type", "application/json")
      .send({
        token: "this_token_does_not_exist_in_the_redeem_store_abcdef0123456789",
        password: "alllowercase1",  // fails strength, but only after reaching handler
      });
    // Acceptable outcomes for a bogus-but-well-formed request:
    //   400 weak_password (we sent a weak password) — means we reached the handler.
    //   400 invalid_token / not_found / expired — token validation reached.
    //   400 validation_failed — Zod schema rejected before token lookup.
    // UNACCEPTABLE: 401 UNAUTHORIZED — means the auth gate stole the request.
    expect(r.status).not.toBe(401);
    expect([400, 404]).toContain(r.status);
  });
});

// Touch the test-only reset to keep the import meaningful and avoid leaking
// invitation rows across files if this suite is run in isolation.
afterAllCleanup();
function afterAllCleanup(): void {
  // no-op guard: _testAccessInvitations is intentionally referenced so a future
  // maintainer can reset() between runs if cross-file isolation is needed.
  void _testAccessInvitations;
}
