/**
 * WAVE 134 · CAUSE 2 — the ONE shared "admin has published a price list" fixture.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * v25.27 deliberately DELETED the source-baked pricing seed from
 * `server/pricingModelStore.ts` (see the "v25.27 — NO SEED. Admin is the source
 * of truth." block at pricingModelStore.ts:160-181) and turned both
 * `adminPricingStore.PRICING_TIERS` and `subscriptionsStore.PLAN_PRICES` into
 * live proxies over that store. On a fresh install — which is exactly what a
 * vitest worker is — there are ZERO pricing models, so:
 *
 *   • `PRICING_TIERS.length === 0`
 *   • `PLAN_PRICES.founder_pro === undefined`
 *   • `getPlanPriceStrict("founder_pro")` throws `TierNotConfiguredError`
 *   • `updateSubscription(..., { plan })` refuses (`tier_not_configured`)
 *
 * That behaviour is CORRECT (R95/R96: pricing is admin-set and database-driven,
 * never compiled in). The ~24 tests that still expected a seed are therefore the
 * stale artefact, and per R98 they are re-based onto this fixture, which plays
 * the part of the admin: it AUTHORS tiers through the production write path
 * (`createModel` → `promoteModel`), exactly as POST /api/admin/pricing-models +
 * the publish button do.
 *
 * R95 COMPLIANCE — read before adding anything here
 * -------------------------------------------------
 * 1. This file lives under `server/__tests__/` and is imported ONLY by tests.
 *    `w134_pricing_catalogue_fixture.test.ts` FAILS if any file outside
 *    `server/__tests__/` imports it, so a fixture amount can never become a
 *    product price.
 * 2. The amounts below are ADMIN-SET INPUTS to a round trip, not a price list.
 *    The re-based tests assert "the surface reports what the admin published",
 *    and one of them re-publishes a different amount and asserts the surface
 *    follows — an assertion no hardcoded-$840 test could make.
 * 3. Nothing here writes into a rendering path, so the Wave 129 price-literal
 *    fence (`wave129_price_period_and_literal_fence.test.ts` §3, which scans
 *    `client/src/pages/partner/*` + `client/src/lib/partnerDisplay.ts` +
 *    `client/src/pages/admin/AdminFeesConsolidated.tsx`) is untouched and stays
 *    green.
 * 4. There is NO fallback amount anywhere in this file: every author call takes
 *    an explicit integer minor-unit amount, and a refusal THROWS rather than
 *    silently producing a $0 tier. No `Number()`/`parseInt`/`parseFloat` on money.
 */
import {
  createModel,
  promoteModel,
  listModels,
  getModel,
  _testPricingModels,
  type PricingModel,
  type PricingStatus,
  type ProductLine,
  type BillingCadence,
  type FeatureGate,
} from "../../pricingModelStore";

/** The admin identity every fixture-authored revision is attributed to. */
export const FIXTURE_PRICING_ADMIN = "fixture-admin@capavate.test";

/**
 * Canonical plan-key → slug map. MUST match `PLAN_TO_SLUG` in
 * server/subscriptionsStore.ts:106-111 and the slugs that
 * POST /api/admin/pricing-models/bootstrap-founder-tiers creates
 * (pricingModelStore.ts:618-623); if either moves, these tests must move with it.
 */
export const FOUNDER_PLAN_SLUGS = {
  founder_free: "founder-free",
  founder_pro: "founder-pro",
  founder_scale: "founder-scale",
  founder_enterprise: "founder-enterprise",
} as const;

/**
 * ADMIN-SET TEST AMOUNTS — integer minor units, USD.
 *
 * NOT a price list and NOT product data: these are the numbers this fixture's
 * imaginary admin happens to type, so that a test can assert the surface echoes
 * them back. Any test may pass its own amounts instead. Free is 0 because a
 * CONFIGURED free tier ("published at zero") is a different state from an
 * UNCONFIGURED one (`undefined`), and subscriptionsStore.ts:630-635 depends on
 * telling them apart.
 */
