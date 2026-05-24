/**
 * Sprint 10 — M&A Intelligence store + routes.
 *
 * Houses the per-company acquirer-fit scores, comparable-exits library,
 * top strategic-buyer shortlists, and the investor-led M&A initiative
 * thread index.
 *
 * Routes:
 *   GET  /api/investor/ma/intelligence/:companyId
 *   POST /api/investor/ma/initiative          — investor-led M&A start
 *
 * Scores are recomputed deterministically from a small set of inputs so
 * the math reconciles with the unit tests.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  maInitiativeSchema,
  type MaIntelligence,
  type MaInitiativePayload,
} from "@shared/schema";
import { emitSync } from "./sprint10Telemetry";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";

/* ----------------- deterministic acquirer-fit math ----------------- */

/**
 * Compute acquirer-fit score from a 6-feature vector. Each feature in [0,1].
 * Weighted sum × 100; rounded to nearest integer; clamped.
 *
 *   weights = { pmf 0.20, tech 0.20, mgmt 0.15, growth 0.15, share 0.10, lowChurn 0.20 }
 */
export function computeAcquirerFitScore(features: {
  pmf: number; tech: number; mgmt: number; growth: number; share: number; lowChurn: number;
}): number {
  const w = { pmf: 0.20, tech: 0.20, mgmt: 0.15, growth: 0.15, share: 0.10, lowChurn: 0.20 };
  const raw =
    features.pmf * w.pmf +
    features.tech * w.tech +
    features.mgmt * w.mgmt +
    features.growth * w.growth +
    features.share * w.share +
    features.lowChurn * w.lowChurn;
  const score = Math.round(raw * 100);
  return Math.max(0, Math.min(100, score));
}

/** Filter comparable exits to last `windowMonths` and within sector tag. */
export function filterComparableExits<T extends { date: string; sector: string }>(
  comps: T[],
  asOfIso: string,
  sector: string,
  windowMonths = 24,
): T[] {
  const asOf = new Date(asOfIso).getTime();
  const cutoff = asOf - windowMonths * 30 * 24 * 60 * 60 * 1000;
  return comps.filter((c) => {
    const t = new Date(c.date).getTime();
    return Number.isFinite(t) && t >= cutoff && t <= asOf && c.sector === sector;
  });
}

/* ----------------- seeded data per company ----------------- */

const COMPS_LIBRARY: Array<{ target: string; acquirer: string; date: string; valuationUsd: number; revenueMultiple: number; sector: string }> = [
  { target: "BridgeFX",     acquirer: "Visa",      date: "2025-11-04", valuationUsd:  680_000_000, revenueMultiple: 11.4, sector: "Fintech" },
  { target: "Quill Pay",    acquirer: "Stripe",    date: "2025-08-19", valuationUsd:  340_000_000, revenueMultiple:  9.2, sector: "Fintech" },
  { target: "Astra Settle", acquirer: "Adyen",     date: "2024-12-12", valuationUsd:  220_000_000, revenueMultiple:  8.0, sector: "Fintech" },
  { target: "Cordis Bio",   acquirer: "Roche",     date: "2025-09-30", valuationUsd: 1_100_000_000, revenueMultiple: 18.5, sector: "Biotech" },
  { target: "MimicLabs",    acquirer: "Illumina",  date: "2024-11-21", valuationUsd:  410_000_000, revenueMultiple:  9.4, sector: "Biotech" },
  { target: "Ardent Care",  acquirer: "Teladoc",   date: "2025-04-10", valuationUsd:  280_000_000, revenueMultiple:  6.8, sector: "Digital Health" },
  { target: "Vesta Robotics", acquirer: "Rockwell", date: "2025-07-01", valuationUsd:  520_000_000, revenueMultiple:  7.2, sector: "Industrial Automation" },
  { target: "OnyxAI",       acquirer: "ServiceNow", date: "2025-10-08", valuationUsd:  890_000_000, revenueMultiple: 14.0, sector: "AI Infrastructure" },
  { target: "Bristle Grid", acquirer: "Schneider", date: "2025-02-14", valuationUsd:  310_000_000, revenueMultiple:  6.0, sector: "Climate / Grid" },
];

