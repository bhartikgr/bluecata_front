/**
 * INDEPENDENT REVIEWER TESTS — slide13b Addendum G (strict invited-identity
 * resolution) and Addendum H (new-identity signup path) at the ONLY caller,
 * POST /api/auth/redeem in server/lib/teamInviteRedeem.ts.
 *
 * Reviewer-owned, additive. No product source, gate, registry or baseline is
 * modified by this file. Fixtures are written straight into the in-memory test
 * DB so each durable-identity SHAPE can be exercised independently of any
 * cache: the contract under test is "what SQL says", not "what a persona map
 * remembers".
 *
 * G — a token holder must never be able to convert an ambiguous, deleted or
 *     partially-persisted identity into either (a) access to someone's existing
 *     account or (b) a brand-new account that shadows it:
 *   G1 users row and credential row disagree on the user id   → 409 INVITED_IDENTITY_AMBIGUOUS
 *   G2 soft-deleted users row                                  → 409 INVITED_IDENTITY_DELETED
 *   G3 credential tombstone only (no live row anywhere)        → 409 INVITED_IDENTITY_DELETED
 *                                                                (refuse, never resurrect)
 *   G4 stored email differs from canonical login's lower(email)
 *      by whitespace only                                      → 409 INVITED_IDENTITY_AMBIGUOUS
 *   G5 live credential-only orphan (no users row)              → treated as an EXISTING
 *                                                                identity (401 sign-in),
 *                                                                never as a new signup;
 *                                                                a session cannot claim it
 *                                                                either (no users row)
 *
 * H — only a genuinely absent identity may sign up through the invitation:
 *   H1 unknown email  → preview new_account; redeem creates the account, mints a
 *                       session, and writes the membership atomically
 *   H2 weak password / missing terms → 400, invitation NOT consumed
 *
 * Every refusal is additionally asserted to leave the invitation pending with no
 * membership rows in either table.
 *
 * Isolation: NODE_ENV=test ⇒ server/db/connection.ts opens ":memory:". No shared
 * DB, no network, no mail, no live access.
 *
 * Run:
 *   cd /home/user/workspace/work && NODE_ENV=test npx vitest run \
 *     server/__tests__/preflight_slide13b_invite_identity_contract_GH.test.ts \
 *     --maxWorkers=1
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import crypto from "node:crypto";
import { rawDb } from "../db/connection";

let app: express.Express;
let companyId = "";

async function buildApp(): Promise<express.Express> {
  const a = express();
  a.use(express.json());
  // Mirror of the production inline cookie parser (server/index.ts, Sprint 26);
  // registerRoutes() does not install it.
  a.use((req, _res, next) => {
    const r = req as express.Request & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) {
            try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
          }
        }
      }
      r.cookies = out;
    }
    next();
  });
  const server = http.createServer(a);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, a);
  return a;
}

function db(): any {
  return rawDb();
}

function seedCompany(id: string): void {
  db()
    .prepare(
      `INSERT INTO companies (id, tenant_id, name, legal_name, is_demo)
         VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO NOTHING`,
    )
    .run(id, `tenant_co_${id}`, "GH Contract Co", "GH Contract Co Ltd");
}

function seedInvite(email: string, role = "owner"): { id: string; raw: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const id = `fti_gh_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  db()
    .prepare(
      `INSERT INTO founder_team_invitations
         (id, company_id, invited_by_user_id, invited_email, invited_name, role, status, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(id, companyId, "u_partner_actor_gh", email, "GH Invitee", role, tokenHash, expires, now);
  return { id, raw };
}

function insertUser(id: string, email: string, deletedAt: string | null = null): void {
  db()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
         VALUES (?, ?, ?, ?, 'founder', 0, ?)`,
    )
    .run(id, `tenant_${id}`, email, "GH Fixture", deletedAt);
}

function insertCredential(userId: string, email: string, deletedAt: string | null = null): void {
  db()
    .prepare(
      `INSERT INTO user_credentials (user_id, email, name, password_hash, created_at, updated_at, deleted_at)
         VALUES (?, ?, 'GH Fixture', ?, ?, ?, ?)`,
    )
    .run(userId, email, `fixture$${crypto.randomBytes(8).toString("hex")}`, new Date().toISOString(), new Date().toISOString(), deletedAt);
}

function inviteStatus(id: string): { status: string; accepted_at: string | null } {
  return db()
    .prepare(`SELECT status, accepted_at FROM founder_team_invitations WHERE id = ?`)
    .get(id) as any;
}

function membershipRows(email: string): number {
  // Count by EMAIL-independent user ids: any row for this company tied to any of
  // the fixture ids for that email. Counting per-table keeps a missing table
  // visible instead of reporting a comfortable zero.
  const ids = new Set<string>();
  for (const r of db().prepare(`SELECT id FROM users WHERE lower(email) = ?`).all(email.toLowerCase()) as any[]) ids.add(r.id);
  for (const r of db().prepare(`SELECT user_id AS id FROM user_credentials WHERE lower(email) = ?`).all(email.toLowerCase()) as any[]) ids.add(r.id);
  let n = 0;
  for (const t of ["company_members", "founder_team_members"]) {
    for (const id of ids) {
      const r = db().prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE company_id = ? AND user_id = ?`).get(companyId, id) as any;
      n += Number(r?.c ?? 0);
    }
  }
  return n;
}

async function redeem(token: string, body: Record<string, unknown> = {}) {
  return request(app).post("/api/auth/redeem").send({ token, agreedToTerms: true, ...body });
}

function cookieNamesOf(res: request.Response): string[] {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => String(c).split("=")[0]);
}

/** Asserts a refusal had no durable effect whatsoever. */
function expectNothingHappened(inviteId: string, email: string, res: request.Response): void {
  const inv = inviteStatus(inviteId);
  expect(inv.status).toBe("pending");
  expect(inv.accepted_at ?? null).toBeNull();
  expect(membershipRows(email)).toBe(0);
  expect(cookieNamesOf(res).some((n) => n.includes("cap_uid"))).toBe(false);
  expect(res.body?.ctx).toBeUndefined();
}

