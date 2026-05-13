/**
 * Sprint 11 — Multi-company founder auth.
 *
 * Models a single founder ("Maya Chen") owning multiple companies. Each
 * company is standalone — separate cap table, separate dataroom, separate
 * billing, separate Collective application status. Roll-up only happens at
 * the founder-account level for invoicing summary.
 *
 * Routes:
 *   GET  /api/auth/me                         — returns current user + role
 *   GET  /api/founder/companies               — list of companies owned/accessible
 *   POST /api/founder/companies/:id/activate  — set active company
 *   GET  /api/founder/active-company          — the current active company id
 *   GET  /api/founder/companies/:id/billing   — per-company billing snapshot
 */
import type { Express, Request, Response } from "express";

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

const MOCK_USER = {
  id: "u_maya_chen",
  email: "maya@novapay.ai",
  name: "Maya Chen",
  avatarUrl: null,
  role: "founder" as const,
  phone: "+1 415-555-0142",
  language: "en",
  timezone: "America/Los_Angeles",
};

// In-memory active company per session — defaults to NovaPay for the demo.
let activeCompanyId = "co_novapay";

const FOUNDER_COMPANIES: FounderCompanyMembership[] = [
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
];

export function getCompaniesForFounder(): FounderCompanyMembership[] {
  return FOUNDER_COMPANIES;
}
export function getActiveCompanyId(): string {
  return activeCompanyId;
}
export function setActiveCompanyId(id: string): boolean {
  if (FOUNDER_COMPANIES.find((c) => c.companyId === id)) {
    activeCompanyId = id;
    return true;
  }
  return false;
}
export function getMockUser() {
  return MOCK_USER;
}

export function registerMultiCompanyRoutes(app: Express): void {
  // NOTE: /api/auth/me has been replaced by Sprint 15 D1 (server/lib/userContext.ts)
  // which returns the full UserContext including investor + collective + admin.
  // The legacy founder-only shape is exposed at /api/auth/me/legacy for back-compat.
  app.get("/api/auth/me/legacy", (_req: Request, res: Response) => {
    res.json({
      user: MOCK_USER,
      activeCompanyId,
      companyCount: FOUNDER_COMPANIES.length,
      authMode: "session",
      sprint11LightOnly: true,
    });
  });

  app.get("/api/founder/companies", (_req: Request, res: Response) => {
    res.json(FOUNDER_COMPANIES);
  });

  app.get("/api/founder/active-company", (_req: Request, res: Response) => {
    const c = FOUNDER_COMPANIES.find((x) => x.companyId === activeCompanyId) ?? null;
    res.json({ activeCompanyId, company: c });
  });

  app.post("/api/founder/companies/:id/activate", (req: Request, res: Response) => {
    const ok = setActiveCompanyId(req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: "company_not_found" });
    return res.json({ ok: true, activeCompanyId });
  });

  app.get("/api/founder/companies/:id/billing", (req: Request, res: Response) => {
    const c = FOUNDER_COMPANIES.find((x) => x.companyId === req.params.id);
    if (!c) return res.status(404).json({ error: "company_not_found" });
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
