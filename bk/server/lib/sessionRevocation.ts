/**
 * Sprint v23 Wave C — FIX C1 (W-2) — Server-side session revocation.
 *
 * Background:
 *   The Capavate auth model uses the SESSION_COOKIE value AS the userId
 *   (see `lib/userContext.ts::resolvePersonaId` and `lib/authRoutes.ts`
 *   `setSessionCookie(res, canonicalId)`). Prior to Wave C, the logout
 *   handler at `server/routes.ts:1789` cleared the cookie on the *client*
 *   only — a captured cookie value (XSS exfil, shoulder-surf, network
 *   capture on a shared box) remained a valid auth token on the server
 *   indefinitely until the user manually rotated.
 *
 * Fix:
 *   Maintain a server-side revocation set keyed by userId. On logout we
 *   add the caller's userId to the set; `resolvePersonaId()` consults the
 *   set and short-circuits to null when the userId is revoked.
 *
 *   A subsequent successful login REMOVES the userId from the set so the
 *   re-issued cookie authenticates normally. This preserves the
 *   "logout then re-login" idempotency QA expects.
 *
 *   The set is in-memory by design — session revocation is a transient
 *   concept tied to active sessions. On server restart the set clears,
 *   but so do all in-memory caches that any attacker would have already
 *   exploited; cookies will continue to identify their userId, and the
 *   user can be re-authed normally. For a Redis-backed deployment we
 *   keep the same interface and let the production wiring swap the
 *   storage (Sprint 29 KL-08 sessionStore pattern).
 *
 * Caller contract:
 *   - revokeSession(userId): mark as revoked
 *   - clearRevocation(userId): undo (called by login)
 *   - isRevoked(userId): check (called by resolvePersonaId)
 *   - _all() / _reset(): test helpers (NOT for production)
 */

const revokedUserIds = new Set<string>();

/** Mark a session userId as revoked. Idempotent. */
export function revokeSession(userId: string): void {
  if (typeof userId === "string" && userId.length > 0) {
    revokedUserIds.add(userId);
  }
}

/** Remove a userId from the revocation set (called on successful login). */
export function clearRevocation(userId: string): void {
  if (typeof userId === "string" && userId.length > 0) {
    revokedUserIds.delete(userId);
  }
}

/** True if the cookie token (=userId) is currently revoked. */
export function isRevoked(userId: string | undefined | null): boolean {
  if (!userId) return false;
  return revokedUserIds.has(userId);
}

/** Test-only: dump the current revocation set. */
export function _allRevoked(): ReadonlySet<string> {
  return revokedUserIds;
}

/** Test-only: clear the set entirely. */
export function _resetRevocation(): void {
  revokedUserIds.clear();
}
