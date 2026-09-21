/**
 * A0: real in-memory SQLite + Express HTTP. No external traffic/mail/shared DB.
 * Fault injection is SQL triggers or a narrowly targeted prepare failure;
 * signup, resolver, cookies, status gate and membership writes are real.
 */
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomBytes, createHash } from "node:crypto";
import { rawDb } from "../db/connection";
import { registerTeamInviteRedeemRoutes } from "../lib/teamInviteRedeem";
import { registerFounderTeamRoutes } from "../lib/founderTeamStore";
import { resolveInvitedIdentityStrict } from "../lib/inviteIdentityResolver";
import * as identityResolver from "../lib/inviteIdentityResolver";
import * as personas from "../lib/userContext";
import { signSessionValue } from "../lib/sessionCookie";
import { revokeSession, _resetRevocation } from "../lib/sessionRevocation";
import { lookupByEmail } from "../userCredentialsStore";
import { registerAuthShellRoutes } from "../lib/authRoutes";
import { registerMfaRoutes } from "../lib/mfaRoutes";
import { beginEnrolment, confirmEnrolment, setPolicyMode, mfaChallengeRequired } from "../lib/mfaStore";
import { totpCodeForStep, totpStepForTime } from "../lib/mfaTotp";

const app = express();
const db = rawDb();
const unique = () => randomBytes(7).toString("hex");
const password = () => `Fixture-${unique()}`;
const emailFor = () => `a0_${unique()}@test.example`;
const now = () => new Date().toISOString();
const cookie = (id: string) => `cap_uid=${signSessionValue(id)}`;

