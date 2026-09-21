/**
 * REGRESSION (converted from the slide13b MF-5 / Addendum G fail-before proof).
 * Independent reviewer-owned file. No product source is modified by this file.
 *
 * ORIGINAL DEFECT (reproduced by this same file before Wave A0):
 *   The holder of a team OWNER invitation token — which the partner "add
 *   portfolio company" flow hands to the PARTNER, not to the invited person —
 *   could POST /api/auth/redeem with an ARBITRARY password and NO session
 *   cookie and receive (a) HTTP 200, (b) a Set-Cookie session bound to the
 *   ALREADY-PERSISTED account for the invited email, (c) owner-equivalent
 *   company membership rows, and (d) a consumed single-use invitation. The
 *   stored credential hash was never verified and never overwritten, so the
 *   arbitrary password was simply ignored: token possession alone became
 *   proof of account identity.
 *
 * CONTRACT NOW ASSERTED (Addendum G, as built in server/lib/teamInviteRedeem.ts):
 *   existing durable identity + no session          → 401 SIGN_IN_REQUIRED_TO_ACCEPT
 *   existing durable identity + other's session     → 403 SESSION_IDENTITY_MISMATCH
 *   existing durable identity + its OWN session     → 200, and NO new session is
 *                                                     minted (login/MFA lifetime
 *                                                     is preserved, not renewed)
 *   terms not accepted (even with a valid session)   → 400 TERMS_NOT_ACCEPTED
 *   every refusal must leave: invitation pending, accepted_at NULL, ZERO rows in
 *   company_members AND founder_team_members, credential hash untouched, and no
 *   duplicate credential row for the invited email.
 *
 * Isolation: NODE_ENV=test ⇒ server/db/connection.ts opens ":memory:". No shared
 * DB, no closeDb, no network, no mail, no live access.
 *
 * Run:
 *   cd /home/user/workspace/work && NODE_ENV=test npx vitest run \
 *     server/__tests__/preflight_slide13b_existing_account_redeem_bypass.test.ts \
 *     --maxWorkers=1
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
  // Mirror of the production inline cookie parser (server/index.ts, Sprint 26).
  // registerRoutes() does not install it, and without it no session cookie can
  // reach the redeem handler — the harness would prove a false 401.
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

function seedCompany(companyId: string): void {
  const db: any = rawDb();
  db.prepare(
    `INSERT INTO companies (id, tenant_id, name, legal_name, is_demo)
       VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(id) DO NOTHING`,
  ).run(companyId, `tenant_co_${companyId}`, "Preflight Bypass Co", "Preflight Bypass Co Ltd");
}

/** Owner-role invitation, exactly the shape the partner create flow produces. */
function seedOwnerInvite(companyId: string, email: string): { id: string; raw: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const id = `fti_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const db: any = rawDb();
  db.prepare(
    `INSERT INTO founder_team_invitations
       (id, company_id, invited_by_user_id, invited_email, invited_name, role, status, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'owner', 'pending', ?, ?, ?)`,
  ).run(id, companyId, "u_partner_actor_test", email, "Preflight Owner", tokenHash, expires, now);
  return { id, raw };
}

function credRow(email: string): { user_id: string; password_hash: string } | undefined {
  const db: any = rawDb();
  return db
    .prepare(`SELECT user_id, password_hash FROM user_credentials WHERE lower(email) = ? AND deleted_at IS NULL`)
    .get(email.toLowerCase()) as any;
}

function credRowCount(email: string): number {
  const db: any = rawDb();
  return Number(
    (db
      .prepare(`SELECT COUNT(*) AS c FROM user_credentials WHERE lower(email) = ? AND deleted_at IS NULL`)
      .get(email.toLowerCase()) as any)?.c ?? 0,
  );
}

function tableCount(table: string, companyId: string, userId: string): number {
  const db: any = rawDb();
  try {
    const r = db
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE company_id = ? AND user_id = ?`)
      .get(companyId, userId) as any;
    return Number(r?.c ?? 0);
  } catch {
    return -1; // table absent in this build — reported, never silently 0
  }
}

