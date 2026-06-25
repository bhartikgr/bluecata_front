#!/usr/bin/env node
/**
 * scripts/seed_pricing.ts — v25.43 R3 — Seed founder pricing tiers.
 *
 * Inserts 3 DEMO founder pricing models (product_line=founder, status=live) so
 * the F12 plan-description rendering (pricingModelStore → BillingPricingTier →
 * PlanCard) has data to display during QA:
 *
 *   1. Free  — $0/mo   — "Up to 1 company, 10 cap-table positions, basic
 *                          investor relations."
 *   2. Pro   — $99/mo  — "Unlimited cap table, rounds & SAFEs, investor portal,
 *                          document vault."
 *   3. Scale — $499/mo — "Multi-company, white-label investor portal,
 *                          audit-grade compliance & dedicated support."
 *
 * This is SEED data, not production data. It is written through the SAME
 * admin-editable, shim-persisted `pricingModelStore` the admin Pricing UI uses,
 * so the founder Subscribe page surfaces it immediately (no restart required).
 *
 * Money is in INTEGER MINOR UNITS (cents). Annual prices are derived as the
 * monthly price × 12 (no discount) so both cadences resolve in
 * pricingTiersStore.priceForCadence.
 *
 * Idempotent: re-running skips any tier whose slug already exists.
 *
 * Usage:
 *   npx tsx scripts/seed_pricing.ts
 */
import { getDb } from "../server/db/connection";
import {
  configurePricingModelStore,
  hydratePricingModelStore,
  listModels,
  createModel,
  type CreateModelInput,
} from "../server/pricingModelStore";

interface SeedTier {
  slug: string;
  name: string;
  description: string;
  monthlyMinor: number;
}

const SEED_TIERS: SeedTier[] = [
  {
    slug: "founder-free",
    name: "Free",
    description: "Up to 1 company, 10 cap-table positions, basic investor relations.",
    monthlyMinor: 0,
  },
  {
    slug: "founder-pro",
    name: "Pro",
    description: "Unlimited cap table, rounds & SAFEs, investor portal, document vault.",
    monthlyMinor: 9_900, // $99/mo
  },
  {
    slug: "founder-scale",
    name: "Scale",
    description:
      "Multi-company, white-label investor portal, audit-grade compliance & dedicated support.",
    monthlyMinor: 49_900, // $499/mo
  },
];

function buildInput(t: SeedTier): CreateModelInput {
  const annualMinor = t.monthlyMinor * 12;
  return {
    productLine: "founder",
    slug: t.slug,
    name: t.name,
    description: t.description,
    status: "live", // surfaced to founder checkout immediately
    currency: "USD",
    basePriceMinor: t.monthlyMinor,
    cadence: "monthly",
    cadenceOptions: [
      { cadence: "monthly", priceMinor: t.monthlyMinor },
      { cadence: "annual", priceMinor: annualMinor },
    ],
    currencyOverrides: [],
    regionalMultipliers: [],
    features: [],
    metering: [],
    volumeBrackets: [],
    discountCodes: [],
    trial: null,
    effectiveFrom: null,
    effectiveTo: null,
    grandfatherOnChange: false,
    taxInclusive: false,
  } as CreateModelInput;
}

async function main() {
  // Ensure a DB connection exists, then configure no-op sinks (audit/bridge are
  // not needed for a seed) and rehydrate any previously-authored models so the
  // idempotency check sees them.
  getDb();
  configurePricingModelStore({ audit: () => {}, bridge: () => {} });
  await hydratePricingModelStore();

  const existing = listModels({ productLine: "founder" });
  const existingSlugs = new Set(existing.map((m) => m.slug));

  let created = 0;
  let skipped = 0;

  for (const t of SEED_TIERS) {
    if (existingSlugs.has(t.slug)) {
      console.log(`[seed:pricing] skip '${t.slug}' — already exists`);
      skipped++;
      continue;
    }
    const res = createModel(buildInput(t), "seed_pricing_script");
    if (res.ok) {
      console.log(
        `[seed:pricing] created '${t.slug}' (${t.name}) — $${(t.monthlyMinor / 100).toFixed(0)}/mo, status=live`,
      );
      created++;
    } else {
      console.error(`[seed:pricing] FAILED '${t.slug}': ${res.error}`);
    }
  }

  console.log(`[seed:pricing] done — ${created} created, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error("[seed:pricing] fatal:", err);
  process.exit(1);
});
