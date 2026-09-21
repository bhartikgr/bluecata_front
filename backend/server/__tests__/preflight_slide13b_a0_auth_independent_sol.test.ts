/**
 * Independent A0 post-build proof.
 *
 * Scope: real in-memory SQLite + Express HTTP, no external traffic or mail.
 * This file is additive test evidence only; it does not alter product source.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { registerTeamInviteRedeemRoutes } from "../lib/teamInviteRedeem";
import { registerFounderTeamRoutes } from "../lib/founderTeamStore";
import { signSessionValue } from "../lib/sessionCookie";

const app = express();
const db: any = rawDb();
const unique = () => randomBytes(8).toString("hex");
const emailFor = () => `sol_a0_${unique()}@test.example`;
const isoNow = () => new Date().toISOString();
const signedCookie = (userId: string) => `cap_uid=${signSessionValue(userId)}`;

function insertUser(email: string, id = `usr_sol_${unique()}`, deletedAt: string | null = null) {
  db.prepare(
    "INSERT INTO users (id,tenant_id,email,name,role,deleted_at) VALUES (?,?,?,?,?,?)",
  ).run(id, `tenant_${id}`, email, "Independent A0", "founder", deletedAt);
  return id;
}

function insertAuth(email: string, id = `usr_sol_${unique()}`, status = "active") {
  db.prepare(
    "INSERT INTO auth_users (id,email,password_hash,role,status,created_at) VALUES (?,?,?,'founder',?,?)",
  ).run(id, email, "auth-hash-must-not-change", status, isoNow());
  return id;
}

function insertCredential(email: string, id = `usr_sol_${unique()}`, deletedAt: string | null = null) {
  db.prepare(
    "INSERT INTO user_credentials (user_id,email,password_hash,deleted_at) VALUES (?,?,?,?)",
  ).run(id, email, "credential-hash-must-not-change", deletedAt);
  return id;
}

function insertCompleteIdentity(email: string) {
  const id = insertUser(email);
  insertAuth(email, id);
  insertCredential(email, id);
  return id;
}

function insertInvite(email: string) {
  const companyId = `co_sol_${unique()}`;
  const invitationId = `fti_sol_${unique()}`;
  const token = `tok_${unique()}_${unique()}`;
  db.prepare("INSERT INTO companies (id,tenant_id,name,legal_name) VALUES (?,?,?,?)")
    .run(companyId, `tenant_${companyId}`, "Independent A0 Company", "Independent A0 Company Ltd");
  db.prepare(`INSERT INTO founder_team_invitations
    (id,company_id,invited_by_user_id,invited_email,invited_name,role,status,token_hash,expires_at,created_at)
    VALUES (?,?, 'partner_sol',?, 'Independent Invitee','owner','pending',?,?,?)`)
    .run(
      invitationId,
      companyId,
      email,
      createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 86_400_000).toISOString(),
      isoNow(),
    );
  return { companyId, invitationId, token, email };
}

type Invite = ReturnType<typeof insertInvite>;

function payload(invite: Invite) {
  return { token: invite.token, agreedToTerms: true };
}

function assertNoGrant(invite: Invite, response: request.Response) {
  expect(response.headers["set-cookie"]).toBeUndefined();
  expect(
    db.prepare("SELECT status,accepted_at FROM founder_team_invitations WHERE id=?")
      .get(invite.invitationId),
  ).toEqual({ status: "pending", accepted_at: null });
  expect(
    db.prepare("SELECT count(*) AS n FROM company_members WHERE company_id=?")
      .get(invite.companyId),
  ).toEqual({ n: 0 });
  expect(
    db.prepare("SELECT count(*) AS n FROM founder_team_members WHERE company_id=?")
      .get(invite.companyId),
  ).toEqual({ n: 0 });
}

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(process.env.SMTP_MODE).toBe("dry_run");
  expect(db.prepare("PRAGMA database_list").all().every((row: any) => !row.file)).toBe(true);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).cookies = Object.fromEntries(
      String(req.headers.cookie ?? "")
        .split(";")
        .filter(Boolean)
        .map((part) => {
          const split = part.indexOf("=");
          return [part.slice(0, split).trim(), decodeURIComponent(part.slice(split + 1))];
        }),
    );
    next();
  });
  registerFounderTeamRoutes(app);
  registerTeamInviteRedeemRoutes(app);
  app.get("/api/auth/redeem/preview", (_req, res) => res.status(418).json({ downstream: true }));
  app.post("/api/auth/redeem", (_req, res) => res.status(418).json({ downstream: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("slide13b A0 independent DB/HTTP authentication proof", () => {
  it("does not accept an arbitrary password for an existing durable identity", async () => {
    const email = emailFor();
    const userId = insertCompleteIdentity(email);
    const invite = insertInvite(email);
    const before = db.prepare("SELECT password_hash FROM user_credentials WHERE user_id=?").get(userId);

    const response = await request(app)
      .post("/api/auth/redeem")
      .send({ ...payload(invite), password: "Attacker-supplied-password" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("SIGN_IN_REQUIRED_TO_ACCEPT");
    expect(response.body.returnTo).toBe(
      `/auth/redeem?token=${encodeURIComponent(invite.token)}&continue=1`,
    );
    expect(db.prepare("SELECT password_hash FROM user_credentials WHERE user_id=?").get(userId))
      .toEqual(before);
    assertNoGrant(invite, response);
  });

  it("revalidates identity inside the claim transaction and rolls back after a deletion race", async () => {
    const email = emailFor();
    const userId = insertCompleteIdentity(email);
    const invite = insertInvite(email);
    const originalPrepare = db.prepare.bind(db);
    let injected = false;
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      if (!injected && String(sql).includes("SELECT 1 FROM company_members")) {
        injected = true;
        originalPrepare("UPDATE users SET deleted_at=? WHERE id=?").run(isoNow(), userId);
      }
      return originalPrepare(sql);
    });

    const response = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", signedCookie(userId))
      .send(payload(invite));

    expect(injected).toBe(true);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("INVITED_IDENTITY_DELETED");
    vi.restoreAllMocks();
    assertNoGrant(invite, response);
  });

  it("refuses an auth_users-only orphan even with its matching signed session", async () => {
    const email = emailFor();
    const userId = insertAuth(email);
    const invite = insertInvite(email);

    const response = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", signedCookie(userId))
      .send(payload(invite));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("INVITED_IDENTITY_INCOMPLETE");
    assertNoGrant(invite, response);
  });

  it("refuses a credential-only orphan even with its matching signed session", async () => {
    const email = emailFor();
    const userId = insertCredential(email);
    const invite = insertInvite(email);
    const before = db.prepare("SELECT password_hash FROM user_credentials WHERE user_id=?").get(userId);

    const response = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", signedCookie(userId))
      .send(payload(invite));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("INVITED_IDENTITY_INCOMPLETE");
    expect(db.prepare("SELECT password_hash FROM user_credentials WHERE user_id=?").get(userId))
      .toEqual(before);
    assertNoGrant(invite, response);
  });

  it("treats a credential tombstone as deleted, never as new-account eligibility", async () => {
    const email = emailFor();
    insertCredential(email, undefined, isoNow());
    const invite = insertInvite(email);

    const response = await request(app)
      .post("/api/auth/redeem")
      .send({ ...payload(invite), password: "Would-be-new-password" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("INVITED_IDENTITY_DELETED");
    expect(db.prepare("SELECT count(*) AS n FROM users WHERE lower(email)=?").get(email))
      .toEqual({ n: 0 });
    assertNoGrant(invite, response);
  });

  it("rejects a raw user-id cookie when development fallback is enabled", async () => {
    vi.stubEnv("STRICT_SESSION_COOKIE", "0");
    const email = emailFor();
    const userId = insertCompleteIdentity(email);
    const invite = insertInvite(email);

    const response = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", `cap_uid=${userId}`)
      .send(payload(invite));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("SIGN_IN_REQUIRED_TO_ACCEPT");
    assertNoGrant(invite, response);
  });

  it("accepts the same SSO identity with a signed session and creates no credential", async () => {
    const email = emailFor();
    const userId = insertUser(email);
    insertAuth(email, userId);
    const invite = insertInvite(email);

    const response = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", signedCookie(userId))
      .send(payload(invite));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.companyId).toBe(invite.companyId);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(
      db.prepare("SELECT status,accepted_at FROM founder_team_invitations WHERE id=?")
        .get(invite.invitationId),
    ).toMatchObject({ status: "accepted" });
    expect(
      db.prepare("SELECT user_id,company_id FROM company_members WHERE company_id=?")
        .get(invite.companyId),
    ).toEqual({ user_id: userId, company_id: invite.companyId });
    expect(
      db.prepare("SELECT user_id,company_id FROM founder_team_members WHERE company_id=?")
        .get(invite.companyId),
    ).toEqual({ user_id: userId, company_id: invite.companyId });
    expect(
      db.prepare("SELECT count(*) AS n FROM user_credentials WHERE user_id=?").get(userId),
    ).toEqual({ n: 0 });
  });
});