export const FIXTURE_ANNUAL_MINOR = {
  "founder-free": 0,
  "founder-pro": 24_000,
  "founder-scale": 84_000,
  "founder-enterprise": 240_000,
  "capavate-annual": 84_000,
  "collective-standard": 60_000,
} as const;

/**
 * Feature keys the founder-facing tier surfaces assert on — the union of the
 * lists in adminPricing.test.ts and founderSinglePlan.test.ts, i.e. "full
 * Capavate functionality per company" (Ozan, 24-May-2026).
 */
export const CAPAVATE_CORE_FEATURE_KEYS = [
  "cap_table",
  "rounds",
  "data_room",
  "investors_crm",
  "documents",
  "esop",
  "communications",
  "audit_chain",
  "compliance",
  "support",
] as const;

/** Features EXCLUDED from a Capavate founder tier by owner directive (v19 Wave A). */
export const CAPAVATE_EXCLUDED_FEATURE_KEYS = ["collective", "consortium"] as const;

function fullFeatureMatrix(): FeatureGate[] {
  return [
    ...CAPAVATE_CORE_FEATURE_KEYS.map((key) => ({
      key,
      label: key.replace(/_/g, " "),
      included: true,
      quota: null,
    })),
    ...CAPAVATE_EXCLUDED_FEATURE_KEYS.map((key) => ({
      key,
      label: key,
      included: false,
      quota: null,
    })),
  ];
}

export interface AuthorTierSpec {
  slug: string;
  name?: string;
  description?: string;
  productLine?: ProductLine;
  /** Integer MINOR units. REQUIRED — there is deliberately no default. */
  annualMinor: number;
  currency?: string;
  cadence?: BillingCadence;
  /** Final status. Authoring walks draft → preview → live for "live". */
  status?: PricingStatus;
  features?: FeatureGate[];
  trialDays?: number;
}

/**
 * Author ONE pricing model the way an admin does, and return the stored row.
 *
 * THROWS on any refusal (bad slug, slug already in use, illegal promotion) and
 * on a vacuous postcondition (the model not being readable back at the
 * requested status). A fixture that quietly fails to seat a tier would turn 24
 * re-based tests into tests of nothing.
 */
export function authorPricingTier(spec: AuthorTierSpec): PricingModel {
  if (!Number.isInteger(spec.annualMinor) || spec.annualMinor < 0) {
    throw new Error(
      `pricingCatalogueFixture: annualMinor must be a non-negative integer in minor units, got ${String(spec.annualMinor)}`,
    );
  }
  const cadence: BillingCadence = spec.cadence ?? "annual";
  const currency = (spec.currency ?? "USD").toUpperCase();
  const wanted: PricingStatus = spec.status ?? "live";

  const created = createModel(
    {
      productLine: spec.productLine ?? "founder",
      slug: spec.slug,
      name: spec.name ?? spec.slug,
      description: spec.description ?? `Authored by ${FIXTURE_PRICING_ADMIN} for tests.`,
      currency,
      basePriceMinor: spec.annualMinor,
      cadence,
      cadenceOptions: [{ cadence, priceMinor: spec.annualMinor }],
      currencyOverrides: [{ currency, basePriceMinor: spec.annualMinor }],
      regionalMultipliers: [],
      features: spec.features ?? fullFeatureMatrix(),
      metering: [],
      volumeBrackets: [],
      discountCodes: [],
      trial: spec.trialDays === undefined ? null : { lengthDays: spec.trialDays, requiresCard: false, autoConvertToPlanId: null },
      effectiveFrom: null,
      effectiveTo: null,
      grandfatherOnChange: true,
      taxInclusive: false,
      status: "draft",
    },
    FIXTURE_PRICING_ADMIN,
  );
  if (!created.ok) {
    throw new Error(`pricingCatalogueFixture: createModel('${spec.slug}') refused: ${created.error}`);
  }

  let row = created.model;
  if (wanted !== "draft") {
    /* Production transition table (pricingModelStore.ts:363-368):
       draft → preview → live. There is no draft → live shortcut, and the
       fixture must not invent one. */
    const path: PricingStatus[] = wanted === "live" ? ["preview", "live"] : [wanted];
    for (const to of path) {
      const promoted = promoteModel(row.id, to, FIXTURE_PRICING_ADMIN);
      if (!promoted.ok) {
        throw new Error(`pricingCatalogueFixture: promote '${spec.slug}' -> ${to} refused: ${promoted.error}`);
      }
      row = promoted.model;
    }
  }

  /* Postcondition: readable back, at the requested status, with the exact
     amount the caller asked for. */
  const back = getModel(row.id);
  if (!back || back.status !== wanted || back.basePriceMinor !== spec.annualMinor) {
    throw new Error(
      `pricingCatalogueFixture: postcondition failed for '${spec.slug}' — ` +
        `status=${back?.status ?? "missing"} basePriceMinor=${String(back?.basePriceMinor)}`,
    );
  }
  return back;
}

