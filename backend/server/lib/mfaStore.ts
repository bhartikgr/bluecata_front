/**
 * server/lib/mfaStore.ts — WAVE 305 · R251.
 *
 * THE DURABLE MFA STATE. Every read and write in the MFA feature goes through
 * here. Nothing is held in process memory (owner ruling, verbatim: "No in-memory
 * ANYWHERE. All dynamically db driven.") except the one-time lazy schema
 * bootstrap flag, which is not state — it is a "have I run CREATE TABLE yet".
 *
 * ===========================================================================
 * THE TWO RULES THAT MATTER MORE THAN THE FEATURE
 * ===========================================================================
 *
 * RULE 1 — ENFORCEMENT READS `mfa_enrolment.state`. IT NEVER READS
 *          `auth_users.totp_secret`.
 *
 *   `auth_users.totp_secret` is polluted. The retired scaffold
 *   (`server/lib/secureAuthRoutes.ts` POST /api/auth/secure/2fa/setup) wrote a
 *   secret to it on request, before verifying anything, using an alphabet no
 *   authenticator app can decode. `server/lib/adminUsersRoutes.ts` then DERIVED
 *   "MFA enabled" from `totp_secret != ''`. If the login gate had been wired to
 *   that same derivation, every account carrying a stray scaffold secret would
 *   have been asked for a code it is mathematically unable to produce, and would
 *   have been locked out permanently.
 *
 *   So: `mfaChallengeRequired()` below issues exactly TWO queries, against
 *   `mfa_policy` and `mfa_enrolment`. The string "totp_secret" appears in this
 *   file ONLY inside `secretForVerification()`, which is called after a challenge
 *   has already been decided on and is never consulted to decide one. A test
 *   plants a secret on an account with no enrolment row and asserts the login is
 *   UNCHALLENGED.
 *
 * RULE 2 — BOTH READS FAIL OPEN.
 *
 *   `mfaChallengeRequired()` returns `false` on ANY failure: missing table,
 *   corrupt row, driver outage, unreadable policy, throw of any kind. There is no
 *   configuration that makes it fail closed.
 *
 *   That is the opposite of `accountStatus.evaluateLoginGateForIdentity`, which
 *   fails CLOSED, and the difference is deliberate and worth stating plainly:
 *   failing closed on an account-status read protects the platform from letting a
 *   suspended user in. Failing closed on an MFA read would lock out EVERY user
 *   INCLUDING THE OWNER'S ADMIN ACCOUNT the moment a table read hiccups, during a
 *   launch week in which 38 accounts exist and none is enrolled. The owner's
 *   ruling is explicit: lock-out is the worst outcome, worse than no MFA. A second
 *   factor that is unavailable degrades to a password, which is what the platform
 *   has today. A second factor that is unavailable and mandatory is an outage.
 *
 *   Every fail-open is LOGGED at error level with the reason. Failing open
 *   silently would be the actual defect.
 *
 * ===========================================================================
 * NO MONEY IN THIS FILE. No currency, no amounts, no `Number()` on anything but
 * an integer time counter or a row count. Nothing here can fabricate a zero.
 * ===========================================================================
 */

import crypto from "node:crypto";
import { rawDb } from "../db/connection";
import { getDbDriver } from "../db/connection";
import { hashPassword, verifyPassword as verifyScryptHash } from "./auth";
import { MFA_SCHEMA_SQL } from "./mfaSchema";
import { RFC4648_BASE32_ALPHABET, generateTotpSecret, verifyTotp } from "./mfaTotp";
import { log } from "./logger";

/* ------------------------------------------------------------------------- *
 * Handle + lazy schema bootstrap (the rateLimitStore.ts arrangement).
 * ------------------------------------------------------------------------- */

let bootstrapped = false;

/**
 * The durable handle, bootstrapping the schema on first use. Returns null rather
 * than throwing, because every caller here is on the login path and an Express
 * middleware must not receive a throw from a second-factor lookup.
 */
function store(): any {
  if (getDbDriver() === "postgres") return null;
  let db: any;
  try {
    db = rawDb();
  } catch {
    return null;
  }
  if (!db) return null;
  if (!bootstrapped) {
    try {
      /* Executes the canonical migration text VERBATIM. Every statement is
       * CREATE ... IF NOT EXISTS / INSERT OR IGNORE, so this is safe on a
       * database the migration runner has already migrated. */
      db.exec(MFA_SCHEMA_SQL);
      bootstrapped = true;
    } catch (e) {
      log.error?.(`[mfaStore] schema bootstrap failed: ${(e as Error)?.message ?? String(e)}`);
      return null;
    }
  }
  return db;
}

