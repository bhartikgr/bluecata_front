/**
 * Sprint 11 — Multi-company founder auth.
 * KL-04 FIX: getCompaniesForFounder() ab userId accept karta hai
 * Real signup users ke liye empty array return karta hai
 * Demo personas ke liye mock data return karta hai
 */
import type { Express, Request, Response } from "express";
import { resolvePersonaId } from "./lib/userContext";
import { rawDb } from "./db/connection";

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

// Demo personas — only these get mock companies
const DEMO_PERSONA_IDS = new Set([
  "u_maya_chen",
  "u_aisha_patel",
  "u_lapsed_lp",
  "u_no_position",
  "u_admin",
]);

// In-memory active company per session
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

/**
 * KL-04 FIX: userId pass karo
 * - Demo personas → mock companies
 * - Real DB users → empty array (naye user ke paas koi company nahi hoti)
 */
export function getCompaniesForFounder(userId?: string): FounderCompanyMembership[] {
  // Agar userId nahi diya ya demo persona hai toh mock data return karo
  if (!userId || DEMO_PERSONA_IDS.has(userId)) {
    return FOUNDER_COMPANIES;
  }
  // Real signup user — DB mein check karo
  // Abhi ke liye empty array (production mein company creation flow add hoga)
  return [];
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
  app.get("/api/auth/me/legacy", (_req: Request, res: Response) => {
    res.json({
      user: MOCK_USER,
      activeCompanyId,
      companyCount: FOUNDER_COMPANIES.length,
      authMode: "session",
      sprint11LightOnly: true,
    });
  });

  // KL-04 FIX: real user ke liye uski companies return karo
  app.get("/api/founder/companies", (req: Request, res: Response) => {
    const userId = resolvePersonaId(req);
    const companies = getCompaniesForFounder(userId ?? undefined);
    res.json(companies);
  });

  app.get("/api/founder/active-company", (req: Request, res: Response) => {
    const userId = resolvePersonaId(req);
    const companies = getCompaniesForFounder(userId ?? undefined);
    const c = companies.find((x) => x.companyId === activeCompanyId) ?? companies[0] ?? null;
    const activeId = c?.companyId ?? null;
    res.json({ activeCompanyId: activeId, company: c });
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