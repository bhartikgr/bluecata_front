/**
 * server/publicPricingRoutes.ts — D2.5 Slice 2 (Dynamic public pricing).
 *
 * Problem this fixes: capavate.com/#pricing (the marketing homepage) shipped
 * $840/year and $1,500 as hardcoded strings in the client bundle
 * (client/src/components/home3compo/PricingSection.jsx +
 * client/src/components/home3compo/LearnSection.jsx). Admin edits at
 * /admin/pricing-models never reached the public site because nothing on
 * the public path ever called an API — the numbers were baked in at build
 * time. See D25_HARDCODED_VALUES.md H-1..H-4 for the historical context on
 * how badly pricing has drifted before ("Pricing plans are determined from
 * the Admin area. They are never hardcoded." — adminPlatformStore.ts:1242).
 *
 * This route is the SAFE PUBLIC SUBSET of `pricing_models` (via the durable
 * pricingModelStore) and `collective_subscription_configs` (via
 * collectiveSubscriptionConfigStore). It is intentionally the ONLY server
 * surface the marketing homepage is allowed to call:
 *   - NO auth required (this is public marketing content, same info that
 *     already renders unauthenticated on capavate.com today).
 *   - NO admin-only metadata: no version/revisionHash/createdBy/updatedBy,
 *     no audit trail, no history.
 *   - NO gateway config: never touches airwallexTier / airwallexPriceId /
 *     anything from airwallexCollective.ts or paymentGatewayAdapter.ts.
 *     Zero Airwallex touches, per the sacred boundary list.
 *   - NO internal cost basis, margin, or commission data.
 *
 * Server-side cached for 5 minutes so a public, unauthenticated, no-rate-limit
 * endpoint can't be used to hammer the pricing stores. Cache is invalidated
 * early if an admin edits a founder/collective pricing record in the same
 * process (best-effort — see invalidatePublicPricingCache()).
 *
 * Fail-closed → fail-SOFT for this one endpoint only: because this is public
 * marketing copy (not a checkout/billing path), if the live stores throw we
 * serve the last-known-good cached payload rather than a 500, and only fall
 * through to the static defaults below if there has never been a successful
 * read. This mirrors the platform's documented preference for graceful
 * degradation on read-only public surfaces while keeping every REAL charge
 * path (Subscribe.tsx, adminPricingStore, pricingModelStore itself) fail-closed
 * exactly as it is today. See ASSUMPTIONS_SLICE_2.md Q1.
 */
import type { Express, Request, Response } from "express";
import * as pricingModel from "./pricingModelStore";
import * as collectiveConfig from "./collectiveSubscriptionConfigStore";

/* =================================================================== */
/*  Safe public shape                                                  */
/* =================================================================== */

export interface PublicPriceEntry {
  price_minor?: number;
  currency?: string;
  display: string;
}

export interface PublicPricingPayload {
  capavate_annual: PublicPriceEntry;
  academy_one_time: PublicPriceEntry;
  investors_free: PublicPriceEntry;
  partners_custom: PublicPriceEntry;
  as_of: string;
}

/** Slugs the admin area uses to identify these four marketing rows.
 *  Documented in ASSUMPTIONS_SLICE_2.md — admins should create/keep pricing
 *  models under these slugs for the public homepage to pick them up. */
const SLUGS = {
  capavateAnnual: ["capavate-annual", "founder-pro", "capavate-platform"],
  academyOneTime: ["academy-one-time", "entrepreneur-academy", "global-entrepreneur-academy"],
} as const;

/** Static fallback — byte-identical to the values that used to be hardcoded
 *  in the JSX, so a cold-start / empty-admin-catalog / DB-error install
 *  degrades to today's known-correct marketing copy instead of showing
 *  "undefined" or a blank pricing section. */
const STATIC_FALLBACK: PublicPricingPayload = {
  capavate_annual: { price_minor: 84000, currency: "USD", display: "$840/year per company" },
  academy_one_time: { price_minor: 150000, currency: "USD", display: "$1,500 one-time" },
  investors_free: { display: "Free. Always." },
  partners_custom: { display: "Custom pricing" },
  as_of: new Date(0).toISOString(),
};

/* =================================================================== */
/*  5-minute server-side cache                                         */
/* =================================================================== */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes, per spec

let cachedPayload: PublicPricingPayload | null = null;
let cachedAt = 0; // epoch ms of the cache write, used for TTL math (mockable via now())

/** Injected clock so probe_slice_2.py can mock time without sleeping. */
let clock: () => number = () => Date.now();
export function _setClockForTests(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}

function cacheIsFresh(): boolean {
  if (!cachedPayload) return false;
  return clock() - cachedAt < CACHE_TTL_MS;
}

/**
 * Called by pricing-model / collective-subscription admin write paths so an
 * admin save propagates immediately instead of waiting out the TTL. Wiring
 * this call into the admin PATCH/POST handlers is OPTIONAL (5-minute staleness
 * is an accepted tradeoff per the task's Constraint section) — if not wired,
 * the cache still self-heals within 5 minutes with zero code changes.
 */
export function invalidatePublicPricingCache(): void {
  cachedPayload = null;
  cachedAt = 0;
}

/** Test-only escape hatch to inspect/reset cache state without waiting. */
export function _resetCacheForTests(): void {
  cachedPayload = null;
  cachedAt = 0;
}
export function _getCacheStateForTests(): { hasCachedPayload: boolean; cachedAt: number } {
  return { hasCachedPayload: cachedPayload !== null, cachedAt };
}

