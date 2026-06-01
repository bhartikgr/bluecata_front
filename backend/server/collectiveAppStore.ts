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
import { isNull, eq } from "drizzle-orm";
import {
  collectiveApplicationSchema,
  type CollectiveApplication,
  type CollectiveAppStatus,
  collectiveApps as collectiveAppsTable,
} from "@shared/schema";
import { investorPortfolio, currentInvestor } from "./mockData";
import { emitSync } from "./sprint10Telemetry";
import { getMembership } from "./membershipStore";
import { requireCollectiveEnabled } from "./lib/featureFlags"; /* v16 Fix 6 */
import { getDb } from "./db/connection"; /* v17 Phase B */
import { pAll } from "./db/portable"; /* Wave H Track A — Postgres compatibility */
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";

type StoredApplication = CollectiveApplication & {
  id: string;
  userId: string;
  status: CollectiveAppStatus;
  submittedAt: string;
  reviewedAt?: string;
  chapterId?: string;
  tenantId?: string;
};

const applications: StoredApplication[] = [];

export function clearApplications(): void {
  applications.length = 0;
}

/* ---------- v17 Phase B — Hybrid Map+DB: hydrate on boot ---------- */
export async function hydrateCollectiveAppStore(): Promise<void> {
  applications.length = 0;
  try {
    const db: any = getDb();
    /* Wave H Track A — was `.all() as any[]`; converted to portable pAll() so
     * this hydrate path works on both better-sqlite3 (sync .all) and
     * postgres-js (thenable). This was one of the three crash sites in
     * Avi's production logs: `[hydrate] collectiveAppStore: DB read failed`. */
    const rows = await pAll<any>(
      db
        .select()
        .from(collectiveAppsTable)
        .where(isNull((collectiveAppsTable as any).deletedAt))
    );
    for (const r of rows) {
      let payload: any = {};
      try { payload = JSON.parse(r.payload_json ?? r.payloadJson ?? "{}"); } catch { /* empty */ }
      const stored: StoredApplication = {
        ...(payload as CollectiveApplication),
        id: r.id,
        userId: r.user_id ?? r.userId,
        status: (r.status ?? "submitted") as CollectiveAppStatus,
        submittedAt: r.submitted_at ?? r.submittedAt,
        reviewedAt: r.reviewed_at ?? r.reviewedAt ?? undefined,
        chapterId: r.chapter_id ?? r.chapterId,
        tenantId: r.tenant_id ?? r.tenantId,
      };
      applications.push(stored);
    }
    if (rows.length > 0) {
      log.info(`[hydrate] collectiveAppStore: ${rows.length} applications restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] collectiveAppStore: DB read failed:", msg);
    }
  }
  void eq;
}

/** Patch v10 — expose for admin approval pipeline. */
export function listApplications(filter?: { status?: CollectiveAppStatus }): StoredApplication[] {
  if (!filter?.status) return applications.slice();
  return applications.filter((a) => a.status === filter.status);
}

export function getApplicationById(id: string): StoredApplication | null {
  return applications.find((a) => a.id === id) ?? null;
}

export function setApplicationStatus(id: string, status: CollectiveAppStatus): StoredApplication | null {
  const a = applications.find((x) => x.id === id);
  if (!a) return null;
  const reviewedAt = new Date().toISOString();
  // v17 Phase B — DB write-through.
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(collectiveAppsTable)
        .set({ status, reviewedAt, updatedAt: reviewedAt } as any)
        .where(eq((collectiveAppsTable as any).id, id))
        .run();
    });
  } catch (err) {
    log.warn("[collectiveAppStore.setApplicationStatus] DB update failed (memory only):", (err as Error).message);
  }
  a.status = status;
  a.reviewedAt = reviewedAt;
  return a;
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

  app.post("/api/collective/applications", requireCollectiveEnabled, (req: Request, res: Response) => {
    // Defect 13 fix: read userId from authenticated session, not hardcoded.
    const userId = req.userContext?.userId;
    if (!userId || !req.userContext?.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to apply." });
    }
    // Patch v9 (P0-4): explicitly reject body-supplied investorId/userId that
    // doesn't match the session. Stops attackers from submitting applications
    // attributed to another user even if the eligibility gate would also catch
    // it downstream.
    const bodyInvestorId = (req.body && (req.body.investorId ?? req.body.userId)) as string | undefined;
    if (typeof bodyInvestorId === "string" && bodyInvestorId !== userId) {
      return res.status(400).json({ error: "investorId_must_match_session" });
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
    const submittedAt = new Date().toISOString();
    const chapterId = DEFAULT_CHAPTER_ID;
    const tenantId = DEFAULT_CHAPTER_TENANT_ID;
    const stored: StoredApplication = {
      ...parsed.data,
      id,
      userId,  // Defect 13: real userId from session
      status: "submitted",
      submittedAt,
      chapterId,
      tenantId,
    };
    // v17 Phase B — DB write-through, transaction-wrapped.
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.insert(collectiveAppsTable).values({
          id,
          tenantId,
          chapterId,
          userId,
          status: "submitted",
          payloadJson: JSON.stringify(parsed.data),
          submittedAt,
          createdAt: submittedAt,
        } as any).run();
      });
    } catch (err) {
      log.warn("[collectiveAppStore.submit] DB insert failed (memory only):", (err as Error).message);
    }
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
  // C-014 v23.5: GET /api/collective/applications/mine — investor application status endpoint
  // Must be registered before the :id route to avoid route shadowing.
  app.get("/api/collective/applications/mine", (req: Request, res: Response) => {
    const userId = req.userContext?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "missing_identity" });
    const mine = applications
      .filter(a => a.userId === userId)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    if (mine.length === 0) return res.status(404).json({ error: "no_application_yet" });
    return res.json({ application: mine[0] });
  });

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
