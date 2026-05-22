/**
 * Sprint 11 — Admin pricing store (read by founder Settings).
 *
 * Routes:
 *   GET  /api/admin/pricing-tiers       — current tier table (consumed by Founder Settings → Plan & Pricing)
 *   PATCH /api/admin/pricing-tiers/:id  — admin updates a tier (price, included features)
 */
import type { Express, Request, Response } from "express";

export type PricingTier = {
  id: string;
  name: string;
  monthlyUsd: number;
  annualUsd: number;
  blurb: string;
  features: Array<{ key: string; label: string; included: boolean; limit?: string }>;
};

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "founder_free",
    name: "Founder Free",
    monthlyUsd: 0,
    annualUsd: 0,
    blurb: "Solo founder, single round, lightweight cap table.",
    features: [
      { key: "captable", label: "Cap table", included: true, limit: "≤ 25 holders" },
      { key: "rounds", label: "Active rounds", included: true, limit: "1" },
      { key: "dataroom", label: "Dataroom", included: true, limit: "100 MB" },
      { key: "investor_crm", label: "Investor CRM", included: false },
      { key: "reports", label: "Investor reports", included: false },
      { key: "messages", label: "Messages", included: true, limit: "DM only" },
      { key: "soft_circle", label: "Soft-circle book", included: false },
      { key: "warrants_options", label: "Warrants + ESOP attach", included: false },
      { key: "anti_dilution", label: "Anti-dilution simulator", included: false },
      { key: "audit_export", label: "Audit-grade activity export", included: false },
      { key: "collective_apply", label: "Apply to Capavate Collective", included: true },
    ],
  },
  {
    id: "founder_pro",
    name: "Founder Pro",
    monthlyUsd: 249,
    annualUsd: 2_490,
    blurb: "Active fundraisers running 1+ rounds with a real investor list.",
    features: [
      { key: "captable", label: "Cap table", included: true, limit: "Unlimited" },
      { key: "rounds", label: "Active rounds", included: true, limit: "Unlimited" },
      { key: "dataroom", label: "Dataroom", included: true, limit: "10 GB + watermarking" },
      { key: "investor_crm", label: "Investor CRM", included: true },
      { key: "reports", label: "Investor reports", included: true, limit: "Templates + read-receipts" },
      { key: "messages", label: "Messages", included: true, limit: "Threads + posts + broadcasts" },
      { key: "soft_circle", label: "Soft-circle book", included: true },
      { key: "warrants_options", label: "Warrants + ESOP attach", included: true },
      { key: "anti_dilution", label: "Anti-dilution simulator", included: true },
      { key: "audit_export", label: "Audit-grade activity export", included: true },
      { key: "collective_apply", label: "Apply to Capavate Collective", included: true },
    ],
  },
  {
    id: "founder_scale",
    name: "Founder Scale",
    monthlyUsd: 749,
    annualUsd: 7_490,
    blurb: "Multi-company groups, late-stage rounds, full M&A intelligence.",
    features: [
      { key: "captable", label: "Cap table", included: true, limit: "Unlimited + ledger export" },
      { key: "rounds", label: "Active rounds", included: true, limit: "Unlimited" },
      { key: "dataroom", label: "Dataroom", included: true, limit: "Unlimited + investor watermark + DRM" },
      { key: "investor_crm", label: "Investor CRM", included: true },
      { key: "reports", label: "Investor reports", included: true },
      { key: "messages", label: "Messages", included: true },
      { key: "soft_circle", label: "Soft-circle book", included: true },
      { key: "warrants_options", label: "Warrants + ESOP attach", included: true },
      { key: "anti_dilution", label: "Anti-dilution simulator", included: true, limit: "+ M&A intelligence" },
      { key: "audit_export", label: "Audit-grade activity export", included: true },
      { key: "collective_apply", label: "Apply to Capavate Collective", included: true, limit: "Path A + Path B" },
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
    if (typeof req.body?.annualUsd === "number") t.annualUsd = req.body.annualUsd;
    if (typeof req.body?.blurb === "string") t.blurb = req.body.blurb;
    res.json(t);
  });
}
