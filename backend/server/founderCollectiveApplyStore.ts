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
import { getDb, rawDb } from "./db/connection"; /* v17 Phase B; rawDb added v25.35 for DB-first reads */
import {
  founderCollectiveNominations as founderCollectiveNominationsTable,
  founderCollectiveApplications as founderCollectiveApplicationsTable,
} from "@shared/schema";
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { listChaptersForUser } from "./chaptersStore"; /* v25.41 Q7 */
import { log } from "./lib/logger";

/* ============================================================
 * v25.41 Q7 (Avi answer = A): resolve the REAL chapter from the founder's
 * chapter membership at write time, instead of always stamping the platform
 * DEFAULT chapter. Per Avi's unifying directive, the chapter a record belongs
 * to must be derived dynamically from the membership record table, not a
 * hardcoded constant.
 *
 * Precedence: first ACTIVE chapter membership for the user wins. If the user
 * has no resolvable chapter membership (the common single-chapter LIVE case,
 * or a brand-new founder), fall back to the DEFAULT chapter — preserving the
 * exact prior behavior so nothing already shipped is "spoiled".
 * ============================================================ */
function resolveFounderChapter(userId: string): { chapterId: string; tenantId: string } {
  try {
    const memberships = listChaptersForUser(userId);
    // v25.41 round-2 (per GPT-5.5): when a founder has MULTIPLE active chapter
    // memberships, the previous `memberships.find(active)` returned the first
    // one in unspecified order. Make this deterministic: prefer DEFAULT_CHAPTER
    // if the founder belongs to it (so single-chapter LIVE keeps current
    // behavior); otherwise sort active memberships by joinedAt ASC (or `id`
    // ASC as a stable tiebreak) and take the earliest. This is a deterministic
    // policy until an explicit per-application chapter selector is added.
    const actives = memberships.filter((m) => m.membershipStatus === "active");
    let pick = actives.find((m) => m.id === DEFAULT_CHAPTER_ID);
    if (!pick && actives.length > 0) {
      const sorted = [...actives].sort((a, b) => {
        const aj = (a as { joinedAt?: string }).joinedAt ?? "";
        const bj = (b as { joinedAt?: string }).joinedAt ?? "";
        if (aj !== bj) return aj.localeCompare(bj);
        return String(a.id).localeCompare(String(b.id));
      });
      pick = sorted[0];
    }
    if (!pick && memberships.length > 0) pick = memberships[0]; // pre-v25.41 behavior fallback
    if (pick && pick.id) {
      return { chapterId: pick.id, tenantId: pick.tenantId ?? DEFAULT_CHAPTER_TENANT_ID };
    }
  } catch (err) {
    log.warn("[founderCollectiveApplyStore.resolveFounderChapter] lookup failed:", (err as Error).message);
  }
  return { chapterId: DEFAULT_CHAPTER_ID, tenantId: DEFAULT_CHAPTER_TENANT_ID };
}

export type NominationStatus = "pending_vouch" | "vouched" | "reviewing" | "invited" | "presented" | "declined";
// v23.8 W-21: "accepted" added so admin approval of a founder Path B application
// uses the same status semantic as the admin filter tab / member badge. "invited"
// is retained for backward compatibility with any rows persisted before v23.8.
export type ApplicationStatus = "submitted" | "reviewing" | "invited" | "accepted" | "rejected" | "waitlisted";

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

/* ---------- v25.35 — DB-first read helpers (MAJOR #13) ----------
 * `applications[]` / `nominations[]` are fast caches; the DB is the read
 * authority. A cold cache after restart previously caused founder/admin reads
 * to under-report (or 404) genuinely-persisted rows. These helpers read with
 * rawDb() and repopulate the cache. Read errors degrade to cache-only.
 */
function mapAppRow(r: any): CompanyApplication {
  return {
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
  };
}

function mapNomRow(r: any): CompanyNomination {
  return {
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
  };
}

function appCacheUpsert(row: CompanyApplication): CompanyApplication {
  const idx = applications.findIndex((a) => a.id === row.id);
  if (idx >= 0) { applications[idx] = row; return applications[idx]; }
  applications.push(row);
  return row;
}

function nomCacheUpsert(row: CompanyNomination): CompanyNomination {
  const idx = nominations.findIndex((n) => n.id === row.id);
  if (idx >= 0) { nominations[idx] = row; return nominations[idx]; }
  nominations.push(row);
  return row;
}

/** DB-first: merge all application rows into the cache and return the union. */
function applicationsDbFirst(): CompanyApplication[] {
  try {
    const rows: any[] = rawDb()
      .prepare("SELECT * FROM founder_collective_applications WHERE deleted_at IS NULL")
      .all();
    for (const r of rows) appCacheUpsert(mapAppRow(r));
  } catch (err) {
    log.warn("[founderCollectiveApplyStore.applicationsDbFirst] DB fallback failed:", (err as Error).message);
  }
  return applications;
}