/**
 * Make the MFA tables exist. Callers that only READ (the admin user list) need
 * this, because otherwise their read fails on a database the migration runner has
 * not touched and the screen would render "no MFA" for everybody — a false
 * negative rather than an honest unknown.
 *
 * Returns false rather than throwing. Never a hard dependency.
 */
export function ensureMfaSchema(): boolean {
  return store() != null;
}

/**
 * TEST SEAM — force a read to fail, to prove the fail-open is real.
 *
 * The scope argument matters and is not decoration. `mfaChallengeRequired` reads
 * the policy FIRST and returns as soon as that read fails, so an injection that
 * fails BOTH reads can only ever exercise the first fail-open — the second one
 * would be unreachable, and a test using it could not tell a working
 * enrolment-read fail-open from a missing one. This was found by disarming the
 * second fail-open and watching the suite stay GREEN (W305 disarm D2b). The
 * scopes exist so each fail-open can be proved on its own.
 */
export type MfaReadFailureScope = "all" | "policy" | "enrolment";
let forcedReadFailure: string | null = null;
let forcedReadFailureScope: MfaReadFailureScope = "all";
export function __forceMfaReadFailureForTest(reason: string | null, scope: MfaReadFailureScope = "all"): void {
  forcedReadFailure = reason;
  forcedReadFailureScope = reason == null ? "all" : scope;
}
function forcedFailureFor(which: "policy" | "enrolment"): string | null {
  if (!forcedReadFailure) return null;
  if (forcedReadFailureScope === "all" || forcedReadFailureScope === which) return forcedReadFailure;
  return null;
}

/* ------------------------------------------------------------------------- *
 * Policy
 * ------------------------------------------------------------------------- */

export type MfaPolicyMode = "off" | "enrolled_only";

/** The only two values the CHECK constraint permits. Asserted by test. */
export const MFA_POLICY_MODES: readonly MfaPolicyMode[] = ["off", "enrolled_only"] as const;

export type PolicyRead = { ok: true; mode: MfaPolicyMode } | { ok: false; reason: string };

