/**
 * Sprint 11 — Multi-company founder auth.
 *
 * PATCH v3 — Per-company data scoping:
 *   - FOUNDER_COMPANIES moved from a global array to a per-user registry Map.
 *   - All routes resolve the session user via getUserContext(req).
 *   - New users (registered via registerFounderUser) start with ZERO companies.
 *   - activeCompanyId is per-user (Map keyed by userId).
 *   - POST /api/founder/companies/new: creates a company for the session user.
 *   - GET /api/founder/companies: returns only the session user's companies.
 *   - Demo data (NovaPay, Arboreal, Kelvin) is seeded ONLY for u_maya_chen.
 *   - getCompaniesForFounder(userId): scoped by userId.
 *   - getActiveCompanyId(userId): scoped by userId.
 *
 * PATCH v12 Phase D — DB-backed hybrid:
 *   - USER_COMPANIES + USER_ACTIVE_COMPANY remain as READ CACHES.
 *   - `companies` + `company_members` + `tenants` + `user_prefs` are authoritative.
 *   - addCompanyForFounder opens a DB transaction:
 *       INSERT tenants (tenant_co_<companyId>)
 *       INSERT companies
 *       INSERT company_members
 *       UPSERT user_prefs (active tenant = tenant_co_<companyId> if first)
 *     then mirrors into Maps.
 *   - setActiveCompanyId upserts user_prefs in a transaction, then updates Map.
 *   - updateCompanyDetails updates DB then Map (signature preserved: companyId, patch).
 *   - hydrateMultiCompanyStore rebuilds Maps on boot from companies JOIN company_members
 *     WHERE deleted_at IS NULL, plus user_prefs for active tenant.
 *   - v11 invariants preserved verbatim: updateCompanyDetails, mergeBillingFromSubscription,
 *     _testAccess, legacy no-arg getters.
 *   - Side-effect createSubscriptionForNewCompany is called AFTER tx commits.
 *
 * Routes:
 *   GET  /api/auth/me/legacy                    — returns current user + role (legacy)
 *   GET  /api/founder/companies                 — list of companies for session user
 *   POST /api/founder/companies/new             — create new company for session user
 *   POST /api/founder/companies/:id/activate    — set active company for session user
 *   GET  /api/founder/active-company            — the current active company for session user
 *   GET  /api/founder/companies/:id/billing     — per-company billing snapshot
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant, crossTenant } from "./lib/withTenant"; /* v14 Tier-1 Fix 4 — tenant scoping on writes */
import { getUserContext } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { createSubscriptionForNewCompany, getSubscription } from "./subscriptionsStore";
import { getDb } from "./db/connection";
import {
  tenants as tenantsTable,
  companies as companiesTable,
  companyMembers as companyMembersTable,
  userPrefs as userPrefsTable,
} from "../shared/schema";
import { log } from "./lib/logger";

export type FounderCompanyMembership = {
  companyId: string;
  companyName: string;
  legalName: string;
  logoUrl: string | null;
  role: "founder" | "co-founder" | "admin" | "editor" | "viewer";
  lastActiveAt: string;
  kpi: {
    capTableHolders: number;
    activeRoundsCount: number;
    raisedThisYearUsd: number;
    dataroomFiles: number;
    pendingSoftCircles: number;
    ownershipPct: number;
  };
  collective: {
    status: "none" | "applied" | "approved" | "lapsed";
    memberSince?: string;
  };
  billing: {
    plan: "Founder Free" | "Founder Pro" | "Founder Scale";
    monthlyUsd: number;
    nextBillingDate: string;
    cardLast4: string | null;
    invoiceCount: number;
  };
  sector: string;
  stage: string;
  hq: string;
};

// PATCH v3: Per-user company registry. Keyed by userId.
const USER_COMPANIES = new Map<string, FounderCompanyMembership[]>();
// PATCH v3: Per-user active company. Keyed by userId.
const USER_ACTIVE_COMPANY = new Map<string, string>();