function nominationsDbFirst(): CompanyNomination[] {
  try {
    const rows: any[] = rawDb()
      .prepare("SELECT * FROM founder_collective_nominations WHERE deleted_at IS NULL")
      .all();
    for (const r of rows) nomCacheUpsert(mapNomRow(r));
  } catch (err) {
    log.warn("[founderCollectiveApplyStore.nominationsDbFirst] DB fallback failed:", (err as Error).message);
  }
  return nominations;
}

function applicationByIdDbFirst(id: string): CompanyApplication | null {
  const cached = applications.find((a) => a.id === id);
  if (cached) return cached;
  try {
    const r: any = rawDb()
      .prepare("SELECT * FROM founder_collective_applications WHERE id = ? AND deleted_at IS NULL")
      .get(id);
    if (r) return appCacheUpsert(mapAppRow(r));
  } catch (err) {
    log.warn("[founderCollectiveApplyStore.applicationByIdDbFirst] DB fallback failed:", (err as Error).message);
  }
  return null;
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
  // v25.35 (MAJOR #13) — DB-first so a cold cache does not under-report.
  return applicationsDbFirst().filter(a => !filter?.status || a.status === filter.status);
}

export function getApplicationById(id: string): CompanyApplication | null {
  // v25.35 (MAJOR #13) — DB-first lookup with cache fallback.
  return applicationByIdDbFirst(id);
}

export function setApplicationStatus(
  id: string,
  status: ApplicationStatus,
  reviewedBy?: string,
): CompanyApplication | null {
  /* v25.21 Lane A NH-002 fix (REWORK after triple-verify): the legacy code
   * mutated the in-memory row, attempted the DB write, and returned the row
   * EVEN IF the DB write failed. The admin route then activated the
   * founder's membership against an unpersisted status — the exact
   * membership-active / application-still-submitted half-state the parallel
   * fix in `collectiveAppStore` closed. We now: (1) revert the in-memory
   * mutation if the DB write fails, (2) return null so the caller can
   * short-circuit before activating membership. */
  // v25.35 (MAJOR #13) — DB-first: ensure the row is in the cache before we
  // index it, so an admin status change after a restart does not falsely
  // 404/null on a cold cache.
  if (!applications.some(a => a.id === id)) applicationByIdDbFirst(id);
  const idx = applications.findIndex(a => a.id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const previous = applications[idx];
  applications[idx] = { ...previous, status, reviewedAt: now };
  // v17 Phase B — DB write-through, mirror the existing pattern.
  let dbUpdateOk = false;
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(founderCollectiveApplicationsTable)
        .set({ status, reviewedAt: now } as any)
        .where(eq((founderCollectiveApplicationsTable as any).id, id))
        .run();
    });
    dbUpdateOk = true;
  } catch (err) {
    log.warn("[founderCollectiveApplyStore.setApplicationStatus] DB update failed (memory only):", (err as Error).message);
  }
  if (!dbUpdateOk) {
    // Roll back the in-memory mutation so cache and DB stay in sync.
    applications[idx] = previous;
    return null;
  }
  return applications[idx];
}

