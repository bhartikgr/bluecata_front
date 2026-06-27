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
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { isNull, eq } from "drizzle-orm";
import {
  collectiveApplicationSchema,
  type CollectiveApplication,
  type CollectiveAppStatus,
  collectiveApps as collectiveAppsTable,
} from "@shared/schema";
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

/**
 * v25.12 NM-1 — DB fallback for list/get. If the in-memory mirror is
 * empty (or contains fewer rows than the DB after a hydrate error),
 * read directly from the DB. This prevents the admin pipeline from
 * showing zero applications after a transient hydrate failure.
 */
function listApplicationsFromDb(filter?: { status?: CollectiveAppStatus }): StoredApplication[] {
  try {
    const db: any = getDb();
    const rows: any[] = db
      .select()
      .from(collectiveAppsTable)
      .where(isNull((collectiveAppsTable as any).deletedAt))
      .all() as any[];
    const out: StoredApplication[] = [];
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
      if (!filter?.status || stored.status === filter.status) out.push(stored);
    }
    return out;
  } catch (err) {
    log.warn("[collectiveAppStore.listApplicationsFromDb] failed:", (err as Error).message);
    return [];
  }
}

function getApplicationFromDb(id: string): StoredApplication | null {
  try {
    const db: any = getDb();
    const r: any = db
      .select()
      .from(collectiveAppsTable)
      .where(eq(collectiveAppsTable.id, id))
      .get();
    if (!r) return null;
    let payload: any = {};
    try { payload = JSON.parse(r.payload_json ?? r.payloadJson ?? "{}"); } catch { /* empty */ }
    return {
      ...(payload as CollectiveApplication),
      id: r.id,
      userId: r.user_id ?? r.userId,
      status: (r.status ?? "submitted") as CollectiveAppStatus,
      submittedAt: r.submitted_at ?? r.submittedAt,
      reviewedAt: r.reviewed_at ?? r.reviewedAt ?? undefined,
      chapterId: r.chapter_id ?? r.chapterId,
      tenantId: r.tenant_id ?? r.tenantId,
    };
  } catch (err) {
    log.warn("[collectiveAppStore.getApplicationFromDb] failed:", (err as Error).message);
    return null;
  }
}

/** Patch v10 — expose for admin approval pipeline. */
export function listApplications(filter?: { status?: CollectiveAppStatus }): StoredApplication[] {
  /* v25.12 NM-1 — if memory is empty, fall back to a fresh DB read so
   * admins do not see a phantom-empty list after a hydrate error. */
  if (applications.length === 0) {
    const fromDb = listApplicationsFromDb(filter);
    if (fromDb.length > 0) {
      for (const a of fromDb) applications.push(a);
      return fromDb;
    }
  }
  if (!filter?.status) return applications.slice();
  return applications.filter((a) => a.status === filter.status);
}

export function getApplicationById(id: string): StoredApplication | null {
  const inMem = applications.find((a) => a.id === id);
  if (inMem) return inMem;
  /* v25.12 NM-1 — fall back to DB so admin detail pages do not 404
   * after a hydrate error. */
  return getApplicationFromDb(id);
}