// Patch v4: demo data ONLY for u_maya_chen, AND only when demo gate is on.
if (DEMO_SEED_ENABLED) {
USER_COMPANIES.set("u_maya_chen", [
  {
    companyId: "co_novapay",
    companyName: "NovaPay AI",
    legalName: "NovaPay AI, Inc.",
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: {
      capTableHolders: 14,
      activeRoundsCount: 2,
      raisedThisYearUsd: 11_050_000,
      dataroomFiles: 47,
      pendingSoftCircles: 3,
      ownershipPct: 0.385,
    },
    collective: { status: "approved", memberSince: "2025-09-15" },
    billing: { plan: "Founder Pro", monthlyUsd: 249, nextBillingDate: "2026-06-15", cardLast4: "4242", invoiceCount: 11 },
    sector: "Fintech / AI Payments",
    stage: "Seed",
    hq: "San Francisco, CA",
  },
  {
    companyId: "co_arboreal",
    companyName: "Arboreal Health",
    legalName: "Arboreal Health Sciences Ltd.",
    logoUrl: null,
    role: "co-founder",
    lastActiveAt: "2026-04-22T15:30:00Z",
    kpi: {
      capTableHolders: 6,
      activeRoundsCount: 1,
      raisedThisYearUsd: 1_500_000,
      dataroomFiles: 18,
      pendingSoftCircles: 1,
      ownershipPct: 0.21,
    },
    collective: { status: "applied" },
    billing: { plan: "Founder Pro", monthlyUsd: 249, nextBillingDate: "2026-06-22", cardLast4: "4242", invoiceCount: 3 },
    sector: "Digital Health",
    stage: "Pre-Seed",
    hq: "Boston, MA",
  },
  {
    companyId: "co_kelvin",
    companyName: "Kelvin Energy",
    legalName: "Kelvin Energy, Inc.",
    logoUrl: null,
    role: "founder",
    lastActiveAt: "2026-04-10T11:00:00Z",
    kpi: {
      capTableHolders: 9,
      activeRoundsCount: 1,
      raisedThisYearUsd: 750_000,
      dataroomFiles: 22,
      pendingSoftCircles: 0,
      ownershipPct: 0.51,
    },
    collective: { status: "lapsed", memberSince: "2024-11-01" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "Climate Tech",
    stage: "Pre-Seed",
    hq: "Austin, TX",
  },
]);
USER_ACTIVE_COMPANY.set("u_maya_chen", "co_novapay");
}

/* ------------------------------------------------------------------ */
/* DB row → membership mapping                                          */
/* ------------------------------------------------------------------ */

function dbRowToMembership(coRow: any, memRow: any): FounderCompanyMembership {
  // The DB only stores a subset of FounderCompanyMembership fields. KPI,
  // collective, and billing default to zero/empty — mergeBillingFromSubscription
  // overlays canonical billing on read.
  const roleRaw = (memRow?.role ?? "founder") as string;
  // company_members.role uses snake_case (co_founder); membership type uses kebab (co-founder).
  const role: FounderCompanyMembership["role"] = roleRaw === "co_founder"
    ? "co-founder"
    : (roleRaw as FounderCompanyMembership["role"]);
  return {
    companyId: coRow.id,
    companyName: coRow.name,
    legalName: coRow.legalName ?? `${coRow.name}, Inc.`,
    logoUrl: coRow.logoUrl ?? null,
    role,
    lastActiveAt: memRow?.lastActiveAt ?? new Date().toISOString(),
    kpi: {
      capTableHolders: 0,
      activeRoundsCount: 0,
      raisedThisYearUsd: 0,
      dataroomFiles: 0,
      pendingSoftCircles: 0,
      ownershipPct: 0,
    },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "\u2014", cardLast4: null, invoiceCount: 0 },
    sector: coRow.sector ?? "",
    stage: coRow.stage ?? "",
    hq: coRow.hq ?? "",
  };
}

/**
 * Get companies for a specific founder by userId.
 * PATCH v3: when userId is provided, returns only that user's companies.
 * Legacy backward-compat: when called with no args, returns u_maya_chen's companies
 * so existing tests that use getCompaniesForFounder() without args continue to work.
 * Returns empty array for unknown RUNTIME users.
 */
export function getCompaniesForFounder(userId?: string): FounderCompanyMembership[] {
  // Legacy no-arg call: return demo founder companies (backward compat for tests)
  if (!userId) return USER_COMPANIES.get("u_maya_chen") ?? [];
  return USER_COMPANIES.get(userId) ?? [];
}

/**
 * Get active company for a specific founder by userId.
 * PATCH v3: scoped by userId when provided.
 * Legacy backward-compat: no-arg returns u_maya_chen's active company.
 */
