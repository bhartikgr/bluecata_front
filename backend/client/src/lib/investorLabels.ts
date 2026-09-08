/**
 * W1P — pure display helpers for investor-facing copy.
 *
 * All functions here are presentation-only: they humanize raw enum values and
 * guard interpolated template fragments. No enum *values* change — only how
 * they render. Kept dependency-free (no React) so they are unit-testable.
 */
import { KYC_VARIANT_OPTIONS } from "./profile/data/enums";

/** Title-case a raw enum token: "round_update" → "Round Update". */
function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---------------- BUG-28 notification kind chips ---------------- */

/** Enum→label for notification-kind filter chips. Keys stay as data. */
export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  all: "All",
  invitation: "Invitation",
  round_update: "Round update",
  message: "Message",
  collective: "Collective",
  portfolio: "Portfolio",
};

/** Humanized label for a notification-kind chip; falls back to title-case. */
export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABELS[kind] ?? titleCase(kind);
}

/* ---------------- BUG-24 KYC variant display ---------------- */

const KYC_VARIANT_LABELS: Record<string, string> = Object.fromEntries(
  KYC_VARIANT_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * Humanized label for a KYC variant enum. Reuses the canonical option labels
 * from data/enums so there is a single source of truth; unknown variants fall
 * back to a title-cased token rather than leaking the raw enum.
 */
export function kycVariantLabel(variant: string | null | undefined): string {
  if (!variant) return "—";
  return KYC_VARIANT_LABELS[variant] ?? titleCase(variant);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   INTERNATIONAL CORRECTION — THE BADGE MUST NOT TURN AN ABSENCE INTO A REGIME.
   ═══════════════════════════════════════════════════════════════════════════════
   `kycVariantForCountry` falls back to `"generic"`, whose label reads
   "Other — generic KYC + AML". That single fallback is reached from TWO
   completely different situations:

     (a) a country IS on record and it is outside the nine jurisdictions the
         platform offers a declaration for (say Brazil), and
     (b) NO country of tax residency is on record at all.

   Rendering (b) as "Other" states a conclusion about the investor's jurisdiction
   that nobody reached — the same error as printing a currency symbol for an
   unknown currency, or a zero for an unknown number. It also asserts a
   "KYC + AML" process as though the platform performed one.

   This function does not decide a regime, does not add a jurisdiction and does
   not gate anything. It only distinguishes "not recorded" from "recorded and
   outside the nine", and says which one it is. The supported set is read from
   `ACCREDITATION_JURISDICTION_CODES` in `shared/accreditationClause.ts` — the
   registry that already exists. No second list is introduced here.

   The voice is taken from the SPV Compliance tab and the K-1 tab, which are the
   platform's existing precedent for scoping to a jurisdiction and stating
   plainly what is not shown and why. */
export function kycVariantBadgeText(
  variant: string | null | undefined,
  countryOfTaxResidencyCode: string | null | undefined,
): string {
  const country = (countryOfTaxResidencyCode ?? "").trim();
  if (variant === "generic" || !variant) {
    if (country === "") {
      return "Country of tax residency not on record — no jurisdiction-specific regime applied";
    }
    return `Recorded country ${country.toUpperCase()} is outside the jurisdictions this platform offers a declaration for — no jurisdiction-specific regime applied`;
  }
  return kycVariantLabel(variant);
}

/* ---------------- BUG-09/10/19/20 round + empty-guard helpers ---------------- */

/**
 * Render a round name as a standalone phrase WITHOUT appending a literal
 * " round" (round names like "Seed" already read fine; appending produced
 * "TEST ROUND round" doubling). Empty → a stable fallback.
 */
export function roundPhrase(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "the round";
}

/** Return `v` when truthy/non-blank, else `fallback`. */
export function nonEmpty(v: string | null | undefined, fallback: string): string {
  const trimmed = (v ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/* ---------------- BUG-01/02/21 identity display guards (rule #13) ---------------- */

/* ═══ WAVE 190 · ITEM C — THE SET NOW LIVES IN `shared/`, AND IT INCLUDES
   "new contact".

   THE DEFECT. `"New contact"` — the literal the CRM create paths use as their
   own no-name fallback — was NOT in this set, so a stored `"New contact"` was
   treated as a person and `safeInitials` printed "NC" on the owner's real
   account (`ozan@capavate.com`).

   WHY IT MOVED RATHER THAN JUST GROWING. The write side has to enforce the same
   set: a screen that stops printing "NC" while the database keeps accepting
   `"New contact"` as somebody's name has hidden the defect, not fixed it. Two
   copies of the literals is how they drift, and this drift is exactly what
   happened here. The original six literals are preserved byte-for-byte in
   `PLACEHOLDER_PERSON_NAMES`, so nothing that used to be caught stops being
   caught, and `isPlaceholderToken` below keeps its name and signature so every
   existing caller is untouched. */
import { isPlaceholderPersonName } from "@shared/placeholderPersonNames";

/** True when the token looks like an email address (has an "@"). */
export function looksLikeEmail(v: string | null | undefined): boolean {
  return !!v && v.includes("@");
}

function isPlaceholderToken(v: string): boolean {
  return isPlaceholderPersonName(v);
}

/**
 * Return a full legal name (first + last) suitable for a typed legal signature,
 * or "" when the identity only exposes a partial/placeholder/email. Per rule #13
 * we never surface a lone first name or a raw email where a full legal name is
 * expected — an empty string (blank field) is safer than a misleading partial.
 */
export function fullLegalName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed || looksLikeEmail(trimmed) || isPlaceholderToken(trimmed)) return "";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return ""; // no last name → not a full legal name
  return parts.join(" ");
}

/**
 * Safe first-name greeting token. Never returns a raw email or a placeholder
 * like "New"/"New User"; falls back to a neutral token (default "there").
 */
export function greetingName(
  screenName: string | null | undefined,
  name: string | null | undefined,
  fallback = "there",
): string {
  const candidates = [screenName, (name ?? "").split(/\s+/)[0]];
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t && !looksLikeEmail(t) && !isPlaceholderToken(t)) return t;
  }
  return fallback;
}

/**
 * Safe display name for a partner team member row (rule #13). NEVER returns a
 * raw synthetic id (a `u_…` token such as the `u_redeemed_*` personas minted in
 * userContext.ts): if `name` is present but is a raw id, it is discarded and we
 * fall through to `email`, then to a stable `"Pending member"` placeholder. The
 * server resolver already guarantees non-raw names; this is the client-side
 * belt-and-suspenders so a raw id can never leak into the UI even if a future
 * payload regresses.
 */
export function safeMemberName(
  name: string | null | undefined,
  email: string | null | undefined,
  userId?: string | null,
): string {
  const trimmedName = (name ?? "").trim();
  if (trimmedName && !/^u_/.test(trimmedName)) return trimmedName;
  const trimmedEmail = (email ?? "").trim();
  if (trimmedEmail && !/^u_/.test(trimmedEmail)) return trimmedEmail;
  return "Pending member";
}

/**
 * Safe up-to-2-char initials from a display name. Never derives initials from
 * an email local-part or a placeholder; returns "" when nothing safe is found
 * (caller renders a neutral avatar glyph instead).
 */
export function safeInitials(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed || looksLikeEmail(trimmed) || isPlaceholderToken(trimmed)) return "";
  const letters = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .filter((c) => /[a-z]/i.test(c));
  return letters.slice(0, 2).join("").toUpperCase();
}
