/**
 * client/src/lib/priceDisplayPolicy.ts
 *
 * WAVE 199 · ITEM B · R173.6 — "there really should not be a displayed as monthly",
 * and "these are ALL 100% dynamic from the admin area and dynamically
 * updated/displayed in the frontend".
 *
 * WHAT THIS IS
 *   The one client-side reader of GET /api/price-display-policy, which reports the
 *   billing-period offer the admin sets in Admin → Fees (wave 188's
 *   `partner_pricing_model_config` row: monthly_purchasable / annual_purchasable /
 *   forbid_x12_derivation).
 *
 * WHY EVERY MONTHLY DISPLAY MUST ASK IT
 *   Before this wave, every monthly figure in the frontend rendered unconditionally.
 *   The admin's annual-only setting was real, shipped and switchable, and no surface
 *   could see it. So "the platform is annual and/or fixed only" was true of the
 *   database and false of every screen. Asking here makes the display follow the
 *   admin, which is the whole of R173.6.
 *
 * WHAT IT IS NOT
 *   It is NOT a deletion of monthly. Monthly stays priced, stored, derivable and
 *   administrable; a surface that asks this hook renders its monthly content again
 *   the moment an admin switches monthly back on. Nothing here removes a control, a
 *   column or a capability.
 *
 * FAIL-CLOSED, AND WHY THAT IS SAFE HERE
 *   While the policy has not loaded — and if the request fails — this reports
 *   `false`. That hides the monthly EXTRAS only: the annual and fixed figures on
 *   every affected screen are rendered by code that does not consult this hook, so no
 *   surface can end up with no price at all. Fail-closed also matches the shipped
 *   database state (monthly not offered), so a slow network cannot make a screen
 *   advertise a cadence the platform does not sell.
 *
 * NO DERIVATION, NO LITERALS
 *   This file holds no price, no currency and no cadence (R156.2) and performs no
 *   arithmetic on money (R156.1). `forbidX12Derivation` is surfaced so a caller can
 *   be told never to divide an annual figure by twelve.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";

export interface PriceDisplayPolicy {
  monthlyDisplayAllowed: boolean;
  annualOffered: boolean;
  monthlyOffered: boolean;
  model: string;
  forbidX12Derivation: boolean;
  updatedAt: string | null;
  unavailableReason: string | null;
  /**
   * WAVE 202 · R178.1 — the owner's PER-PRICE billing-period choices. ADDITIVE and
   * optional: an older server, or a server that cannot read the per-price table,
   * omits it, and every surface then uses the platform-wide fields above. Absence
   * therefore behaves exactly as wave 199 did. See `usePricePeriodOffer` below.
   */
  scopes?: PricePeriodOfferView[];
}

export const PRICE_DISPLAY_POLICY_KEY = "/api/price-display-policy";

/** The raw policy, or `null` until it is known. */
export function usePriceDisplayPolicy(): PriceDisplayPolicy | null {
  const q = useQuery<{ ok?: boolean; policy?: PriceDisplayPolicy }>({
    queryKey: [PRICE_DISPLAY_POLICY_KEY],
    queryFn: async () => (await apiRequest("GET", PRICE_DISPLAY_POLICY_KEY)).json(),
  });
  return q.data?.policy ?? null;
}

/**
 * May this surface print a monthly price figure, or offer a monthly cadence?
 *
 * The single question every gated site asks. It answers `false` while unknown, for
 * the reasons in the header.
 */
