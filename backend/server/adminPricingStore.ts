/**
 * Sprint 11 — Admin pricing store (read by founder Settings).
 *
 * v25.27 Phase A3 — UNIFY pricing chain.
 * ----------------------------------------
 * BEFORE: this file owned a hardcoded RAM-only `PRICING_TIERS` array (single
 * $840 tier). The PATCH /api/admin/pricing-tiers/:id endpoint mutated the
 * in-memory object only — every admin edit reverted to $840 on restart.
 * Meanwhile the admin UI's /admin/pricing-models page wrote to a SEPARATE,
 * durable store (`pricingModelStore`) which billing ignored. Result:
 * three disconnected pricing catalogs.
 *
 * AFTER: this module is now a BACKWARDS-COMPATIBLE READ ADAPTER over the
 * persistent `pricingModelStore`. Existing consumers of:
 *   GET   /api/admin/pricing-tiers
 *   PATCH /api/admin/pricing-tiers/:id
 * still work, but reads come from pricingModelStore (durable + admin-editable)
 * and the PATCH route forwards to `pricingModelStore.updateModel` so changes
 * actually persist.
 *
 * The exported `PRICING_TIERS` constant is preserved as a getter so any
 * import that destructures it (server code, tests) sees current data.
 */
import type { Express, Request, Response } from "express";
/* WAVE 34 · TASK 2 — ISO-4217 exponent for the tier displayPrice string.
   WAVE 35 · F2 — and now for the NUMBERS in the same object literal, which
   Wave 34 classified "USD by contract" (category 3) and left on a hardcoded
   `/100`. Review A falsified that classification by execution. */
import { fromMinor, toMinor, currencyExponent } from "./lib/currency";
import * as pricingModel from "./pricingModelStore";
import { requireAuth } from "./lib/authMiddleware"; /* v25.48.3 Q-C3 — founder-scoped read route */

export type PricingTier = {
  id: string;
  name: string;
  /* WAVE 35 · F2 — these two are USD-ONLY and are now `null` for any tier
     priced in another currency. They were `Math.round(minor / 100)` labelled
     USD: a ¥1,200,000/year JPY plan was served to founders as `annualUsd:
     12000` and rendered `$12,000` — 100× understated AND mislabelled. A null
     forces the consumer to render a refusal or use the currency-aware fields
     below; a zero would have been a lie that looks like a price. */
  monthlyUsd: number | null;
  annualUsd: number | null;
  /** WAVE 35 · F2 — the truth: ISO-4217 code + integer minor units. */
  currency: string;
  monthlyMinor: number;
  annualMinor: number;
  blurb: string;
  features: Array<{ key: string; label: string; included: boolean; limit?: string }>;
  /** v19 Wave A: explicit billing cycle for display. */
  billingCycle?: "annual" | "monthly" | "one_time";
  /** v19 Wave A: integer cents for accurate display + billing. */
  annualPriceCents?: number;
  /** v19 Wave A: pre-formatted display string. */
  displayPrice?: string;
};

