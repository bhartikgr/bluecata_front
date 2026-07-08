/**
 * W2-G — reusable display-name resolver (NON-sacred).
 *
 * Problem: several partner/collective read surfaces JOIN raw userIds against
 * the canonical `users` table, but synthetic ids minted at runtime (e.g. the
 * `u_redeemed_<ts>` personas created in userContext.ts:755 for invite-redeemed
 * users) may not have a matching `users` row. When the JOIN misses, those call
 * sites fell back to a null name — or, worse, surfaced the opaque raw id
 * (`u_redeemed_...`) as if it were a person's name.
 *
 * This module centralises userId -> best-available identity resolution in ONE
 * place so partner Team (W2-G), and the upcoming W3 / W1P userId<->display
 * needs, share a single, well-tested mapping. It reads from (in priority):
 *   1. the canonical `users` table,
 *   2. the durable userCredentialsStore (bcrypt identity, survives restart),
 *   3. getUserContextForId (runtime personas + DB hydration).
 *
 * Hard guarantee: the returned `name` is NEVER a raw "u_..." id. When no human
 * name or email can be resolved, a stable humanised label is returned instead.
 *
 * SACRED: this file does not modify userContext.ts (it only READS via the
 * already-exported getUserContextForId) and touches no sacred store.
 */
import { rawDb } from "../db/connection";
import { getUserContextForId } from "./userContext";
import { lookupByUserId } from "../userCredentialsStore";

export interface ResolvedDisplayName {
  userId: string;
  /** Best human label. Never a raw "u_..." id; falls back to email, then a
   *  humanised placeholder. Safe to render directly in a UI. */
  name: string;
  /** Best resolved email, or null when none is known. */
  email: string | null;
  /** True when a real name or email was found (vs. a placeholder fallback). */
  resolved: boolean;
}

/** A raw platform user id looks like `u_...` (incl. `u_redeemed_...`, `u_public`). */
function isRawUserId(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^u_[A-Za-z0-9_]*$/.test(s.trim());
}

/** Stable, human-friendly placeholder when no name/email is resolvable. */
function humanizeFallback(userId: string): string {
  if (/^u_redeemed_/.test(userId)) return "Invited member";
  if (userId === "u_public") return "Public applicant";
  return "Pending member";
}

/**
 * Resolve a single userId to its best display name + email. Never throws; on
 * total resolution failure returns a humanised placeholder name (never the
 * raw id).
 */
export function resolveDisplayName(userId: string): ResolvedDisplayName {
  const uid = String(userId ?? "").trim();
  let name: string | null = null;
  let email: string | null = null;

  // 1) canonical users table
  try {
    const row = rawDb()
      .prepare("SELECT name, email FROM users WHERE id = ?")
      .get(uid) as { name?: string | null; email?: string | null } | undefined;
    if (row) {
      name = row.name ?? name;
      email = row.email ?? email;
    }
  } catch {
    /* non-fatal — fall through to other sources */
  }

  // 2) durable credential store (survives restart, hydrated from auth_users)
  if (!name || !email) {
    try {
      const cred = lookupByUserId(uid);
      if (cred) {
        email = email ?? (cred.email ?? null);
        name = name ?? (cred.name ?? null);
      }
    } catch {
      /* non-fatal */
    }
  }

  // 3) runtime persona / user-context hydration
  if (!name || !email) {
    try {
      const ctx = getUserContextForId(uid);
      if (ctx?.isAuthed) {
        name = name ?? (ctx.identity?.name || null);
        email = email ?? (ctx.identity?.email || null);
      }
    } catch {
      /* non-fatal */
    }
  }

  // Never surface a raw "u_..." id as a name (the exact bug W2-G fixes).
  if (isRawUserId(name)) name = null;

  const cleanName = name && name.trim() ? name.trim() : null;
  const cleanEmail = email && email.trim() ? email.trim() : null;
  const resolved = !!(cleanName || cleanEmail);
  const display = cleanName ?? cleanEmail ?? humanizeFallback(uid);

  return { userId: uid, name: display, email: cleanEmail, resolved };
}

/** Batch helper — resolves many ids, de-duplicated, into a Map keyed by id. */
export function resolveDisplayNames(
  userIds: readonly string[],
): Map<string, ResolvedDisplayName> {
  const out = new Map<string, ResolvedDisplayName>();
  for (const id of userIds) {
    const key = String(id ?? "").trim();
    if (!out.has(key)) out.set(key, resolveDisplayName(key));
  }
  return out;
}
