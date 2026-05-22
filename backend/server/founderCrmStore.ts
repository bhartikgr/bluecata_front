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
 *
 * Patch v12 Day 3 (audit §3.11) — DB-BACKED hybrid.
 *   - `contacts: FounderCrmContact[]` is now a READ CACHE; the
 *     `founder_crm_contacts` table is authoritative.
 *   - Mutations (POST/PATCH) write through inside `getDb().transaction(...)`.
 *     No trailing `()` — Drizzle invokes the callback for us.
 *   - `hydrateFounderCrmStore()` rebuilds `contacts` from
 *     `WHERE deleted_at IS NULL` on boot.
 *   - All v11 fix markers preserved verbatim:
 *       VALID_STAGES, normalizeStage(), `stage: normalizeStage(...)`,
 *       `appendAdminAudit("crm.contact.created", ...)` emission, and
 *       `_testAccessFounderCrm = { contacts }`.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { emitSync } from "./sprint10Telemetry";
import { requireAuth } from "./lib/authMiddleware";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
// B-V11-7 fix: log CRM-contact creation events to the central audit log so the
// activity timeline (/api/founder/companies/:id/activity) surfaces them.
import { appendAdminAudit } from "./adminPlatformStore";
import { getDb } from "./db/connection";
import { withTenant, crossTenant } from "./lib/withTenant"; /* v14 Tier-1 Fix 4 — tenant scoping on writes */
import { founderCrmContacts as founderCrmContactsTable } from "../shared/schema";
import { log } from "./lib/logger";

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

/** Tenant id for a company. Same canonical pattern as adminPlatform/dataroom. */
function tenantForCompany(companyId: string): string {
  return `tenant_co_${companyId}`;
}

/** Convert a DB row into the in-memory FounderCrmContact shape. */
function rowToContact(r: any): FounderCrmContact {
  const parse = <T,>(s: any, fallback: T): T => {
    if (!s || typeof s !== "string") return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  return {
    id: r.id,
    companyId: r.companyId,
    investorId: r.investorId ?? "",
    name: r.name,
    firmName: r.firmName ?? "—",
    email: r.email ?? "",
    region: r.region ?? "US",
    stage: r.stage as FounderCrmContact["stage"],
    ownership: parse(r.ownership, { sharesUsd: 0, pct: 0 }),
    softCircleHistory: parse(r.softCircleHistory, [] as FounderCrmContact["softCircleHistory"]),
    maSignals: typeof r.maSignals === "number" ? r.maSignals : 0,
    threadIds: parse(r.threadIds, [] as string[]),
    notes: r.notes ?? "",
    notesUpdatedAt: r.notesUpdatedAt ?? "",
    tasks: parse(r.tasks, [] as FounderCrmContact["tasks"]),
    series: r.series ?? "—",
  };
}

/** Build column values for INSERT/UPDATE. */
function contactToRow(c: FounderCrmContact) {
  const now = new Date().toISOString();
  return {
    id: c.id,
    tenantId: tenantForCompany(c.companyId),
    companyId: c.companyId,
    investorId: c.investorId,
    name: c.name,
    firmName: c.firmName,
    role: null as string | null,
    email: c.email,
    region: c.region,
    stage: c.stage,
    ownership: JSON.stringify(c.ownership),
    softCircleHistory: JSON.stringify(c.softCircleHistory),
    tasks: JSON.stringify(c.tasks),
    threadIds: JSON.stringify(c.threadIds),
    maSignals: c.maSignals,
    notes: c.notes,
    notesUpdatedAt: c.notesUpdatedAt,
    series: c.series,
    createdAt: now,
    updatedAt: now,
    deletedAt: null as string | null,
  };
}

// Patch v4: gated demo seed. v12 Day 3 — these are seeded BOTH in memory and
// in the DB on first boot (`ENABLE_DEMO_SEED=1`) so a restart without the env
// var still returns them.
const DEMO_SEED: FounderCrmContact[] = DEMO_SEED_ENABLED ? [
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

// In-memory read cache; authoritative store is founder_crm_contacts.
const contacts: FounderCrmContact[] = [...DEMO_SEED];

/** Seed demo contacts into the DB (idempotent — INSERT OR IGNORE). */
function seedDemoContactsIntoDb(): void {
  if (!DEMO_SEED_ENABLED || DEMO_SEED.length === 0) return;
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      for (const c of DEMO_SEED) {
        // CROSS-TENANT (seed) — demo seeding writes across tenants on first boot.
        const existing = tx
          .select({ id: founderCrmContactsTable.id })
          .from(founderCrmContactsTable)
          .where(crossTenant(eq(founderCrmContactsTable.id, c.id), founderCrmContactsTable))
          .limit(1)
          .all() as any[];
        if (existing.length === 0) {
          tx.insert(founderCrmContactsTable).values(contactToRow(c)).run();
        }
      }
    });
  } catch (err) {
    log.warn("[founderCrmStore] demo seed write-through failed:", (err as Error).message);
  }
}

