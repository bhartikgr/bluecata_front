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
import * as pricingModel from "./pricingModelStore";

export type PricingTier = {
  id: string;
  name: string;
  monthlyUsd: number;
  annualUsd: number;
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

  return {
    id: m.id,
    name: m.name,
    monthlyUsd: Math.round((monthlyMinor || 0) / 100),
    annualUsd: Math.round((annualMinor || 0) / 100),
    blurb: m.description,
    features: m.features.map((f) => ({ key: f.key, label: f.label, included: f.included })),
    billingCycle: m.cadence === "annual" || m.cadence === "monthly" || m.cadence === "one_time" ? m.cadence : "annual",
    annualPriceCents: annualMinor,
    displayPrice: annualMinor > 0
      ? `$${Math.round(annualMinor / 100).toLocaleString()} ${m.currency || "USD"}/year`
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

  // PATCH — forward writes to the persistent pricingModelStore.
  // This is the bug fix: prior versions mutated the in-RAM array.
  app.patch("/api/admin/pricing-tiers/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const model = pricingModel.getModel(id);
    if (!model) return res.status(404).json({ error: "tier_not_found" });

    const update: Partial<pricingModel.PricingModel> = {};

    if (typeof req.body?.monthlyUsd === "number") {
      const monthlyMinor = Math.round(req.body.monthlyUsd * 100);
      const newCadenceOpts = (model.cadenceOptions ?? []).map((c) =>
        c.cadence === "monthly" ? { ...c, priceMinor: monthlyMinor } : c,
      );
      if (!newCadenceOpts.some((c) => c.cadence === "monthly")) {
        newCadenceOpts.push({ cadence: "monthly", priceMinor: monthlyMinor });
      }
      update.cadenceOptions = newCadenceOpts;
      if (model.cadence === "monthly") update.basePriceMinor = monthlyMinor;
    }

    if (typeof req.body?.annualUsd === "number") {
      const annualMinor = Math.round(req.body.annualUsd * 100);
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
