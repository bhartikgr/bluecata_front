/**
 * Sprint 18 — Founder Apply-to-Collective (COMPANIES applying to PRESENT).
 *
 * Two paths:
 *  - Path A "Get Vouched"     — an existing cap-table investor nominates the company.
 *    Creates a CompanyNomination with status: pending_vouch.
 *  - Path B "Apply Directly"  — direct company application without an investor sponsor.
 *    Creates a CompanyApplication with status: submitted.
 *
 * Both paths submit the COMPANY for presentation rights — neither path is a membership
 * application. (Membership lives in collectiveAppStore.ts on the investor side.)
 *
 * Routes:
 *   POST /api/founder/collective/nominations    (Path A)
 *   GET  /api/founder/collective/nominations
 *   POST /api/founder/collective/applications   (Path B)
 *   GET  /api/founder/collective/applications
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isNull, eq } from "drizzle-orm";
import { emitSync } from "./sprint10Telemetry";
import { getCompaniesForFounder } from "./multiCompanyStore"; /* v16 F-coll-2 ownership */
import { requireCollectiveEnabled } from "./lib/featureFlags"; /* v16 Fix 6 */
import { getDb } from "./db/connection"; /* v17 Phase B */
import {
  founderCollectiveNominations as founderCollectiveNominationsTable,
  founderCollectiveApplications as founderCollectiveApplicationsTable,
} from "@shared/schema";
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";

export type NominationStatus = "pending_vouch" | "vouched" | "reviewing" | "invited" | "presented" | "declined";
export type ApplicationStatus = "submitted" | "reviewing" | "invited" | "rejected" | "waitlisted";

export type CompanyNomination = {
  id: string;
  companyId: string;
  founderId: string;
  vouchingInvestorId: string;
  pitchSummary: string;
  deckLink?: string;
  supplementaryNotes?: string;
  asks?: string;
  status: NominationStatus;
  submittedAt: string;
  vouchedAt?: string;
};

export type CompanyApplication = {
  id: string;
  companyId: string;
  founderId: string;
  pitchDeckFilename: string;
  tractionMrr: number;
  tractionUsers: number;
  tractionGrowthPct: number;
  asks: string;
  references: string;
  coverLetter: string;
  feeAcknowledged: boolean;
  status: ApplicationStatus;
  submittedAt: string;
  reviewedAt?: string;
};

const nominations: CompanyNomination[] = [];
const applications: CompanyApplication[] = [];

export function clearFounderCollectiveStore(): void {
  nominations.length = 0;
  applications.length = 0;
}