function user(email: string, id = `a0_${unique()}`, deleted: string | null = null, role = "founder") {
  db.prepare("INSERT INTO users (id,tenant_id,email,name,role,deleted_at) VALUES (?,?,?,?,?,?)")
    .run(id, `tenant_${id}`, email, "A0 User", role, deleted);
  return id;
}
function auth(email: string, id = `a0_${unique()}`, status = "active") {
  db.prepare("INSERT INTO auth_users (id,email,password_hash,role,status,created_at) VALUES (?,?,?,'founder',?,?)")
    .run(id, email, "fixture-not-a-password", status, now());
  return id;
}
function cred(email: string, id = `a0_${unique()}`, deleted: string | null = null) {
  db.prepare("INSERT INTO user_credentials (user_id,email,password_hash,deleted_at) VALUES (?,?,?,?)")
    .run(id, email, "fixture-not-a-password", deleted);
  return id;
}
function signup(email = emailFor()) {
  const pw = password();
  const result = personas.registerFounderUser({ email, name: "A0 Owner", password: pw });
  expect(result.alreadyExisted).toBe(false);
  expect(resolveInvitedIdentityStrict(email)).toEqual({ kind: "single", userId: result.userId });
  return { email, id: result.userId, password: pw };
}
function invite(email: string) {
  const company = `co_a0_${unique()}`, id = `fti_a0_${unique()}`, token = unique() + unique();
  db.prepare("INSERT INTO companies (id,tenant_id,name,legal_name) VALUES (?,?,?,?)")
    .run(company, `tenant_${company}`, "A0 Company", "A0 Company Ltd");
  db.prepare(`INSERT INTO founder_team_invitations
    (id,company_id,invited_by_user_id,invited_email,invited_name,role,status,token_hash,expires_at,created_at)
    VALUES (?,?, 'partner_a0',?, 'A0 Owner','owner','pending',?,?,?)`)
    .run(id, company, email, createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 86400000).toISOString(), now());
  return { company, id, token, email };
}
type Invite = ReturnType<typeof invite>;
function pending(inv: Invite, res: request.Response) {
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(db.prepare("SELECT status,accepted_at FROM founder_team_invitations WHERE id=?").get(inv.id))
    .toEqual({ status: "pending", accepted_at: null });
  for (const table of ["company_members", "founder_team_members"]) {
    expect(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE company_id=?`).get(inv.company)).toEqual({ n: 0 });
  }
}
const post = (inv: Invite) => request(app).post("/api/auth/redeem");
const body = (inv: Invite) => ({ token: inv.token, agreedToTerms: true });
function failRead(fragment: string) {
  const original = db.prepare.bind(db);
  vi.spyOn(db, "prepare").mockImplementation((sql: any) => {
    if (String(sql).includes(fragment)) throw new Error("isolated fixture read failure");
    return original(sql);
  });
}

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(process.env.SMTP_MODE).toBe("dry_run");
  expect(db.prepare("PRAGMA database_list").all().every((r: any) => !r.file)).toBe(true);
  app.use(express.json());
  // Same unsigned-cookie shape consumed by the production bootstrap. Parsing
  // is transport only; the real shared verifier must authenticate the value.
  app.use((req, _res, next) => {
    (req as any).cookies = Object.fromEntries(
      String(req.headers.cookie ?? "").split(";").filter(Boolean).map(part => {
        const at = part.indexOf("=");
        return [part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1))];
      }),
    );
    next();
  });
  registerTeamInviteRedeemRoutes(app);
  registerFounderTeamRoutes(app);
  app.get("/api/auth/redeem/preview", (_req, res) => res.status(418).json({ downstream: "investor-preview" }));
  app.post("/api/auth/redeem", (req, res) => res.status(418).json({ downstream: "investor-redeem", body: req.body }));
  registerAuthShellRoutes(app, {
    preview: () => ({ ok: false, reason: "not_found" }),
    redeem: () => ({ ok: false, reason: "not_found" }),
  });
  registerMfaRoutes(app);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  _resetRevocation();
  for (const trigger of ["a0_users_fail", "a0_creds_fail", "a0_member_fail"]) db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
});

describe("A0 durable identity resolution (all sources, never first row)", () => {
  it("genuine none; a credential tombstone is not signup eligibility (H3-b, review hardening)", async () => {
    const email = emailFor();
    expect(resolveInvitedIdentityStrict(email)).toEqual({ kind: "none" });
    cred(email, undefined, now());
    expect(resolveInvitedIdentityStrict(email)).toEqual({ kind: "deleted" });
    const inv = invite(email);
    const res = await post(inv).send({ ...body(inv), password: password() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVITED_IDENTITY_DELETED");
    pending(inv, res);
  });
  it.each(["users", "auth_users", "user_credentials"])("passwordless/independent %s persistence is existing", (table) => {
    const email = emailFor();
    const id = table === "users" ? user(email) : table === "auth_users" ? auth(email) : cred(email);
    expect(resolveInvitedIdentityStrict(` ${email.toUpperCase()} `)).toEqual({ kind: "single", userId: id });
  });
  it.each(["users", "auth_users", "user_credentials"])("enumerates case-variant duplicate IDs in %s", async (table) => {
    const email = emailFor(), inv = invite(email);
    const insert = table === "users" ? user : table === "auth_users" ? auth : cred;
    insert(email);
    insert(email.toUpperCase());
    expect(resolveInvitedIdentityStrict(email)).toEqual({ kind: "ambiguous" });
    const res = await post(inv).send({ ...body(inv), password: password() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVITED_IDENTITY_AMBIGUOUS");
    expect(res.body.candidates).toBeUndefined();
    pending(inv, res);
  });
  it.each(["users", "auth_users", "user_credentials"])("trim-only stored %s email is a conflict, never signup/login-loop", async table => {
    const email = emailFor(), inv = invite(email);
    const insert = table === "users" ? user : table === "auth_users" ? auth : cred;
    insert(` ${email} `);
    const res = await post(inv).send({ ...body(inv), password: password() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVITED_IDENTITY_AMBIGUOUS");
    pending(inv, res);
  });
  it("cross-store disagreement cannot choose auth_users over credentials", async () => {
    const email = emailFor(), inv = invite(email);
    auth(email); cred(email);
    const res = await post(inv).send(body(inv));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVITED_IDENTITY_AMBIGUOUS");
    pending(inv, res);
  });
  it("same exact ID in all three sources remains unambiguous", () => {
    const email = emailFor(), id = user(email);
    auth(email.toUpperCase(), id); cred(email, id);
    expect(resolveInvitedIdentityStrict(email)).toEqual({ kind: "single", userId: id });
  });
  it("soft-deleted users case variant blocks signup and never consumes the token", async () => {
    const email = emailFor(), inv = invite(email);
    user(email.toUpperCase(), undefined, now());
    const res = await post(inv).send({ ...body(inv), password: password() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVITED_IDENTITY_DELETED");
    pending(inv, res);
  });
  it.each(["FROM users WHERE lower", "FROM auth_users WHERE lower", "FROM user_credentials WHERE lower"])(
    "unavailable source %s gives 503, never none", async fragment => {
      const inv = invite(emailFor());
      failRead(fragment);
      expect(resolveInvitedIdentityStrict(inv.email)).toEqual({ kind: "unavailable" });
      const res = await post(inv).send({ ...body(inv), password: password() });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("ACCOUNT_RESOLUTION_UNAVAILABLE");
      vi.restoreAllMocks();
      pending(inv, res);
    },
  );
});

describe("A0 existing accounts: canonical signed session only", () => {
  it("arbitrary password/no cookie is 401 with unchanged credentials and no signup/password verification", async () => {
    const account = signup(), inv = invite(account.email);
    const hash = db.prepare("SELECT password_hash FROM user_credentials WHERE user_id=?").get(account.id);
    const register = vi.spyOn(personas, "registerFounderUser");
    const verify = vi.spyOn(personas, "verifyPassword");
    const res = await post(inv).send({ ...body(inv), password: password(), userId: account.id, email: account.email });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("SIGN_IN_REQUIRED_TO_ACCEPT");
    expect(res.body.returnTo).toBe(`/auth/redeem?token=${encodeURIComponent(inv.token)}&continue=1`);
    expect(register).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(db.prepare("SELECT password_hash FROM user_credentials WHERE user_id=?").get(account.id)).toEqual(hash);
    pending(inv, res);
  });
  it.each(["header", "query", "demo", "raw-cookie", "forged-cookie", "expired-cookie"])(
    "rejects %s bypass even in test/development fallback configuration", async kind => {
      const account = signup(), inv = invite(account.email);
      vi.stubEnv("STRICT_SESSION_COOKIE", "0");
      let req = post(inv);
      if (kind === "header") req = req.set("x-user-id", account.id);
      if (kind === "query") req = req.query({ userId: account.id });
      if (kind === "demo") req = req.query({ as: "founder" });
      if (kind === "raw-cookie") req = req.set("Cookie", `cap_uid=${account.id}`);
      if (kind === "forged-cookie") req = req.set("Cookie", `${cookie(account.id)}forged`);
      if (kind === "expired-cookie") {
        const realNow = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(realNow - 5 * 3600000);
        const expired = cookie(account.id);
        vi.restoreAllMocks();
        req = req.set("Cookie", expired);
      }
      const res = await req.send(body(inv));
      expect(res.status).toBe(401);
      pending(inv, res);
    },
  );
  it("wrong signed identity is 403, not signup and not an expired token", async () => {
    const account = signup(), inv = invite(account.email);
    const res = await post(inv).set("Cookie", cookie(user(emailFor()))).send(body(inv));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("SESSION_IDENTITY_MISMATCH");
    pending(inv, res);
  });
  it("revoked signed identity is 401", async () => {
    const account = signup(), inv = invite(account.email);
    revokeSession(account.id);
    const res = await post(inv).set("Cookie", cookie(account.id)).send(body(inv));
    expect(res.status).toBe(401);
    pending(inv, res);
  });
  it.each(["suspended", "inactive", "archived", "disabled"])("status %s blocks the matching signed identity", async status => {
    const email = emailFor(), id = user(email), inv = invite(email);
    auth(email, id, status);
    const res = await post(inv).set("Cookie", cookie(id)).send(body(inv));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("ACCOUNT_NOT_ACTIVE");
    pending(inv, res);
  });
  it("status read error fails closed separately from identity lookup", async () => {
    const account = signup(), inv = invite(account.email);
    failRead("SELECT status FROM auth_users WHERE id");
    const res = await post(inv).set("Cookie", cookie(account.id)).send(body(inv));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ACCOUNT_STATUS_UNAVAILABLE");
    vi.restoreAllMocks();
    pending(inv, res);
  });
  it("matching session accepts without password, preserves credential hash and never renews cookie", async () => {
    const account = signup(), inv = invite(account.email);
    const hash = db.prepare("SELECT password_hash FROM user_credentials WHERE user_id=?").get(account.id);
    // Independent partner affiliation: no scalar-role exclusion on founder claim.
    db.prepare(`INSERT INTO company_members (id,user_id,role,tenant_id,consortium_partner_id)
      VALUES (?,?,'admin',?,'partner_a0')`).run(`cm_${unique()}`, account.id, "tenant_partner_a0");
    const res = await post(inv).set("Cookie", cookie(account.id)).send(body(inv));
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body.ctx.userId).toBe(account.id);
    expect(db.prepare("SELECT password_hash FROM user_credentials WHERE user_id=?").get(account.id)).toEqual(hash);
    expect(db.prepare("SELECT status FROM founder_team_invitations WHERE id=?").get(inv.id)).toEqual({ status: "accepted" });
    expect(db.prepare("SELECT user_id,role FROM company_members WHERE company_id=?").get(inv.company))
      .toEqual({ user_id: account.id, role: "co_founder" });
    expect(db.prepare("SELECT user_id FROM founder_team_members WHERE company_id=?").get(inv.company))
      .toEqual({ user_id: account.id });
  });
  it("MFA-enrolled user cannot turn an invitation/password into a session", async () => {
    const account = signup(), inv = invite(account.email);
    expect(setPolicyMode("enrolled_only", account.id, Date.now()).ok).toBe(true);
    const enrollment = beginEnrolment(account.id);
    expect(enrollment.ok).toBe(true);
    if (!enrollment.ok) throw new Error("fixture enrollment failed");
    const step = totpStepForTime(Date.now());
    expect(confirmEnrolment(account.id, totpCodeForStep(enrollment.secret, step)!, Date.now()).ok).toBe(true);
    expect(mfaChallengeRequired(account.id).required).toBe(true);
    const login = await request(app).post("/api/auth/login").send({ email: account.email, password: account.password });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.headers["set-cookie"]).toBeUndefined();
    const res = await post(inv).send({ ...body(inv), password: password(), mfaVerified: true });
    expect(res.status).toBe(401);
    expect(res.body.stepUpToken).toBeUndefined();
    pending(inv, res);
    // Only the canonical MFA challenge completes authentication. Redemption
    // neither consumes the step-up token nor issues/renews the resulting cookie.
    const challenge = await request(app).post("/api/auth/login/mfa").send({
      token: login.body.mfaToken,
      code: totpCodeForStep(enrollment.secret, step + 1),
    });
    expect(challenge.status).toBe(200);
    const session = (challenge.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    const accepted = await post(inv).set("Cookie", session).send(body(inv));
    expect(accepted.status).toBe(200);
    expect(accepted.headers["set-cookie"]).toBeUndefined();
    expect(accepted.body.ctx.userId).toBe(account.id);
  });
  it("persisted passwordless account is never sent into signup", async () => {
    const email = emailFor(), id = user(email), inv = invite(email);
    const register = vi.spyOn(personas, "registerFounderUser");
    const res = await post(inv).send({ ...body(inv), password: password() });
    expect(res.status).toBe(401);
    expect(register).not.toHaveBeenCalled();
    expect(db.prepare("SELECT user_id FROM user_credentials WHERE user_id=?").get(id)).toBeUndefined();
    pending(inv, res);
  });
  it.each(["auth", "credential"])("%s-only orphan is existing but cannot claim without an exact live users row", async source => {
    const email = emailFor(), id = source === "auth" ? auth(email) : cred(email), inv = invite(email);
    const res = await post(inv).set("Cookie", cookie(id)).send(body(inv));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVITED_IDENTITY_INCOMPLETE");
    pending(inv, res);
  });
  it("passwordless live users row may claim through its canonical signed session", async () => {
    const email = emailFor(), id = user(email), inv = invite(email);
    const res = await post(inv).set("Cookie", cookie(id)).send(body(inv));
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(db.prepare("SELECT user_id FROM user_credentials WHERE user_id=?").get(id)).toBeUndefined();
    expect(db.prepare("SELECT user_id FROM company_members WHERE company_id=?").get(inv.company)).toEqual({ user_id: id });
  });
  it("real canonical login cookie is sufficient even when no credential row remains at claim", async () => {
    const account = signup(), inv = invite(account.email);
    const login = await request(app).post("/api/auth/login").send({ email: account.email, password: account.password });
    expect(login.status).toBe(200);
    const session = (login.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    db.prepare("DELETE FROM user_credentials WHERE user_id=?").run(account.id);
    const res = await post(inv).set("Cookie", session).send(body(inv));
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body.ctx.userId).toBe(account.id);
    expect(db.prepare("SELECT user_id FROM user_credentials WHERE user_id=?").get(account.id)).toBeUndefined();
  });
  it("requires literal explicit terms even with a matching session", async () => {
    const account = signup(), inv = invite(account.email);
    for (const agreedToTerms of [undefined, false, "true"]) {
      const res = await post(inv).set("Cookie", cookie(account.id)).send({ token: inv.token, agreedToTerms });
      expect(res.status).toBe(400);
      pending(inv, res);
    }
  });
});

describe("A0 preview, durable signup, rollback and preserved routing", () => {
  it("token-gated preview tells team UI existingAccount and session state without consuming", async () => {
    const account = signup(), inv = invite(account.email);
    for (const [session, state] of [[null, "sign_in_required"], [account.id, "matching"], [user(emailFor()), "mismatch"]]) {
      let req = request(app).get("/api/auth/redeem/preview").query({ token: inv.token });
      if (session) req = req.set("Cookie", cookie(session));
      const res = await req;
      expect(res.status).toBe(200);
      expect(res.body.existingAccount).toBe(true);
      expect(res.body.sessionState).toBe(state);
      expect(res.body.invitation.kind).toBe("team");
      pending(inv, res);
    }
  });
  it("genuine new signup creates exact durable user + credential and issues its new cookie", async () => {
    const inv = invite(emailFor());
    const preview = await request(app).get("/api/auth/redeem/preview").query({ token: inv.token });
    expect(preview.body.existingAccount).toBe(false);
    expect(preview.body.sessionState).toBe("new_account");
    const res = await post(inv).send({ ...body(inv), password: password() });
    expect(res.status).toBe(200);
    const id = res.body.ctx.userId;
    expect(resolveInvitedIdentityStrict(inv.email)).toEqual({ kind: "single", userId: id });
    expect(db.prepare("SELECT id FROM users WHERE id=? AND deleted_at IS NULL").get(id)).toEqual({ id });
    expect(db.prepare("SELECT user_id FROM user_credentials WHERE user_id=? AND deleted_at IS NULL").get(id)).toEqual({ user_id: id });
    expect(res.headers["set-cookie"]?.length).toBe(1);
  });
  it.each(["users", "user_credentials"])("failed %s signup write rolls back every identity row and evicts credential ghost", async table => {
    const inv = invite(emailFor());
    const trigger = table === "users" ? "a0_users_fail" : "a0_creds_fail";
    db.exec(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table}
      WHEN NEW.email = '${inv.email}' BEGIN SELECT RAISE(ABORT,'isolated persistence failure'); END`);
    const res = await post(inv).send({ ...body(inv), password: password() });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("PERSONA_NOT_DURABLE");
    pending(inv, res);
    for (const t of ["users", "auth_users", "user_credentials"])
      expect(db.prepare(`SELECT count(*) AS n FROM ${t} WHERE lower(email)=?`).get(inv.email)).toEqual({ n: 0 });
    expect(lookupByEmail(inv.email)).toBeNull();
    db.exec(`DROP TRIGGER ${trigger}`);
    // The frozen runtime persona still exists. It is NOT authority to mint a
    // cookie or recreate/overwrite an identity: retry must also fail closed.
    const retry = await post(inv).send({ ...body(inv), password: password() });
    expect(retry.status).toBe(503);
    expect(retry.body.error).toBe("IDENTITY_STATE_NEEDS_OPERATOR");
    pending(inv, retry);
    expect(resolveInvitedIdentityStrict(inv.email)).toEqual({ kind: "none" });
  });
  it("concurrent identity appearance before signup is a retryable conflict, not persistence failure", async () => {
    const inv = invite(emailFor());
    const resolve = identityResolver.resolveInvitedIdentityStrict;
    let calls = 0;
    vi.spyOn(identityResolver, "resolveInvitedIdentityStrict").mockImplementation(email => {
      calls++;
      if (calls === 2) user(inv.email);
      return resolve(email);
    });
    const res = await post(inv).send({ ...body(inv), password: password() });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVITED_IDENTITY_STATE_CHANGED");
    pending(inv, res);
  });
  it("a stale signup persona cannot replace the canonical DB identity for the email", async () => {
    const ghost = signup();
    for (const [table, key] of [["users", "id"], ["auth_users", "id"], ["user_credentials", "user_id"]])
      db.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(ghost.id);
    const canonical = user(ghost.email);
    auth(ghost.email, canonical); cred(ghost.email, canonical);
    const inv = invite(ghost.email);
    const before = db.prepare("SELECT * FROM user_credentials WHERE user_id=?").get(canonical);
    const res = await post(inv).set("Cookie", cookie(canonical)).send(body(inv));
    expect(res.status).toBe(200);
    expect(res.body.ctx.userId).toBe(canonical);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(db.prepare("SELECT * FROM user_credentials WHERE user_id=?").get(canonical)).toEqual(before);
    expect(db.prepare("SELECT user_id FROM company_members WHERE company_id=?").get(inv.company))
      .toEqual({ user_id: canonical });
  });
  it("membership failure still rolls back the original claim + tag + grant atomically", async () => {
    const account = signup(), inv = invite(account.email);
    db.exec(`CREATE TRIGGER a0_member_fail BEFORE INSERT ON company_members
      WHEN NEW.company_id='${inv.company}' BEGIN SELECT RAISE(ABORT,'isolated membership failure'); END`);
    const res = await post(inv).set("Cookie", cookie(account.id)).send(body(inv));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("REDEEM_PERSIST_FAILED");
    pending(inv, res);
  });
  it.each(["duplicate", "deleted", "unavailable", "suspended"])(
    "rechecks %s identity at the claim transaction boundary", async change => {
      const account = signup(), inv = invite(account.email);
      const prepare = db.prepare.bind(db);
      let changed = false;
      let deny = false;
      vi.spyOn(db, "prepare").mockImplementation((sql: any) => {
        // This existing route query runs AFTER entry authentication and BEFORE
        // the claim transaction. Simulate a competing durable admin change.
        if (!changed && String(sql).includes("SELECT 1 FROM company_members")) {
          changed = true;
          if (change === "duplicate") user(account.email.toUpperCase());
          if (change === "deleted") prepare("UPDATE users SET deleted_at=? WHERE id=?").run(now(), account.id);
          if (change === "suspended") prepare("UPDATE auth_users SET status='suspended' WHERE id=?").run(account.id);
          if (change === "unavailable") deny = true;
        }
        if (deny && String(sql).includes("FROM users WHERE lower")) throw new Error("fixture unavailable at claim");
        return prepare(sql);
      });
      const res = await post(inv).set("Cookie", cookie(account.id)).send(body(inv));
      expect(changed).toBe(true);
      expect(res.status).toBe(change === "unavailable" ? 503 : change === "suspended" ? 403 : 409);
      expect(res.body.error).toBe({
        duplicate: "INVITED_IDENTITY_AMBIGUOUS", deleted: "INVITED_IDENTITY_DELETED",
        unavailable: "ACCOUNT_RESOLUTION_UNAVAILABLE", suspended: "ACCOUNT_NOT_ACTIVE",
      }[change]);
      vi.restoreAllMocks();
      pending(inv, res);
    },
  );
  it("two attempts consume exactly once", async () => {
    const account = signup(), inv = invite(account.email);
    const results = await Promise.all([1, 2].map(() => post(inv).set("Cookie", cookie(account.id)).send(body(inv))));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(results.every(r => !r.headers["set-cookie"])).toBe(true);
    expect(db.prepare("SELECT count(*) AS n FROM company_members WHERE company_id=?").get(inv.company)).toEqual({ n: 1 });
  });
  it("non-team requests fall through with the original payload unchanged", async () => {
    const payload = { token: unique(), password: password(), continue: true, agreedToTerms: false };
    const get = await request(app).get("/api/auth/redeem/preview").query({ token: payload.token });
    expect(get.status).toBe(418);
    expect(get.body.downstream).toBe("investor-preview");
    const res = await request(app).post("/api/auth/redeem").send(payload);
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ downstream: "investor-redeem", body: payload });
  });
});
