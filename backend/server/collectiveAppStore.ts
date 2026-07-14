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
// W2 A5/A7 — gate-state + indemnity copy (both sacred-free, additive).
import { getAccreditationGateStatus } from "./investorComplianceRoutes";
import { getCollectiveLegalCopyBundle } from "./collectiveLegalCopyStore";
// Wave 2 (#5): admin-granted eligibility path. STATIC ESM import (NOT require) —
// verified no circular import: collectiveMembershipStore only imports
// drizzle/schema/db/chapterDefaults/logger, none of which import this file.
// `isActive(userId)` is the durable admin-granted signal (an operator's
// activate() writes a durable active row with activatedBy = admin userId).
import { isActive as isCollectiveMemberActive } from "./collectiveMembershipStore";
// W3-B C-5 — capture the accreditation self-declaration at individual apply time
// (mirrors W2's sign-at-application). Best-effort + non-fatal: the dedicated
// POST /api/investor/compliance/accreditation-declaration route is the primary
// surface; this just avoids a second round-trip when the wizard already collected
// a signature. Sign fields are read from req.body directly because the zod
// collectiveApplicationSchema strips unknown keys from parsed.data.
import { recordAccreditationDeclaration } from "./investorComplianceRoutes";

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
function listApplicationsFromDb(
  filter?: { status?: CollectiveAppStatus },
  opts?: { strict?: boolean },
): StoredApplication[] {
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
    /* v25.48.2 MF-D — strict callers (the DB-authoritative read endpoints) must
       FAIL CLOSED on a DB read error: re-throw so the route can surface a 5xx
       instead of a false empty that would hide an existing application. The
       legacy best-effort callers (admin list DB-union fallback) keep the
       swallow-and-return-empty behavior. */
    if (opts?.strict) throw err;
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
    /* Wave 2 (#5): admin/chapter operator granted access explicitly. */
    adminGranted: boolean;
  };
  /* Wave 2 (#5): surfaced so the client spine can read the same signal the
     route exposes without re-deriving it. */
  adminGranted: boolean;
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
  // Wave 2 (#5): admin-granted is an independent, first-class eligibility
  // signal — an operator's activate() writes a durable active membership row.
  let adminGranted = false;
  let hasLiveData = false;
  if (userId) {
    try {
      if (isCollectiveMemberActive(userId)) {
        adminGranted = true;
        hasLiveData = true;
      }
    } catch { /* best-effort — durable membership check is non-fatal */ }
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
    // No live portfolio data and no admin grant — not mock-backed. Ineligible.
    return {
      eligible: false,
      reasons: ["no_portfolio_data"],
      passes: {
        investorOnCapTable: false,
        founderOfCompany: false,
        signatoryOnCompany: false,
        vouchedByPartner: false,
        adminGranted: false,
      },
      adminGranted: false,
    };
  }
  const passes = { investorOnCapTable, founderOfCompany, signatoryOnCompany, vouchedByPartner, adminGranted };
  const eligible = Object.values(passes).some(Boolean);
  const reasons: string[] = [];
  if (investorOnCapTable) reasons.push("Verified position on a Capavate cap table.");
  if (founderOfCompany)   reasons.push("Founder of a Capavate company.");
  if (signatoryOnCompany) reasons.push("Signatory on a Capavate company.");
  if (vouchedByPartner)   reasons.push("Vouched by a consortium partner.");
  if (adminGranted)       reasons.push("Access granted by a Capavate Collective operator.");
  if (!eligible) reasons.push("No eligibility signal found. Apply to the waitlist or seek a partner vouch.");
  return { eligible, reasons, passes, adminGranted };
}

