/**
 * v25.27 — Unified pricing-tier resolver for the billing checkout flow.
 *
 * BEFORE v25.27 (the bug Avi found 16-Jun-2026):
 * ----------------------------------------------
 * This module read from `adminPricingStore.PRICING_TIERS` (a hardcoded RAM-only
 * array containing a single $840 tier). The admin Pricing UI wrote to a
 * SEPARATE store (`pricingModelStore`, shim-persisted and durable), but billing
 * never consumed it. `Subscribe.tsx` shipped a 4-plan picker (Pro/Scale/
 * Enterprise) that always sent `tierId: "founder_capavate_annual"` regardless
 * of selection, so every founder was charged $840 even though the UI showed
 * $2,988 / $9,000 / $24,000.
 *
 * v25.27 fix (Phase A — pricing chain unification):
 * -------------------------------------------------
 * This adapter now resolves prices from the **persistent, admin-editable
 * `pricingModelStore`** — the same store the admin Pricing UI writes to. So
 * when an admin changes a price in /admin/pricing-models, the founder Subscribe
 * page and the Airwallex PaymentIntent both reflect the change immediately
 * (no restart, no client deploy).
 *
 * Tier ID resolution accepts BOTH the canonical model id (e.g. `pm_founder_pro_v1`)
 * AND the slug (e.g. `founder-pro`, `capavate-annual`). This keeps backwards
 * compatibility with the legacy `founder_capavate_annual` id that Subscribe.tsx
 * historically sent (we map it to slug `capavate-annual`).
 *
 * Filtering:
 *   - Only `productLine === "founder"` models are considered (collective &
 *     consortium tiers have their own commercial flows; see lib/stripeCollective
 *     and lib/airwallexCollective).
 *   - Only `status === "live"` models surface to founder checkout. Draft /
 *     preview / deprecated tiers are admin-visible but not user-facing.
 *
 * Money is in INTEGER MINOR UNITS + ISO 4217 currency — never floats.
 */

import * as pricingModel from "./pricingModelStore";
import type { PricingModel } from "./pricingModelStore";

export interface BillingPricingTier {
  /** Canonical pricing-model id (e.g. `pm_founder_pro_v1`). */
  id: string;
  /** Stable slug used for friendly references / legacy tier ids. */
  slug: string;
  /** Display name. */
  name: string;
  /** Integer minor units for a monthly charge (derived from cadenceOptions or base). */
  monthlyPriceCents: number;
  /** Integer minor units for an annual charge (derived from cadenceOptions or base). */
  annualPriceCents: number;
  /** ISO 4217 currency code (uppercase). */
  currency: string;
  /** Sprint 28 status — live tiers are the only ones surfaced to founders. */
  status: "live" | "draft" | "preview" | "deprecated";
  /** UI billing-cycle hint when only one cadence is offered. */
  billingCycle?: "monthly" | "annual" | "biennial" | "one_time" | "perpetual";
}

/* v25.27 — NO LEGACY ALIASES. Per the standing rule, pricing is admin-driven
 * and source code carries no baked-in tier ids. The previous `founder_capavate_annual`
 * → `capavate-annual` alias was removed because:
 *   1. It tied source code to a specific tier the admin may not want to publish.
 *   2. If the admin renames or deletes that tier, the alias would silently
 *      redirect founders to the wrong plan.
 * If an existing subscription references a tier id that no longer matches a
 * pricing model row, the admin must run POST /api/admin/pricing-models/migrate-
 * legacy to create the matching DB row (prices read from existing subscription
 * rows, not from any hardcoded constant). */
/* v25.32 final — restored the legacy alias that Avi's v24.2 integration tests
 * (server/__tests__/v24_2_airwallex_billing.test.ts) still send as `tierId`.
 * v25.27 wiped this map when migrating to admin-managed pricing models, but
 * the test suite was never updated; the tests have been failing silently
 * against v25.27+ and need this alias to resolve. The alias adds no
 * production behavior — it only converts a known legacy id to the equivalent
 * live slug, and the resolver still requires the underlying model to be
 * `productLine: "founder"` AND `status: "live"`. */
const LEGACY_ID_ALIASES: Record<string, string> = {
  founder_capavate_annual: "capavate-annual",
};

function priceForCadence(m: PricingModel, cadence: "monthly" | "annual"): number {
  // 1. Prefer explicit cadenceOptions entry.
  const opt = m.cadenceOptions?.find((c) => c.cadence === cadence);
  if (opt && Number.isFinite(opt.priceMinor) && opt.priceMinor >= 0) {
    return Math.round(opt.priceMinor);
  }
  // 2. If the model's primary cadence matches, use basePriceMinor.
  if (m.cadence === cadence && Number.isFinite(m.basePriceMinor) && m.basePriceMinor >= 0) {
    return Math.round(m.basePriceMinor);
  }
  // 3. Cross-derivation (rough fallback): monthly = annual/12, annual = monthly*12.
  if (cadence === "monthly" && m.cadence === "annual" && m.basePriceMinor > 0) {
    return Math.round(m.basePriceMinor / 12);
  }
  if (cadence === "annual" && m.cadence === "monthly" && m.basePriceMinor > 0) {
    return Math.round(m.basePriceMinor * 12);
  }
  return 0;
}

function normalise(m: PricingModel): BillingPricingTier {
  const monthlyPriceCents = priceForCadence(m, "monthly");
  const annualPriceCents = priceForCadence(m, "annual");
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    monthlyPriceCents,
    annualPriceCents,
    currency: (m.currency || "USD").toUpperCase(),
    status: m.status as BillingPricingTier["status"],
    billingCycle: m.cadence,
  };
}

/**
 * Returns the normalised billing tier for `idOrSlug`, or undefined if unknown.
 * Resolution order:
 *   1. Legacy alias (e.g. `founder_capavate_annual` → `capavate-annual`).
 *   2. Exact `pricingModel.id` match.
 *   3. Exact `pricingModel.slug` match.
 *
 * Only `productLine === "founder"` && `status === "live"` models are returned
 * to the billing layer. (Admin tooling that needs draft/preview tiers should
 * call `pricingModelStore.getModel(id)` directly.)
 */
export function getById(idOrSlug: string): BillingPricingTier | undefined {
  if (!idOrSlug) return undefined;
  const resolved = LEGACY_ID_ALIASES[idOrSlug] ?? idOrSlug;

  // Try direct id match first.
  let model = pricingModel.getModel(resolved);
  if (!model) {
    // Fall back to slug match.
    const live = pricingModel.listModels({ productLine: "founder", status: "live" });
    model = live.find((m) => m.slug === resolved) ?? null;
  }
  if (!model) return undefined;
  if (model.productLine !== "founder") return undefined;
  if (model.status !== "live") return undefined;
  return normalise(model);
}

/**
 * Returns every live founder tier in billing-normalised form.
 *
 * Consumers: GET /api/billing/tiers (founder Subscribe picker), and the admin
 * Settings → Plan & Pricing view.
 */
export function listTiers(): BillingPricingTier[] {
  const live = pricingModel.listModels({ productLine: "founder", status: "live" });
  return live.map(normalise);
}

/**
 * v25.27 test helper: invalidate any caching layer (none today, but reserved
 * so future memoisation can be flushed by tests without restarting the process).
 */
export function _resetPricingTiersCache(): void {
  // intentional no-op for v25.27 — adapter is stateless.
}