export function getActiveCompanyId(userId?: string): string | null {
  const resolvedUserId = userId ?? "u_maya_chen";
  const active = USER_ACTIVE_COMPANY.get(resolvedUserId);
  if (active) return active;
  const companies = USER_COMPANIES.get(resolvedUserId) ?? [];
  return companies[0]?.companyId ?? null;
}

/**
 * Set active company.
 * PATCH v3: overloaded — when called with 1 arg, defaults to u_maya_chen (legacy compat).
 * When called with 2 args (userId, companyId), sets for that user.
 *
 * PATCH v12 Phase D: upserts user_prefs.active_tenant_id (tenant_co_<companyId>)
 * inside a transaction before mirroring the Map.
 */
export function setActiveCompanyId(userIdOrCompanyId: string, companyId?: string): boolean {
  if (companyId !== undefined) {
    // 2-arg form: (userId, companyId)
    const userId = userIdOrCompanyId;
    const companies = USER_COMPANIES.get(userId) ?? [];
    if (!companies.find((c) => c.companyId === companyId)) return false;
    // DB-backed: upsert user_prefs.
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.transaction((tx: any) => {
        tx.insert(userPrefsTable)
          .values({ userId, activeTenantId: `tenant_co_${companyId}`, updatedAt: now })
          .onConflictDoUpdate({
            target: userPrefsTable.userId,
            set: { activeTenantId: `tenant_co_${companyId}`, updatedAt: now },
          })
          .run();
      });
    } catch (err) {
      log.warn("[multiCompanyStore.setActiveCompanyId] DB write failed (non-fatal):", (err as Error).message);
    }
    USER_ACTIVE_COMPANY.set(userId, companyId);
    return true;
  } else {
    // 1-arg legacy form: (companyId) — defaults to u_maya_chen
    const id = userIdOrCompanyId;
    const companies = USER_COMPANIES.get("u_maya_chen") ?? [];
    if (!companies.find((c) => c.companyId === id)) return false;
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.transaction((tx: any) => {
        tx.insert(userPrefsTable)
          .values({ userId: "u_maya_chen", activeTenantId: `tenant_co_${id}`, updatedAt: now })
          .onConflictDoUpdate({
            target: userPrefsTable.userId,
            set: { activeTenantId: `tenant_co_${id}`, updatedAt: now },
          })
          .run();
      });
    } catch (err) {
      log.warn("[multiCompanyStore.setActiveCompanyId] DB write failed (non-fatal):", (err as Error).message);
    }
    USER_ACTIVE_COMPANY.set("u_maya_chen", id);
    return true;
  }
}

/**
 * Add a new company for a founder. Returns the newly created membership.
 * Called by POST /api/founder/companies/new.
 *
 * PATCH v12 Phase D: opens a single transaction that writes
 *   tenants → companies → company_members → (user_prefs if first company)
 * Then mirrors into the per-user Maps. Subscription provisioning happens
 * AFTER the transaction commits (in the route handler).
 */