const COMPANY_FEATURES: Record<string, {
  sector: string;
  pmf: number; tech: number; mgmt: number; growth: number; share: number; lowChurn: number;
  buyers: Array<{ name: string; rationale: string; recentActivity: string }>;
}> = {
  co_novapay: {
    sector: "Fintech",
    pmf: 0.78, tech: 0.85, mgmt: 0.80, growth: 0.74, share: 0.18, lowChurn: 0.92,
    buyers: [
      { name: "Stripe",      rationale: "Cross-border B2B payments overlap; Stripe has acquired adjacent rails",       recentActivity: "Acquired Quill Pay 2025-08; rumored interest in agentic-AI routing" },
      { name: "Visa",        rationale: "Visa Direct expansion; agentic-AI orchestration is a strategic gap",          recentActivity: "Acquired BridgeFX 2025-11 for $680M" },
      { name: "Adyen",       rationale: "B2B settlement platform; AI-routing complements unified commerce",            recentActivity: "Acquired Astra Settle 2024-12; expanding APAC corridor" },
    ],
  },
  co_arboreal: {
    sector: "Digital Health",
    pmf: 0.62, tech: 0.70, mgmt: 0.68, growth: 0.85, share: 0.06, lowChurn: 0.81,
    buyers: [
      { name: "Teladoc",     rationale: "Closed-loop coaching slots into chronic-care offering",                      recentActivity: "Acquired Ardent Care 2025-04" },
      { name: "Oura",        rationale: "Wearable + at-home labs is a horizontal expansion play",                     recentActivity: "Series E 2025-10; biomarker partnerships" },
      { name: "UnitedHealth", rationale: "Optum behavioral health rollup; payer reimbursement aligned",                recentActivity: "Optum acquired Persona Health 2025-06" },
    ],
  },
  co_quanta: {
    sector: "Industrial Automation",
    pmf: 0.74, tech: 0.82, mgmt: 0.71, growth: 0.66, share: 0.11, lowChurn: 0.86,
    buyers: [
      { name: "Rockwell",    rationale: "Buying autonomy stack to round out factory-floor portfolio",                 recentActivity: "Acquired Vesta Robotics 2025-07 for $520M" },
      { name: "Siemens",     rationale: "Sinumerik strategy slots in CV-driven QC modules",                            recentActivity: "Strategic announcement on AI-perception stack" },
      { name: "ABB",         rationale: "Robotics & motion division is consolidating the long-tail",                  recentActivity: "Open M&A mandate Q1 2026" },
    ],
  },
  co_kelvin: {
    sector: "Climate / Grid",
    pmf: 0.55, tech: 0.69, mgmt: 0.62, growth: 0.71, share: 0.04, lowChurn: 0.78,
    buyers: [
      { name: "Schneider",   rationale: "Microgrid software shortfall; Bristle Grid roll-up template",                recentActivity: "Acquired Bristle Grid 2025-02" },
      { name: "GE Vernova",  rationale: "Distributed-grid software is a stated 2026 priority",                         recentActivity: "Spin-off Q3 2025; greenfield M&A budget" },
      { name: "Hitachi Energy", rationale: "Asia-Pacific grid orchestration build-out",                                recentActivity: "Acquired Lumio 2024-09" },
    ],
  },
  co_helia: {
    sector: "AI Infrastructure",
    pmf: 0.82, tech: 0.88, mgmt: 0.86, growth: 0.91, share: 0.09, lowChurn: 0.94,
    buyers: [
      { name: "ServiceNow",  rationale: "Agent platform expansion; OnyxAI integration playbook is the template",      recentActivity: "Acquired OnyxAI 2025-10 for $890M" },
      { name: "Snowflake",   rationale: "Data + agent runtime convergence; gap in compute orchestration",             recentActivity: "Open M&A budget; multiple rumored bids" },
      { name: "Databricks",  rationale: "Databricks Mosaic acquisition pattern; agent runtime is next",                recentActivity: "Series I 2025-09; aggressive M&A mode" },
    ],
  },
  co_lattice: {
    sector: "Biotech",
    pmf: 0.71, tech: 0.76, mgmt: 0.75, growth: 0.62, share: 0.07, lowChurn: 0.84,
    buyers: [
      { name: "Roche",       rationale: "Diagnostics platform expansion; molecular-foundry is gap",                    recentActivity: "Acquired Cordis Bio 2025-09 for $1.1B" },
      { name: "Illumina",    rationale: "Foundry-as-a-service plays into MimicLabs roll-up",                          recentActivity: "Acquired MimicLabs 2024-11" },
      { name: "Ginkgo Bioworks", rationale: "Vertical roll-up of biofoundries",                                        recentActivity: "Series F 2025-12" },
    ],
  },
};