export function readPolicyMode(): PolicyRead {
  const forced = forcedFailureFor("policy");
  if (forced) return { ok: false, reason: `forced: ${forced}` };
  const db = store();
  if (!db) return { ok: false, reason: "no database handle" };
  try {
    const row = db.prepare(`SELECT mode FROM mfa_policy WHERE id = 1`).get() as { mode?: string } | undefined;
    const mode = row?.mode;
    if (mode !== "off" && mode !== "enrolled_only") {
      /* An unreadable or unexpected policy value is a fail-open, not a guess. */
      return { ok: false, reason: `policy row absent or unrecognised (mode=${String(mode)})` };
    }
    return { ok: true, mode };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

/* ------------------------------------------------------------------------- *
 * Enrolment
 * ------------------------------------------------------------------------- */

export type MfaEnrolmentState = "pending" | "confirmed" | "disabled";

export type EnrolmentRead =
  | { ok: true; state: MfaEnrolmentState | null; lastUsedStep: number | null }
  | { ok: false; reason: string };

/** Reads `mfa_enrolment`. `state: null` means "no row" — i.e. never enrolled. */
export function readEnrolment(userId: string): EnrolmentRead {
  const forced = forcedFailureFor("enrolment");
  if (forced) return { ok: false, reason: `forced: ${forced}` };
  const db = store();
  if (!db) return { ok: false, reason: "no database handle" };
  try {
    const row = db
      .prepare(`SELECT state, last_used_step AS lastUsedStep FROM mfa_enrolment WHERE user_id = ?`)
      .get(userId) as { state?: string; lastUsedStep?: number | null } | undefined;
    if (!row) return { ok: true, state: null, lastUsedStep: null };
    const s = row.state;
    if (s !== "pending" && s !== "confirmed" && s !== "disabled") {
      return { ok: false, reason: `unrecognised enrolment state ${String(s)}` };
    }
    return { ok: true, state: s, lastUsedStep: row.lastUsedStep ?? null };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

/* ------------------------------------------------------------------------- *
 * THE GATE. This is the function the login route calls.
 * ------------------------------------------------------------------------- */

export type ChallengeDecision = {
  /** True ONLY when the policy honours enrolments AND this user has a confirmed one. */
  required: boolean;
  /** Why, in words an operator can act on. Never null. */
  because: string;
  /** True when a read failed and we let the login through anyway. */
  failedOpen: boolean;
};

/**
 * Decide whether this login must be challenged.
 *
 * TWO READS, BOTH FAIL OPEN. `auth_users.totp_secret` IS NOT CONSULTED.
 */
export function mfaChallengeRequired(userId: string): ChallengeDecision {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    return { required: false, because: "no resolved user id", failedOpen: false };
  }
  const policy = readPolicyMode();
  if (!policy.ok) {
    log.error?.(
      `[mfaStore] FAIL-OPEN: could not read mfa_policy (${policy.reason}) — login for ${userId} proceeds WITHOUT a second factor. This is deliberate (lock-out is worse than no MFA) but it means MFA is currently not being enforced for anyone. Investigate immediately.`,
    );
    return { required: false, because: `policy read failed: ${policy.reason}`, failedOpen: true };
  }
  if (policy.mode === "off") {
    return { required: false, because: "policy mode is off", failedOpen: false };
  }
  const enrolment = readEnrolment(userId);
  if (!enrolment.ok) {
    log.error?.(
      `[mfaStore] FAIL-OPEN: could not read mfa_enrolment for ${userId} (${enrolment.reason}) — login proceeds WITHOUT a second factor. Deliberate; investigate.`,
    );
    return { required: false, because: `enrolment read failed: ${enrolment.reason}`, failedOpen: true };
  }
  if (enrolment.state !== "confirmed") {
    return {
      required: false,
      because: `enrolment state is ${enrolment.state === null ? "absent (never enrolled)" : enrolment.state}`,
      failedOpen: false,
    };
  }
  return { required: true, because: "policy is enrolled_only and this account has a confirmed enrolment", failedOpen: false };
}

/* ------------------------------------------------------------------------- *
 * The secret. Read ONLY to verify a code, never to decide a challenge.
 * ------------------------------------------------------------------------- */

/**
 * The stored TOTP secret for a user.
 *
 * THE ONLY PLACE IN THIS FILE THAT READS A SECRET AT ALL, and it reads
 * `mfa_enrolment.totp_secret` — NOT `auth_users.totp_secret`. The `auth_users`
 * column is polluted by the retired scaffold and is neither read nor written by
 * this wave. Called only AFTER `mfaChallengeRequired` has already returned
 * `required: true`, so a secret can never, on its own, cause a challenge.
 */
function secretForVerification(userId: string): string | null {
  const db = store();
  if (!db) return null;
  try {
    const row = db.prepare(`SELECT totp_secret AS s FROM mfa_enrolment WHERE user_id = ?`).get(userId) as
      | { s?: string | null }
      | undefined;
    const s = row?.s;
    return typeof s === "string" && s.length > 0 ? s : null;
  } catch (e) {
    log.error?.(`[mfaStore] secret read failed for ${userId}: ${(e as Error)?.message ?? String(e)}`);
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 * Enrolment lifecycle
 * ------------------------------------------------------------------------- */

export type BeginResult =
  | { ok: true; secret: string; alreadyConfirmed: false }
  | { ok: false; error: "MFA_UNAVAILABLE" | "ALREADY_CONFIRMED"; message: string };

/**
 * Start (or restart) enrolment. Writes a FRESH secret and a `pending` row.
 *
 * Writing the secret here is safe — which is the whole point of RULE 1. A pending
 * row is never challenged and the secret is never read by the gate, so an
 * abandoned enrolment leaves the account exactly as reachable as before. The
 * scaffold's real defect was not "writes early"; it was that a written secret was
 * elsewhere treated as proof of a working second factor.
 *
 * Refuses to overwrite a CONFIRMED enrolment: re-enrolling must go through
 * `disableEnrolment` first, so a stolen session cannot silently swap the factor.
 */
export function beginEnrolment(userId: string): BeginResult {
  const db = store();
  if (!db) return { ok: false, error: "MFA_UNAVAILABLE", message: "Two-factor setup is temporarily unavailable. Your password still works normally." };
  const existing = readEnrolment(userId);
  if (existing.ok && existing.state === "confirmed") {
    return { ok: false, error: "ALREADY_CONFIRMED", message: "This account already has two-factor authentication switched on. Turn it off first if you want to set it up again." };
  }
  const secret = generateTotpSecret();
  const now = Date.now();
  try {
    /* ONE ROW, ONE WRITE. The secret goes on the enrolment row, so an account
     * with no `auth_users` row (every legacy/seeded persona) can still enrol —
     * and so nothing in this feature ever writes the polluted column. */
    db.prepare(
      `INSERT INTO mfa_enrolment (user_id, method, state, confirmed_at, last_used_step, disabled_at, totp_secret, created_at, updated_at)
       VALUES (?, 'totp', 'pending', NULL, NULL, NULL, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         state = 'pending', confirmed_at = NULL, last_used_step = NULL, disabled_at = NULL,
         totp_secret = excluded.totp_secret, updated_at = excluded.updated_at`,
    ).run(userId, secret, now, now);
  } catch (e) {
    log.error?.(`[mfaStore] beginEnrolment failed for ${userId}: ${(e as Error)?.message ?? String(e)}`);
    return { ok: false, error: "MFA_UNAVAILABLE", message: "Two-factor setup is temporarily unavailable. Your password still works normally." };
  }
  return { ok: true, secret, alreadyConfirmed: false };
}

export type ConfirmResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; error: "NO_PENDING_ENROLMENT" | "BAD_CODE" | "REPLAYED_CODE" | "MFA_UNAVAILABLE"; message: string };

/**
 * Confirm enrolment with a live code.
 *
 * RECOVERY CODES ARE ISSUED IN THE SAME TRANSACTION THAT SETS `confirmed`.
 * The owner's requirement is that recovery exists BEFORE enforcement; the only way
 * to make that unconditional rather than a convention is to make the two writes
 * atomic. If the codes cannot be written, the state does not move and the account
 * remains unchallenged.
 */
export function confirmEnrolment(userId: string, code: string, nowMs: number): ConfirmResult {
  const db = store();
  if (!db) return { ok: false, error: "MFA_UNAVAILABLE", message: "Two-factor setup is temporarily unavailable. Your password still works normally." };
  const existing = readEnrolment(userId);
  if (!existing.ok || existing.state !== "pending") {
    return { ok: false, error: "NO_PENDING_ENROLMENT", message: "Start the two-factor setup again — there is nothing waiting to be confirmed." };
  }
  const secret = secretForVerification(userId);
  if (!secret) {
    return { ok: false, error: "NO_PENDING_ENROLMENT", message: "Start the two-factor setup again — there is nothing waiting to be confirmed." };
  }
  const v = verifyTotp(secret, code, nowMs);
  if (!v.ok) {
    return { ok: false, error: "BAD_CODE", message: "That code is not right. Check your authenticator app and try the current code." };
  }
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  const now = Date.now();
  try {
    db.transaction(() => {
      for (const p of plain) {
        db.prepare(`INSERT INTO mfa_recovery_code (user_id, code_hash, used_at, created_at) VALUES (?, ?, NULL, ?)`).run(
          userId,
          hashPassword(p),
          now,
        );
      }
      db.prepare(
        `UPDATE mfa_enrolment SET state = 'confirmed', confirmed_at = ?, last_used_step = ?, updated_at = ? WHERE user_id = ?`,
      ).run(now, v.step, now, userId);
    })();
  } catch (e) {
    log.error?.(`[mfaStore] confirmEnrolment failed for ${userId}: ${(e as Error)?.message ?? String(e)}`);
    return { ok: false, error: "MFA_UNAVAILABLE", message: "Two-factor setup could not be completed. Nothing was changed and your password still works normally." };
  }
  return { ok: true, recoveryCodes: plain };
}

/** Switch the factor off. Recovery codes are invalidated by being marked used. */
export function disableEnrolment(userId: string, atMs: number): { ok: boolean; priorState: MfaEnrolmentState | null; invalidated: number } {
  const db = store();
  if (!db) return { ok: false, priorState: null, invalidated: 0 };
  const existing = readEnrolment(userId);
  const priorState = existing.ok ? existing.state : null;
  let invalidated = 0;
  try {
    db.transaction(() => {
      const r = db.prepare(`UPDATE mfa_recovery_code SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).run(atMs, userId);
      invalidated = Number(r?.changes ?? 0);
      db.prepare(
        `UPDATE mfa_enrolment SET state = 'disabled', disabled_at = ?, last_used_step = NULL, updated_at = ? WHERE user_id = ?`,
      ).run(atMs, atMs, userId);
      /* The secret is cleared too: a disabled enrolment must not leave a live
       * shared secret lying in the users table. NOT a delete of a row (R195.5) —
       * the enrolment row survives, carrying its history. */
      db.prepare(`UPDATE mfa_enrolment SET totp_secret = NULL WHERE user_id = ?`).run(userId);
    })();
  } catch (e) {
    log.error?.(`[mfaStore] disableEnrolment failed for ${userId}: ${(e as Error)?.message ?? String(e)}`);
    return { ok: false, priorState, invalidated: 0 };
  }
  return { ok: true, priorState, invalidated };
}

/* ------------------------------------------------------------------------- *
 * Challenge verification, with REPLAY REFUSAL
 * ------------------------------------------------------------------------- */

export type ChallengeResult =
  | { ok: true; via: "totp" | "recovery_code"; recoveryCodesRemaining?: number }
  | {
      ok: false;
      error: "NOT_ENROLLED" | "BAD_CODE" | "REPLAYED_CODE" | "RECOVERY_EXHAUSTED" | "MFA_UNAVAILABLE";
      message: string;
    };

/**
 * Verify a challenge response: a TOTP code, or a single-use recovery code.
 *
 * REPLAY REFUSAL — `mfa_enrolment.last_used_step` is compared and then advanced in
 * ONE `UPDATE ... WHERE last_used_step IS NULL OR last_used_step < ?`. The refusal
 * is the row count of that statement, not a read-then-write, so two concurrent
 * submissions of the same code cannot both win.
 */
export function verifyChallenge(userId: string, code: string, nowMs: number): ChallengeResult {
  const db = store();
  if (!db) return { ok: false, error: "MFA_UNAVAILABLE", message: "We cannot check your code right now. Please try again in a moment." };
  const enrolment = readEnrolment(userId);
  if (!enrolment.ok || enrolment.state !== "confirmed") {
    return { ok: false, error: "NOT_ENROLLED", message: "This account does not have two-factor authentication switched on." };
  }

  const submitted = typeof code === "string" ? code.replace(/\s/g, "") : "";

  /* A recovery code is 10 characters from the base32 alphabet; a TOTP code is 6
   * digits. The two shapes cannot collide, so the branch is unambiguous. */
  if (/^[0-9]{6}$/.test(submitted)) {
    const secret = secretForVerification(userId);
    if (!secret) return { ok: false, error: "NOT_ENROLLED", message: "This account does not have two-factor authentication switched on." };
    const v = verifyTotp(secret, submitted, nowMs);
    if (!v.ok) return { ok: false, error: "BAD_CODE", message: "That code is not right. Check your authenticator app and try the current code." };
    let changes = 0;
    try {
      const r = db
        .prepare(
          `UPDATE mfa_enrolment SET last_used_step = ?, updated_at = ?
           WHERE user_id = ? AND (last_used_step IS NULL OR last_used_step < ?)`,
        )
        .run(v.step, Date.now(), userId, v.step);
      changes = Number(r?.changes ?? 0);
    } catch (e) {
      log.error?.(`[mfaStore] replay-guard write failed for ${userId}: ${(e as Error)?.message ?? String(e)}`);
      return { ok: false, error: "MFA_UNAVAILABLE", message: "We cannot check your code right now. Please try again in a moment." };
    }
    if (changes !== 1) {
      return {
        ok: false,
        error: "REPLAYED_CODE",
        message: "That code has already been used. Wait for your authenticator app to show the next one.",
      };
    }
    return { ok: true, via: "totp" };
  }

  return consumeRecoveryCode(db, userId, submitted, nowMs);
}

/* ------------------------------------------------------------------------- *
 * Recovery codes
 * ------------------------------------------------------------------------- */

/** Ten codes. Enough that a user can lose most of them; few enough to print. */
export const RECOVERY_CODE_COUNT = 10;

/** Ten characters from the RFC 4648 base32 alphabet — no 0/1/8/9 to misread. */
export const RECOVERY_CODE_LENGTH = 10;

function generateRecoveryCode(): string {
  const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    out += RFC4648_BASE32_ALPHABET[bytes[i]! % RFC4648_BASE32_ALPHABET.length];
  }
  return out;
}

function consumeRecoveryCode(db: any, userId: string, submitted: string, nowMs: number): ChallengeResult {
  let rows: Array<{ id: number; codeHash: string }>;
  try {
    rows = db
      .prepare(`SELECT id, code_hash AS codeHash FROM mfa_recovery_code WHERE user_id = ? AND used_at IS NULL ORDER BY id`)
      .all(userId) as Array<{ id: number; codeHash: string }>;
  } catch (e) {
    log.error?.(`[mfaStore] recovery read failed for ${userId}: ${(e as Error)?.message ?? String(e)}`);
    return { ok: false, error: "MFA_UNAVAILABLE", message: "We cannot check your code right now. Please try again in a moment." };
  }
  if (rows.length === 0) {
    /* COUNT EXHAUSTION IS ITS OWN ANSWER (R254.3 — the copy must be true in every
     * branch). "That code is not right" would be a lie when the truth is "you have
     * no codes left", and it would send the user hunting for a typo forever. */
    return {
      ok: false,
      error: "RECOVERY_EXHAUSTED",
      message:
        "All of your backup codes have already been used. Ask an administrator to reset two-factor authentication on your account.",
    };
  }
  const upper = submitted.toUpperCase();
  for (const r of rows) {
    let match = false;
    try {
      match = verifyScryptHash(upper, r.codeHash);
    } catch {
      match = false;
    }
    if (!match) continue;
    let changes = 0;
    try {
      /* SINGLE-USE, enforced by `used_at IS NULL` in the WHERE clause rather than
       * by having just read it. Two concurrent uses cannot both succeed. */
      const res = db.prepare(`UPDATE mfa_recovery_code SET used_at = ? WHERE id = ? AND used_at IS NULL`).run(nowMs, r.id);
      changes = Number(res?.changes ?? 0);
    } catch (e) {
      log.error?.(`[mfaStore] recovery consume failed for ${userId}: ${(e as Error)?.message ?? String(e)}`);
      return { ok: false, error: "MFA_UNAVAILABLE", message: "We cannot check your code right now. Please try again in a moment." };
    }
    if (changes !== 1) {
      return {
        ok: false,
        error: "REPLAYED_CODE",
        message: "That backup code has already been used. Each one works once only.",
      };
    }
    return { ok: true, via: "recovery_code", recoveryCodesRemaining: rows.length - 1 };
  }
  return { ok: false, error: "BAD_CODE", message: "That code is not right. Check your authenticator app and try the current code." };
}

/** How many unused recovery codes remain. `null` when the read fails. */
export function unusedRecoveryCodeCount(userId: string): number | null {
  const db = store();
  if (!db) return null;
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM mfa_recovery_code WHERE user_id = ? AND used_at IS NULL`)
      .get(userId) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 * Admin reset — the path that MUST leave an audit row (R253)
 * ------------------------------------------------------------------------- */

export type AdminResetResult =
  | { ok: true; priorState: MfaEnrolmentState | null; invalidated: number }
  | { ok: false; error: "MFA_UNAVAILABLE"; message: string };

/**
 * An administrator clears another account's second factor.
 *
 * This is the break-glass path. It writes state AND an audit row; the audit row is
 * written by the ROUTE (server/lib/mfaRoutes.ts) so that the actor and reason come
 * from the request rather than being invented here.
 */
export function adminResetEnrolment(userId: string, atMs: number): AdminResetResult {
  const r = disableEnrolment(userId, atMs);
  if (!r.ok) {
    return { ok: false, error: "MFA_UNAVAILABLE", message: "The reset could not be completed. Nothing was changed." };
  }
  return { ok: true, priorState: r.priorState, invalidated: r.invalidated };
}

/** Set the platform policy. Refused by the DATABASE for any value off-domain. */
export function setPolicyMode(mode: string, actorId: string, atMs: number): { ok: boolean; reason?: string } {
  const db = store();
  if (!db) return { ok: false, reason: "no database handle" };
  try {
    db.prepare(
      `INSERT INTO mfa_policy (id, mode, scope_json, updated_by, updated_at) VALUES (1, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(mode, actorId, atMs);
    return { ok: true };
  } catch (e) {
    /* The CHECK constraint refusing a third value arrives here. NOT swallowed. */
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}
