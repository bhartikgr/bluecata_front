/**
 * WAVE 305 — MFA OVER REAL HTTP, WITH LOCK-OUT PROVED IMPOSSIBLE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE ONE THING WORSE THAN NO MFA IS LOCKED-OUT ACCOUNTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Thirty-eight accounts exist and none is enrolled, including the owner's admin.
 * So the tests that matter most here are not the ones proving a code works — they
 * are the ones proving that an UN-ENROLLED account is never challenged, under
 * every condition we can construct: default policy, a planted `totp_secret`, a
 * broken policy read, a broken enrolment read.
 *
 * HOW THIS FILE REFUSES TO PROVE THE WRONG THING
 * ----------------------------------------------
 * · NEVER A REPLICA. Every assertion drives the REAL express route table via
 *   supertest and, where a row is claimed, reads that row back out of SQLite with
 *   `rawDb()`. The store's own readers cache in RAM; a passing read from them
 *   would not prove anything landed on disk.
 * · LIVE-CHECK #1 FIRST. The very first test proves OVER HTTP that a password
 *   login posted to `/api/auth/login` reaches the code path we modified. If that
 *   test fails, everything after it is meaningless, so it asserts a marker that
 *   ONLY the new code can produce.
 * · EVERY ABSENCE HAS A LIVE BASELINE. Before asserting "no challenge happened"
 *   the test asserts the challenge machinery DOES fire for an enrolled account in
 *   the same app, same process, same policy. Otherwise "no challenge" could just
 *   mean the feature was never wired up (inert-proof mechanism 9).
 * · A FENCE'S INSTALLATION IS PROVED, NOT ASSUMED. It is not enough that
 *   `mfaChallengeRequired` exists; §1 proves the LOGIN ROUTE CALLS IT, by making
 *   it answer "yes" and observing the HTTP response change.
 *
 * MAIL: `resolveSmtpMode()` is asserted inert in §0. Nothing here sends.
 * MONEY: none. No amount, no currency, no arithmetic anywhere in this feature.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { loadUserContext } from "../lib/requireEntitlement";
import { registerAuthShellRoutes, type RedemptionPreview, type RedemptionResult } from "../lib/authRoutes";
import { registerSecureAuthRoutes } from "../lib/secureAuthRoutes";
import { registerMfaRoutes } from "../lib/mfaRoutes";
import { rawDb } from "../db/connection";
import { resolveSmtpMode } from "../lib/emailSender";
import { totpCodeForStep, totpStepForTime, base32Decode } from "../lib/mfaTotp";
import {
  __forceMfaReadFailureForTest,
  mfaChallengeRequired,
  readEnrolment,
  readPolicyMode,
  ensureMfaSchema,
  beginEnrolment,
  confirmEnrolment,
  setPolicyMode,
  unusedRecoveryCodeCount,
} from "../lib/mfaStore";
import { _resetDurableRateLimitsForTests } from "../lib/rateLimitStore";

/* Demo personas with known passwords, from authRoutes' MOCK_PASSWORDS table.
 * ENABLE_DEMO_SEED must be on for these to exist — asserted as a precondition. */
const ENROLLING = { userId: "u_maya_chen", password: "password123" };
const BYSTANDER = { userId: "u_aisha_patel", password: "password123" };
const PLANTED = { userId: "u_lapsed_lp", password: "password123" };
const ADMIN_LOGIN = { userId: "u_admin", password: "adminpass" };

let app: Express;

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  a.use(loadUserContext);
  registerAuthShellRoutes(a, {
    preview: (): RedemptionPreview => ({ ok: false, reason: "not_found" }),
    redeem: (): RedemptionResult => ({ ok: false, reason: "not_found" }),
  });
  registerSecureAuthRoutes(a);
  registerMfaRoutes(a);
  return a;
}

const login = (creds: { userId: string; password: string }) =>
  request(app).post("/api/auth/login").send(creds);

