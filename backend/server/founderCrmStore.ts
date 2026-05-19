/**
 * Sprint 11 — Founder Investor CRM (mirror of investor CRM, founder-perspective).
 *
 * Pipeline: Lead → Engaged → Soft-Circle → Invested → Long-term partner
 *
 * Endpoints:
 *   GET  /api/founder/investor-crm                        — list contacts (per-company)
 *   POST /api/founder/investor-crm                        — create contact
 *   PATCH /api/founder/investor-crm/:id                   — update stage / notes / tasks
 *   POST /api/founder/investor-crm/broadcast              — segmented broadcast (filters: stage / region / etc.)
 *   GET  /api/founder/crm/contacts                        — alias for investor-crm (scoped to active company)
 *
 * Sprint-fix May 14 2026:
 *   - All endpoints now call requireAuth — anonymous users receive 401.
 *   - companyId defaults to the authenticated founder's activeCompanyId (not hardcoded "co_novapay").
 *   - Added hydrateFounderCrmFromDatabase() stub.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { emitSync } from "./sprint10Telemetry";
import { requireAuth } from "./lib/authMiddleware";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";

export type FounderCrmContact = {
  id: string;
  companyId: string;
  investorId: string;
  name: string;
  firmName: string;
  email: string;
  region: string;
  // Sprint 14 D3 — 7-stage pipeline.
  stage: "lead" | "engaged" | "soft_circle" | "committed" | "signing" | "invested" | "longterm";
  ownership: { sharesUsd: number; pct: number };
  softCircleHistory: Array<{ ts: string; amountUsd: number; type: string }>;
  maSignals: number;
  threadIds: string[];
  notes: string;
  notesUpdatedAt: string;
  tasks: Array<{ id: string; text: string; due: string; status: "open" | "done" }>;
  series: string;
};

// Patch v4: gated demo seed.
const contacts: FounderCrmContact[] = DEMO_SEED_ENABLED ? [
  {
    id: "fcrm_1", companyId: "co_novapay", investorId: "u_aisha_patel",
    name: "Aisha Patel", firmName: "Forge Ventures", email: "aisha@forge.vc", region: "US",
    stage: "invested", ownership: { sharesUsd: 500_000, pct: 0.041 },
    softCircleHistory: [{ ts: "2024-08-22T09:00:00Z", amountUsd: 500_000, type: "definite" }],
    maSignals: 0, threadIds: ["th_aisha"], notes: "Strong fintech network. Pro-rata in next round.",
    notesUpdatedAt: "2026-04-10T11:00:00Z",
    tasks: [{ id: "tsk_1", text: "Quarterly catch-up call", due: "2026-06-15", status: "open" }],
    series: "Pre-Seed SAFE",
  },
  {
    id: "fcrm_2", companyId: "co_novapay", investorId: "u_hydra",
    name: "Marcus Lee", firmName: "Hydra Capital", email: "marcus@hydra.com", region: "SG",
    stage: "invested", ownership: { sharesUsd: 1_500_000, pct: 0.118 },
    softCircleHistory: [{ ts: "2025-01-15T09:00:00Z", amountUsd: 1_500_000, type: "definite" }],
    maSignals: 1, threadIds: ["th_hydra"], notes: "Series Seed lead. Watching for Series A.",
    notesUpdatedAt: "2026-04-29T15:00:00Z",
    tasks: [],
    series: "Series Seed",
  },
  {
    id: "fcrm_3", companyId: "co_novapay", investorId: "u_anchor",
    name: "Yuki Tanaka", firmName: "Anchor Growth", email: "yuki@anchor.io", region: "JP",
    stage: "soft_circle", ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [{ ts: "2026-04-30T10:00:00Z", amountUsd: 4_000_000, type: "indication" }],
    maSignals: 2, threadIds: ["th_anchor_a"], notes: "Lead candidate Series A. Sent dataroom 2026-04-30.",
    notesUpdatedAt: "2026-05-02T08:00:00Z",
    tasks: [{ id: "tsk_a1", text: "Send Q2 KPI snapshot", due: "2026-05-15", status: "open" }],
    series: "Series A (lead candidate)",
  },
  {
    id: "fcrm_4", companyId: "co_novapay", investorId: "u_bluepoint",
    name: "Renu Kapoor", firmName: "Bluepoint Capital", email: "renu@bluepoint.in", region: "IN",
    stage: "engaged", ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0, threadIds: ["th_bluepoint"], notes: "Q1 intro by Forge. Reviewing dataroom.",
    notesUpdatedAt: "2026-04-22T08:00:00Z",
    tasks: [],
    series: "Series A (engaged)",
  },
  {
    id: "fcrm_5", companyId: "co_novapay", investorId: "u_lead_1",
    name: "Sophie Müller", firmName: "Northstar VC", email: "sm@northstar.vc", region: "UK",
    stage: "lead", ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [], maSignals: 0, threadIds: [],
    notes: "Met at Sifted London. Has Series A budget for fintech.",
    notesUpdatedAt: "2026-03-10T08:00:00Z", tasks: [], series: "—",
  },
] : [];

/** Resolve companyId from request: use authenticated founder's activeCompanyId first, then query param. */
function resolveCompanyId(req: Request): string {
  const ctxCompanyId = (req as any).userContext?.founder?.activeCompanyId;
  if (ctxCompanyId) return ctxCompanyId;
  const q = typeof req.query.companyId === "string" ? req.query.companyId : null;
  return q ?? "co_novapay"; // fallback for sandbox dev only
}