export function setApplicationStatus(id: string, status: CollectiveAppStatus): StoredApplication | null {
  /* v25.21 Lane A NH-002 fix — symmetric with getApplicationById's v25.12 NM-1
   * DB fallback. The legacy code returned null on a cache miss without
   * touching the DB, so an admin approve/reject after a hydrate failure
   * activated the membership (via the route's other side effects) while
   * the application status was never persisted — a permanent
   * member-active / application-still-submitted half-state. We now resolve
   * the row from DB on cache miss, perform the UPDATE, AND repopulate the
   * in-memory cache so subsequent lookups don't re-hit the DB. */
  let a = applications.find((x) => x.id === id);
  if (!a) {
    const fromDb = getApplicationFromDb(id);
    if (!fromDb) return null;
    applications.push(fromDb);
    a = fromDb;
  }
  const reviewedAt = new Date().toISOString();
  // v17 Phase B — DB write-through.
  let dbUpdateOk = false;
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(collectiveAppsTable)
        .set({ status, reviewedAt, updatedAt: reviewedAt } as any)
        .where(eq((collectiveAppsTable as any).id, id))
        .run();
    });
    dbUpdateOk = true;
  } catch (err) {
    log.warn("[collectiveAppStore.setApplicationStatus] DB update failed (memory only):", (err as Error).message);
  }
  /* v25.21 Lane A NH-002 fix continued — if the DB write failed, return null
   * so the caller can short-circuit BEFORE doing irreversible activations
   * (e.g. minting a membership row). Membership / application state must
   * not diverge. */
  if (!dbUpdateOk) return null;
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
  // v24.0 C12: eligibility derives ONLY from live membership data. No
  // mock-backed fallback (investorPortfolio/currentInvestor removed).
  //
  // v25.2 fix: previously this hardcoded founderOfCompany=false even for users
  // who clearly were founders — making the eligibility check unable to ever
  // grant a founder access. We now check the live company-members table (which
  // is populated by /api/founder/companies/new) AND the consortium-link table
  // (which grants the "vouchedByPartner" pass when a partner sponsored the
  // founder's company). All checks read directly from the DB so multi-worker
  // PM2 deployments and post-restart state remain consistent.
  let investorOnCapTable = false;
  let vouchedByPartner = false;
  let founderOfCompany = false;
  let signatoryOnCompany = false;
  let hasLiveData = false;
  if (userId) {
    const m = getMembership(userId);
    if (m) {
      hasLiveData = true;
      investorOnCapTable = m.capTablePositions.length > 0;
      vouchedByPartner = Boolean((m as { vouchedByPartner?: boolean }).vouchedByPartner);
    }
    // Founder-of-company check: query company_members for an active role.
    try {
      // Lazy-load rawDb to avoid circular import at module-init time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { rawDb } = require("./db/connection");
      const adb = rawDb();
      const cmRow = adb.prepare(
        `SELECT cm.company_id, cm.role, c.id
           FROM company_members cm
           JOIN companies c ON c.id = cm.company_id
          WHERE cm.user_id = ? AND cm.is_active = 1 AND c.deleted_at IS NULL
          LIMIT 1`
      ).get(userId) as { company_id?: string; role?: string } | undefined;
      if (cmRow?.company_id) {
        hasLiveData = true;
        founderOfCompany = cmRow.role === "founder" || cmRow.role === "owner";
        signatoryOnCompany = cmRow.role === "signatory" || founderOfCompany;
        // If a consortium partner sponsors this company, the founder is also vouched.
        const linkRow = adb.prepare(
          `SELECT partner_id FROM consortium_links WHERE company_id = ? AND unlinked_at IS NULL LIMIT 1`,
        ).get(cmRow.company_id) as { partner_id?: string } | undefined;
        if (linkRow?.partner_id) vouchedByPartner = true;
      }
    } catch { /* best-effort — falls back to membership-only signal */ }
  }
  if (!hasLiveData) {
    // No live portfolio data — not mock-backed. Ineligible.
    return {
      eligible: false,
      reasons: ["no_portfolio_data"],
      passes: {
        investorOnCapTable: false,
        founderOfCompany: false,
        signatoryOnCompany: false,
        vouchedByPartner: false,
      },
    };
  }
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
    // Use req.userContext userId if available (Defect 14 fix). v23.8 D2/W-18 —
    // no `u_investor_demo` synthetic fallback; an unauthenticated check passes
    // undefined and hits the anonymous-eligibility branch.
    const userId = (req.userContext?.userId) ?? (req.query.userId as string | undefined);
    const elig = isEligibleForCollective(userId);
    /* v25.21 Lane C NH-1 fix — enrich the response with a `collectiveStatus`
     * derived from the real collective membership store. Previously the
     * client checked `elig.data?.collectiveStatus === "active"` but the
     * server never returned that field, so active members were always shown
     * the application wizard instead of the "already a member" banner. */
    let collectiveStatus: "active" | "none" = "none";
    if (userId) {
      try {
        // Lazy require so we don't introduce a circular import.
        const membership = require("./collectiveMembershipStore");
        if (membership.isActive(userId)) collectiveStatus = "active";
      } catch { /* non-fatal */ }
    }
    res.json({ ...elig, collectiveStatus });
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
    // v25.35 — FAIL-CLOSED (BLOCKER #5): previously swallowed the insert and
    // pushed to memory, creating a phantom application lost on restart. Now we
    // return 500 on DB failure and only push to the cache after a durable commit.
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
      log.error("[collectiveAppStore.submit] DB insert failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "APPLICATION_PERSIST_FAILED", message: "Could not save your application; please retry." });
    }
    // v25.35 — cache mutated only after the durable commit.
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
    /* v25.21 Lane A NM-001 fix — fall back to the DB when the in-memory
     * cache is empty (post-hydrate-failure / fresh process). Previously
     * a transient hydrate miss returned 404 to a valid investor for an
     * application that exists in the DB — a UX defect that fails closed,
     * but is still a stale-cache surface. */
    let mine = applications
      .filter(a => a.userId === userId)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    if (mine.length === 0) {
      mine = listApplicationsFromDb()
        .filter((a) => a.userId === userId)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    }
    if (mine.length === 0) return res.status(404).json({ error: "no_application_yet" });
    return res.json({ application: mine[0] });
  });

  app.get("/api/collective/applications", (req: Request, res: Response) => {
    if (!req.userContext?.isAdmin) {
      return res.status(403).json({ error: "NOT_ADMIN", message: "Admin access required." });
    }
    /* v25.22 NH-3 fix — partial v25.21 closure: the /mine and /:id reads
     * gained DB fallback, but THIS admin list endpoint kept returning the
     * raw in-memory array. After a hydrate failure the admin saw an empty
     * tracker for rows that exist in the DB. Union with DB-resolved rows
     * keyed by id so the response is complete and de-duplicated. */
    const inMemIds = new Set(applications.map((a) => a.id));
    const fromDb = listApplicationsFromDb().filter((a) => !inMemIds.has(a.id));
    res.json([...applications, ...fromDb]);
  });

  app.get("/api/collective/applications/:id", (req: Request, res: Response) => {
    // B13 (v24.0 LOCKDOWN) — this detail route was registered BEFORE the
    // `app.use("/api/collective", requireAuthenticated)` guard in routes.ts, so
    // it ran with NO authentication and NO handler-level check: any caller
    // (even anonymous) could read any application by guessing its id, exposing
    // another investor's thesis, check sizes, and jurisdiction. We cannot move
    // the whole registration behind the guard without breaking the
    // intentionally-anonymous `/eligibility` and public application-submit
    // paths, so we add an explicit owner-or-admin check here.
    const userId = req.userContext?.userId ?? null;
    if (!userId || !req.userContext?.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to view this application." });
    }
    /* v25.21 Lane A NM-001 fix — DB fallback when the in-memory cache is
     * empty (mirror of getApplicationById's v25.12 NM-1). Without the
     * fallback a transient hydrate miss surfaces a false 404 to the row's
     * owner. The owner-or-admin gate still runs against the DB-resolved
     * row's userId. */
    let a = applications.find((x) => x.id === req.params.id);
    if (!a) {
      const fromDb = getApplicationFromDb(String(req.params.id));
      if (fromDb) a = fromDb;
    }
    // Return 404 (not 403) for both "missing" and "not yours" to avoid leaking
    // which application ids exist.
    if (!a) return res.status(404).json({ error: "application_not_found" });
    if (!req.userContext?.isAdmin && a.userId !== userId) {
      return res.status(404).json({ error: "application_not_found" });
    }
    res.json(a);
  });
}
