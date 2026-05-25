/**
 * Sprint 11 — Admin pricing store (read by founder Settings).
 *
 * v19 Wave A / Change 2: Single-plan default.
 * --------------------------------------------
 * Per founder directive (Ozan, 24-May-2026): “Display only one pricing
 * option for companies (\$840 USD/year). This delivers them full Capavate
 * functionality (not Collective or Consortium Partners). Obviously, this is
 * per company.”
 *
 * The `founder_tiers` table backend schema is preserved (admins can still
 * add tiers via the existing admin pricing endpoints). What changed:
 *   • default seed array contains exactly one tier
 *   • tier carries explicit annual price + billingCycle annotations
 *   • Collective + Consortium are explicitly marked NOT included — those
 *     surfaces have their own commercial flow.
 *
 * Routes (unchanged):
 *   GET  /api/admin/pricing-tiers       — current tier table (consumed by Founder Settings → Plan & Pricing)
 *   PATCH /api/admin/pricing-tiers/:id  — admin updates a tier (price, included features, blurb)
 */
import type { Express, Request, Response } from "express";

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

/**
 * v19 Wave A / Change 2 — single default tier.
 *
 * Capavate Annual: \$840 USD/year per company, full Capavate functionality.
 * Collective + Consortium are explicitly excluded — those are separate
 * commercial offerings with their own membership flows.
 */
export const PRICING_TIERS: PricingTier[] = [
  {
    id: "founder_capavate_annual",
    name: "Capavate Annual",
    monthlyUsd: 70,           // $70/mo display equivalent (= $840 / 12)
    annualUsd: 840,
    blurb: "Full Capavate functionality — \$840 USD/year per company.",
    billingCycle: "annual",
    annualPriceCents: 84000,
    displayPrice: "\$840 USD/year per company",
    features: [
      { key: "cap_table", label: "Cap Table Management", included: true },
      { key: "rounds", label: "Round Management", included: true },
      { key: "data_room", label: "Data Room", included: true },
      { key: "investors_crm", label: "Investor CRM", included: true },
      { key: "documents", label: "Documents & Term Sheets", included: true },
      { key: "esop", label: "ESOP / Option Pool", included: true },
      { key: "communications", label: "Messages & Communications", included: true },
      { key: "audit_chain", label: "Audit Log & Hash Chain Verification", included: true },
      { key: "compliance", label: "GDPR / CCPA Compliance Tools", included: true },
      { key: "support", label: "Email Support", included: true },
      { key: "collective", label: "Collective Membership", included: false },
      { key: "consortium", label: "Consortium Partner Features", included: false },
    ],
  },
];

export function registerAdminPricingRoutes(app: Express): void {
  app.get("/api/admin/pricing-tiers", (_req: Request, res: Response) => {
    res.json(PRICING_TIERS);
  });

  app.patch("/api/admin/pricing-tiers/:id", (req: Request, res: Response) => {
    const t = PRICING_TIERS.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: "tier_not_found" });
    if (typeof req.body?.monthlyUsd === "number") t.monthlyUsd = req.body.monthlyUsd;
    if (typeof req.body?.annualUsd === "number") {
      t.annualUsd = req.body.annualUsd;
      t.annualPriceCents = Math.round(req.body.annualUsd * 100);
    }
    if (typeof req.body?.blurb === "string") t.blurb = req.body.blurb;
    if (req.body?.billingCycle === "annual" || req.body?.billingCycle === "monthly" || req.body?.billingCycle === "one_time") {
      t.billingCycle = req.body.billingCycle;
    }
    res.json(t);
  });
}

// v19 Wave A / Change 2 — test helper exports.
export const _testPricing = { PRICING_TIERS };
