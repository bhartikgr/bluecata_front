/**
 * Sprint 10 — Apply to Capavate Collective (7-step wizard).
 *
 * Routes:
 *   GET  /api/collective/eligibility         — server-side eligibility check
 *   POST /api/collective/applications        — submit application
 *   GET  /api/collective/applications        — list (admin/preview)
 *   GET  /api/collective/applications/:id    — fetch one
 *
 * Eligibility model (per `collective_investor_audit §3 Step 1`):
 *
 *   isEligibleForCollective(userId) is true if at least one of:
 *     • investor on a Capavate cap table
 *     • founder of a Capavate company
 *     • signatory on at least one Capavate company
 *     • vouched by a consortium partner with weight ≥ 1
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import {
  collectiveApplicationSchema,
  type CollectiveApplication,
  type CollectiveAppStatus,
} from "@shared/schema";
import { investorPortfolio, currentInvestor } from "./mockData";
import { emitSync } from "./sprint10Telemetry";
import { getMembership } from "./membershipStore";

type StoredApplication = CollectiveApplication & {
  id: string;
  userId: string;
  status: CollectiveAppStatus;
  submittedAt: string;
  reviewedAt?: string;
};

const applications: StoredApplication[] = [];

export function clearApplications(): void {
  applications.length = 0;
}

/* ---------- Eligibility ---------- */
export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
  passes: {
    investorOnCapTable: boolean;
    founderOfCompany: boolean;
    signatoryOnCompany: boolean;
    vouchedByPartner: boolean;
  };
};

export function isEligibleForCollective(userId?: string): EligibilityResult {
  // Defect 14 fix: use per-user membership to determine cap-table status.
  // Previously voided userId and always read global investorPortfolio.
  let investorOnCapTable = false;
  if (userId) {
    const m = getMembership(userId);
    if (m) {
      investorOnCapTable = m.capTablePositions.length > 0;
    } else {
      // Fallback for unknown personas (e.g. u_investor_demo, test actors):
      // use the global investorPortfolio as a proxy for "has any position".
      investorOnCapTable = (investorPortfolio.length ?? 0) > 0;
    }
  } else {
    // Fallback for anonymous eligibility checks (e.g., admin preview).
    investorOnCapTable = (investorPortfolio.length ?? 0) > 0;
  }
  const founderOfCompany = false;            // demo investor isn't a founder
  const signatoryOnCompany = false;          // not exposed in preview
  // Vouched flag is read from currentInvestor profile if present
  const vouchedByPartner = Boolean((currentInvestor as { vouchedByPartner?: boolean }).vouchedByPartner);
  const passes = { investorOnCapTable, founderOfCompany, signatoryOnCompany, vouchedByPartner };
  const eligible = Object.values(passes).some(Boolean);
  const reasons: string[] = [];
  if (investorOnCapTable) reasons.push("Verified position on a Capavate cap table.");
  if (founderOfCompany)   reasons.push("Founder of a Capavate company.");
  if (signatoryOnCompany) reasons.push("Signatory on a Capavate company.");
  if (vouchedByPartner)   reasons.push("Vouched by a consortium partner.");
  if (!eligible) reasons.push("No eligibility signal found. Apply to the waitlist or seek a partner vouch.");
  return { eligible, reasons, passes };
}

export function registerCollectiveAppRoutes(app: Express): void {
  app.get("/api/collective/eligibility", (req: Request, res: Response) => {
    // Use req.userContext userId if available (Defect 14 fix)
    const userId = (req.userContext?.userId) ?? (req.query.userId as string | undefined) ?? "u_investor_demo";
    res.json(isEligibleForCollective(userId));
  });

  app.post("/api/collective/applications", (req: Request, res: Response) => {
    // Defect 13 fix: read userId from authenticated session, not hardcoded.
    const userId = req.userContext?.userId;
    if (!userId || !req.userContext?.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to apply." });
    }
    const elig = isEligibleForCollective(userId);
    if (!elig.eligible) {
      return res.status(403).json({ error: "not_eligible", eligibility: elig });
    }
    const parsed = collectiveApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    }
    const id = `app_${randomBytes(8).toString("hex")}`;
    const stored: StoredApplication = {
      ...parsed.data,
      id,
      userId,  // Defect 13: real userId from session
      status: "submitted",
      submittedAt: new Date().toISOString(),
    };
    applications.push(stored);
    const env = emitSync({
      eventType: "collective_application_submitted",
      aggregateId: id,
      aggregateKind: "application",
      payload: {
        applicationId: id,
        thesis: parsed.data.thesis,
        minCheckUsd: parsed.data.minCheckUsd,
        maxCheckUsd: parsed.data.maxCheckUsd,
        sectors: parsed.data.sectors,
        stages: parsed.data.stages,
        geoFocus: parsed.data.geoFocus,
        memberTier: parsed.data.memberTier,
        jurisdiction: parsed.data.jurisdiction,
        paymentMethod: parsed.data.paymentMethod,
      },
      req,
    });
    res.json({ ok: true, application: stored, telemetry: env });
  });

  // Defect 58: require admin role for listing all applications
  app.get("/api/collective/applications", (req: Request, res: Response) => {
    if (!req.userContext?.isAdmin) {
      return res.status(403).json({ error: "NOT_ADMIN", message: "Admin access required." });
    }
    res.json(applications);
  });

  app.get("/api/collective/applications/:id", (req: Request, res: Response) => {
    const a = applications.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: "application_not_found" });
    res.json(a);
  });
}
