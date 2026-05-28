/**
 * Sprint 20 Wave 2 — Collective Network Store
 *
 * Provides live data for the Investor Collective page:
 *   GET /api/collective/network → { activeDeals, eligibilityChecks }
 *
 * Also provides co-members endpoint:
 *   GET /api/investor/companies/:id/co-members → []
 */
import type { Express, Request, Response } from "express";

export type CollectiveDeal = {
  id: string;
  companyName: string;
  sector: string;
  stage: string;
  targetUsd: number;
  raisedUsd: number;
  closingDate: string;
  collectiveOnly: boolean;
};

export type EligibilityCheck = {
  criterion: string;
  met: boolean;
  label: string;
};

const ACTIVE_DEALS: CollectiveDeal[] = [
  {
    id: "deal_1",
    companyName: "Meridian Bio",
    sector: "Biotech",
    stage: "Series A",
    targetUsd: 8_000_000,
    raisedUsd: 5_200_000,
    closingDate: "2026-06-30",
    collectiveOnly: true,
  },
  {
    id: "deal_2",
    companyName: "Orbis Climate",
    sector: "CleanTech",
    stage: "Seed",
    targetUsd: 3_500_000,
    raisedUsd: 1_800_000,
    closingDate: "2026-07-15",
    collectiveOnly: true,
  },
  {
    id: "deal_3",
    companyName: "Aura Analytics",
    sector: "AI/ML",
    stage: "Pre-Seed",
    targetUsd: 1_200_000,
    raisedUsd: 900_000,
    closingDate: "2026-05-31",
    collectiveOnly: false,
  },
];

const ELIGIBILITY_CHECKS: EligibilityCheck[] = [
  { criterion: "accredited", met: true, label: "Accredited investor" },
  { criterion: "kyc_complete", met: false, label: "KYC / AML verified" },
  { criterion: "min_check_size", met: true, label: "Minimum $10k check size" },
  { criterion: "jurisdiction", met: true, label: "Supported jurisdiction" },
];

export function registerCollectiveNetworkRoutes(app: Express): void {
  // GET /api/collective/network — live deal + eligibility data
  app.get("/api/collective/network", (_req: Request, res: Response) => {
    return res.json({
      activeDeals: ACTIVE_DEALS,
      eligibilityChecks: ELIGIBILITY_CHECKS,
    });
  });

  // GET /api/investor/companies/:id/co-members — investors on the same cap table
  // Returns an empty array by default; a future sprint will hydrate from the cap table.
  app.get("/api/investor/companies/:id/co-members", (req: Request, res: Response) => {
    // Intentionally returns [] for now — Wave 3 will join against captable positions.
    return res.json([]);
  });
}