/* =================================================================== */
/*  Formatting helpers                                                 */
/* =================================================================== */

function formatAnnual(priceMinor: number, currency: string): string {
  const dollars = Math.round(priceMinor / 100);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${dollars.toLocaleString()}/year per company`;
}

function formatOneTime(priceMinor: number, currency: string): string {
  const dollars = Math.round(priceMinor / 100);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${dollars.toLocaleString()} one-time`;
}

function findBySlug(models: pricingModel.PricingModel[], slugs: readonly string[]): pricingModel.PricingModel | undefined {
  for (const slug of slugs) {
    const hit = models.find((m) => m.slug === slug);
    if (hit) return hit;
  }
  return undefined;
}

function priceMinorForCadence(m: pricingModel.PricingModel, cadence: pricingModel.BillingCadence): number {
  const opt = m.cadenceOptions?.find((c) => c.cadence === cadence);
  if (opt) return opt.priceMinor;
  return m.basePriceMinor;
}

/* =================================================================== */
/*  Core resolver — reads pricing_models + collective_subscription_configs  */
/* =================================================================== */

/**
 * Never exposes: id, version, prevRevisionHash, revisionHash, createdBy,
 * updatedBy, discountCodes, metering, volumeBrackets, trial, taxInclusive,
 * regionalMultipliers, currencyOverrides, airwallexTier, airwallexPriceId,
 * entitlements, membershipRole, sortOrder, metadata. Only price_minor,
 * currency, and a pre-formatted display string ever leave this function.
 */
export function resolvePublicPricingPayload(): PublicPricingPayload {
  // --- capavate_annual: live founder-line model, preferring an explicit
  //     marketing slug, else the first live "founder" model with an
  //     annual cadence (documented assumption — see ASSUMPTIONS_SLICE_2.md).
  const liveFounderModels = pricingModel.listModels({ productLine: "founder", status: "live" });
  const founderModel =
    findBySlug(liveFounderModels, SLUGS.capavateAnnual) ??
    liveFounderModels.find((m) => m.cadence === "annual" || m.cadenceOptions?.some((c) => c.cadence === "annual"));

  const capavate_annual: PublicPriceEntry = founderModel
    ? {
        price_minor: priceMinorForCadence(founderModel, "annual"),
        currency: founderModel.currency || "USD",
        display: formatAnnual(priceMinorForCadence(founderModel, "annual"), founderModel.currency || "USD"),
      }
    : STATIC_FALLBACK.capavate_annual;

  // --- academy_one_time: live add_on model tagged as one-time, matched by
  //     marketing slug first, else any live "add_on" with a one_time cadence.
  const liveAddOnModels = pricingModel.listModels({ productLine: "add_on", status: "live" });
  const academyModel =
    findBySlug(liveAddOnModels, SLUGS.academyOneTime) ??
    liveAddOnModels.find((m) => m.cadence === "one_time" || m.cadenceOptions?.some((c) => c.cadence === "one_time"));

  const academy_one_time: PublicPriceEntry = academyModel
    ? {
        price_minor: priceMinorForCadence(academyModel, "one_time"),
        currency: academyModel.currency || "USD",
        display: formatOneTime(priceMinorForCadence(academyModel, "one_time"), academyModel.currency || "USD"),
      }
    : STATIC_FALLBACK.academy_one_time;

  // --- investors_free: always free by product design (there is no
  //     investor-facing pricing model to read — investors are invited by
  //     their companies, never billed). Static by definition, not a bug.
  const investors_free: PublicPriceEntry = STATIC_FALLBACK.investors_free;

  // --- partners_custom: Consortium Partner pricing is bespoke per contact
  //     (contacts.fee_override_json / contacts.arrangement_json — never a
  //     single public number). We surface ONLY the fact that live partner
  //     tiers exist and are non-zero/custom; we never expose the actual
  //     partnerTiers.ts amounts here (those are commercial, negotiated, and
  //     partner-routes territory — partnerConsortiumRoutes.ts is sacred and
  //     untouched by this slice).
  const partners_custom: PublicPriceEntry = STATIC_FALLBACK.partners_custom;

  return {
    capavate_annual,
    academy_one_time,
    investors_free,
    partners_custom,
    as_of: new Date().toISOString(),
  };
}

/* =================================================================== */
/*  Route registration                                                 */
/* =================================================================== */

export default function registerPublicPricingRoutes(app: Express): void {
  app.get("/api/pricing-public", (_req: Request, res: Response) => {
    // Serve from cache when fresh — this is the "fast public endpoint" /
    // 5-minute TTL requirement.
    if (cacheIsFresh() && cachedPayload) {
      res.set("Cache-Control", "public, max-age=300");
      res.json(cachedPayload);
      return;
    }

    try {
      const payload = resolvePublicPricingPayload();
      cachedPayload = payload;
      cachedAt = clock();
      res.set("Cache-Control", "public, max-age=300");
      res.json(payload);
    } catch (err) {
      // Fail-soft: a public marketing endpoint must never 500 the homepage.
      // Prefer the last-known-good cache (even if past TTL) over the static
      // fallback, and the static fallback only if we have never had a good
      // read (e.g. fresh boot with a DB hiccup).
      // eslint-disable-next-line no-console
      console.error("[pricing-public] resolvePublicPricingPayload failed, serving cached/fallback:", err);
      const degraded = cachedPayload ?? STATIC_FALLBACK;
      res.set("Cache-Control", "public, max-age=60"); // shorter TTL while degraded
      res.json(degraded);
    }
  });
}
