/**
 * Wave 38 · Row 5 — single source of truth for soft-circle expiry arithmetic
 * and the investor-facing banner copy.
 *
 * Before Wave 38 this logic existed TWICE: once in
 * `server/lib/softCircleExpiryRunner.ts` (the runner that actually lapses a
 * soft-circle) and once, re-implemented, in
 * `client/src/components/SoftCircleExpiryBanner.tsx`. The two copies produced
 * the same NUMBER but different TEXT — the client said `day(s)` while the
 * server said `day` / `days` — so the banner could never have been "verbatim"
 * with the runner it claims to mirror. Both now import this module; neither
 * re-implements it.
 *
 * Deliberately dependency-free so the client bundle, the server runner and the
 * tests all load the identical code path.
 */

export const SOFT_CIRCLE_EXPIRY_DAYS = 14;

/**
 * Whole days remaining before a soft-circle lapses. Clamped at 0 — the runner,
 * not the UI, decides what happens at zero.
 *
 * `softCircledAt` must be an ISO timestamp that came from the database. An
 * unparseable value yields `null` (an explicit refusal) rather than `NaN` or a
 * guessed date.
 */
export function daysRemaining(softCircledAt: string, now: Date = new Date()): number | null {
  const startMs = new Date(softCircledAt).getTime();
  if (!Number.isFinite(startMs)) return null;
  const expiresAtMs = startMs + SOFT_CIRCLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiresAtMs - now.getTime()) / (24 * 60 * 60 * 1000)));
}

/** The verbatim investor-facing copy. `null` when the input is not a usable timestamp. */
export function expiryBannerCopy(softCircledAt: string, now: Date = new Date()): string | null {
  const n = daysRemaining(softCircledAt, now);
  if (n === null) return null;
  return expiryBannerCopyForDays(n);
}

/** Copy for an already-computed day count. Shared so the banner cannot drift. */
export function expiryBannerCopyForDays(daysLeft: number): string {
  return `Your soft-circle expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — confirm or release`;
}
