/**
 * 2a (v26.1.x Consortium Partner QA) — Consortium Partner TEAM TITLES.
 *
 * These are DISPLAY / CRM titles for a partner team member's professional role
 * (e.g. "Venture Partner", "Investor Relations"). They are DISTINCT from the
 * five PERMISSION TIERS (`SubRole`: managing_partner | associate | bd | analyst
 * | viewer) that the server enforces for access control. Per Ozan's Option 1,
 * a member has BOTH: a Title (from this list, presentational) and an Access
 * level (a permission tier). Titles NEVER grant permissions.
 *
 * The list contains the EXACTLY 18 titles from the QA slide (2a), in the same
 * order. (An earlier note mis-stated "20"; the QA deck lists 18.)
 */
export const PARTNER_TITLES = [
  "Managing Partner",
  "General Partner",
  "Partner",
  "Venture Partner",
  "Principal",
  "Director",
  "Vice President",
  "Senior Associate",
  "Associate",
  "Analyst",
  "Business Development",
  "Investor Relations",
  "Operations",
  "Finance / Controller",
  "Legal / Compliance",
  "Advisor",
  "Limited Partner (LP)",
  "Viewer",
] as const;

export type PartnerTitle = (typeof PARTNER_TITLES)[number];

/** Type guard for a valid title string. */
export function isPartnerTitle(v: unknown): v is PartnerTitle {
  return typeof v === "string" && (PARTNER_TITLES as readonly string[]).includes(v);
}
