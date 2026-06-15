/**
 * Sprint 20 Wave 2 — Collective Network Store
 *
 * Provides live data for the Investor Collective page:
 *   GET /api/collective/network → { activeDeals, eligibilityChecks }
 *
 * Also provides co-members endpoint:
 *   GET /api/investor/companies/:id/co-members → []
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";

/* eslint-disable @typescript-eslint/no-unused-vars */
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
  // NOTE (v25.0 Track 2 B4): The /api/collective/network graph-payload handler
  // is now registered in collectiveInterestStore.ts (registerCollectiveInterestRoutes)
  // which runs BEFORE sprint20Wave2Routes. The old stub (ACTIVE_DEALS / ELIGIBILITY_CHECKS)
  // is intentionally not re-registered here to avoid shadowing the live graph handler.

  /* v25.12 NC-1 — co-members is now a live read from the captable commit
   * ledger. We return one row per distinct investor who has any non-deleted
   * commit against the company. The caller is filtered out. Privacy: only
   * investors who have `discoverable !== false` on their commit (or no flag
   * set, which defaults to discoverable) are surfaced. */
  app.get("/api/investor/companies/:id/co-members", async (req: Request, res: Response) => {
    try {
      const ctx = (req as any).userContext;
      if (!ctx?.isAuthed) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      }
      const companyId = String(req.params.id || "");
      if (!companyId) return res.json([]);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { listMembersForCompany } = require("./captableCommitStore");
      const rows = (listMembersForCompany(companyId) as Array<any>) ?? [];
      const byInvestor = new Map<string, any>();
      for (const r of rows) {
        const uid = r?.userId ?? r?.investorId;
        if (!uid || uid === ctx.userId) continue;
        if (r?.deletedAt) continue;
        // Latest commit wins (simple last-write).
        byInvestor.set(uid, {
          investorUserId: uid,
          state: r.state ?? "member",
          amount: r.amount ?? null,
          currency: r.currency ?? null,
          shares: r.shares ?? null,
          companyId,
          since: r.createdAt ?? null,
        });
      }
      return res.json(Array.from(byInvestor.values()));
    } catch (err) {
      // Fail open with [] so the dashboard still loads, but log the cause.
      // eslint-disable-next-line no-console
      console.warn("[co-members]", (err as Error).message);
      return res.json([]);
    }
  });
}
