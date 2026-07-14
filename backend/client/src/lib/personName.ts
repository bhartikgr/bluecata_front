/**
 * W3.2 — client-only person-name display guards (NON-sacred).
 *
 * Email is contact information, not a display name. Opaque platform ids
 * (`u_founder_*`, `u_redeemed_*`, etc.) must never be shown in a name slot.
 * These helpers are pure/dependency-free so any client DTO (e.g. useMe.ts)
 * can guard a name value before rendering it as a person's display name.
 */

/** True when the value looks like an email address. */
export function isEmailLike(v: string | null | undefined): boolean {
  if (!v) return false;
  const t = v.trim();
  return t.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

/** True when the value is a raw opaque platform user id (e.g. `u_founder_abc`). */
export function isOpaqueUserId(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^u_[A-Za-z0-9_]*$/.test(v.trim());
}

/**
 * Returns `value` when it is a safe, human display name (not email-like, not
 * a raw opaque id, not blank); otherwise returns `fallback`. Never throws.
 */
export function safePersonDisplayName(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;
  if (isEmailLike(trimmed)) return fallback;
  if (isOpaqueUserId(trimmed)) return fallback;
  return trimmed;
}
