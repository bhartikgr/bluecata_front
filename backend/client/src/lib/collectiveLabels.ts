/**
 * W3.6 — shared, non-sacred snake_case enum -> human label map.
 *
 * Enums are stable machine values; labels are client presentation ONLY. No
 * function here mutates stored enum values or API payloads — machine values
 * stay in `<option value=...>` and request/response bodies; only rendered
 * text goes through `labelFor`.
 *
 * Mirrors the existing ENTRY_KIND_LABELS pattern already used in
 * CollectivePaymentPL.tsx, centralized so every admin/partner surface that
 * renders these enums shares one source of truth.
 */

/** Title-case a raw snake_case/kebab-case token: "round_update" -> "Round Update". */
function titleCaseToken(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Looks up `value` in `map`; when absent, humanizes the raw snake_case value
 * into title case instead of throwing or leaking the raw token unreadably.
 * Never throws — safe for unknown/future enum additions.
 */
export function labelFor(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "—";
  const known = map[value];
  if (known) return known;
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[collectiveLabels] unknown enum value "${value}" — falling back to humanized label`);
  }
  return titleCaseToken(String(value));
}

/* ---------------- Collective payment schedules (W3.6) ---------------- */

export const FEE_KIND_LABELS: Record<string, string> = {
  membership_dues: "Membership dues",
  event_fee: "Event fee",
  sponsorship_fee: "Sponsorship fee",
  chapter_dues: "Chapter dues",
  late_fee: "Late fee",
  // Partner fee-schedule kinds (PartnerFeeSchedules.tsx shares this map).
  subscription_monthly: "Subscription — Monthly",
  subscription_annual: "Subscription — Annual",
  spv_deployment: "SPV deployment (banded)",
  spv_management_per_lp_quarter: "SPV management / LP / quarter",
  spv_closing_bonus: "SPV closing bonus",
};

export const CADENCE_LABELS: Record<string, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

export const SCOPE_KIND_LABELS: Record<string, string> = {
  member: "Member",
  tier: "Tier",
  platform: "Platform",
};

/* ---------------- Partner SPV engine (W3.6) ---------------- */

export const CARRY_BASIS_LABELS: Record<string, string> = {
  per_deployment: "Per deployment",
  whole_spv: "Whole SPV",
};

export const DISTRIBUTION_SCOPE_LABELS: Record<string, string> = {
  private: "Private",
  collective_only: "Collective only",
  network: "Network",
  invite_only: "Invite only",
};

export const LP_VISIBILITY_LABELS: Record<string, string> = {
  own_only: "Own position only",
  co_investors: "Co-investors visible",
};
