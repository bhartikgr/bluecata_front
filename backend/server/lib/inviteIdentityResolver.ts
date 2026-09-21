/**
 * slide13b A0 — durable identity binding for team invitations only.
 * Never use persona/credential caches or login's first-row convenience lookup
 * as proof of ownership. Missing tables/read errors are NOT a new identity.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

export type InvitedIdentity =
  | { kind: "none" }
  | { kind: "single"; userId: string }
  | { kind: "ambiguous" }
  | { kind: "deleted" }
  | { kind: "unavailable" };

export function resolveInvitedIdentityStrict(email: string): InvitedIdentity {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { kind: "unavailable" };
  try {
    const db = rawDb();
    return db.transaction((): InvitedIdentity => {
      const users = db.prepare(
        /* TENANT-SCOPE-EXEMPT: SLIDE13B_INVITED_IDENTITY_GLOBAL */
        "SELECT id, email, deleted_at FROM users WHERE lower(email) = ? OR lower(trim(email)) = ?",
      ).all(normalized, normalized) as { id: string; email: string; deleted_at: string | null }[];
      const auth = db.prepare(
        "SELECT id, email, status FROM auth_users WHERE lower(email) = ? OR lower(trim(email)) = ?",
      ).all(normalized, normalized) as { id: string; email: string; status: string }[];
      const credentials = db.prepare(
        "SELECT user_id, email, deleted_at FROM user_credentials WHERE lower(email) = ? OR lower(trim(email)) = ?",
      ).all(normalized, normalized) as { user_id: string; email: string; deleted_at: string | null }[];
      // Canonical login matches lower(email), not lower(trim(email)). Detect
      // trim-only rows as a data conflict: neither an endless login loop nor
      // silent new signup is safe. No index/schema changes in this wave.
      if ([...users, ...auth, ...credentials].some(r => r.email.toLowerCase() !== normalized)) {
        log.warn("[inviteIdentityResolver] non-canonical stored email requires reconciliation");
        return { kind: "ambiguous" };
      }
      const liveCredentials = credentials.filter(c => c.deleted_at == null);
      const ids = [...users.map(u => u.id), ...auth.map(u => u.id), ...credentials.map(c => c.user_id)];
      if (ids.some(id => typeof id !== "string" || !id.trim())) return { kind: "unavailable" };
      const distinct = new Set(ids);
      if (distinct.size > 1 || users.length > 1 || auth.length > 1 || credentials.length > 1) {
        // No token, credential material, email or candidate IDs in public output.
        log.warn("[inviteIdentityResolver] conflicting durable identity rows", {
          users: users.length, authUsers: auth.length, credentials: liveCredentials.length,
        });
        return { kind: "ambiguous" };
      }
      if (users.some(u => u.deleted_at != null) || credentials.some(c => c.deleted_at != null) ||
          auth.some(u => u.status?.trim().toLowerCase() === "deleted")) {
        return { kind: "deleted" };
      }
      // A tombstone is not proof of a genuinely new identity. Refuse rather
      // than resurrect it, even when no live user/auth row remains (H3-b).
      if (distinct.size === 0) return { kind: "none" };
      return { kind: "single", userId: [...distinct][0] };
    })();
  } catch {
    log.warn("[inviteIdentityResolver] durable identity lookup unavailable");
    return { kind: "unavailable" };
  }
}

/** Must run inside the signup transaction, against SQL rather than caches. */
export function isNewInvitePersonaDurable(email: string, userId: string): boolean {
  const identity = resolveInvitedIdentityStrict(email);
  if (identity.kind !== "single" || identity.userId !== userId) return false;
  const db = rawDb();
  const user = db.prepare(
    /* TENANT-SCOPE-EXEMPT: SLIDE13B_NEW_IDENTITY_DURABILITY */
    "SELECT id FROM users WHERE id = ? AND lower(email) = ? AND deleted_at IS NULL",
  ).get(userId, email.trim().toLowerCase());
  const credential = db.prepare(
    `SELECT user_id FROM user_credentials
       WHERE user_id = ? AND lower(email) = ? AND deleted_at IS NULL
         AND length(trim(password_hash)) > 0`,
  ).get(userId, email.trim().toLowerCase());
  // The strict resolver also reads auth_users and refuses cross-store conflict.
  return !!user && !!credential;
}