function inviteRow(id: string): { status: string; accepted_at: string | null } | undefined {
  const db: any = rawDb();
  return db
    .prepare(`SELECT status, accepted_at FROM founder_team_invitations WHERE id = ?`)
    .get(id) as any;
}

function cookieNamesOf(res: request.Response): string[] {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => String(c).split("=")[0]);
}

function sessionCookieHeaderOf(res: request.Response): string {
  const raw = (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
  return raw.map((c) => String(c).split(";")[0]).join("; ");
}

describe("REGRESSION slide13b A0 — team invite redeem cannot impersonate an existing account", () => {
  const companyId = `co_pf13b_${crypto.randomBytes(4).toString("hex")}`;
  const email = `pf13b_${crypto.randomBytes(4).toString("hex")}@test.example`;
  const otherEmail = `pf13bx_${crypto.randomBytes(4).toString("hex")}@test.example`;
  // Never printed by this test.
  const realPassword = `Real-${crypto.randomBytes(8).toString("hex")}`;
  const otherPassword = `Other-${crypto.randomBytes(8).toString("hex")}`;
  const arbitraryPassword = `Arbitrary-${crypto.randomBytes(8).toString("hex")}`;

  let inviteNoSession = { id: "", raw: "" };
  let inviteWrongSession = { id: "", raw: "" };
  let inviteMatching = { id: "", raw: "" };
  let inviteTerms = { id: "", raw: "" };
  let existingUserId = "";
  let otherUserId = "";
  let hashBefore = "";
  let invitedCookie = "";
  let otherCookie = "";

  beforeAll(async () => {
    app = await buildApp();

    // 1. A REAL, DURABLY PERSISTED account for the invited email, created through
    //    the canonical public signup route (credential + persona + users row).
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ email, name: "Preflight Owner", password: realPassword });
    expect(signup.status, "canonical signup must succeed for the fixture").toBe(200);
    const before = credRow(email);
    expect(before?.user_id, "durable credential row must exist for the invited email").toBeTruthy();
    existingUserId = before!.user_id;
    hashBefore = before!.password_hash;

    // 2. An unrelated real account, used as the "signed in as someone else" case.
    const otherSignup = await request(app)
      .post("/api/auth/signup")
      .send({ email: otherEmail, name: "Preflight Other", password: otherPassword });
    expect(otherSignup.status).toBe(200);
    otherUserId = credRow(otherEmail)!.user_id;
    expect(otherUserId).not.toBe(existingUserId);

    // 3. Real sessions, obtained ONLY through the canonical login route.
    const login = await request(app).post("/api/auth/login").send({ email, password: realPassword });
    expect(login.status, "canonical login must succeed").toBe(200);
    expect(login.body?.ok).toBe(true);
    invitedCookie = sessionCookieHeaderOf(login);
    expect(invitedCookie, "login must issue a session cookie").toContain("cap_uid");

    const otherLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: otherEmail, password: otherPassword });
    expect(otherLogin.status).toBe(200);
    otherCookie = sessionCookieHeaderOf(otherLogin);

    // 4. One company and four independent owner invitations for that same email
    //    (single-use tokens: one per scenario, so no test consumes another's).
    seedCompany(companyId);
    inviteNoSession = seedOwnerInvite(companyId, email);
    inviteWrongSession = seedOwnerInvite(companyId, email);
    inviteMatching = seedOwnerInvite(companyId, email);
    inviteTerms = seedOwnerInvite(companyId, email);
    // Real bcrypt signup/login work (4 hashes) can exceed the 10s default hook
    // timeout when this file shares a worker with other suites. Reviewer-owned
    // timeout only; no product or config change.
  }, 120_000);

  it("preview: an existing invited account is reported as existingAccount + sign_in_required", async () => {
    const res = await request(app).get(
      `/api/auth/redeem/preview?token=${encodeURIComponent(inviteNoSession.raw)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.invitation?.kind).toBe("team");
    expect(res.body.invitation?.inviteeEmail).toBe(email);
    expect(res.body.invitation?.role).toBe("owner");
    // A0 contract: the preview must not present an existing account as a signup.
    expect(res.body.existingAccount).toBe(true);
    expect(res.body.sessionState).toBe("sign_in_required");
    // The preview must never mint a session either.
    expect(cookieNamesOf(res).some((n) => n.includes("cap_uid"))).toBe(false);
  });

  it("preview with the invited account's OWN session reports matching; with another's, mismatch", async () => {
    const matching = await request(app)
      .get(`/api/auth/redeem/preview?token=${encodeURIComponent(inviteMatching.raw)}`)
      .set("Cookie", invitedCookie);
    expect(matching.status).toBe(200);
    expect(matching.body.sessionState).toBe("matching");

    const mismatch = await request(app)
      .get(`/api/auth/redeem/preview?token=${encodeURIComponent(inviteMatching.raw)}`)
      .set("Cookie", otherCookie);
    expect(mismatch.status).toBe(200);
    expect(mismatch.body.sessionState).toBe("mismatch");
  });

  it("REGRESSION: arbitrary password + NO session is refused with 401 and changes nothing", async () => {
    const res = await request(app)
      .post("/api/auth/redeem")
      .send({ token: inviteNoSession.raw, password: arbitraryPassword, agreedToTerms: true });

    const inv = inviteRow(inviteNoSession.id);
    const after = credRow(email);

    // Full observed state (no secrets) — kept because the original proof relied
    // on more than the status code.
    // eslint-disable-next-line no-console
    console.log(
      "[regression:A0] no-session redeem OBSERVED",
      JSON.stringify(
        {
          status: res.status,
          bodyOk: res.body?.ok,
          bodyError: res.body?.error,
          hasReturnTo: typeof res.body?.returnTo === "string" && res.body.returnTo.length > 0,
          setCookieNames: cookieNamesOf(res),
          ctxUserIdLeaked: String(res.body?.ctx?.userId ?? ""),
          invitationStatus: inv?.status,
          invitationAcceptedAt: inv?.accepted_at,
          companyMembersRows: tableCount("company_members", companyId, existingUserId),
          founderTeamMemberRows: tableCount("founder_team_members", companyId, existingUserId),
          credentialHashUnchanged: after?.password_hash === hashBefore,
          liveCredentialRowsForEmail: credRowCount(email),
        },
        null,
        2,
      ),
    );

    // 1. Refusal, with the canonical sign-in redirect and no partial success.
    expect(res.status).toBe(401);
    expect(res.body?.ok).toBe(false);
    expect(res.body?.error).toBe("SIGN_IN_REQUIRED_TO_ACCEPT");
    expect(typeof res.body?.returnTo).toBe("string");
    expect(res.body.returnTo).toContain("/auth/redeem?token=");
    // 2. No session may be minted on a refusal.
    expect(cookieNamesOf(res).some((n) => n.includes("cap_uid"))).toBe(false);
    // 3. No identity context may be returned to the token holder.
    expect(res.body?.ctx).toBeUndefined();
    // 4. The single-use invitation must remain unconsumed.
    expect(inv?.status).toBe("pending");
    expect(inv?.accepted_at ?? null).toBeNull();
    // 5. No access of any kind was granted.
    expect(tableCount("company_members", companyId, existingUserId)).toBe(0);
    expect(tableCount("founder_team_members", companyId, existingUserId)).toBe(0);
    // 6. The stored credential is untouched and not duplicated.
    expect(after?.password_hash).toBe(hashBefore);
    expect(credRowCount(email)).toBe(1);
  });

  it("REGRESSION: another account's valid session is refused with 403 and changes nothing", async () => {
    const res = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", otherCookie)
      .send({ token: inviteWrongSession.raw, password: arbitraryPassword, agreedToTerms: true });

    const inv = inviteRow(inviteWrongSession.id);
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("SESSION_IDENTITY_MISMATCH");
    expect(cookieNamesOf(res).some((n) => n.includes("cap_uid"))).toBe(false);
    expect(inv?.status).toBe("pending");
    expect(inv?.accepted_at ?? null).toBeNull();
    // Neither the invited identity nor the signed-in stranger gains access.
    expect(tableCount("company_members", companyId, existingUserId)).toBe(0);
    expect(tableCount("founder_team_members", companyId, existingUserId)).toBe(0);
    expect(tableCount("company_members", companyId, otherUserId)).toBe(0);
    expect(tableCount("founder_team_members", companyId, otherUserId)).toBe(0);
    expect(credRow(email)?.password_hash).toBe(hashBefore);
  });

  it("REGRESSION: a valid own session without accepted terms is 400 and consumes nothing", async () => {
    const res = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", invitedCookie)
      .send({ token: inviteTerms.raw, agreedToTerms: false });

    const inv = inviteRow(inviteTerms.id);
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("TERMS_NOT_ACCEPTED");
    expect(inv?.status).toBe("pending");
    expect(inv?.accepted_at ?? null).toBeNull();
    expect(tableCount("company_members", companyId, existingUserId)).toBe(0);
    expect(tableCount("founder_team_members", companyId, existingUserId)).toBe(0);
  });

  it("POSITIVE: the invited account's OWN session accepts, and NO new session is minted", async () => {
    const res = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", invitedCookie)
      // A password is irrelevant on this path and must not be required or used.
      .send({ token: inviteMatching.raw, agreedToTerms: true });

    const inv = inviteRow(inviteMatching.id);
    const db: any = rawDb();
    const cm = db
      .prepare(
        `SELECT role, is_active, deleted_at, tenant_id FROM company_members
           WHERE company_id = ? AND user_id = ?`,
      )
      .get(companyId, existingUserId) as any;
    const ftm = db
      .prepare(`SELECT role, removed_at FROM founder_team_members WHERE company_id = ? AND user_id = ?`)
      .get(companyId, existingUserId) as any;

    // eslint-disable-next-line no-console
    console.log(
      "[regression:A0] matching-session redeem OBSERVED",
      JSON.stringify(
        {
          status: res.status,
          bodyOk: res.body?.ok,
          setCookieNames: cookieNamesOf(res),
          invitationStatus: inv?.status,
          companyMemberRole: cm?.role,
          companyMemberActive: cm?.is_active,
          founderTeamRole: ftm?.role,
          liveCredentialRowsForEmail: credRowCount(email),
        },
        null,
        2,
      ),
    );

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.kind).toBe("team");
    expect(res.body?.companyId).toBe(companyId);
    expect(res.body?.role).toBe("owner");
    // The login/MFA session lifetime must be preserved, NOT renewed or replaced.
    expect(cookieNamesOf(res).some((n) => n.includes("cap_uid"))).toBe(false);
    // Durable effects, exactly once.
    expect(inv?.status).toBe("accepted");
    expect(inv?.accepted_at).toBeTruthy();
    expect(cm?.role).toBe("co_founder"); // owner → co_founder in company_members
    expect(Number(cm?.is_active)).toBe(1);
    expect(cm?.deleted_at ?? null).toBeNull();
    expect(ftm?.role).toBe("owner");
    expect(ftm?.removed_at ?? null).toBeNull();
    // No identity was created or rewritten by accepting.
    expect(credRow(email)?.password_hash).toBe(hashBefore);
    expect(credRowCount(email)).toBe(1);
  });

  it("REGRESSION: replaying the now-consumed token is refused as already redeemed", async () => {
    const res = await request(app)
      .post("/api/auth/redeem")
      .set("Cookie", invitedCookie)
      .send({ token: inviteMatching.raw, agreedToTerms: true });
    expect([409, 410]).toContain(res.status);
    expect(String(res.body?.error)).toBe("already_redeemed");
  });
});
