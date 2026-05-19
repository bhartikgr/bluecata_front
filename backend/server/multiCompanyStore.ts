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
import { getUserContext } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { createSubscriptionForNewCompany, getSubscription } from "./subscriptionsStore";

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
 */
export function setActiveCompanyId(userIdOrCompanyId: string, companyId?: string): boolean {
  if (companyId !== undefined) {
    // 2-arg form: (userId, companyId)
    const userId = userIdOrCompanyId;
    const companies = USER_COMPANIES.get(userId) ?? [];
    if (companies.find((c) => c.companyId === companyId)) {
      USER_ACTIVE_COMPANY.set(userId, companyId);
      return true;
    }
    return false;
  } else {
    // 1-arg legacy form: (companyId) — defaults to u_maya_chen
    const id = userIdOrCompanyId;
    const companies = USER_COMPANIES.get("u_maya_chen") ?? [];
    if (companies.find((c) => c.companyId === id)) {
      USER_ACTIVE_COMPANY.set("u_maya_chen", id);
      return true;
    }
    return false;
  }
}

/**
 * Add a new company for a founder. Returns the newly created membership.
 * Called by POST /api/founder/companies/new.
 */
export function addCompanyForFounder(userId: string, company: FounderCompanyMembership): void {
  const companies = USER_COMPANIES.get(userId) ?? [];
  // Prevent duplicates
  if (!companies.find((c) => c.companyId === company.companyId)) {
    companies.push(company);
    USER_COMPANIES.set(userId, companies);
  }
  // If this is their first company, set it as active
  if (!USER_ACTIVE_COMPANY.has(userId)) {
    USER_ACTIVE_COMPANY.set(userId, company.companyId);
  }
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
  app.get("/api/founder/active-company", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const activeId = getActiveCompanyId(ctx.userId);
    const companies = getCompaniesForFounder(ctx.userId);
    const c = companies.find((x) => x.companyId === activeId) ?? null;
    res.json({ activeCompanyId: activeId, company: c });
  });

  // PATCH v3: Activate a company scoped to session user
  app.post("/api/founder/companies/:id/activate", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const ok = setActiveCompanyId(ctx.userId, req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: "company_not_found" });
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
    const { name, legalName, sector, stage, hq } = req.body ?? {};
    if (!name) return res.status(400).json({ ok: false, error: "name is required" });
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
      billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "\u2014", cardLast4: null, invoiceCount: 0 },
      sector: sector ?? "",
      stage: stage ?? "",
      hq: hq ?? "",
    };
    addCompanyForFounder(ctx.userId, newCompany);
    // V1: ensure subscriptionsStore row exists — idempotent.
    try {
      createSubscriptionForNewCompany(companyId, {
        plan: "founder_free",
        actor: `founder:${ctx.userId}`,
      });
    } catch (err) {
      // Non-fatal: log but don't block company creation. The company is still
      // usable; admin can backfill later. Telemetry will pick this up.
      // eslint-disable-next-line no-console
      console.warn("[multiCompanyStore] createSubscriptionForNewCompany failed:", err);
    }
    res.status(201).json({ ok: true, companyId, company: mergeBillingFromSubscription(newCompany) });
  });

  app.get("/api/founder/companies/:id/billing", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companiesRaw = getCompaniesForFounder(ctx.userId);
    const raw = companiesRaw.find((x) => x.companyId === req.params.id);
    if (!raw) return res.status(404).json({ error: "company_not_found" });
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
