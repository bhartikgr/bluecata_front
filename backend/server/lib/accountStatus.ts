/**
 * server/lib/accountStatus.ts — v25.48.2 Q5 (Ozan).
 *
 * DB-driven account-status lookup for the login gate. A suspended / inactive /
 * archived account must NOT be able to authenticate (Q5=(a)). The authoritative
 * store for a login account's lifecycle status is the `auth_users` table
 * (status column, written by the admin users PATCH route). We read it live per
 * login attempt — no in-memory canonical state.
 *
 * Returns the lowercased status string, or null when no auth_users row exists
 * for the email (runtime founders / demo personas that predate auth_users are
 * treated as active — their absence from auth_users means no suspension was
 * ever applied).
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

/** Statuses that must block login (fail-closed on the login path). */
const BLOCKED_STATUSES = new Set(["suspended", "inactive", "archived", "disabled"]);

export function getAccountStatusByEmail(email: string): string | null {
  const emailLc = (email || "").trim().toLowerCase();
  if (!emailLc) return null;
  const row = rawDb()
    .prepare(`SELECT status FROM auth_users WHERE lower(email) = ? LIMIT 1`)
    .get(emailLc) as { status?: string } | undefined;
  if (!row || row.status == null) return null;
  return String(row.status).trim().toLowerCase();
}

/**
 * v25.48.2 MF-A / MF-E — authoritative status lookup keyed by the resolved
 * user/persona id (auth_users.id, the primary key). This is the identity a
 * session actually carries, so it is the correct thing to gate on. Returns the
 * lowercased status, or null when no auth_users row exists for the id (demo /
 * runtime personas that predate auth_users are treated as active — their
 * absence means no suspension was ever applied). Throws on a DB/read error so
 * callers fail CLOSED.
 */
export function getAccountStatusByUserId(userId: string): string | null {
  const id = (userId || "").trim();
  if (!id) return null;
  const row = rawDb()
    .prepare(`SELECT status FROM auth_users WHERE id = ? LIMIT 1`)
    .get(id) as { status?: string } | undefined;
  if (!row || row.status == null) return null;
  return String(row.status).trim().toLowerCase();
}

/** True when the given status string denotes a login-blocked account. */
export function isBlockedAccountStatus(status: string | null): boolean {
  if (!status) return false;
  return BLOCKED_STATUSES.has(status.trim().toLowerCase());
}

/**
 * v25.48.2 MF2 (Q5) — discriminated login-gate result. The status lookup must
 * FAIL CLOSED: a DB/schema/read ERROR is NOT the same as a legitimate "no row"
 * (which means the account was never suspended and may proceed). We therefore
 * distinguish three outcomes so authRoutes can deny WITHOUT issuing a session
 * when the lookup threw.
 *
 *   - { decision: "allow" }               → no blocking status; proceed.
 *   - { decision: "block"; status }       → suspended/inactive/archived; 403.
 *   - { decision: "error"; message }      → lookup threw; deny (503), no session.
 */
export type LoginGateResult =
  | { decision: "allow" }
  | { decision: "block"; status: string }
  | { decision: "error"; message: string };

/**
 * Resolve + evaluate the login gate for an email. Fail-closed on lookup errors.
 */
export function evaluateLoginGate(email: string): LoginGateResult {
  return evaluateLoginGateForIdentity({ email });
}

/**
 * v25.48.2 MF-A — evaluate the login gate against the AUTHORITATIVE identity of
 * the resolved user/persona. The prior email-only gate fail-OPENED when a
 * caller supplied a known `userId` WITHOUT an email: `getAccountStatusByEmail("")`
 * returned null → "allow" → a suspended canonical/demo/admin persona could log
 * in by userId+password with the DB status never checked.
 *
 * We now resolve status by the RESOLVED userId FIRST (the identity the session
 * will actually carry). Only when no auth_users row exists for that id do we
 * fall back to the email (covers legacy callers that pass email but no id). A
 * DB/read error on EITHER lookup fails CLOSED (decision "error" → deny). If
 * neither identity yields a row, the account was never suspended → allow.
 */
export function evaluateLoginGateForIdentity(identity: { userId?: string | null; email?: string | null }): LoginGateResult {
  try {
    let status: string | null = null;
    if (identity.userId) status = getAccountStatusByUserId(identity.userId);
    if (status == null && identity.email) status = getAccountStatusByEmail(identity.email);
    if (isBlockedAccountStatus(status)) {
      return { decision: "block", status: status as string };
    }
    return { decision: "allow" };
  } catch (err) {
    // A read/schema error must NOT fail-open. Deny login (no session issued).
    const message = (err as Error).message;
    log.warn(`[accountStatus] status lookup failed — failing closed: ${message}`);
    return { decision: "error", message };
  }
}