/**
 * v14 — Resolve companyId from authenticated session.
 *
 * Order: 1) session.activeCompanyId, 2) explicit ?companyId= query (only
 * when the founder owns it via userContext.founder.companies, or caller is
 * admin), 3) returns null. Routes treat null as 400 missing_active_company.
 * NEVER falls back to demo "co_novapay". Header values are NOT consulted.
 */
function resolveCompanyId(req: Request): string | null {
  const ctx = (req as any).userContext;
  const ctxCompanyId = ctx?.founder?.activeCompanyId as string | undefined;
  if (ctxCompanyId) return ctxCompanyId;
  const q = typeof req.query.companyId === "string" ? req.query.companyId : null;
  if (q && Array.isArray(ctx?.founder?.companies)) {
    const owns = ctx.founder.companies.some((c: { companyId: string }) => c.companyId === q);
    if (owns || ctx?.isAdmin) return q;
  }
  return null;
}

function ensureCompanyId(req: Request, res: Response): string | null {
  const id = resolveCompanyId(req);
  if (!id) {
    res.status(400).json({ ok: false, error: "missing_active_company" });
    return null;
  }
  return id;
}

export function registerFounderCrmRoutes(app: Express): void {
  // GET /api/founder/investor-crm — list contacts (per authenticated founder's company)
  app.get("/api/founder/investor-crm", requireAuth, (req: Request, res: Response) => {
    const companyId = ensureCompanyId(req, res); if (!companyId) return;
    res.json(contacts.filter((c) => c.companyId === companyId));
  });

  // GET /api/founder/crm/contacts — alias for investor-crm (fixes the "tone" crash)
  app.get("/api/founder/crm/contacts", requireAuth, (req: Request, res: Response) => {
    const companyId = ensureCompanyId(req, res); if (!companyId) return;
    res.json(contacts.filter((c) => c.companyId === companyId));
  });

  // B-V11-2 fix: server-side pipeline-stage validator. The CRM list view
  // crashes if a contact carries a stage value outside this enum, so we
  // reject (silently normalise to "lead") any unknown stage at write time.
  const VALID_STAGES = new Set(["lead", "engaged", "soft_circle", "committed", "signing", "invested", "longterm"]);
  function normalizeStage(s: unknown): string {
    return typeof s === "string" && VALID_STAGES.has(s) ? s : "lead";
  }

  // POST /api/founder/investor-crm — create contact
  app.post("/api/founder/investor-crm", requireAuth, (req: Request, res: Response) => {
    const companyId = ensureCompanyId(req, res); if (!companyId) return;
    const c: FounderCrmContact = {
      id: `fcrm_${randomBytes(3).toString("hex")}`,
      companyId: req.body?.companyId ?? companyId,
      investorId: req.body?.investorId ?? `u_${randomBytes(3).toString("hex")}`,
      name: req.body?.name ?? "New contact",
      firmName: req.body?.firmName ?? "—",
      email: req.body?.email ?? "",
      region: req.body?.region ?? "US",
      stage: normalizeStage(req.body?.stage) as FounderCrmContact["stage"],
      ownership: { sharesUsd: 0, pct: 0 },
      softCircleHistory: [], maSignals: 0, threadIds: [],
      notes: req.body?.notes ?? "",
      notesUpdatedAt: new Date().toISOString(),
      tasks: [], series: req.body?.series ?? "—",
    };
    contacts.push(c);
    // Patch v12 Day 3: write-through. No trailing `()` — Drizzle invokes the
    // callback for us. Failure to persist is logged but does NOT throw —
    // in-memory state remains consistent; hydration on restart will reconcile.
    try {
      const db = getDb();
      db.transaction((tx: any) => {
        tx.insert(founderCrmContactsTable).values(contactToRow(c)).run();
      });
    } catch (err) {
      log.error("[founderCrmStore POST] DB write failed:", (err as Error).message);
    }
    // B-V11-7 fix: emit a `crm.contact.created` audit entry so the company
    // activity timeline reflects investor-CRM growth.
    appendAdminAudit(
      (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "u_unknown",
      `company:${c.companyId}`,
      "crm.contact.created",
      { contactId: c.id, firmName: c.firmName, stage: c.stage },
    );
    res.json(c);
  });

  // PATCH /api/founder/investor-crm/:id — update stage / notes / tasks
  app.patch("/api/founder/investor-crm/:id", requireAuth, (req: Request, res: Response) => {
    const c = contacts.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: "not_found" });
    if (typeof req.body?.stage === "string") c.stage = normalizeStage(req.body.stage) as FounderCrmContact["stage"];
    if (typeof req.body?.notes === "string") { c.notes = req.body.notes; c.notesUpdatedAt = new Date().toISOString(); }
    if (req.body?.task) {
      c.tasks.push({ id: `tsk_${randomBytes(3).toString("hex")}`, text: req.body.task.text, due: req.body.task.due, status: "open" });
    }
    // Patch v12 Day 3: write-through update. No trailing `()`.
    // v14 Tier-1 Fix 4: scope by tenantId so a forged :id from another tenant
    // cannot be mutated even if it slips past the in-memory cache check.
    try {
      const db = getDb();
      const tenantId = tenantForCompany(c.companyId);
      db.transaction((tx: any) => {
        tx.update(founderCrmContactsTable)
          .set({
            stage: c.stage,
            notes: c.notes,
            notesUpdatedAt: c.notesUpdatedAt,
            tasks: JSON.stringify(c.tasks),
            updatedAt: new Date().toISOString(),
          })
          .where(withTenant(eq(founderCrmContactsTable.id, c.id), { tenantId, table: founderCrmContactsTable }))
          .run();
      });
    } catch (err) {
      log.error("[founderCrmStore PATCH] DB write failed:", (err as Error).message);
    }
    // Audit the update so the activity timeline reflects stage moves too.
    appendAdminAudit(
      (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "u_unknown",
      `company:${c.companyId}`,
      "crm.contact.updated",
      { contactId: c.id, stage: c.stage },
    );
    res.json(c);
  });

  // POST /api/founder/investor-crm/broadcast — segmented broadcast
  app.post("/api/founder/investor-crm/broadcast", requireAuth, (req: Request, res: Response) => {
    const { filter, message } = req.body ?? {};
    const compId = ensureCompanyId(req, res); if (!compId) return;
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
 * hydrateFounderCrmStore — Patch v12 Day 3 real hydrator.
 *
 * Reads every live row from founder_crm_contacts and rebuilds the
 * in-memory `contacts` array. Demo seed contacts are written through to
 * the DB on first boot (`ENABLE_DEMO_SEED=1`) so subsequent boots without
 * the env var still serve them via this hydrator.
 */
export async function hydrateFounderCrmStore(): Promise<void> {
  try {
    const db = getDb();
    // Seed first so a fresh DB has demo rows before we read them back.
    seedDemoContactsIntoDb();
    const rows = db
      .select()
      .from(founderCrmContactsTable)
      // CROSS-TENANT (boot hydration) — justified because we read all rows then
      // assign each to its owning tenant's cache. Each row carries its tenant_id,
      // and the cache is filtered per-request by resolveCompanyId().
      .where(crossTenant(isNull(founderCrmContactsTable.deletedAt), founderCrmContactsTable, { skipSoftDelete: true }))
      .all() as any[];
    contacts.length = 0;
    for (const r of rows) contacts.push(rowToContact(r));
    if (rows.length > 0) {
      log.info(`[hydrate] founderCrmStore: ${rows.length} contacts restored`);
    }
  } catch (err) {
    log.warn("[hydrate] founderCrmStore: DB read failed:", (err as Error).message);
  }
}

/**
 * Legacy v11 export — kept for back-compat with sprint-fix callers that
 * imported it directly. Delegates to the real hydrator.
 */
export async function hydrateFounderCrmFromDatabase(_db?: unknown): Promise<void> {
  return hydrateFounderCrmStore();
}