/* ---------- v17 Phase B — hydrator ---------- */
export async function hydrateFounderCollectiveApplyStore(): Promise<void> {
  nominations.length = 0;
  applications.length = 0;
  try {
    const db: any = getDb();
    const nomRows = db
      .select()
      .from(founderCollectiveNominationsTable)
      .where(isNull((founderCollectiveNominationsTable as any).deletedAt))
      .all() as any[];
    for (const r of nomRows) {
      nominations.push({
        id: r.id,
        companyId: r.company_id ?? r.companyId,
        founderId: r.founder_id ?? r.founderId,
        vouchingInvestorId: r.vouching_investor_id ?? r.vouchingInvestorId,
        pitchSummary: r.pitch_summary ?? r.pitchSummary,
        deckLink: r.deck_link ?? r.deckLink ?? undefined,
        supplementaryNotes: r.supplementary_notes ?? r.supplementaryNotes ?? undefined,
        asks: r.asks ?? undefined,
        status: (r.status ?? "pending_vouch") as NominationStatus,
        submittedAt: r.submitted_at ?? r.submittedAt,
        vouchedAt: r.vouched_at ?? r.vouchedAt ?? undefined,
      });
    }
    const appRows = db
      .select()
      .from(founderCollectiveApplicationsTable)
      .where(isNull((founderCollectiveApplicationsTable as any).deletedAt))
      .all() as any[];
    for (const r of appRows) {
      applications.push({
        id: r.id,
        companyId: r.company_id ?? r.companyId,
        founderId: r.founder_id ?? r.founderId,
        pitchDeckFilename: r.pitch_deck_filename ?? r.pitchDeckFilename,
        tractionMrr: Number(r.traction_mrr ?? r.tractionMrr ?? 0),
        tractionUsers: Number(r.traction_users ?? r.tractionUsers ?? 0),
        tractionGrowthPct: Number(r.traction_growth_pct ?? r.tractionGrowthPct ?? 0),
        asks: r.asks,
        references: r.references_text ?? r.referencesText ?? "",
        coverLetter: r.cover_letter ?? r.coverLetter,
        feeAcknowledged: Boolean(r.fee_acknowledged ?? r.feeAcknowledged),
        status: (r.status ?? "submitted") as ApplicationStatus,
        submittedAt: r.submitted_at ?? r.submittedAt,
        reviewedAt: r.reviewed_at ?? r.reviewedAt ?? undefined,
      });
    }
    if (nomRows.length + appRows.length > 0) {
      log.info(`[hydrate] founderCollectiveApplyStore: ${nomRows.length} nominations + ${appRows.length} applications restored`);
    }
    void DEFAULT_CHAPTER_TENANT_ID;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] founderCollectiveApplyStore: DB read failed:", msg);
    }
  }
}

const nominationSchema = z.object({
  companyId: z.string().min(1),
  founderId: z.string().min(1),
  vouchingInvestorId: z.string().min(1),
  pitchSummary: z.string().min(20).max(2000),
  deckLink: z.string().url().optional(),
  supplementaryNotes: z.string().max(2000).optional(),
  asks: z.string().max(2000).optional(),
});

const applicationSchema = z.object({
  companyId: z.string().min(1),
  founderId: z.string().min(1),
  pitchDeckFilename: z.string().min(1),
  tractionMrr: z.number().nonnegative(),
  tractionUsers: z.number().nonnegative(),
  tractionGrowthPct: z.number(),
  asks: z.string().min(20).max(2000),
  references: z.string().max(2000).default(""),
  coverLetter: z.string().min(100).max(8000),
  feeAcknowledged: z.boolean().refine(v => v === true, { message: "Fee acknowledgement required" }),
});

/**
 * v16 F-coll-2 — Ownership guard for founder-side application/nomination POSTs.
 *
 * The two write endpoints below previously trusted `body.founderId` and
 * `body.companyId` blindly. Any authed user could POST `founderId: u_maya_chen,
 * companyId: co_arboreal` and impersonate Maya. The fix:
 *   1. require an authenticated identity (req.userContext.userId).
 *   2. require body.founderId === req.userContext.userId.
 *   3. require body.companyId be one of the caller's companies
 *      (via multiCompanyStore.getCompaniesForFounder).
 *
 * Returns null on success, or an Express response with the 4xx already sent.
 */
function enforceFounderOwnership(
  req: Request,
  res: Response,
  body: { founderId?: string; companyId?: string },
): { userId: string } | null {
  const ctx = (req as Request & { userContext?: { userId?: string; isAuthed?: boolean } }).userContext;
  const userId = ctx?.userId;
  if (!userId || !ctx?.isAuthed) {
    res.status(401).json({ error: "missing_identity" });
    return null;
  }
  // B-401 hardening v23.4.13: derive founderId from session, don't trust client.
  // Overwrite body.founderId with the authenticated userId so a hostile caller
  // cannot impersonate another founder by supplying a different founderId.
  if (req.session && (req.session as any).userId) {
    body.founderId = (req.session as any).userId;
  }
  if (body.founderId && body.founderId !== userId) {
    res.status(403).json({ error: "founder_mismatch", message: "body.founderId must equal the authenticated user." });
    return null;
  }
  if (!body.companyId) {
    res.status(400).json({ error: "companyId_required" });
    return null;
  }
  const companies = getCompaniesForFounder(userId);
  const ownsCompany = companies.some((c) => c.companyId === body.companyId);
  if (!ownsCompany) {
    res.status(403).json({ error: "company_not_owned", message: "You are not a founder of this company." });
    return null;
  }
  return { userId };
}

