/**
 * WAVE 341 (productgaps2) · W335 — THE LEGAL PAGES SWITCHED THE SIDEBAR TO THE
 * FOUNDER WORKSPACE.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, MEASURED ON THE CODE, NOT ASSUMED.
 *
 *   1. `client/src/App.tsx:628–637` registers the legal pages as PUBLIC routes
 *      with no shell: `/terms`, `/terms-of-service`, `/privacy`,
 *      `/privacy-policy`, `/legal/:docId`.
 *   2. `AppRouter` (`App.tsx:~1670`) ends `return bare ? routes : <AppShell>…`.
 *      `isAuthRoute` (`:443`) makes a path bare when it `startsWith("/collective/")`
 *      — but NOT for the five legal paths above. So a signed-in visitor on
 *      `/terms-of-service` is wrapped in **`AppShell`**.
 *   3. `AppShell` (`AppShell.tsx:~810`) derives its scope from the URL:
 *      `/admin` → admin, `/investor` → investor, `/founder` → founder, and
 *      **otherwise it falls back to the role in context, defaulting to
 *      `"founder"`**. `/terms-of-service` matches none of the three prefixes.
 *   4. Every Consortium Partner and Collective page is under `/collective/…`
 *      and renders inside `CollectiveShell`, which mounts `LegalFooterLinks`
 *      (`CollectiveShell.tsx:787`). Following that footer link therefore takes
 *      a partner out of their own rail and into the FOUNDER workspace sidebar.
 *
 * THE FIX FOLLOWS THE CONFIRMED PRECEDENT AT `App.tsx:1313`, which registers
 * `/collective/partner/privacy` onto the SAME component inside `CollectiveShell`.
 * Shell-scoped ALIASES are added onto the SAME legal components — no new page,
 * no second source of truth, and the bare public routes are UNTOUCHED, so
 * founder, investor, admin and anonymous visitors reach them exactly as before
 * and nothing is deleted (R195.5).
 *
 * WHY TWO SCOPES AND NOT ONE. `CollectiveShell` derives its own theme from the
 * URL as well (`CollectiveShell.tsx:750`): `data-product="partner"` iff the
 * path starts with `/collective/partner`, else `"collective"`. Sending a
 * Collective MEMBER to a `/collective/partner/…` alias would silently re-theme
 * their page as a partner page. So each shell scope gets its own alias and this
 * helper picks the one that matches where the visitor already is.
 */

/** The three legal paths that exist as bare public routes. */
export const LEGAL_PUBLIC_PATHS = {
  terms: "/terms-of-service",
  privacy: "/privacy-policy",
  doc: "/legal",
} as const;

export const LEGAL_SCOPE_PARTNER = "/collective/partner";
export const LEGAL_SCOPE_COLLECTIVE = "/collective";

/**
 * The prefix the legal links should carry for the shell the visitor is in.
 *
 * `""` means "leave the public path alone": that is the correct answer for
 * founder, investor, admin and anonymous visitors, whose shell already derives
 * the right scope from their role. Only the two `CollectiveShell` scopes need a
 * prefix, because their scope comes from the URL and a bare legal URL loses it.
 */
export function legalScopeForLocation(location: string): string {
  if (location.startsWith(LEGAL_SCOPE_PARTNER)) return LEGAL_SCOPE_PARTNER;
  if (location.startsWith(`${LEGAL_SCOPE_COLLECTIVE}/`)) return LEGAL_SCOPE_COLLECTIVE;
  return "";
}

/** `legalHref(scope, LEGAL_PUBLIC_PATHS.terms)` → `/collective/partner/terms-of-service`. */
export function legalHref(scope: string, publicPath: string): string {
  return `${scope}${publicPath}`;
}