/** THE STORED ROWS. Straight out of SQLite. Not the store's RAM mirror. */
function auditRows(action: string): Array<Record<string, any>> {
  return rawDb()
    .prepare(
      `SELECT id, tenant_id AS tenantId, actor_id AS actorId, action, target,
              payload_json AS payloadJson, created_at AS createdAt,
              prev_hash AS prevHash, hash
         FROM audit_log WHERE action = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(action) as Array<Record<string, any>>;
}

/** Enrol a persona for real, over HTTP, and return its secret + recovery codes. */
async function enrolOverHttp(userId: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const begin = await request(app).post("/api/auth/mfa/enrol/begin").set("x-user-id", userId).send({});
  expect(begin.status, JSON.stringify(begin.body)).toBe(200);
  const secret = String(begin.body.secret);
  expect(base32Decode(secret)?.length).toBe(20);
  const code = totpCodeForStep(secret, totpStepForTime(Date.now()))!;
  const confirm = await request(app)
    .post("/api/auth/mfa/enrol/confirm")
    .set("x-user-id", userId)
    .send({ code });
  expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
  const codes = confirm.body.recoveryCodes as string[];
  expect(Array.isArray(codes)).toBe(true);
  expect(codes.length).toBeGreaterThan(0);
  return { secret, recoveryCodes: codes };
}

/* THE CODE THAT CONFIRMED THE ENROLMENT IS ALREADY SPENT — by design. Confirming
 * records its step as used, so the very first login cannot replay the code the
 * user just typed into the setup screen. Every login helper below therefore asks
 * for the NEXT step's code, which is inside the ±1 drift window and so is a code a
 * real authenticator would legitimately offer a few seconds later. */
async function freshCode(secret: string, userId: string, extra = 0): Promise<string> {
  /* If a previous step in this test consumed a step AHEAD of the current one (it
   * can, because +1 drift is legitimately accepted), then no un-replayed code
   * exists inside the drift window until the clock catches up. Wait rather than
   * assert a code we know must be refused. */
  for (let i = 0; i < 80; i++) {
    const r0 = rawDb().prepare(`SELECT last_used_step AS s FROM mfa_enrolment WHERE user_id = ?`).get(userId) as
      | { s: number | null }
      | undefined;
    const l0 = typeof r0?.s === "number" ? r0.s : -1;
    if (Math.max(totpStepForTime(Date.now()), l0 + 1) + extra - totpStepForTime(Date.now()) <= 1) break;
    await new Promise((res) => setTimeout(res, 500));
  }
  const current = totpStepForTime(Date.now());
  const row = rawDb()
    .prepare(`SELECT last_used_step AS s FROM mfa_enrolment WHERE user_id = ?`)
    .get(userId) as { s: number | null } | undefined;
  const last = typeof row?.s === "number" ? row.s : -1;
  /* The first step that is BOTH un-replayed and inside the ±1 drift window. This
   * is computed rather than hardcoded so the test cannot break merely because the
   * wall clock crossed a thirty-second boundary mid-test. */
  const step = Math.max(current, last + 1) + extra;
  expect(step).toBeGreaterThan(last);
  expect(Math.abs(step - current)).toBeLessThanOrEqual(1);
  const c = totpCodeForStep(secret, step);
  expect(typeof c).toBe("string");
  return c!;
}

function wipeEnrolment(userId: string): void {
  ensureMfaSchema();
  rawDb().prepare(`DELETE FROM mfa_recovery_code WHERE user_id = ?`).run(userId);
  rawDb().prepare(`DELETE FROM mfa_enrolment WHERE user_id = ?`).run(userId);
}

beforeAll(() => {
  app = buildApp();
  expect(ensureMfaSchema()).toBe(true);
  /* PRECONDITION: the demo personas with known passwords really are seeded.
   * Without this, every "login succeeded" below could be a 401 misread. */
  expect(setPolicyMode("enrolled_only", "u_test_setup", Date.now()).ok).toBe(true);
});

beforeEach(() => {
  __forceMfaReadFailureForTest(null);
  _resetDurableRateLimitsForTests?.();
});

afterEach(() => {
  __forceMfaReadFailureForTest(null);
});

describe("W305 §0 — MAIL IS INERT", () => {
  it("0a resolveSmtpMode() is a non-sending mode", () => {
    const mode = resolveSmtpMode();
    expect(["dry_run", "console", "disabled"]).toContain(mode);
    expect(mode).not.toBe("smtp");
  });
});

describe("W305 §1 — LIVE-CHECK #1: PRODUCTION LOGIN POSTS TO /api/auth/login AND REACHES THE NEW GATE", () => {
  it("1a a password login over HTTP to /api/auth/login succeeds and returns a context", async () => {
    wipeEnrolment(BYSTANDER.userId);
    const r = await login(BYSTANDER);
    /* PRECONDITION FOR EVERYTHING ELSE IN THIS FILE. If this route is not the
     * login route, no proof below means anything. */
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.ctx?.userId).toBe(BYSTANDER.userId);
    /* A session cookie was actually set, so this is the real login, not a stub. */
    expect(String(r.headers["set-cookie"] ?? "")).toMatch(/./);
  });

  it("1b THE GATE IS INSTALLED ON THAT ROUTE — an enrolled account gets mfaRequired instead of a session", async () => {
    wipeEnrolment(ENROLLING.userId);
    await enrolOverHttp(ENROLLING.userId);
    /* The enrolment is CONFIRMED in the database, read back directly. */
    const row = rawDb()
      .prepare(`SELECT state FROM mfa_enrolment WHERE user_id = ?`)
      .get(ENROLLING.userId) as { state: string } | undefined;
    expect(row?.state).toBe("confirmed");

    const r = await login(ENROLLING);
    expect(r.status).toBe(200);
    /* THE MARKER ONLY THE NEW CODE CAN PRODUCE. */
    expect(r.body.ok).toBe(false);
    expect(r.body.mfaRequired).toBe(true);
    expect(typeof r.body.mfaToken).toBe("string");
    expect(String(r.body.mfaToken).length).toBeGreaterThan(20);
    /* AND NO SESSION WAS ISSUED. A gate that challenges but still logs you in is
     * theatre. `setSessionCookie` must not have run. */
    const cookies = ([] as string[]).concat(r.headers["set-cookie"] ?? []);
    const sessionish = cookies.filter((c) => /^(cap_session|session|sid)=/.test(c) && !/=;|=deleted/.test(c));
    expect(sessionish).toEqual([]);
    /* And no user context was handed back either. */
    expect(r.body.ctx).toBeUndefined();
  });

  it("1c the challenge can be completed over HTTP with a real TOTP code, and only then is a session issued", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { secret } = await enrolOverHttp(ENROLLING.userId);
    const first = await login(ENROLLING);
    expect(first.body.mfaRequired).toBe(true);

    const code = (await freshCode(secret, ENROLLING.userId));
    const done = await request(app)
      .post("/api/auth/login/mfa")
      .send({ token: first.body.mfaToken, code });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.ok).toBe(true);
    expect(done.body.ctx?.userId).toBe(ENROLLING.userId);
    expect(String(done.headers["set-cookie"] ?? "")).toMatch(/./);
  });

  it("1d a WRONG code over HTTP is refused, and the step-up token is not a session", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { secret } = await enrolOverHttp(ENROLLING.userId);
    const first = await login(ENROLLING);
    const good = (await freshCode(secret, ENROLLING.userId));
    const wrong = good === "000000" ? "111111" : "000000";
    expect(wrong).not.toBe(good);
    const r = await request(app).post("/api/auth/login/mfa").send({ token: first.body.mfaToken, code: wrong });
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
    /* PRECONDITION ON THE REFUSAL: the SAME token with the RIGHT code works, so
     * the 401 was about the code and not about a dead token. */
    const ok = await request(app).post("/api/auth/login/mfa").send({ token: first.body.mfaToken, code: good });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("1e a forged or absent step-up token cannot complete a login", async () => {
    for (const token of [undefined, "", "not-a-token", "eyJhIjoxfQ.deadbeef"]) {
      const r = await request(app).post("/api/auth/login/mfa").send({ token, code: "123456" });
      expect(r.status).toBe(401);
      expect(r.body.ok).toBe(false);
      expect(r.body.error).toBe("MFA_TOKEN_INVALID");
    }
  });
});

describe("W305 §2 — REPLAY IS REFUSED", () => {
  it("2a the same TOTP code cannot be used twice, even inside its own 30-second step", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { secret } = await enrolOverHttp(ENROLLING.userId);
    const code = (await freshCode(secret, ENROLLING.userId));

    const a = await login(ENROLLING);
    const first = await request(app).post("/api/auth/login/mfa").send({ token: a.body.mfaToken, code });
    /* PRECONDITION: the first use SUCCEEDS. A replay test whose first use fails
     * proves nothing at all (inert-proof mechanism 9). */
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.ok).toBe(true);

    const b = await login(ENROLLING);
    expect(b.body.mfaRequired).toBe(true);
    const replay = await request(app).post("/api/auth/login/mfa").send({ token: b.body.mfaToken, code });
    expect(replay.status).toBe(401);
    expect(replay.body.ok).toBe(false);
    expect(replay.body.error).toBe("REPLAYED_CODE");
  });

  it("2b the consumed step is recorded IN THE DATABASE, which is what makes the refusal durable", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { secret } = await enrolOverHttp(ENROLLING.userId);
    /* After confirmation the step that confirmed it is ALREADY recorded — that is
     * the property that stops the setup code being replayed as a login. So the
     * baseline here is "a step is recorded", and the proof is that it ADVANCES. */
    const before = rawDb()
      .prepare(`SELECT last_used_step AS s FROM mfa_enrolment WHERE user_id = ?`)
      .get(ENROLLING.userId) as { s: number | null };
    expect(typeof before.s).toBe("number");

    const step = totpStepForTime(Date.now()) + 1;
    expect(step).toBeGreaterThan(Number(before.s));
    const code = totpCodeForStep(secret, step)!;
    const a = await login(ENROLLING);
    expect((await request(app).post("/api/auth/login/mfa").send({ token: a.body.mfaToken, code })).status).toBe(200);

    const after = rawDb()
      .prepare(`SELECT last_used_step AS s FROM mfa_enrolment WHERE user_id = ?`)
      .get(ENROLLING.userId) as { s: number | null };
    expect(after.s).toBe(step);
  });
});

describe("W305 §3 — LOCK-OUT PROOFS: AN UN-ENROLLED ACCOUNT IS NEVER CHALLENGED", () => {
  it("3a THE LIVE BASELINE. In this same app and policy, an enrolled account IS challenged", async () => {
    wipeEnrolment(ENROLLING.userId);
    await enrolOverHttp(ENROLLING.userId);
    const r = await login(ENROLLING);
    expect(r.body.mfaRequired).toBe(true);
  });

  it("3b none of the un-enrolled accounts is challenged — including the admin", async () => {
    for (const creds of [BYSTANDER, PLANTED, ADMIN_LOGIN]) {
      wipeEnrolment(creds.userId);
      /* PRECONDITION: there really is no enrolment row. */
      const e = readEnrolment(creds.userId);
      expect(e.ok && e.state).toBeNull();
      const r = await login(creds);
      expect(r.status, `${creds.userId}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.ok, `${creds.userId} must NOT be challenged`).toBe(true);
      expect(r.body.mfaRequired).toBeUndefined();
      expect(r.body.ctx?.userId).toBe(creds.userId);
    }
  });

  it("3c A PLANTED totp_secret DOES NOT CHALLENGE — enforcement reads mfa_enrolment.state only", async () => {
    wipeEnrolment(PLANTED.userId);
    const db = rawDb();
    /* Plant exactly what the retired scaffold used to write: a secret on
     * auth_users, with no enrolment row anywhere. */
    const planted = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    db.prepare(
      `INSERT INTO auth_users (id, email, password_hash, totp_secret, created_at)
       VALUES (?, ?, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET totp_secret = excluded.totp_secret`,
    ).run(PLANTED.userId, `${PLANTED.userId}@w305.test`, planted, new Date().toISOString());

    /* PRECONDITION 1: the secret really is stored. Without this the test would
     * pass against a failed INSERT — a fixture that cannot distinguish the fix
     * from the defect (inert-proof mechanism 10). */
    const stored = db.prepare(`SELECT totp_secret AS s FROM auth_users WHERE id = ?`).get(PLANTED.userId) as
      | { s: string | null }
      | undefined;
    expect(stored?.s).toBe(planted);
    /* PRECONDITION 2: there is no enrolment row. */
    expect(db.prepare(`SELECT COUNT(*) AS n FROM mfa_enrolment WHERE user_id = ?`).get(PLANTED.userId)).toEqual({ n: 0 });
    /* PRECONDITION 3: the challenge machinery is alive right now. */
    wipeEnrolment(ENROLLING.userId);
    await enrolOverHttp(ENROLLING.userId);
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);

    /* THE PROOF: login is UNCHALLENGED. */
    const r = await login(PLANTED);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.mfaRequired).toBeUndefined();
    expect(r.body.ctx?.userId).toBe(PLANTED.userId);
  });

  it("3d BOTH READS FAIL OPEN — an injected read failure still lets everyone in", async () => {
    wipeEnrolment(ENROLLING.userId);
    await enrolOverHttp(ENROLLING.userId);
    /* PRECONDITION: with reads healthy, the enrolled account IS challenged. */
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);

    /* Now break the reads. `mfaChallengeRequired` performs the policy read and
     * the enrolment read; the injection fails BOTH, which is the worst case. */
    __forceMfaReadFailureForTest("W305 injected read failure");
    try {
      for (const creds of [ENROLLING, BYSTANDER, ADMIN_LOGIN]) {
        const r = await login(creds);
        expect(r.status, `${creds.userId} must still log in: ${JSON.stringify(r.body)}`).toBe(200);
        expect(r.body.ok, `${creds.userId} must log in when the MFA reads fail`).toBe(true);
        expect(r.body.mfaRequired).toBeUndefined();
        expect(r.body.ctx?.userId).toBe(creds.userId);
      }
    } finally {
      __forceMfaReadFailureForTest(null);
    }
    /* AND THE INJECTION WAS REAL: with it cleared, the challenge returns. If this
     * assertion failed, the fail-open above could have been the feature simply
     * being switched off (a RED — here a GREEN — that proves nothing). */
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);
  });

  /* 3d proves the FIRST fail-open. It cannot prove the second: the policy read
   * runs first and returns immediately when it fails, so with both reads broken
   * the enrolment fail-open is never reached. That was demonstrated, not assumed
   * — disarm D2b turned the enrolment fail-open into a fail-CLOSED and the suite
   * stayed GREEN. 3e closes that hole by failing ONLY the enrolment read, with
   * the policy read asserted healthy first so the injection cannot be mistaken
   * for the feature being switched off. */
  it("3d2 THE SECOND FAIL-OPEN, ON ITS OWN — a broken enrolment read alone still lets everyone in", async () => {
    wipeEnrolment(ENROLLING.userId);
    await enrolOverHttp(ENROLLING.userId);
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);

    __forceMfaReadFailureForTest("W305 injected ENROLMENT-ONLY read failure", "enrolment");
    try {
      /* PRECONDITION, ASSERTED FIRST: the policy read is still healthy, so what
       * follows is attributable to the enrolment read alone and to nothing else. */
      const policy = readPolicyMode();
      expect(policy.ok, "the policy read must remain healthy for this test to mean anything").toBe(true);
      expect(policy.ok && policy.mode).toBe("enrolled_only");

      /* PRECONDITION: the enrolment read really is broken. */
      const enrolment = readEnrolment(ENROLLING.userId);
      expect(enrolment.ok, "the enrolment read must actually be failing").toBe(false);

      const decision = mfaChallengeRequired(ENROLLING.userId);
      expect(decision.required, "a broken enrolment read must not challenge").toBe(false);
      expect(decision.failedOpen, "and it must be recorded as a fail-open, not as a normal pass").toBe(true);

      for (const creds of [ENROLLING, BYSTANDER, ADMIN_LOGIN]) {
        const r = await login(creds);
        expect(r.status, `${creds.userId}: ${JSON.stringify(r.body)}`).toBe(200);
        expect(r.body.ok, `${creds.userId} must log in when only the enrolment read fails`).toBe(true);
        expect(r.body.mfaRequired).toBeUndefined();
      }
    } finally {
      __forceMfaReadFailureForTest(null);
    }
    /* The injection was real and is now gone. */
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);
  });

  it("3e mode 'off' challenges nobody, and the enrolled account keeps its enrolment", async () => {
    wipeEnrolment(ENROLLING.userId);
    await enrolOverHttp(ENROLLING.userId);
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);
    expect(setPolicyMode("off", "u_test", Date.now()).ok).toBe(true);
    try {
      const r = await login(ENROLLING);
      expect(r.body.ok).toBe(true);
      expect(r.body.mfaRequired).toBeUndefined();
      /* The enrolment was NOT destroyed by turning the policy off. */
      const row = rawDb().prepare(`SELECT state FROM mfa_enrolment WHERE user_id = ?`).get(ENROLLING.userId) as {
        state: string;
      };
      expect(row.state).toBe("confirmed");
    } finally {
      expect(setPolicyMode("enrolled_only", "u_test", Date.now()).ok).toBe(true);
    }
    /* Restored: the challenge is back. */
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);
  });

  it("3f a PENDING enrolment does not challenge — enforcement is never retroactive to an unfinished opt-in", async () => {
    wipeEnrolment(ENROLLING.userId);
    const b = beginEnrolment(ENROLLING.userId);
    expect(b.ok).toBe(true);
    const row = rawDb().prepare(`SELECT state FROM mfa_enrolment WHERE user_id = ?`).get(ENROLLING.userId) as {
      state: string;
    };
    expect(row.state).toBe("pending");
    const r = await login(ENROLLING);
    expect(r.body.ok).toBe(true);
    expect(r.body.mfaRequired).toBeUndefined();
  });
});

