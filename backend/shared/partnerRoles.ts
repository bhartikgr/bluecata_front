/**
 * w-partner F-new2 — the SINGLE source of truth for which Consortium Partner
 * permission tiers may write a portfolio company's private profile.
 *
 * The server guard (`assertSubRole(...)` on PATCH /api/partner/me/portfolio/:id)
 * and the client `canEdit` predicate MUST both read this constant. They had
 * diverged: create allowed `bd` (partnerPortfolioCompanyRoutes.ts:39) while the
 * profile PATCH allowed only managing_partner|associate, so a `bd` user could
 * create a company and was then silently locked out of editing it.
 *
 * DELETE stays stricter (managing_partner only) and deliberately does NOT use
 * this constant.
 */
export const PORTFOLIO_PROFILE_WRITE_ROLES = [
  "managing_partner",
  "associate",
  "bd",
] as const;

export type PortfolioProfileWriteRole = (typeof PORTFOLIO_PROFILE_WRITE_ROLES)[number];

/** True when a partner sub-role may edit a portfolio company's private profile. */
export function canWritePortfolioProfile(subRole: string | null | undefined): boolean {
  return (
    typeof subRole === "string" &&
    (PORTFOLIO_PROFILE_WRITE_ROLES as readonly string[]).includes(subRole)
  );
}
