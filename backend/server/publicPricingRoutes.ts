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
/* WAVE 34 · TASK 2 — ISO-4217 exponent for the public price display strings. */
import { fromMinor } from "./lib/currency";
/* WAVE 50 · ITEM 1 — the annual fee is a `platform_fees` row, read directly so
 * that an absent row stays absent instead of becoming a $0. */
import { rawDb } from "./db/connection";
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

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 50 · ITEM 1 — THE ANNUAL FEE HAD A SECOND SOURCE, AND IT WAS LIVE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS HERE. A `STATIC_FALLBACK` object literal holding a `price_minor`, a
 * currency and a pre-formatted display string for BOTH the founder annual fee and
 * the academy one-time fee, described as a cold-start degradation path. The
 * amounts are not repeated in this comment, deliberately: after this wave the
 * only place either number exists is a database row, and a comment carrying a
 * copy of a price is how a second source starts.
 *
 * WHY THAT DESCRIPTION WAS WRONG, AND THIS IS THE REPRODUCTION. `kv_pricingModelStore`
 * holds ZERO rows in both `data.db` and `test.db`. `resolvePublicPricingPayload()`
 * reads that store, finds nothing, and took the fallback — so those constants were
 * not a dormant safety net, they were THE LIVE ANSWER served to every visitor of
 * GET /api/pricing-public. `server/pricingModelStore.ts` (~:161-182) records that
 * these very figures, "Free, Pro, Capavate Annual", were a hardcoded seed deleted
 * in v25.27 because "all source-baked pricing is removed"; this object was a
 * surviving copy of it. Two sources for one price violates R22 ("every price must
 * resolve from one read"); a compiled-in price violates R21 ("100% dynamic.
 * Nothing static or hard coded").
 *
 * THE ANNUAL FEE IS A REAL PRICE FOR A REAL PRODUCT. It appears on 30+ live paid
 * invoices and matches the "Capavate Annual Administrative Fee". The HARDCODING is
 * the defect, not the number. So the amount was MOVED — not deleted, not changed —
 * into `platform_fees` by migration 0187 §3, under the keys below, and is resolved
 * from there. `platform_fees` is the admin-editable table R22 already made
 * authoritative for the SPV deployment fee ("the value the owner edits is
 * authoritative; the charge path must read the SAME row"), and it already holds the
 * legitimate `consortium.spv_deployment_fee` seed this wave confirmed and did not
 * touch.
 *
 * WHAT REPLACES THE FALLBACK WHEN THE ROW IS EMPTY: an explicit R6 REFUSAL, never
 * a price. Note the refusal carries NO `price_minor` and NO `currency` — a zero
 * here would render "$0/year", which is R6's exact prohibition and would be worse
 * than the hardcoding it replaced.
 *
 * `platformFeesStore.getFee()` is deliberately NOT used: it returns
 * `{ amountMinor: 0 }` for an unknown key, which erases the difference between
 * "free" and "we have no row". This reads the row directly so absence stays
 * absence.
 *
 * OBSERVATION FOR THE OWNER, recorded rather than silently decided: the founder
 * annual fee has two plausible homes in this tree — `platform_fees` (admin-edited,
 * R22's precedent, chosen here) and `kv_pricingModelStore` (the richer pricing-model
 * catalogue this route prefers when populated). This wave did not restructure the
 * catalogue; the read order below still prefers a live pricing model when one
 * exists, so seeding one later supersedes this row without a code change.
 */
export const PUBLIC_FEE_KEYS = {
  capavateAnnual: "founder.capavate_annual",
  academyOneTime: "founder.academy_one_time",
} as const;

/** Read one `platform_fees` row, or null. NULL/absent stays absent — never 0. */
function readPlatformFee(key: string): { amountMinor: number; currency: string } | null {
  try {
    const row: any = rawDb()
      .prepare(`SELECT amount_minor, currency FROM platform_fees WHERE key = ? AND deleted_at IS NULL`)
      .get(key);
    if (!row) return null;
    if (row.amount_minor === null || row.amount_minor === undefined) return null;
    const amountMinor = Number(row.amount_minor);
    if (!Number.isFinite(amountMinor) || amountMinor < 0) return null;
    return { amountMinor, currency: String(row.currency || "USD").toUpperCase() };
  } catch {
    return null;
  }
}

/**
 * R6 refusal text for a price we cannot resolve. Deliberately not a number and
 * not a blank: a marketing surface that cannot quote must SAY it cannot quote.
 */
export const PRICE_UNAVAILABLE_DISPLAY = "Pricing unavailable — please contact us";

/** Non-price marketing copy. These carry NO amount, so they are not prices and
 *  R21/R22 do not apply to them: investors are never billed (there is no
 *  investor pricing model to read), and Consortium Partner pricing is bespoke
 *  per contact and is deliberately never a single public number. */
const STATIC_COPY = {
  investors_free: { display: "Free. Always." } as PublicPriceEntry,
  partners_custom: { display: "Custom pricing" } as PublicPriceEntry,
} as const;

/** The last-resort payload. It contains NO prices — only the copy above and
 *  explicit refusals — so no code path in this file can quote a compiled-in
 *  amount. */
function refusalPayload(): PublicPricingPayload {
  return {
    capavate_annual: { display: PRICE_UNAVAILABLE_DISPLAY },
    academy_one_time: { display: PRICE_UNAVAILABLE_DISPLAY },
    investors_free: STATIC_COPY.investors_free,
    partners_custom: STATIC_COPY.partners_custom,
    as_of: new Date(0).toISOString(),
  };
}

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

/* WAVE 34 · TASK 2 — both formatters were:
 *     const dollars = Math.round(priceMinor / 100);
 * The `currency` parameter was ALREADY being used on the next line to pick the
 * symbol, and the divisor was still a hardcoded exponent-2 assumption. This is
 * GET /api/pricing-public — the unauthenticated marketing pricing endpoint, the
 * most publicly visible money surface in the product. A ¥1,200,000/year tier
 * was quoted to the world as "JPY 12,000/year per company". Non-USD pricing is
 * not hypothetical: pricingModelStore models carry a first-class `currency`
 * plus a `currencyOverrides[]` array and previewPrice() resolves per-currency.
 * `fromMinor` reads the ISO-4217 exponent (JPY/KRW = 0) and returns a number,
 * so the local variable's type and the rendered SHAPE are both unchanged. */
function formatAnnual(priceMinor: number, currency: string): string {
  const major = fromMinor(priceMinor, currency);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${major.toLocaleString()}/year per company`;
}

function formatOneTime(priceMinor: number, currency: string): string {
  const major = fromMinor(priceMinor, currency);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${major.toLocaleString()} one-time`;
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

  /* WAVE 50 · ITEM 1 — ONE READ, THEN A REFUSAL. A live pricing model still wins
   * when one exists (that is the richer catalogue and this route's first choice);
   * otherwise the admin-editable `platform_fees` row; otherwise an explicit R6
   * refusal. There is no third branch holding a number. */
  const annualFeeRow = founderModel ? null : readPlatformFee(PUBLIC_FEE_KEYS.capavateAnnual);
  const capavate_annual: PublicPriceEntry = founderModel
    ? {
        price_minor: priceMinorForCadence(founderModel, "annual"),
        currency: founderModel.currency || "USD",
        display: formatAnnual(priceMinorForCadence(founderModel, "annual"), founderModel.currency || "USD"),
      }
    : annualFeeRow
      ? {
          price_minor: annualFeeRow.amountMinor,
          currency: annualFeeRow.currency,
          display: formatAnnual(annualFeeRow.amountMinor, annualFeeRow.currency),
        }
      : { display: PRICE_UNAVAILABLE_DISPLAY };

  // --- academy_one_time: live add_on model tagged as one-time, matched by
  //     marketing slug first, else any live "add_on" with a one_time cadence.
  const liveAddOnModels = pricingModel.listModels({ productLine: "add_on", status: "live" });
  const academyModel =
    findBySlug(liveAddOnModels, SLUGS.academyOneTime) ??
    liveAddOnModels.find((m) => m.cadence === "one_time" || m.cadenceOptions?.some((c) => c.cadence === "one_time"));

  const academyFeeRow = academyModel ? null : readPlatformFee(PUBLIC_FEE_KEYS.academyOneTime);
  const academy_one_time: PublicPriceEntry = academyModel
    ? {
        price_minor: priceMinorForCadence(academyModel, "one_time"),
        currency: academyModel.currency || "USD",
        display: formatOneTime(priceMinorForCadence(academyModel, "one_time"), academyModel.currency || "USD"),
      }
    : academyFeeRow
      ? {
          price_minor: academyFeeRow.amountMinor,
          currency: academyFeeRow.currency,
          display: formatOneTime(academyFeeRow.amountMinor, academyFeeRow.currency),
        }
      : { display: PRICE_UNAVAILABLE_DISPLAY };

  // --- investors_free: always free by product design (there is no
  //     investor-facing pricing model to read — investors are invited by
  //     their companies, never billed). Static by definition, not a bug.
  const investors_free: PublicPriceEntry = STATIC_COPY.investors_free;

  // --- partners_custom: Consortium Partner pricing is bespoke per contact
  //     (contacts.fee_override_json / contacts.arrangement_json — never a
  //     single public number). We surface ONLY the fact that live partner
  //     tiers exist and are non-zero/custom; we never expose the actual
  //     partnerTiers.ts amounts here (those are commercial, negotiated, and
  //     partner-routes territory — partnerConsortiumRoutes.ts is sacred and
  //     untouched by this slice).
  const partners_custom: PublicPriceEntry = STATIC_COPY.partners_custom;

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
      // WAVE 50 · ITEM 1 — the degraded path now refuses rather than quoting a
      // compiled-in amount. Last-known-good cache is still preferred over the
      // refusal, because a real price read a minute ago is better information
      // than "unavailable"; what is gone is the hardcoded number underneath it.
      const degraded = cachedPayload ?? refusalPayload();
      res.set("Cache-Control", "public, max-age=60"); // shorter TTL while degraded
      res.json(degraded);
    }
  });
}