export function registerFounderCrmRoutes(app: Express): void {
  // GET /api/founder/investor-crm — list contacts (per authenticated founder's company)
  app.get("/api/founder/investor-crm", requireAuth, (req: Request, res: Response) => {
    const companyId = resolveCompanyId(req);
    res.json(contacts.filter((c) => c.companyId === companyId));
  });

  // GET /api/founder/crm/contacts — alias for investor-crm (fixes the "tone" crash)
  app.get("/api/founder/crm/contacts", requireAuth, (req: Request, res: Response) => {
    const companyId = resolveCompanyId(req);
    res.json(contacts.filter((c) => c.companyId === companyId));
  });

  // POST /api/founder/investor-crm — create contact
  app.post("/api/founder/investor-crm", requireAuth, (req: Request, res: Response) => {
    const companyId = resolveCompanyId(req);
    const c: FounderCrmContact = {
      id: `fcrm_${randomBytes(3).toString("hex")}`,
      companyId: req.body?.companyId ?? companyId,
      investorId: req.body?.investorId ?? `u_${randomBytes(3).toString("hex")}`,
      name: req.body?.name ?? "New contact",
      firmName: req.body?.firmName ?? "—",
      email: req.body?.email ?? "",
      region: req.body?.region ?? "US",
      stage: req.body?.stage ?? "lead",
      ownership: { sharesUsd: 0, pct: 0 },
      softCircleHistory: [], maSignals: 0, threadIds: [],
      notes: req.body?.notes ?? "",
      notesUpdatedAt: new Date().toISOString(),
      tasks: [], series: req.body?.series ?? "—",
    };
    contacts.push(c);
    res.json(c);
  });

  // PATCH /api/founder/investor-crm/:id — update stage / notes / tasks
  app.patch("/api/founder/investor-crm/:id", requireAuth, (req: Request, res: Response) => {
    const c = contacts.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: "not_found" });
    if (typeof req.body?.stage === "string") c.stage = req.body.stage;
    if (typeof req.body?.notes === "string") { c.notes = req.body.notes; c.notesUpdatedAt = new Date().toISOString(); }
    if (req.body?.task) {
      c.tasks.push({ id: `tsk_${randomBytes(3).toString("hex")}`, text: req.body.task.text, due: req.body.task.due, status: "open" });
    }
    res.json(c);
  });

  // POST /api/founder/investor-crm/broadcast — segmented broadcast
  app.post("/api/founder/investor-crm/broadcast", requireAuth, (req: Request, res: Response) => {
    const { filter, message } = req.body ?? {};
    const compId = resolveCompanyId(req);
    let targets = contacts.filter((c) => c.companyId === compId);
    if (filter?.stage)  targets = targets.filter((c) => c.stage === filter.stage);
    if (filter?.region) targets = targets.filter((c) => c.region === filter.region);
    if (filter?.series) targets = targets.filter((c) => c.series.toLowerCase().includes(String(filter.series).toLowerCase()));
    const env = emitSync({
      eventType: "founder_crm_broadcast",
      aggregateId: `fcb_${randomBytes(3).toString("hex")}`,
      aggregateKind: "broadcast",
      payload: { companyId: compId, recipientCount: targets.length, filter, messagePreview: String(message ?? "").slice(0, 80) },
      req,
    });
    res.json({ ok: true, recipientCount: targets.length, recipients: targets.map((t) => t.investorId), telemetry: env });
  });
}

export const _testAccessFounderCrm = { contacts };

/* V10 (Patch v8): Public scoped reader replacing _testAccessFounderCrm.contacts
 * filtering by callers. Returns all contacts scoped to the given companyId.
 * Production routes should use this instead of reaching into _testAccessFounderCrm.
 */
export function listContactsForCompany(companyId: string): FounderCrmContact[] {
  if (!companyId) return [];
  return contacts.filter((c) => c.companyId === companyId);
}

/**
 * hydrateFounderCrmFromDatabase — Sprint 29 KL-04 pattern.
 * No-op in sandbox. Avi wires Drizzle SELECT here once Postgres is live.
 */
export async function hydrateFounderCrmFromDatabase(_db?: unknown): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[hydrate] founderCrmStore — no DATABASE_URL set, in-memory only");
    return;
  }
  // TODO Avi: add Drizzle SELECT here when Postgres is wired
  console.log("[hydrate] founderCrmStore — DATABASE_URL set but DB queries not wired yet");
}