// C-009 helper v23.5: expose founderCollectiveApplyStore reads to admin bridge
export function listApplications(filter?: { status?: ApplicationStatus }): CompanyApplication[] {
  return applications.filter(a => !filter?.status || a.status === filter.status);
}

export function getApplicationById(id: string): CompanyApplication | null {
  return applications.find(a => a.id === id) ?? null;
}

export function setApplicationStatus(
  id: string,
  status: ApplicationStatus,
  reviewedBy?: string,
): CompanyApplication | null {
  const idx = applications.findIndex(a => a.id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  applications[idx] = { ...applications[idx], status, reviewedAt: now };
  // v17 Phase B — DB write-through, mirror the existing pattern.
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(founderCollectiveApplicationsTable)
        .set({ status, reviewedAt: now } as any)
        .where(eq((founderCollectiveApplicationsTable as any).id, id))
        .run();
    });
  } catch (err) {
    log.warn("[founderCollectiveApplyStore.setApplicationStatus] DB update failed (memory only):", (err as Error).message);
  }
  return applications[idx];
}

// C-006 helper v23.5: return latest application for a given founderId
export function getLatestApplicationByFounder(founderId: string): CompanyApplication | null {
  const mine = applications
    .filter(a => a.founderId === founderId)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  return mine[0] ?? null;
}