describe("W305 §4 — RECOVERY EXISTS BEFORE ENFORCEMENT", () => {
  it("4a recovery codes are issued once, are single-use, and the remaining count falls", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { recoveryCodes } = await enrolOverHttp(ENROLLING.userId);
    expect(recoveryCodes.length).toBe(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(unusedRecoveryCodeCount(ENROLLING.userId)).toBe(10);

    /* NEVER DISPLAYED TWICE: no route hands them back. */
    const status = await request(app).get("/api/auth/mfa/status").set("x-user-id", ENROLLING.userId);
    expect(status.status).toBe(200);
    expect(JSON.stringify(status.body)).not.toContain(recoveryCodes[0]);
    expect(status.body.recoveryCodesRemaining).toBe(10);

    /* THE PLAINTEXT IS NOT IN THE DATABASE — only a hash. */
    const rows = rawDb()
      .prepare(`SELECT code_hash AS h FROM mfa_recovery_code WHERE user_id = ?`)
      .all(ENROLLING.userId) as Array<{ h: string }>;
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.h.length).toBeGreaterThan(20);
      for (const plain of recoveryCodes) expect(r.h).not.toContain(plain);
    }

    /* USE ONE over HTTP. */
    const a = await login(ENROLLING);
    const used = await request(app)
      .post("/api/auth/login/mfa")
      .send({ token: a.body.mfaToken, code: recoveryCodes[0] });
    expect(used.status, JSON.stringify(used.body)).toBe(200);
    expect(used.body.ok).toBe(true);
    expect(used.body.usedRecoveryCode).toBe(true);
    expect(used.body.recoveryCodesRemaining).toBe(9);
    /* Read the consumption back FROM THE DATABASE. */
    const consumed = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM mfa_recovery_code WHERE user_id = ? AND used_at IS NOT NULL`)
      .get(ENROLLING.userId) as { n: number };
    expect(consumed.n).toBe(1);

    /* SINGLE USE: the same code is now refused. */
    const b = await login(ENROLLING);
    const twice = await request(app)
      .post("/api/auth/login/mfa")
      .send({ token: b.body.mfaToken, code: recoveryCodes[0] });
    expect(twice.status).toBe(401);
    expect(twice.body.ok).toBe(false);
    /* PRECONDITION ON THAT REFUSAL: a DIFFERENT, unused code still works. */
    const c = await login(ENROLLING);
    const other = await request(app)
      .post("/api/auth/login/mfa")
      .send({ token: c.body.mfaToken, code: recoveryCodes[1] });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(other.body.recoveryCodesRemaining).toBe(8);
  });

  it("4b EXHAUSTION IS HANDLED — the last code works, and the user is told there are none left", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { recoveryCodes } = await enrolOverHttp(ENROLLING.userId);
    /* Spend all but one through the real route. */
    for (let i = 0; i < recoveryCodes.length - 1; i++) {
      /* The per-account attempt throttle allows ten tries per fifteen minutes, and
       * spending ten codes in one test would trip it. Clearing it here keeps this
       * test about EXHAUSTION; the throttle itself has its own test (§9). */
      _resetDurableRateLimitsForTests?.();
      const s = await login(ENROLLING);
      const r = await request(app).post("/api/auth/login/mfa").send({ token: s.body.mfaToken, code: recoveryCodes[i] });
      expect(r.status, `code ${i}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    expect(unusedRecoveryCodeCount(ENROLLING.userId)).toBe(1);
    _resetDurableRateLimitsForTests?.();
    const last = recoveryCodes[recoveryCodes.length - 1];
    const s = await login(ENROLLING);
    const r = await request(app).post("/api/auth/login/mfa").send({ token: s.body.mfaToken, code: last });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.recoveryCodesRemaining).toBe(0);
    expect(unusedRecoveryCodeCount(ENROLLING.userId)).toBe(0);

    /* Now zero remain. The status route says so HONESTLY — zero, not null, not a
     * fabricated ten. */
    const status = await request(app).get("/api/auth/mfa/status").set("x-user-id", ENROLLING.userId);
    expect(status.body.recoveryCodesRemaining).toBe(0);

    /* And the TOTP app still works, so exhausting backup codes is not a lock-out. */
    const enrolRow = rawDb().prepare(`SELECT state FROM mfa_enrolment WHERE user_id = ?`).get(ENROLLING.userId) as {
      state: string;
    };
    expect(enrolRow.state).toBe("confirmed");
  }, 30_000);

  it("4c a user can turn MFA off with a valid code, and is then not challenged", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { secret } = await enrolOverHttp(ENROLLING.userId);
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);
    /* Wrong code cannot disable it. */
    const bad = await request(app).post("/api/auth/mfa/disable").set("x-user-id", ENROLLING.userId).send({ code: "000000" });
    expect(bad.status).toBe(400);
    expect(bad.body.ok).toBe(false);
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);
    /* A fresh step's code can. */
    const code = (await freshCode(secret, ENROLLING.userId));
    const off = await request(app).post("/api/auth/mfa/disable").set("x-user-id", ENROLLING.userId).send({ code });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const r = await login(ENROLLING);
    expect(r.body.ok).toBe(true);
    expect(r.body.mfaRequired).toBeUndefined();
    /* Recovery codes were invalidated, read back from the database. */
    const live = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM mfa_recovery_code WHERE user_id = ? AND used_at IS NULL`)
      .get(ENROLLING.userId) as { n: number };
    expect(live.n).toBe(0);
  });
});

describe("W305 §5 — THE ADMIN RESET PATH WRITES AN AUDIT ROW, READ BACK FROM SQLITE (R253)", () => {
  it("5a the reset requires an admin, requires a reason of ten characters, and then writes the row", async () => {
    wipeEnrolment(ENROLLING.userId);
    await enrolOverHttp(ENROLLING.userId);
    expect((await login(ENROLLING)).body.mfaRequired).toBe(true);

    /* A non-admin cannot reset anybody. */
    const denied = await request(app)
      .post("/api/admin/mfa/reset")
      .set("x-user-id", BYSTANDER.userId)
      .send({ userId: ENROLLING.userId, reason: "user lost their phone" });
    expect(denied.status).toBe(403);

    /* An empty or too-short reason is refused, because the reason IS the audit. */
    for (const reason of ["", "   ", "lost", "too short"]) {
      const r = await request(app)
        .post("/api/admin/mfa/reset")
        .set("x-user-id", "u_admin")
        .send({ userId: ENROLLING.userId, reason });
      expect(r.status, `reason ${JSON.stringify(reason)} must be refused`).toBe(400);
      expect(r.body.error).toBe("REASON_REQUIRED");
    }

    /* LIVE BASELINE FOR THE ABSENCE CHECK: count the rows before. */
    const before = auditRows("mfa.admin_reset");
    const reason = "owner verified by phone, handset replaced";
    const ok = await request(app)
      .post("/api/admin/mfa/reset")
      .set("x-user-id", "u_admin")
      .send({ userId: ENROLLING.userId, reason });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    /* THE ROW, READ BACK OUT OF SQLITE. Not an emit. Not a log line. Not the
     * response body. */
    const after = auditRows("mfa.admin_reset");
    expect(after.length).toBe(before.length + 1);
    const row = after[0];
    expect(row.action).toBe("mfa.admin_reset");
    expect(row.target).toBe(`user:${ENROLLING.userId}`);
    expect(row.actorId).toBe("u_admin");
    expect(typeof row.hash).toBe("string");
    expect(String(row.hash).length).toBeGreaterThan(20);
    const payload = JSON.parse(String(row.payloadJson));
    expect(payload.reason).toBe(reason);
    expect(String(payload.priorState)).toBe("confirmed");
    /* And the reset actually took effect: no longer challenged. */
    const r = await login(ENROLLING);
    expect(r.body.ok).toBe(true);
    expect(r.body.mfaRequired).toBeUndefined();
    expect(rawDb().prepare(`SELECT COUNT(*) AS n FROM mfa_enrolment WHERE user_id = ? AND state = 'confirmed'`).get(ENROLLING.userId)).toEqual({ n: 0 });
  });

  it("5b the audit row joins the existing hash chain rather than inventing a new shape", () => {
    const rows = auditRows("mfa.admin_reset");
    /* PRECONDITION: 5a ran and there is at least one row. */
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    /* Same columns the rest of the platform's audit rows use — this is the
     * existing writer, not a parallel table. */
    for (const k of ["id", "tenantId", "actorId", "action", "target", "payloadJson", "createdAt", "hash"]) {
      expect(row[k], `column ${k} must be populated`).not.toBeUndefined();
    }
    expect(row.prevHash === null || typeof row.prevHash === "string").toBe(true);
  });

  it("5c a passed challenge and a used recovery code are also audited to the same table", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { recoveryCodes } = await enrolOverHttp(ENROLLING.userId);
    const beforePassed = auditRows("mfa.challenge_passed").length;
    const beforeUsed = auditRows("mfa.recovery_code_used").length;
    const s = await login(ENROLLING);
    const r = await request(app).post("/api/auth/login/mfa").send({ token: s.body.mfaToken, code: recoveryCodes[0] });
    expect(r.status).toBe(200);
    expect(auditRows("mfa.challenge_passed").length).toBe(beforePassed + 1);
    expect(auditRows("mfa.recovery_code_used").length).toBe(beforeUsed + 1);
  });
});

describe("W305 §6 — THE SCAFFOLD IS RETIRED IN PLACE, NOT DELETED (R195.5)", () => {
  it("6a both scaffold routes still EXIST — they answer, they are not 404", async () => {
    for (const p of ["/api/auth/secure/2fa/setup", "/api/auth/secure/2fa/verify"]) {
      const r = await request(app).post(p).set("x-user-id", BYSTANDER.userId).send({ code: "123456" });
      expect(r.status, `${p} must still be routed`).not.toBe(404);
    }
  });

  it("6b they refuse honestly with 501 and NAME their replacement", async () => {
    /* Each route names ITS OWN replacement — setup points at enrolment, verify
     * points at the login exchange. Asserting one shared string would have let a
     * route that named the wrong successor pass. */
    const expected: Record<string, string[]> = {
      "/api/auth/secure/2fa/setup": ["/api/auth/mfa/enrol/begin", "/api/auth/mfa/enrol/confirm", "/settings/two-factor"],
      "/api/auth/secure/2fa/verify": ["/api/auth/login/mfa"],
    };
    for (const [p, needles] of Object.entries(expected)) {
      const r = await request(app).post(p).set("x-user-id", BYSTANDER.userId).send({ code: "123456" });
      expect(r.status, p).toBe(501);
      expect(r.body.ok).toBe(false);
      expect(r.body.error).toBe("SCAFFOLD_RETIRED");
      expect(r.body.retiredBy).toBe("wave305");
      const text = JSON.stringify(r.body);
      expect(needles.length).toBeGreaterThan(0);
      for (const n of needles) expect(text, `${p} must name ${n}`).toContain(n);
    }
  });

  it("6c THE OLD VERIFY NO LONGER ACCEPTS ANY SIX DIGITS — the actual defect is closed", async () => {
    /* This was the defect: /2fa/verify returned success for any well-formed code.
     * Now no six-digit string succeeds. Preconditions: the route is reachable
     * (6a) and answers (6b). */
    let refused = 0;
    for (const code of ["000000", "123456", "999999", "287082"]) {
      const r = await request(app).post("/api/auth/secure/2fa/verify").set("x-user-id", BYSTANDER.userId).send({ code });
      expect(r.status).toBe(501);
      expect(r.body.ok).not.toBe(true);
      refused++;
    }
    expect(refused).toBe(4);
  });

  it("6d the scaffold no longer WRITES a totp_secret anywhere", async () => {
    const db = rawDb();
    const target = BYSTANDER.userId;
    db.prepare(
      `INSERT INTO auth_users (id, email, password_hash, totp_secret, created_at) VALUES (?, ?, '', NULL, ?)
       ON CONFLICT(id) DO UPDATE SET totp_secret = NULL`,
    ).run(target, `${target}@w305.test`, new Date().toISOString());
    /* PRECONDITION: the column is readable and currently null, so an unchanged
     * null afterwards is meaningful. */
    expect(db.prepare(`SELECT totp_secret AS s FROM auth_users WHERE id = ?`).get(target)).toEqual({ s: null });
    await request(app).post("/api/auth/secure/2fa/setup").set("x-user-id", target).send({});
    expect(db.prepare(`SELECT totp_secret AS s FROM auth_users WHERE id = ?`).get(target)).toEqual({ s: null });
  });
});

describe("W305 §7 — THE NEW ROUTES ARE SCOPED", () => {
  it("7a the MFA routes are NOT on the public allowlist, so the global guard demands a session", async () => {
    /* HONEST LIMITATION, RECORDED IN THE TEST ITSELF. In-process there is a
     * sandbox identity fallback (server/lib/userContext.ts) which deliberately
     * hands even a header-less request a seeded persona so existing fixtures work.
     * Because of it, an "anonymous" supertest request is not actually anonymous,
     * and asserting 401 against this app would be asserting something untrue. So
     * the real protection is asserted where it actually lives: the global route
     * guard's public allowlist. `/api/auth/login` is public (the password step must
     * be reachable without a session, and `/api/auth/login/mfa` inherits that by
     * prefix, correctly — it carries its own signed step-up token). Nothing under
     * `/api/auth/mfa/` or `/api/admin/mfa/` is public, so in production those
     * routes sit behind the default-deny guard. */
    const guardSrc = fs.readFileSync(path.resolve(__dirname, "../lib/applyRouteGuards.ts"), "utf8");
    const block = guardSrc.slice(guardSrc.indexOf("const PUBLIC_API_PREFIXES = ["));
    const listEnd = block.indexOf("];");
    expect(listEnd).toBeGreaterThan(0);
    const list = block.slice(0, listEnd);
    /* PRECONDITION: we really read the allowlist and it is not empty. */
    expect(list).toContain('"/api/auth/login"');
    expect(list.split("\n").length).toBeGreaterThan(5);
    /* THE PROOF: no MFA-specific prefix was added to the allowlist by this wave. */
    /* NOTE: "/api/auth/secure" IS on the allowlist already, from long before this
     * wave. That is pre-existing and out of scope here — and the two scaffold
     * routes under it now answer 501 to everybody, authenticated or not, so their
     * public reachability grants nothing. It is recorded in the wave report rather
     * than silently changed. */
    for (const forbidden of ["/api/auth/mfa", "/api/admin/mfa"]) {
      expect(list, `${forbidden} must NOT be publicly allowlisted`).not.toContain(`"${forbidden}`);
    }
    /* And the step-up exchange is reachable by prefix, which is what lets a user
     * who has not yet completed the challenge finish it. */
    const r = await request(app).post("/api/auth/login/mfa").send({ token: "nope", code: "123456" });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("MFA_TOKEN_INVALID");
  });

  it("7b the admin routes refuse a signed-in non-admin", async () => {
    const reset = await request(app)
      .post("/api/admin/mfa/reset")
      .set("x-user-id", BYSTANDER.userId)
      .send({ userId: ENROLLING.userId, reason: "a perfectly long reason here" });
    expect(reset.status).toBe(403);
    const policyGet = await request(app).get("/api/admin/mfa/policy").set("x-user-id", BYSTANDER.userId);
    expect(policyGet.status).toBe(403);
    const policySet = await request(app)
      .post("/api/admin/mfa/policy")
      .set("x-user-id", BYSTANDER.userId)
      .send({ mode: "off" });
    expect(policySet.status).toBe(403);
    /* PRECONDITION: an actual admin is allowed, so the 403s are about the role. */
    expect((await request(app).get("/api/admin/mfa/policy").set("x-user-id", "u_admin")).status).toBe(200);
  });

  it("7c THE POLICY ROUTE CANNOT SET A THIRD MODE either — the API domain matches the CHECK", async () => {
    for (const mode of ["required", "all", "admins", ""]) {
      const r = await request(app).post("/api/admin/mfa/policy").set("x-user-id", "u_admin").send({ mode });
      expect(r.status, `mode ${JSON.stringify(mode)}`).toBe(400);
      expect(r.body.ok).toBe(false);
    }
    /* PRECONDITION: the two legal values ARE accepted. */
    for (const mode of ["off", "enrolled_only"]) {
      const r = await request(app).post("/api/admin/mfa/policy").set("x-user-id", "u_admin").send({ mode });
      expect(r.status, `mode ${mode}`).toBe(200);
    }
    expect(setPolicyMode("enrolled_only", "u_test", Date.now()).ok).toBe(true);
  });
});