// C-006 helper v23.5: return latest application for a given founderId
export function getLatestApplicationByFounder(founderId: string): CompanyApplication | null {
  // v25.35 (MAJOR #13) — DB-first so the founder's status endpoint resolves a
  // persisted application after a restart (no false 404).
  const mine = applicationsDbFirst()
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

    // v25.40 FIX-17 (collective P2 #5) — Path A duplicate-guard. Path B (direct
    // application) already has a DB-first duplicate guard; Path A (investor-vouched
    // nomination) had none, so a founder could create multiple pending nominations
    // for the same (companyId, founderId), flooding the vouch/admin queue with
    // redundant rows. Mirror Path B's DB-FIRST check, but per the v25.40 brief we
    // RETURN the existing nomination (idempotent) rather than 409 — re-submitting a
    // nomination should be a no-op that surfaces the row already in flight.
    try {
      const dupRow: any = rawDb()
        .prepare(
          `SELECT * FROM founder_collective_nominations
           WHERE founder_id = ? AND company_id = ?
             AND status NOT IN ('rejected', 'withdrawn')
             AND deleted_at IS NULL
           LIMIT 1`,
        )
        .get(parsed.data.founderId, parsed.data.companyId);
      if (dupRow) {
        const existingNom = nomCacheUpsert(mapNomRow(dupRow));
        return res.json({ ok: true, nomination: existingNom, duplicate: true });
      }
    } catch (err) {
      log.error("[founderCollectiveApplyStore.nomination] duplicate DB check failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "DUPLICATE_CHECK_FAILED", message: "Could not verify your nomination; please retry." });
    }

    const id = `nom_${randomBytes(8).toString("hex")}`;
    const submittedAt = new Date().toISOString();
    const stored: CompanyNomination = {
      ...parsed.data,
      id,
      status: "pending_vouch",
      submittedAt,
    };
    // v25.41 Q7 — stamp the founder's real chapter from membership (DEFAULT
    // fallback), consistent with the application write path.
    const nomChapter = resolveFounderChapter(parsed.data.founderId);
    // v17 Phase B — DB write-through, transaction-wrapped.
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.insert(founderCollectiveNominationsTable).values({
          id,
          tenantId: nomChapter.tenantId,
          chapterId: nomChapter.chapterId,
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
      // v25.35 — FAIL-CLOSED (BLOCKER #6): do not create a phantom nomination.
      log.error("[founderCollectiveApplyStore.nomination] DB insert failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "NOMINATION_PERSIST_FAILED", message: "Could not save the nomination; please retry." });
    }
    // v25.35 — cache mutated only after the durable commit.
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
    // v25.35 (MAJOR #13) — DB-first read of nominations.
    const allNoms = nominationsDbFirst();
    const scoped = isAdmin
      ? (companyId ? allNoms.filter(n => n.companyId === companyId) : allNoms)
      : allNoms.filter(n => ownedCompanyIds.has(n.companyId) && (!companyId || n.companyId === companyId));
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
    // v25.13 NM2 — reject if the same founder already has a non-rejected
    // application for the same company. Without this guard, founders could
    // submit duplicates (or re-apply while waitlisted), flooding the admin
    // review queue with redundant entries for one company.
    // v25.35 fix-3 (Concern 1, GPT-5.5 strict re-verify) — truly DB-FIRST
    // duplicate guard. The previous fix-2 still consulted the memory cache
    // first, allowing a stale cache to authoritatively reject a request
    // before checking durable DB state. We now query the DB FIRST and ignore
    // the in-memory `applications` array as a duplicate source of truth.
    // Memory is consulted only to derive the existing application object
    // from a confirmed DB row (for the cache + response payload).
    let existing: CompanyApplication | undefined;
    try {
      const dupRow: any = rawDb()
        .prepare(
          `SELECT * FROM founder_collective_applications
           WHERE founder_id = ? AND company_id = ?
             AND status NOT IN ('rejected', 'withdrawn')
             AND deleted_at IS NULL
           LIMIT 1`,
        )
        .get(parsed.data.founderId, parsed.data.companyId);
      if (dupRow) {
        // Repopulate the cache from the durable row so subsequent reads are
        // consistent, then treat as a duplicate.
        existing = appCacheUpsert(mapAppRow(dupRow));
      }
    } catch (err) {
      log.error("[founderCollectiveApplyStore.application] duplicate DB check failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "DUPLICATE_CHECK_FAILED", message: "Could not verify your application; please retry." });
    }
    if (existing) {
      return res.status(409).json({
        error: "duplicate_application",
        message:
          "An application for this company already exists. Withdraw or wait for a decision before re-applying.",
        existingApplicationId: existing.id,
        existingStatus: existing.status,
      });
    }
    const id = `capp_${randomBytes(8).toString("hex")}`;
    const submittedAt = new Date().toISOString();
    const stored: CompanyApplication = {
      ...parsed.data,
      id,
      status: "submitted",
      submittedAt,
    };
    // v25.41 Q7 — resolve the founder's real chapter from membership (falls back
    // to DEFAULT when none), so the application record is stamped with the
    // chapter it actually belongs to rather than always the platform default.
    const appChapter = resolveFounderChapter(parsed.data.founderId);
    // v17 Phase B — DB write-through, transaction-wrapped.
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.insert(founderCollectiveApplicationsTable).values({
          id,
          tenantId: appChapter.tenantId,
          chapterId: appChapter.chapterId,
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
      // v25.35 — FAIL-CLOSED (BLOCKER #7): this path acknowledges a $2,500 fee.
      // A swallowed insert would create a phantom paid application lost on
      // restart. Return 500 and only push to the cache after a durable commit.
      log.error("[founderCollectiveApplyStore.application] DB insert failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "APPLICATION_PERSIST_FAILED", message: "Could not save your application; please retry." });
    }
    // v25.35 — cache mutated only after the durable commit.
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
    // v25.35 (MAJOR #13) — DB-first read of applications.
    const allApps = applicationsDbFirst();
    const scoped = isAdmin
      ? (companyId ? allApps.filter(a => a.companyId === companyId) : allApps)
      : allApps.filter(a => ownedCompanyIds.has(a.companyId) && (!companyId || a.companyId === companyId));
    res.json(scoped);
  });
}