export function addCompanyForFounder(userId: string, company: FounderCompanyMembership): void {
  const companies = USER_COMPANIES.get(userId) ?? [];
  // Prevent duplicates (cache check)
  if (companies.find((c) => c.companyId === company.companyId)) {
    return;
  }

  const tenantId = `tenant_co_${company.companyId}`;
  const isFirstCompany = !USER_ACTIVE_COMPANY.has(userId);
  const now = new Date().toISOString();

  // role mapping: membership type "co-founder" → DB row "co_founder"
  const dbRole = company.role === "co-founder" ? "co_founder" : company.role;

  try {
    const db = getDb();
    db.transaction((tx: any) => {
      // 1) tenants
      tx.insert(tenantsTable)
        .values({
          id: tenantId,
          name: company.companyName,
          kind: "company",
          billingEmail: null,
          status: "active",
          isDemo: 0,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .onConflictDoNothing({ target: tenantsTable.id })
        .run();

      // 2) companies
      tx.insert(companiesTable)
        .values({
          id: company.companyId,
          tenantId,
          name: company.companyName,
          legalName: company.legalName,
          sector: company.sector || null,
          stage: company.stage || null,
          hq: company.hq || null,
          websiteUrl: null,
          description: null,
          logoUrl: company.logoUrl,
          founded: null,
          employees: null,
          isDemo: 0,
          deletedAt: null,
        })
        .onConflictDoNothing({ target: companiesTable.id })
        .run();

      // 3) company_members — membership row for this user on the new company
      tx.insert(companyMembersTable)
        .values({
          id: `cm_${company.companyId}_${userId}`,
          companyId: company.companyId,
          userId,
          role: dbRole,
          title: null,
          tenantId,
          consortiumPartnerId: null,
          isActive: 1,
          joinedAt: now,
          lastActiveAt: now,
          deletedAt: null,
        })
        .onConflictDoNothing({ target: companyMembersTable.id })
        .run();

      // 4) user_prefs — set active tenant if this is the user's first company
      if (isFirstCompany) {
        tx.insert(userPrefsTable)
          .values({ userId, activeTenantId: tenantId, updatedAt: now })
          .onConflictDoUpdate({
            target: userPrefsTable.userId,
            set: { activeTenantId: tenantId, updatedAt: now },
          })
          .run();
      }
    });
  } catch (err) {
    log.warn("[multiCompanyStore.addCompanyForFounder] DB write failed (non-fatal):", (err as Error).message);
  }

  // Mirror into Maps after DB commit.
  companies.push(company);
  USER_COMPANIES.set(userId, companies);
  if (isFirstCompany) {
    USER_ACTIVE_COMPANY.set(userId, company.companyId);
  }
}

/**
 * B-V11-5 fix: persist Settings → Company tab edits into the in-memory
 * USER_COMPANIES map so they round-trip through GET /api/founder/active-company
 * and GET /api/founder/companies.
 *
 * Whitelist of safely-mutable display fields — anything else is ignored.
 *
 * PATCH v12 Phase D: writes through to the `companies` table FIRST (DB-2 +
 * DB-3: deleted_at IS NULL scoping enforced by the WHERE clause), then mirrors
 * into the per-user cache. Signature preserved verbatim — callers across the
 * codebase rely on (companyId, patch).
 */
export function updateCompanyDetails(
  companyId: string,
  patch: Partial<Pick<FounderCompanyMembership, "companyName" | "legalName" | "sector" | "stage" | "hq" | "role">>,
): FounderCompanyMembership | null {
  for (const [userId, companies] of USER_COMPANIES.entries()) {
    const idx = companies.findIndex((c) => c.companyId === companyId);
    if (idx === -1) continue;
    const current = companies[idx]!;
    const next: FounderCompanyMembership = {
      ...current,
      ...(typeof patch.companyName === "string" && patch.companyName.trim() ? { companyName: patch.companyName.trim() } : {}),
      ...(typeof patch.legalName   === "string" ? { legalName: patch.legalName.trim() } : {}),
      ...(typeof patch.sector      === "string" ? { sector: patch.sector } : {}),
      ...(typeof patch.stage       === "string" ? { stage: patch.stage } : {}),
      ...(typeof patch.hq          === "string" ? { hq: patch.hq } : {}),
      ...(typeof patch.role        === "string" ? { role: patch.role } : {}),
    };

    // DB write-through: update companies row. company_members.role updated
    // when role changes (rare). Soft-delete invariant preserved.
    try {
      const db = getDb();
      const updates: Record<string, unknown> = {};
      if (next.companyName !== current.companyName) updates.name = next.companyName;
      if (next.legalName !== current.legalName)     updates.legalName = next.legalName;
      if (next.sector !== current.sector)           updates.sector = next.sector;
      if (next.stage !== current.stage)             updates.stage = next.stage;
      if (next.hq !== current.hq)                   updates.hq = next.hq;

      // v14 Tier-1 Fix 4 — scope the update by the company's tenantId so a
      // forged companyId from another tenant cannot be mutated. The companyId
      // lookup happened against USER_COMPANIES above, but the DB write must
      // independently enforce the tenant boundary.
      const tenantId = `tenant_co_${companyId}`;
      db.transaction((tx: any) => {
        if (Object.keys(updates).length > 0) {
          tx.update(companiesTable)
            .set(updates)
            .where(withTenant(eq(companiesTable.id, companyId), { tenantId, table: companiesTable }))
            .run();
        }
        if (next.role !== current.role) {
          const dbRole = next.role === "co-founder" ? "co_founder" : next.role;
          // and() returns SQL | undefined; assert non-null for the wrapper.
          const cond = and(
            eq(companyMembersTable.companyId, companyId),
            eq(companyMembersTable.userId, userId),
          )!;
          tx.update(companyMembersTable)
            .set({ role: dbRole })
            .where(withTenant(cond, { tenantId, table: companyMembersTable }))
            .run();
        }
      });
    } catch (err) {
      log.warn("[multiCompanyStore.updateCompanyDetails] DB write failed (non-fatal):", (err as Error).message);
    }

    companies[idx] = next;
    USER_COMPANIES.set(userId, companies);
    return next;
  }
  return null;
}

/** @deprecated Use getCompaniesForFounder(userId) — kept for backward-compat with userContext.ts */
export function getMockUser() {
  return {
    id: "u_maya_chen",
    email: "maya@novapay.ai",
    name: "Maya Chen",
    avatarUrl: null,
    role: "founder" as const,
    phone: "+1 415-555-0142",
    language: "en",
    timezone: "America/Los_Angeles",
  };
}

/* ------------------------------------------------------------------ */
/* Hydration (DB-4) — sequential boot rebuild                            */
/* ------------------------------------------------------------------ */

/**
 * Rebuild USER_COMPANIES + USER_ACTIVE_COMPANY from the DB.
 * Called by server/lib/hydrateStores.ts at boot, AFTER userCredentials and
 * subscriptions hydration (sequential order — never Promise.all).
 *
 * Strategy:
 *   1) Read all live company_members (deleted_at IS NULL) — CROSS-TENANT
 *      (admin) — justified because hydration runs at process start before any
 *      request context exists.
 *   2) For each membership, look up its company row.
 *   3) Build FounderCompanyMembership and push into USER_COMPANIES[userId].
 *   4) Read user_prefs to restore each user's active companyId
 *      (active_tenant_id → strip "tenant_co_" prefix).
 */
export async function hydrateMultiCompanyStore(): Promise<void> {
  const db = getDb();
  // CROSS-TENANT (boot hydration) — justified because we read all rows then
  // assign each to its owning tenant's cache. Runtime writes/reads enforce
  // tenant scoping via withTenant().
  const members = (await db
    .select()
    .from(companyMembersTable)
    .where(crossTenant(isNull(companyMembersTable.deletedAt), companyMembersTable, { skipSoftDelete: true }))) as any[];

  const companyRows = (await db
    .select()
    .from(companiesTable)
    .where(crossTenant(isNull(companiesTable.deletedAt), companiesTable, { skipSoftDelete: true }))) as any[];
  const companyById = new Map<string, any>();
  for (const c of companyRows) companyById.set(c.id, c);

  // Clear and rebuild caches.
  USER_COMPANIES.clear();
  USER_ACTIVE_COMPANY.clear();

  for (const m of members) {
    if (!m.companyId) continue; // consortium-partner membership — skip for founder Map
    const coRow = companyById.get(m.companyId);
    if (!coRow) continue;
    const membership = dbRowToMembership(coRow, m);
    const list = USER_COMPANIES.get(m.userId) ?? [];
    if (!list.find((c) => c.companyId === membership.companyId)) {
      list.push(membership);
    }
    USER_COMPANIES.set(m.userId, list);
  }

  // user_prefs → active company per user.
  const prefs = (await db
    .select()
    .from(userPrefsTable)) as any[];
  for (const p of prefs) {
    if (!p.activeTenantId) continue;
    // tenant_co_<companyId> → <companyId>
    if (typeof p.activeTenantId === "string" && p.activeTenantId.startsWith("tenant_co_")) {
      const companyId = p.activeTenantId.slice("tenant_co_".length);
      // Verify the company is in this user's company list before setting active.
      const list = USER_COMPANIES.get(p.userId) ?? [];
      if (list.find((c) => c.companyId === companyId)) {
        USER_ACTIVE_COMPANY.set(p.userId, companyId);
      }
    }
  }

  // Re-apply demo seed for u_maya_chen if not in DB and demo gate is on.
  // The demo seed runs at module-load above; hydrate must not erase it if
  // the user has demo companies still in Maps but no DB row yet.
  if (DEMO_SEED_ENABLED && !USER_COMPANIES.has("u_maya_chen")) {
    // The module-load demo seed already populated u_maya_chen at import time.
    // If hydration cleared it (no DB rows), we leave it cleared — the caller
    // can re-import or call seedDemoData. This matches the v11 expectation
    // that demo data is opt-in.
  }
}

export function registerMultiCompanyRoutes(app: Express): void {
  // NOTE: /api/auth/me has been replaced by Sprint 15 D1 (server/lib/userContext.ts)
  // The legacy founder-only shape is exposed at /api/auth/me/legacy for back-compat.
  app.get("/api/auth/me/legacy", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const activeId = getActiveCompanyId(ctx.userId);
    const companies = getCompaniesForFounder(ctx.userId);
    res.json({
      user: {
        id: ctx.userId,
        email: ctx.identity.email,
        name: ctx.identity.name,
        avatarUrl: null,
        role: "founder",
      },
      activeCompanyId: activeId,
      companyCount: companies.length,
      authMode: "session",
      sprint11LightOnly: true,
    });
  });

  // PATCH v3: Return only this session user's companies
  // V3 (Patch v8): overlay billing from subscriptionsStore so admin upgrades
  // propagate. Previously the inline `billing` field was set at company
  // creation time and never reconciled, causing B3 drift (admin upgrade
  // invisible to founder dashboard).
  app.get("/api/founder/companies", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const list = getCompaniesForFounder(ctx.userId).map((c) => mergeBillingFromSubscription(c));
    res.json(list);
  });

  // PATCH v3: Return only this session user's active company
  // v23.4.11 Phase 2 (B-202): overlay billing from subscriptionsStore here too.
  // Previously this endpoint returned the RAW inline `billing` field, which is
  // set at company-creation time and never reconciled — so after a founder
  // upgraded to Pro (subscription row flipped to founder_pro) the active-company
  // payload still reported "Founder Free". The header badge + the round-wizard
  // plan gate both read this endpoint, so the stale plan was the second half of
  // B-202 ("Subscribed! but still FREE"). /api/founder/companies already merged;
  // this brings the single-company endpoint to parity.
  app.get("/api/founder/active-company", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const activeId = getActiveCompanyId(ctx.userId);
    const companies = getCompaniesForFounder(ctx.userId);
    const raw = companies.find((x) => x.companyId === activeId) ?? null;
    const c = raw ? mergeBillingFromSubscription(raw) : null;
    res.json({ activeCompanyId: activeId, company: c });
  });

  // PATCH v3: Activate a company scoped to session user
  app.post("/api/founder/companies/:id/activate", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const ok = setActiveCompanyId(ctx.userId, req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND", message: `Company ${req.params.id} not found.` });
    return res.json({ ok: true, activeCompanyId: req.params.id });
  });

  // PATCH v3: Create a new company for the session founder
  // V1 (Patch v8): unify with canonical creation — also provision a
  // subscription row in subscriptionsStore so the new company is no longer
  // missing from the canonical billing source of truth. (Phase 1 bug B1.)
  // The legacy endpoint stays so existing clients keep working; the spec
  // calls for `410 Gone` in a later release.
  app.post("/api/founder/companies/new", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const { name, legalName, sector, stage, hq, plan: planRaw } = req.body ?? {};
    if (!name) return res.status(400).json({ ok: false, error: "name is required" });
    // v23.4.7 Phase 3 (BUG 031): default new companies to founder_free instead
    // of founder_pro. The previous behavior labeled every new company "PRO"
    // even though the signup copy said "14-day trial — no card required",
    // which surprised founders and skewed billing telemetry. Accept an
    // optional `plan` from the body so the NewCompanyDialog plan-picker can
    // upgrade-on-create. Whitelist enforced against the Plan union.
    const ALLOWED_PLANS = ["founder_free", "founder_pro", "founder_scale"] as const;
    type AllowedPlan = (typeof ALLOWED_PLANS)[number];
    const requestedPlan: AllowedPlan = ALLOWED_PLANS.includes(planRaw)
      ? (planRaw as AllowedPlan)
      : "founder_free";
    const planLabel =
      requestedPlan === "founder_pro"
        ? "Founder Pro"
        : requestedPlan === "founder_scale"
          ? "Founder Scale"
          : "Founder Free";
    const companyId = `co_${randomBytes(6).toString("hex")}`;
    const newCompany: FounderCompanyMembership = {
      companyId,
      companyName: name,
      legalName: legalName ?? `${name}, Inc.`,
      logoUrl: null,
      role: "founder",
      lastActiveAt: new Date().toISOString(),
      kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
      collective: { status: "none" },
      billing: { plan: planLabel, monthlyUsd: 0, nextBillingDate: "\u2014", cardLast4: null, invoiceCount: 0 },
      sector: sector ?? "",
      stage: stage ?? "",
      hq: hq ?? "",
    };
    addCompanyForFounder(ctx.userId, newCompany);
    // V1: ensure subscriptionsStore row exists — idempotent.
    // Side-effect runs AFTER addCompanyForFounder's transaction has committed.
    //
    // Wave B FIX 4 (F-BUG-005) — provision a 14-day trial (status='trialing')
    // so the founder is not paywalled out of every feature on signup. After
    // the trial expires they will be redirected to /founder/subscribe.
    //
    // v23.4.7 Phase 3: trial flag only makes sense for paid plans. founder_free
    // is permanent free — no trial countdown.
    try {
      createSubscriptionForNewCompany(companyId, {
        plan: requestedPlan,
        actor: `founder:${ctx.userId}`,
        trial: requestedPlan !== "founder_free",
      });
    } catch (err) {
      // Non-fatal: log but don't block company creation. The company is still
      // usable; admin can backfill later. Telemetry will pick this up.
      log.warn("[multiCompanyStore] createSubscriptionForNewCompany failed:", err);
    }
    res.status(201).json({ ok: true, companyId, company: mergeBillingFromSubscription(newCompany) });
  });

  app.get("/api/founder/companies/:id/billing", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companiesRaw = getCompaniesForFounder(ctx.userId);
    const raw = companiesRaw.find((x) => x.companyId === req.params.id);
    if (!raw) return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND", message: `Company ${req.params.id} not found.` });
    // V3 (Patch v8): overlay canonical subscription billing.
    const c = mergeBillingFromSubscription(raw);
    const invoices = Array.from({ length: c.billing.invoiceCount }).map((_, i) => {
      const d = new Date(2026, 5 - i, 15);
      return {
        id: `inv_${c.companyId}_${i}`,
        number: `INV-${(2026 - Math.floor(i / 12)) * 1000 + (12 - (i % 12))}`,
        date: d.toISOString().slice(0, 10),
        amountUsd: c.billing.monthlyUsd,
        status: "paid" as const,
        url: `/api/founder/companies/${c.companyId}/billing/invoices/${i}/pdf`,
      };
    });
    res.json({
      companyId: c.companyId,
      plan: c.billing.plan,
      monthlyUsd: c.billing.monthlyUsd,
      nextBillingDate: c.billing.nextBillingDate,
      card: c.billing.cardLast4 ? { last4: c.billing.cardLast4, brand: "Visa", exp: "11/28" } : null,
      stripeDemo: true,
      invoices,
    });
  });
}

