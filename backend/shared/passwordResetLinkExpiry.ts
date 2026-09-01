/**
 * Wave 246 — single source of truth for the password-reset link lifetime and
 * the human phrase that describes it.
 *
 * WHAT WAS WRONG. `client/src/pages/auth/Forgot.tsx` told the user "Magic links
 * expire in 15 minutes" while `server/lib/authRoutes.ts` minted a token that
 * lives for 24 hours, and the reset email said 24 hours. The QA report asked for
 * the EMAIL to be changed to 15 minutes; owner ruling R218.1 established the
 * opposite — the email and the token agree, and the screen was the only liar.
 * There is no 15-minute link mechanism anywhere on this platform: every other
 * "magic link" is 7, 14, 24 or 30 days, and the shortest link TTL in the tree is
 * a 10-minute pitch-deck view link that this page cannot mint.
 *
 * The screen said 15 minutes because the duration was written down twice — once
 * as arithmetic in the route, once as prose in the page — and the two drifted.
 * The fix is the same one Wave 38 applied in `shared/softCircleExpiry.ts`: one
 * module, imported by both sides, so the number the page prints IS the number
 * the route mints. Nothing here changes the token's lifetime; the value below is
 * the 24 hours that `authRoutes.ts` has always used.
 *
 * Deliberately dependency-free so the client bundle, the server route and the
 * tests all load the identical code path.
 */

/** Lifetime of a password-reset link, in whole hours. The one place it is written. */
export const PASSWORD_RESET_TOKEN_TTL_HOURS = 24;

/**
 * The same lifetime in milliseconds, DERIVED — never written a second time.
 * `server/lib/authRoutes.ts` mints `expires_at` from this value.
 */
export const PASSWORD_RESET_TOKEN_TTL_MS =
  PASSWORD_RESET_TOKEN_TTL_HOURS * 60 * 60 * 1_000;

/**
 * The user-facing duration phrase, DERIVED from the same constant that mints the
 * token, so a page printing it cannot disagree with the token it describes.
 * Singular/plural is handled here rather than at each call site, which is the
 * exact drift Wave 38 documented (`day` vs `day(s)`).
 */
export function passwordResetLinkExpiryPhrase(
  hours: number = PASSWORD_RESET_TOKEN_TTL_HOURS,
): string {
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