export function useMonthlyDisplayAllowed(): boolean {
  const policy = usePriceDisplayPolicy();
  return policy?.monthlyDisplayAllowed === true;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 202 · ITEM A · R178.1 — THE PER-PRICE LAYER.
 *
 * THE OWNER'S WORDS: "the admin area pricing section should allow me to choose
 * between annual and/or monthly pricing. Whatever I choose should be dynamically
 * displayed in the frontend."
 *
 * WAVE 199'S TWO EXPORTS ABOVE ARE UNTOUCHED AND STILL WORK. They read the
 * platform-wide answer, which is now the DEFAULT rather than the only answer. What
 * is added here is the ability for a surface to ask about ONE price, so that the
 * owner's choice for the Collective membership is not forced to be the same as his
 * choice for the founder annual plan.
 *
 * FAIL-CLOSED, UNCHANGED. While the policy has not loaded, and if the request
 * fails, monthly is NOT displayable. A scope the owner has not spoken about falls
 * back to `monthlyDisplayAllowed`, which is exactly what wave 199 answered — so
 * this can never be MORE permissive than wave 199 was. There is no code path where
 * "unknown" means "show monthly".
 *
 * NO DERIVATION, NO LITERALS. No price, currency or cadence appears below (R156.2)
 * and no arithmetic is performed on money (R156.1). `forbidX12Derivation` is
 * surfaced so a caller can be told never to multiply or divide by twelve.
 * ══════════════════════════════════════════════════════════════════════════════ */

/** One price's recorded billing-period choice, as the server resolves it. */
export interface PricePeriodOfferView {
  scopeKey: string;
  annualOffered: boolean;
  monthlyOffered: boolean;
  /** 'per_price' when the owner chose for this price; 'platform_default' if not. */
  source: "per_price" | "platform_default";
  /** `null` means UNSET. Never 0-by-default, never derived (R143.4). */
  annualAmountMinor: number | null;
  annualCurrency: string | null;
  annualDerivation: "unset" | "admin_set";
  forbidX12Derivation: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  notes: string | null;
  unavailableReason: string | null;
}

/**
 * Scope keys are namespaced by the store that owns the price, so a platform_fees
 * key, a partner tier slug and a pricing-model id cannot collide. These builders
 * are the ONLY place a client composes one, so a surface and the server can never
 * disagree about the spelling.
 */
export function platformFeeScope(feeKey: string): string {
  return `platform_fee:${feeKey}`;
}
export function partnerTierScope(tierSlug: string): string {
  return `partner_tier:${tierSlug}`;
}
export function pricingModelScope(modelId: string): string {
  return `pricing_model:${modelId}`;
}

/**
 * The owner's choice for ONE price, taken from the policy payload wave 199 already
 * fetches. No second network request: `scopes` travels with the policy, so a
 * surface that already asks the policy pays nothing extra to ask per-price.
 *
 * Returns `null` while the policy is unknown — callers must treat that as
 * fail-closed, which `useMonthlyDisplayAllowedForScope` below does for them.
 */
export function usePricePeriodOffer(scopeKey: string): PricePeriodOfferView | null {
  const policy = usePriceDisplayPolicy();
  if (policy === null) return null;
  const scopes = Array.isArray(policy.scopes) ? policy.scopes : [];
  const found = scopes.find((s) => s && s.scopeKey === scopeKey);
  if (found) return found;
  /* NO RECORDED CHOICE. The platform-wide answer applies, reported with
     `source: 'platform_default'` so a screen can say which it is using. This
     mirrors the server's `resolvePricePeriodOffer()` exactly. */
  return {
    scopeKey,
    annualOffered: policy.annualOffered,
    monthlyOffered: policy.monthlyOffered,
    source: "platform_default",
    annualAmountMinor: null,
    annualCurrency: null,
    annualDerivation: "unset",
    forbidX12Derivation: policy.forbidX12Derivation,
    updatedAt: policy.updatedAt,
    updatedBy: null,
    notes: null,
    unavailableReason: policy.unavailableReason,
  };
}

/**
 * May THIS price print a monthly figure or offer a monthly cadence?
 *
 * The per-price counterpart of `useMonthlyDisplayAllowed()`. It answers `false`
 * while unknown, for the reasons in the header. With no per-price choice recorded
 * its answer is identical to `useMonthlyDisplayAllowed()`, which is why moving a
 * surface onto it cannot change that surface's behaviour on the day it lands.
 */
export function useMonthlyDisplayAllowedForScope(scopeKey: string): boolean {
  const offer = usePricePeriodOffer(scopeKey);
  return offer?.monthlyOffered === true;
}