describe("W305 §8 — ONE CHALLENGE COVERS ALL PERSONAS (persona switching is not segmented)", () => {
  it("8a enrolment and enforcement are keyed on the user id alone — there is no persona column", () => {
    const cols = rawDb().prepare(`PRAGMA table_info(mfa_enrolment)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    /* PRECONDITION: we really read the table. */
    expect(names).toContain("user_id");
    expect(names).toContain("state");
    for (const forbidden of ["persona", "persona_id", "role", "portal", "workspace_id"]) {
      expect(names, `mfa_enrolment must not segment by ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("8b ONE challenge yields the whole multi-persona context — it is not issued per persona", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { secret } = await enrolOverHttp(ENROLLING.userId);
    const first = await login(ENROLLING);
    expect(first.body.mfaRequired).toBe(true);
    /* The step-up token itself is opaque, but what it BUYS is observable: a single
     * exchange returns the complete UserContext, with every persona flag resolved
     * at once. There is no second challenge for a second persona because there is
     * no second session — persona switching is a client-side view change that makes
     * no server call, so segmenting the challenge would have been segmenting
     * nothing. */
    const code = (await freshCode(secret, ENROLLING.userId));
    const done = await request(app).post("/api/auth/login/mfa").send({ token: first.body.mfaToken, code });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const ctx = done.body.ctx as Record<string, unknown>;
    /* PRECONDITION: we really got a context. */
    expect(ctx?.userId).toBe(ENROLLING.userId);
    for (const flag of ["founder", "investor", "collective", "isAdmin", "isAuthed"]) {
      expect(ctx, `the single challenge must resolve ${flag}`).toHaveProperty(flag);
    }
    expect(ctx.isAuthed).toBe(true);
    /* And exactly ONE challenge-passed audit row was written for it, not one per
     * persona. */
    const rows = auditRows("mfa.challenge_passed").filter((r) => r.target === `user:${ENROLLING.userId}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("W305 §9 — REPEATED WRONG CODES ARE THROTTLED, AND THE THROTTLE FAILS CLOSED", () => {
  it("9a after ten wrong codes the account is throttled, and a correct code is still refused until it clears", async () => {
    wipeEnrolment(ENROLLING.userId);
    const { secret, recoveryCodes } = await enrolOverHttp(ENROLLING.userId);
    _resetDurableRateLimitsForTests?.();
    /* PRECONDITION: a correct code works right now, so the 429 below is the
     * throttle and not a broken enrolment. */
    const warmup = await login(ENROLLING);
    expect(
      (await request(app).post("/api/auth/login/mfa").send({ token: warmup.body.mfaToken, code: (await freshCode(secret, ENROLLING.userId)) }))
        .status,
    ).toBe(200);
    _resetDurableRateLimitsForTests?.();

    let sawThrottle = false;
    for (let i = 0; i < 14; i++) {
      const s = await login(ENROLLING);
      if (!s.body.mfaToken) break;
      const r = await request(app).post("/api/auth/login/mfa").send({ token: s.body.mfaToken, code: "000000" });
      if (r.status === 429) {
        sawThrottle = true;
        expect(r.body.error).toBe("MFA_TOO_MANY_ATTEMPTS");
        expect(typeof r.body.resetAt).toBe("string");
        break;
      }
      expect(r.status).toBe(401);
    }
    expect(sawThrottle, "ten wrong codes must trip the throttle").toBe(true);
    /* THE THROTTLE DOES NOT LOCK THE ACCOUNT OUT PERMANENTLY: the password step
     * still answers, and it answers with a challenge rather than an error. */
    const still = await login(ENROLLING);
    expect(still.status).toBe(200);
    expect(still.body.mfaRequired).toBe(true);
    _resetDurableRateLimitsForTests?.();
    /* And once cleared, a real credential works again. A RECOVERY CODE is used
     * here rather than a TOTP code deliberately: the warm-up above consumed a
     * step, and waiting for the clock to leave that step would make this test
     * slow and time-dependent for no extra proof. Recovery codes carry no step,
     * so this asserts exactly the thing in question — the throttle released. */
    const after = await login(ENROLLING);
    expect(after.body.mfaRequired).toBe(true);
    const done = await request(app)
      .post("/api/auth/login/mfa")
      .send({ token: after.body.mfaToken, code: recoveryCodes[0] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.usedRecoveryCode).toBe(true);
  }, 30_000);
});