export interface FounderCatalogueOptions {
  /** Per-slug override of the admin-set amount, integer minor units. */
  annualMinor?: Partial<Record<keyof typeof FIXTURE_ANNUAL_MINOR, number>>;
  /** Also author the Collective membership tier (productLine "collective"). */
  includeCollective?: boolean;
  /** Also author the single "Capavate Annual" per-company tier. */
  includeCapavateAnnual?: boolean;
  /** Status for the authored tiers. Default "live" (i.e. published). */
  status?: PricingStatus;
}

/**
 * Author the whole published catalogue in one call: the four canonical founder
 * plan tiers (so `PLAN_PRICES` resolves and `updateSubscription` can accept a
 * plan change) plus, optionally, Capavate Annual and Collective Standard.
 *
 * Idempotent: slugs already present are left exactly as they are, so a test may
 * author one tier itself and then call this for the rest.
 */
export function authorFounderCatalogue(opts: FounderCatalogueOptions = {}): Record<string, PricingModel> {
  const status = opts.status ?? "live";
  const amount = (slug: keyof typeof FIXTURE_ANNUAL_MINOR): number =>
    opts.annualMinor?.[slug] ?? FIXTURE_ANNUAL_MINOR[slug];

  const wanted: AuthorTierSpec[] = [
    { slug: "founder-free", name: "Founder Free", annualMinor: amount("founder-free"), status },
    { slug: "founder-pro", name: "Founder Pro", annualMinor: amount("founder-pro"), status },
    { slug: "founder-scale", name: "Founder Scale", annualMinor: amount("founder-scale"), status },
    { slug: "founder-enterprise", name: "Founder Enterprise", annualMinor: amount("founder-enterprise"), status },
  ];
  if (opts.includeCapavateAnnual !== false) {
    wanted.push({ slug: "capavate-annual", name: "Capavate Annual", annualMinor: amount("capavate-annual"), status });
  }
  if (opts.includeCollective) {
    wanted.push({
      slug: "collective-standard",
      name: "Collective Standard",
      productLine: "collective",
      annualMinor: amount("collective-standard"),
      status,
    });
  }

  const out: Record<string, PricingModel> = {};
  const existing = new Map(listModels().map((m) => [m.slug, m]));
  for (const spec of wanted) {
    const already = existing.get(spec.slug);
    out[spec.slug] = already ?? authorPricingTier(spec);
  }
  return out;
}

/** Read back an authored tier by slug, or throw. */
export function authoredTier(slug: string): PricingModel {
  const m = listModels().find((x) => x.slug === slug);
  if (!m) throw new Error(`pricingCatalogueFixture: no authored tier with slug '${slug}'`);
  return m;
}

/**
 * Drop every pricing model — i.e. return the worker to the FRESH-INSTALL state
 * v25.27 actually ships. Used by the tests that pin "no admin has published
 * anything yet, so the surface must be empty rather than invent a price".
 */
export function clearAuthoredPricingTiers(): void {
  _testPricingModels.models.clear();
  _testPricingModels.history.clear();
}
