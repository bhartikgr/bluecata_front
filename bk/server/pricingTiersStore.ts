/**
 * v24.2 Airwallex wiring — pricing-tier resolver for the billing checkout flow.
 *
 * The authoritative pricing-tier data already lives in `adminPricingStore`
 * (`PRICING_TIERS`, surfaced via GET /api/admin/pricing-tiers and consumed by
 * Founder Settings → Plan & Pricing). That source of truth carries dollar
 * fields (`monthlyUsd`, `annualUsd`) plus an `annualPriceCents` integer.
 *
 * The new `/api/billing/plan` checkout handler needs to mint an Airwallex
 * PaymentIntent, which requires *integer minor units* + an ISO-4217 currency.
 * Rather than duplicate or migrate the pricing data (and to avoid touching the
 * sacred `shared/schema.ts`), this module is a thin READ-ONLY adapter over
 * `adminPricingStore.PRICING_TIERS`. It normalises each tier into a shape the
 * checkout handler expects:
 *
 *   { id, name, monthlyPriceCents, annualPriceCents, currency }
 *
 * monthlyPriceCents is derived from `monthlyUsd` (×100) when present, otherwise
 * from annual/12. All amounts are integers. Currency defaults to USD (the only
 * currency the single default tier is priced in today).
 *
 * NO new mocks: this reflects real configured pricing. If a tier id is unknown
 * the caller gets `undefined` and surfaces a clean 404.
 */
import { PRICING_TIERS, type PricingTier } from "./adminPricingStore";

export interface BillingPricingTier {
  id: string;
  name: string;
  /** Integer minor units for a monthly charge. */
  monthlyPriceCents: number;
  /** Integer minor units for an annual charge. */
  annualPriceCents: number;
  /** ISO 4217 currency code (uppercase). */
  currency: string;
}

function toMinor(usd: number | undefined): number {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return 0;
  return Math.round(usd * 100);
}

function normalise(t: PricingTier): BillingPricingTier {
  const annualPriceCents =
    typeof t.annualPriceCents === "number" && t.annualPriceCents > 0
      ? Math.round(t.annualPriceCents)
      : toMinor(t.annualUsd);
  // Prefer an explicit monthly price; otherwise derive from the annual figure.
  const monthlyPriceCents =
    typeof t.monthlyUsd === "number" && t.monthlyUsd > 0
      ? toMinor(t.monthlyUsd)
      : annualPriceCents > 0
        ? Math.round(annualPriceCents / 12)
        : 0;
  return {
    id: t.id,
    name: t.name,
    monthlyPriceCents,
    annualPriceCents,
    // The default tier is USD-only today; PRICING_TIERS carries no currency
    // column, so default to USD. When multi-currency pricing lands this is the
    // single place to thread it through.
    currency: "USD",
  };
}

/** Returns the normalised billing tier for `id`, or undefined if unknown. */
export function getById(id: string): BillingPricingTier | undefined {
  const t = PRICING_TIERS.find((x) => x.id === id);
  return t ? normalise(t) : undefined;
}

/** Returns every configured tier in billing-normalised form. */
export function listTiers(): BillingPricingTier[] {
  return PRICING_TIERS.map(normalise);
}