export function getMaIntelligenceFor(companyId: string, asOfIso = new Date().toISOString()): MaIntelligence {
  // Patch v4: drop the NovaPay default fallback. When demo is off, return null-like
  // baseline so the function does not leak NovaPay buyers to fresh users.
  const f = COMPANY_FEATURES[companyId] ?? (DEMO_SEED_ENABLED ? COMPANY_FEATURES.co_novapay : { sector: "", pmf: 0, tech: 0, mgmt: 0, growth: 0, share: 0, lowChurn: 0, buyers: [] });
  const acquirerFitScore = computeAcquirerFitScore({ pmf: f.pmf, tech: f.tech, mgmt: f.mgmt, growth: f.growth, share: f.share, lowChurn: f.lowChurn });
  // M&A score weights deal-readiness signals (mgmt + lowChurn + tech)
  const maScore = Math.round((f.mgmt * 0.4 + f.lowChurn * 0.4 + f.tech * 0.2) * 100);
  const comps = filterComparableExits(COMPS_LIBRARY, asOfIso, f.sector, 24)
    .map(({ target, acquirer, date, valuationUsd, revenueMultiple }) => ({ target, acquirer, date, valuationUsd, revenueMultiple }));
  const mults = comps.map((c) => c.revenueMultiple).filter((n): n is number => Number.isFinite(n));
  const low  = mults.length ? Math.min(...mults) : 0;
  const high = mults.length ? Math.max(...mults) : 0;
  const intentSignal: MaIntelligence["intentSignal"] =
    acquirerFitScore >= 80 ? "active_negotiation" :
    acquirerFitScore >= 65 ? "inbound" :
    acquirerFitScore >= 45 ? "outbound" : "none";
  return {
    companyId,
    acquirerFitScore,
    maScore,
    intentSignal,
    topStrategicBuyers: f.buyers.slice(0, 3),
    comparableExits: comps,
    revenueMultipleRange: { low, high },
    productMarketFit: Math.round(f.pmf * 100),
    technologyDifferentiation: Math.round(f.tech * 100),
    customerConcentration: Math.round((1 - f.share) * 100),
    growthRate: Math.round(f.growth * 100),
    marketShare: Math.round(f.share * 100),
    managementTeamStrength: Math.round(f.mgmt * 100),
  };
}

/* ----------------- investor-led initiatives ----------------- */
type Initiative = MaInitiativePayload & {
  id: string;
  createdAt: string;
  threadId: string;
  investorUserId: string;
};
const initiatives: Initiative[] = [];

export function getInitiatives(): Initiative[] {
  return initiatives.slice();
}

export function clearInitiatives(): void {
  initiatives.length = 0;
}

export function registerMaIntelligenceRoutes(app: Express): void {
  app.get("/api/investor/ma/intelligence/:companyId", (req: Request, res: Response) => {
    const { companyId } = req.params;
    const intel = getMaIntelligenceFor(companyId);
    res.json(intel);
  });

  app.post("/api/investor/ma/initiative", (req: Request, res: Response) => {
    const parsed = maInitiativeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    }
    const id = `mai_${randomBytes(8).toString("hex")}`;
    const initiative: Initiative = {
      ...parsed.data,
      id,
      createdAt: new Date().toISOString(),
      threadId: `ch_ma_${parsed.data.companyId}_${id}`,
      investorUserId: "u_investor_demo",
    };
    initiatives.push(initiative);
    const eventType = parsed.data.initiativeType === "lead_initiative"
      ? "ma_initiative_started"
      : "ma_discussion_started";
    const env = emitSync({
      eventType,
      aggregateId: parsed.data.companyId,
      aggregateKind: "company",
      payload: {
        initiativeId: id,
        threadId: initiative.threadId,
        topic: parsed.data.topic,
        buyerShortlist: parsed.data.buyerShortlist ?? [],
        investorUserId: initiative.investorUserId,
      },
      req,
    });
    res.json({ ok: true, initiative, telemetry: env });
  });

  // GET initiatives back for tests + dashboard
  app.get("/api/investor/ma/initiatives", (_req, res) => {
    res.json(initiatives);
  });
}