function modelToTier(m: pricingModel.PricingModel): PricingTier {
  const annualOption = m.cadenceOptions?.find((c) => c.cadence === "annual");
  const monthlyOption = m.cadenceOptions?.find((c) => c.cadence === "monthly");

  const annualMinor =
    annualOption?.priceMinor ??
    (m.cadence === "annual" ? m.basePriceMinor : (m.basePriceMinor || 0) * 12);
  const monthlyMinor =
    monthlyOption?.priceMinor ??
    (m.cadence === "monthly" ? m.basePriceMinor : Math.round(annualMinor / 12));

  /* WAVE 35 · F2 — the model carries a first-class per-model `currency`, and
     the sibling `displayPrice` line below already reads it. The two numeric
     fields did not, so the SAME object literal carried a currency-aware string
     and two currency-blind numbers. */
  const tierCurrency = String(m.currency || "USD").toUpperCase();
  const isUsd = tierCurrency === "USD";

  return {
    id: m.id,
    name: m.name,
    /* USD-only, null otherwise — see the type. `fromMinor` supplies the
       ISO-4217 exponent instead of a hardcoded 100, so this stays correct if
       the USD exponent assumption is ever revisited. */
    monthlyUsd: isUsd ? Math.round(fromMinor(monthlyMinor || 0, tierCurrency)) : null,
    annualUsd: isUsd ? Math.round(fromMinor(annualMinor || 0, tierCurrency)) : null,
    currency: tierCurrency,
    monthlyMinor: monthlyMinor || 0,
    annualMinor: annualMinor || 0,
    blurb: m.description,
    features: m.features.map((f) => ({ key: f.key, label: f.label, included: f.included })),
    billingCycle: m.cadence === "annual" || m.cadence === "monthly" || m.cadence === "one_time" ? m.cadence : "annual",
    annualPriceCents: annualMinor,
    /* WAVE 34 · TASK 2 — was:
     *   `$${Math.round(annualMinor / 100).toLocaleString()} ${m.currency || "USD"}/year`
     * The model's OWN currency was interpolated into the very string that was
     * built with a hardcoded exponent-2 divisor — and with a hardcoded "$".
     * A ¥1,200,000/year tier rendered "$12,000 JPY/year": wrong magnitude AND
     * wrong symbol. `fromMinor` supplies the ISO-4217 exponent; the "$" is now
     * conditional on USD, matching the shape publicPricingRoutes already uses.
     * USD output is byte-identical to before. */
    displayPrice: annualMinor > 0
      ? (() => {
          const tierCurrency = m.currency || "USD";
          const symbol = tierCurrency === "USD" ? "$" : "";
          return `${symbol}${fromMinor(annualMinor, tierCurrency).toLocaleString()} ${tierCurrency}/year`;
        })()
      : "Free",
  };
}

function listLiveFounderTiers(): PricingTier[] {
  return pricingModel
    .listModels({ productLine: "founder", status: "live" })
    .map(modelToTier);
}

/**
 * v25.27 — PRICING_TIERS is now a dynamic array-like proxy that reflects the
 * current pricingModelStore state on every access. Code that does
 * `PRICING_TIERS.find(t => t.id === ...)` works exactly as before, but the
 * data is sourced from the durable store, not a hardcoded RAM array.
 *
 * If you need a snapshot at a single point in time, call `listLiveFounderTiers()`.
 */
export const PRICING_TIERS: PricingTier[] = new Proxy([] as PricingTier[], {
  get(_target, prop) {
    const fresh = listLiveFounderTiers();
    if (prop === "length") return fresh.length;
    if (typeof prop === "string" && /^\d+$/.test(prop)) {
      return fresh[Number(prop)];
    }
    // Array methods: rebind to the fresh snapshot
    if (prop === Symbol.iterator) return fresh[Symbol.iterator].bind(fresh);
    const v = (fresh as unknown as Record<string | symbol, unknown>)[prop as string];
    return typeof v === "function" ? (v as Function).bind(fresh) : v;
  },
  has(_target, prop) {
    const fresh = listLiveFounderTiers();
    return prop in fresh;
  },
  ownKeys() {
    const fresh = listLiveFounderTiers();
    return Reflect.ownKeys(fresh);
  },
  getOwnPropertyDescriptor(_target, prop) {
    const fresh = listLiveFounderTiers();
    return Object.getOwnPropertyDescriptor(fresh, prop);
  },
});