export function registerCollectiveAppRoutes(app: Express): void {
  app.get("/api/collective/eligibility", (req: Request, res: Response) => {
    // Use req.userContext userId if available (Defect 14 fix). v23.8 D2/W-18 —
    // no `u_investor_demo` synthetic fallback; an unauthenticated check passes
    // undefined and hits the anonymous-eligibility branch.
    // W1 (v26.2.0) SECURITY — a client-supplied `?userId=` was previously an
    // identity FALLBACK, letting anyone probe another user's eligibility /
    // active-membership status. It is now an ADMIN-ONLY diagnostic override:
    // non-admins use their session id; anonymous/non-admin `?userId` is silently
    // ignored (no 403, no shape change — avoids an existence/format oracle).
    const ctx = req.userContext;
    const queryUserId = typeof req.query.userId === "string" && req.query.userId.trim()
      ? req.query.userId.trim()
      : undefined;
    const userId = ctx?.isAdmin && queryUserId ? queryUserId : ctx?.userId;
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

  // W2 A5 — dedicated gate state for the client CollectiveMemberGate. Returns
  // the SAME signals the server gate uses (membership, cap-table exemption,
  // accreditation status) so the client can block child pages until the
  // first-sign-on declaration is complete — without depending on child API
  // calls failing. Never consults KYC (A6): KYC is optional and never gates.
  app.get("/api/collective/gate-state", (req: Request, res: Response) => {
    const ctx = req.userContext;
    const userId = ctx?.userId;
    if (!userId || !ctx?.isAuthed) {
      return res.status(401).json({ ok: false, error: "NOT_AUTHED", message: "Sign in to continue." });
    }

    // Admins are members for gate purposes and never blocked.
    const isAdmin = ctx?.isAdmin === true;

    // Membership + exemption from the authoritative store (DB-backed).
    let isMember = isAdmin;
    let capTableExempt = false;
    try {
      const membership = require("./collectiveMembershipStore");
      if (membership.isActive(userId)) isMember = true;
      capTableExempt = membership.get(userId)?.capTableExempt === true;
    } catch { /* non-fatal — degrade to ctx below */ }
    if (!isMember && ctx?.collective?.status === "active") isMember = true;

    // Partner-only session detection (mirrors the server gate's redirect hint).
    let isPartnerOnly = false;
    try {
      const partnerTeam = require("./partnerTeamStore");
      isPartnerOnly = !isMember && !!partnerTeam.findByUserId(userId);
    } catch { /* non-fatal */ }

    // Accreditation status — fail CLOSED for the gate (treat read error as
    // "none" so the client shows the blocker rather than admitting silently).
    let accreditationStatus: "none" | "self_certified" | "verified" = "none";
    try {
      accreditationStatus = getAccreditationGateStatus(userId).status;
    } catch {
      accreditationStatus = "none";
    }

    // Admins never need the declaration; genuine members with status "none" do.
    const requiresAccreditationDeclaration =
      !isAdmin && isMember && accreditationStatus === "none";

    const copy = getCollectiveLegalCopyBundle([
      "collective_gate_indemnity",
      "accreditation_declaration_indemnity",
    ]);

    return res.json({
      ok: true,
      isMember,
      isPartnerOnly,
      capTableExempt,
      accreditationStatus,
      requiresAccreditationDeclaration,
      declarationEndpoint: "/api/investor/compliance/accreditation-declaration",
      copy: {
        gateIndemnity: copy.collective_gate_indemnity,
        declarationIndemnity: copy.accreditation_declaration_indemnity,
      },
    });
  });

  // W2 A7 — indemnity / assumption-of-vetting copy slots. Read-only, safe to
  // call unauthenticated (copy is not user-specific). Malformed supplied copy
  // degrades to placeholder, never crashes.
  app.get("/api/collective/legal-copy", (req: Request, res: Response) => {
    const slotsRaw = typeof req.query.slots === "string" ? req.query.slots : "";
    const slots = slotsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as any[];
    const bundle = getCollectiveLegalCopyBundle(slots);
    return res.json({ ok: true, copy: bundle });
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

    // W3-B C-5 — best-effort accreditation capture at apply time. Reads the sign
    // fields from req.body directly (zod strips them from parsed.data). NON-FATAL:
    // a missing/invalid signature here never blocks the application — the investor
    // completes accreditation via the dedicated route/settings surface instead.
    try {
      const b = (req.body ?? {}) as { accreditationSignatureName?: unknown; accreditationCriteria?: unknown; jurisdiction?: unknown };
      const sig = typeof b.accreditationSignatureName === "string" ? b.accreditationSignatureName : "";
      if (sig.trim().length >= 2 && Array.isArray(b.accreditationCriteria) && b.accreditationCriteria.length > 0) {
        const r = recordAccreditationDeclaration(userId, {
          signatureName: sig,
          criteria: b.accreditationCriteria,
          jurisdiction: b.jurisdiction,
        });
        if (!r.ok) {
          log.warn("[collectiveAppStore.submit] apply-time accreditation capture skipped:", r.error);
        }
      }
    } catch (err) {
      log.warn("[collectiveAppStore.submit] apply-time accreditation capture failed (non-fatal):", (err as Error).message);
    }

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
    /* v25.48.2 MF-D — read STRICTLY from the DB (the authoritative store). The
     * prior implementation read the in-memory `applications` array first and
     * only fell back to the DB when the mirror was empty, which violates the
     * 100% DB-driven / no-in-memory-canonical-state rule. We now query the DB
     * on EVERY request and FAIL CLOSED (500) on a read error — never a false
     * empty that would hide an existing application. */
    let mine: StoredApplication[];
    try {
      mine = listApplicationsFromDb(undefined, { strict: true })
        .filter((a) => a.userId === userId)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    } catch (err) {
      log.error("[collectiveAppStore] /applications/mine DB read failed — failing closed:", (err as Error).message);
      return res.status(500).json({ error: "APPLICATIONS_LOOKUP_FAILED", message: "Unable to load your application right now. Please try again." });
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