export function registerFounderCollectiveApplyRoutes(app: Express): void {
  // C-006 v23.5: GET /api/founder/collective/applications/mine — status endpoint
  app.get("/api/founder/collective/applications/mine", (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "missing_identity" });
    const app1 = getLatestApplicationByFounder(userId);
    if (!app1) return res.status(404).json({ error: "no_application_yet" });
    return res.json({ application: app1 });
  });

  // Path A — investor-vouched nomination (v16 Fix 6: gated behind COLLECTIVE_ENABLED)
  app.post("/api/founder/collective/nominations", requireCollectiveEnabled, (req: Request, res: Response) => {
    const parsed = nominationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    }
    // v16 F-coll-2 — ownership: caller must be the founder named, and own the company.
    const owner = enforceFounderOwnership(req, res, parsed.data);
    if (!owner) return; // response already sent
    const id = `nom_${randomBytes(8).toString("hex")}`;
    const submittedAt = new Date().toISOString();
    const stored: CompanyNomination = {
      ...parsed.data,
      id,
      status: "pending_vouch",
      submittedAt,
    };
    // v17 Phase B — DB write-through, transaction-wrapped.
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.insert(founderCollectiveNominationsTable).values({
          id,
          tenantId: DEFAULT_CHAPTER_TENANT_ID,
          chapterId: DEFAULT_CHAPTER_ID,
          companyId: parsed.data.companyId,
          founderId: parsed.data.founderId,
          vouchingInvestorId: parsed.data.vouchingInvestorId,
          pitchSummary: parsed.data.pitchSummary,
          deckLink: parsed.data.deckLink ?? null,
          supplementaryNotes: parsed.data.supplementaryNotes ?? null,
          asks: parsed.data.asks ?? null,
          status: "pending_vouch",
          submittedAt,
          createdAt: submittedAt,
        } as any).run();
      });
    } catch (err) {
      log.warn("[founderCollectiveApplyStore.nomination] DB insert failed (memory only):", (err as Error).message);
    }
    nominations.push(stored);
    const env = emitSync({
      eventType: "collective_company_nomination_submitted",
      aggregateId: id,
      aggregateKind: "application" /* v16: sync envelope union has no "nomination"; reuse "application" */,
      payload: {
        nominationId: id,
        companyId: parsed.data.companyId,
        vouchingInvestorId: parsed.data.vouchingInvestorId,
      },
      req,
    });
    res.json({ ok: true, nomination: stored, telemetry: env });
  });

  app.get("/api/founder/collective/nominations", (req, res) => {
    // v16 F-coll-2 — scope GETs to the caller's own companies (admin sees all).
    const ctx = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean } }).userContext;
    const userId = ctx?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "missing_identity" });
    const isAdmin = !!ctx?.isAdmin;
    const companyId = (req.query.companyId as string | undefined) ?? null;
    const ownedCompanyIds = new Set(getCompaniesForFounder(userId).map((c) => c.companyId));
    const scoped = isAdmin
      ? (companyId ? nominations.filter(n => n.companyId === companyId) : nominations)
      : nominations.filter(n => ownedCompanyIds.has(n.companyId) && (!companyId || n.companyId === companyId));
    res.json(scoped);
  });

  // Path B — direct company application (NOT membership; v16 Fix 6: gated)
  app.post("/api/founder/collective/applications", requireCollectiveEnabled, (req: Request, res: Response) => {
    const parsed = applicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    }
    // v16 F-coll-2 — ownership: caller must be the founder named, and own the company.
    const owner = enforceFounderOwnership(req, res, parsed.data);
    if (!owner) return; // response already sent
    const id = `capp_${randomBytes(8).toString("hex")}`;
    const submittedAt = new Date().toISOString();
    const stored: CompanyApplication = {
      ...parsed.data,
      id,
      status: "submitted",
      submittedAt,
    };
    // v17 Phase B — DB write-through, transaction-wrapped.
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.insert(founderCollectiveApplicationsTable).values({
          id,
          tenantId: DEFAULT_CHAPTER_TENANT_ID,
          chapterId: DEFAULT_CHAPTER_ID,
          companyId: parsed.data.companyId,
          founderId: parsed.data.founderId,
          pitchDeckFilename: parsed.data.pitchDeckFilename,
          tractionMrr: parsed.data.tractionMrr,
          tractionUsers: parsed.data.tractionUsers,
          tractionGrowthPct: parsed.data.tractionGrowthPct,
          asks: parsed.data.asks,
          referencesText: parsed.data.references,
          coverLetter: parsed.data.coverLetter,
          feeAcknowledged: parsed.data.feeAcknowledged ? 1 : 0,
          status: "submitted",
          submittedAt,
          createdAt: submittedAt,
        } as any).run();
      });
    } catch (err) {
      log.warn("[founderCollectiveApplyStore.application] DB insert failed (memory only):", (err as Error).message);
    }
    applications.push(stored);
    const env = emitSync({
      eventType: "collective_company_application_submitted",
      aggregateId: id,
      aggregateKind: "application",
      payload: {
        applicationId: id,
        companyId: parsed.data.companyId,
        tractionMrr: parsed.data.tractionMrr,
        tractionUsers: parsed.data.tractionUsers,
      },
      req,
    });
    res.json({ ok: true, application: stored, telemetry: env });
  });

  app.get("/api/founder/collective/applications", (req, res) => {
    // v16 F-coll-2 — scope GETs to the caller's own companies (admin sees all).
    const ctx = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean } }).userContext;
    const userId = ctx?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "missing_identity" });
    const isAdmin = !!ctx?.isAdmin;
    const companyId = (req.query.companyId as string | undefined) ?? null;
    const ownedCompanyIds = new Set(getCompaniesForFounder(userId).map((c) => c.companyId));
    const scoped = isAdmin
      ? (companyId ? applications.filter(a => a.companyId === companyId) : applications)
      : applications.filter(a => ownedCompanyIds.has(a.companyId) && (!companyId || a.companyId === companyId));
    res.json(scoped);
  });
}