export function registerAdminPricingRoutes(app: Express): void {
  // GET — list founder-tier pricing (live tiers only).
  app.get("/api/admin/pricing-tiers", (_req: Request, res: Response) => {
    res.json(listLiveFounderTiers());
  });

  /* v25.48.3 Q-C3 — FOUNDER-scoped, read-only pricing tiers. The founder
   * Settings > Billing/Plan tab previously called the admin route
   * /api/admin/pricing-tiers, which the router-level `requireAdmin` guard
   * rejects with 403 ADMIN_REQUIRED for founders (noisy; incomplete pricing).
   * This mirror returns the SAME live founder tiers (public, non-sensitive
   * catalog) behind requireAuth so founders read their own plan options
   * without hitting an admin route. No write route is exposed here — edits
   * stay admin-only. */
  app.get("/api/founder/pricing-tiers", requireAuth, (_req: Request, res: Response) => {
    res.json(listLiveFounderTiers());
  });

  // PATCH — forward writes to the persistent pricingModelStore.
  // This is the bug fix: prior versions mutated the in-RAM array.
  app.patch("/api/admin/pricing-tiers/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const model = pricingModel.getModel(id);
    if (!model) return res.status(404).json({ error: "tier_not_found" });

    const update: Partial<pricingModel.PricingModel> = {};

    /* WAVE 35 · F2 (write pole) — the READ path served `monthlyUsd` for a JPY
     * model; this WRITE path accepted it back and did `* 100`, which for a
     * zero-exponent currency PERSISTS a 100× over-statement into
     * pricingModelStore. A USD-named field cannot describe a non-USD model, so
     * it is REFUSED rather than silently mis-scaled. Callers pricing a non-USD
     * tier send the exponent-free `monthlyMinor` / `annualMinor` instead. */
    const modelCurrency = String(model.currency || "USD").toUpperCase();
    const usdFieldSent =
      typeof req.body?.monthlyUsd === "number" || typeof req.body?.annualUsd === "number";
    if (usdFieldSent && modelCurrency !== "USD") {
      return res.status(400).json({
        error: "currency_mismatch",
        message:
          `Tier "${id}" is priced in ${modelCurrency}. The USD-only fields monthlyUsd/annualUsd ` +
          `cannot express a ${modelCurrency} price (ISO-4217 exponent ` +
          `${currencyExponent(modelCurrency)}, not 2). Send monthlyMinor / annualMinor ` +
          `as integer minor units instead.`,
        currency: modelCurrency,
        expectedFields: ["monthlyMinor", "annualMinor"],
      });
    }

    /* Exponent-free minor-unit writes — valid for EVERY currency. */
    const applyMinor = (cadence: "monthly" | "annual", priceMinor: number) => {
      const opts = (update.cadenceOptions ?? model.cadenceOptions ?? []).map((c) =>
        c.cadence === cadence ? { ...c, priceMinor } : c,
      );
      if (!opts.some((c) => c.cadence === cadence)) opts.push({ cadence, priceMinor });
      update.cadenceOptions = opts;
      if (model.cadence === cadence) update.basePriceMinor = priceMinor;
    };
    if (typeof req.body?.monthlyMinor === "number" && Number.isInteger(req.body.monthlyMinor)) {
      applyMinor("monthly", req.body.monthlyMinor);
    }
    if (typeof req.body?.annualMinor === "number" && Number.isInteger(req.body.annualMinor)) {
      applyMinor("annual", req.body.annualMinor);
    }

    if (typeof req.body?.monthlyUsd === "number") {
      /* modelCurrency is USD here (guarded above); toMinor supplies the
       * ISO-4217 exponent rather than a hardcoded 100. */
      const monthlyMinor = toMinor(req.body.monthlyUsd, modelCurrency);
      const newCadenceOpts = (update.cadenceOptions ?? model.cadenceOptions ?? []).map((c) =>
        c.cadence === "monthly" ? { ...c, priceMinor: monthlyMinor } : c,
      );
      if (!newCadenceOpts.some((c) => c.cadence === "monthly")) {
        newCadenceOpts.push({ cadence: "monthly", priceMinor: monthlyMinor });
      }
      update.cadenceOptions = newCadenceOpts;
      if (model.cadence === "monthly") update.basePriceMinor = monthlyMinor;
    }

    if (typeof req.body?.annualUsd === "number") {
      const annualMinor = toMinor(req.body.annualUsd, modelCurrency);
      const newCadenceOpts = (update.cadenceOptions ?? model.cadenceOptions ?? []).map((c) =>
        c.cadence === "annual" ? { ...c, priceMinor: annualMinor } : c,
      );
      if (!newCadenceOpts.some((c) => c.cadence === "annual")) {
        newCadenceOpts.push({ cadence: "annual", priceMinor: annualMinor });
      }
      update.cadenceOptions = newCadenceOpts;
      if (model.cadence === "annual") update.basePriceMinor = annualMinor;
    }

    if (typeof req.body?.blurb === "string") update.description = req.body.blurb;
    if (
      req.body?.billingCycle === "annual" ||
      req.body?.billingCycle === "monthly" ||
      req.body?.billingCycle === "one_time"
    ) {
      update.cadence = req.body.billingCycle;
    }

    if (Object.keys(update).length === 0) {
      // No-op — return current state so legacy clients don't break.
      return res.json(modelToTier(model));
    }

    const actor =
      (req as { userContext?: { userId?: string } }).userContext?.userId || "admin:legacy-pricing-tiers";
    const result = pricingModel.updateModel(id, update, actor);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(modelToTier(result.model));
  });
}

// v19 Wave A / Change 2 — test helper exports.
export const _testPricing = { PRICING_TIERS };