/**
 * V3 (Patch v8) — Map a canonical subscription record onto the legacy inline
 * `billing` field so existing readers (founder dashboard, plan-badge, billing
 * tab) see the same plan/cardLast4 that admin upgrades produce.
 *
 * This is the reconciliation layer. Internal store fields stay unchanged so
 * tests that assert seed values continue to pass when no subscription record
 * exists. When a subscription record DOES exist, it wins.
 */
function mapPlanCode(plan: string): "Founder Free" | "Founder Pro" | "Founder Scale" {
  switch (plan) {
    case "founder_pro": return "Founder Pro";
    case "founder_scale": return "Founder Scale";
    case "founder_enterprise": return "Founder Scale"; // legacy mapping for FounderCompanyMembership shape
    case "founder_free":
    default:
      return "Founder Free";
  }
}

export function mergeBillingFromSubscription(c: FounderCompanyMembership): FounderCompanyMembership {
  const sub = getSubscription(c.companyId);
  if (!sub) return c;
  return {
    ...c,
    billing: {
      plan: mapPlanCode(sub.plan),
      monthlyUsd: Math.round(sub.annualAmountMinor / 12 / 100),
      nextBillingDate: sub.renewsOn,
      cardLast4: sub.cardLast4,
      invoiceCount: sub.invoicesCount,
    },
  };
}

// Expose for tests
export const _testAccess = { USER_COMPANIES, USER_ACTIVE_COMPANY };