describe("slide13b G/H — strict invited-identity contract at POST /api/auth/redeem", () => {
  beforeAll(async () => {
    app = await buildApp();
    companyId = `co_gh_${crypto.randomBytes(4).toString("hex")}`;
    seedCompany(companyId);
  });

  it("G1: a users row and a credential row naming DIFFERENT ids is ambiguous, never a pick-one", async () => {
    const email = `gh1_${crypto.randomBytes(4).toString("hex")}@test.example`;
    insertUser(`u_gh1_a_${crypto.randomBytes(3).toString("hex")}`, email);
    insertCredential(`u_gh1_b_${crypto.randomBytes(3).toString("hex")}`, email);
    const inv = seedInvite(email);

    const res = await redeem(inv.raw, { password: `Arb-${crypto.randomBytes(6).toString("hex")}` });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("INVITED_IDENTITY_AMBIGUOUS");
    expectNothingHappened(inv.id, email, res);

    // The preview must refuse identically — it must not leak a chosen identity.
    const prev = await request(app).get(`/api/auth/redeem/preview?token=${encodeURIComponent(inv.raw)}`);
    expect(prev.status).toBe(409);
    expect(prev.body?.error).toBe("INVITED_IDENTITY_AMBIGUOUS");
  });

  it("G2: a soft-deleted users row is refused as deleted, not treated as absent", async () => {
    const email = `gh2_${crypto.randomBytes(4).toString("hex")}@test.example`;
    const uid = `u_gh2_${crypto.randomBytes(3).toString("hex")}`;
    insertUser(uid, email, new Date().toISOString());
    insertCredential(uid, email);
    const inv = seedInvite(email);

    const res = await redeem(inv.raw, { password: `Arb-${crypto.randomBytes(6).toString("hex")}` });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("INVITED_IDENTITY_DELETED");
    expectNothingHappened(inv.id, email, res);
  });

  it("G3: a credential tombstone alone is refused — no resurrection and no shadow signup", async () => {
    const email = `gh3_${crypto.randomBytes(4).toString("hex")}@test.example`;
    insertCredential(`u_gh3_${crypto.randomBytes(3).toString("hex")}`, email, new Date().toISOString());
    const inv = seedInvite(email);

    const res = await redeem(inv.raw, { password: `Arb-${crypto.randomBytes(6).toString("hex")}` });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("INVITED_IDENTITY_DELETED");
    expectNothingHappened(inv.id, email, res);
    // Critically: no NEW live credential row was minted for that email.
    const live = db()
      .prepare(`SELECT COUNT(*) AS c FROM user_credentials WHERE lower(email) = ? AND deleted_at IS NULL`)
      .get(email.toLowerCase()) as any;
    expect(Number(live?.c ?? 0)).toBe(0);
  });

  it("G4: a stored email that differs from canonical lower(email) by whitespace is a conflict", async () => {
    const core = `gh4_${crypto.randomBytes(4).toString("hex")}@test.example`;
    const uid = `u_gh4_${crypto.randomBytes(3).toString("hex")}`;
    insertUser(uid, `  ${core} `); // trim-only divergence from what login matches
    insertCredential(uid, `  ${core} `);
    const inv = seedInvite(core);

    const res = await redeem(inv.raw, { password: `Arb-${crypto.randomBytes(6).toString("hex")}` });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("INVITED_IDENTITY_AMBIGUOUS");
    const invRow = inviteStatus(inv.id);
    expect(invRow.status).toBe("pending");
    expect(cookieNamesOf(res).some((n) => n.includes("cap_uid"))).toBe(false);
  });

  it("G5: a live credential-only orphan is an EXISTING identity (401 sign-in), never a new signup", async () => {
    const email = `gh5_${crypto.randomBytes(4).toString("hex")}@test.example`;
    const uid = `u_gh5_${crypto.randomBytes(3).toString("hex")}`;
    insertCredential(uid, email); // no users row, no auth_users row
    const inv = seedInvite(email);

    const prev = await request(app).get(`/api/auth/redeem/preview?token=${encodeURIComponent(inv.raw)}`);
    expect(prev.status).toBe(200);
    expect(prev.body?.existingAccount).toBe(true);
    expect(prev.body?.sessionState).toBe("sign_in_required");

    const res = await redeem(inv.raw, { password: `Arb-${crypto.randomBytes(6).toString("hex")}` });
    expect(res.status).toBe(401);
    expect(res.body?.error).toBe("SIGN_IN_REQUIRED_TO_ACCEPT");
    expectNothingHappened(inv.id, email, res);
    // And the orphan was NOT completed into a user behind the scenes.
    const u = db().prepare(`SELECT COUNT(*) AS c FROM users WHERE lower(email) = ?`).get(email.toLowerCase()) as any;
    expect(Number(u?.c ?? 0)).toBe(0);
  });

  it("H2: a weak password or unaccepted terms is rejected and consumes nothing", async () => {
    const email = `gh6_${crypto.randomBytes(4).toString("hex")}@test.example`;
    const inv = seedInvite(email);

    const weak = await redeem(inv.raw, { password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body?.error).toBe("WEAK_PASSWORD");
    expectNothingHappened(inv.id, email, weak);

    const noTerms = await redeem(inv.raw, {
      password: `Good-${crypto.randomBytes(6).toString("hex")}`,
      agreedToTerms: false,
    });
    expect(noTerms.status).toBe(400);
    expect(noTerms.body?.error).toBe("TERMS_NOT_ACCEPTED");
    expectNothingHappened(inv.id, email, noTerms);

    // No identity was created by either rejected attempt.
    const rows = db()
      .prepare(`SELECT COUNT(*) AS c FROM user_credentials WHERE lower(email) = ?`)
      .get(email.toLowerCase()) as any;
    expect(Number(rows?.c ?? 0)).toBe(0);
  });

  it("H1: a genuinely absent identity signs up, gets a session, and is granted membership atomically", async () => {
    const email = `gh7_${crypto.randomBytes(4).toString("hex")}@test.example`;
    const inv = seedInvite(email);

    const prev = await request(app).get(`/api/auth/redeem/preview?token=${encodeURIComponent(inv.raw)}`);
    expect(prev.status).toBe(200);
    expect(prev.body?.existingAccount).toBe(false);
    expect(prev.body?.sessionState).toBe("new_account");

    const res = await redeem(inv.raw, { password: `Good-${crypto.randomBytes(8).toString("hex")}` });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.kind).toBe("team");
    expect(res.body?.companyId).toBe(companyId);
    // A brand-new identity DOES get a session here (nothing to preserve).
    expect(cookieNamesOf(res).some((n) => n.includes("cap_uid"))).toBe(true);

    const invRow = inviteStatus(inv.id);
    expect(invRow.status).toBe("accepted");
    expect(invRow.accepted_at).toBeTruthy();

    const cred = db()
      .prepare(`SELECT user_id FROM user_credentials WHERE lower(email) = ? AND deleted_at IS NULL`)
      .get(email.toLowerCase()) as any;
    expect(cred?.user_id).toBeTruthy();
    const user = db()
      .prepare(`SELECT id FROM users WHERE id = ? AND deleted_at IS NULL`)
      .get(cred.user_id) as any;
    expect(user?.id, "the accepted identity must be durable in users, not cache-only").toBe(cred.user_id);
    const cm = db()
      .prepare(`SELECT role, is_active FROM company_members WHERE company_id = ? AND user_id = ?`)
      .get(companyId, cred.user_id) as any;
    expect(cm?.role).toBe("co_founder");
    expect(Number(cm?.is_active)).toBe(1);
  });
});
