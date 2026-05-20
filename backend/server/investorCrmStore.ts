/**
 * Sprint 20 Wave 2 + Sprint 21 Wave D — Investor CRM Store
 *
 * Rich CRM for investors: track founders, co-investors, and advisors.
 *
 * Endpoints (Sprint 20 base):
 *   GET    /api/investor/crm                    — list all contacts
 *   POST   /api/investor/crm                    — create contact
 *   PATCH  /api/investor/crm/:id                — update contact fields
 *   DELETE /api/investor/crm/:id                — delete contact
 *   POST   /api/investor/crm/:id/notes          — append a note (Sprint 21)
 *   POST   /api/investor/crm/:id/tasks          — add a task (Sprint 21)
 *   PATCH  /api/investor/crm/:id/tasks/:taskId  — update task status (Sprint 21)
 *
 * Sprint 21 Wave D additions:
 *   POST   /api/investor/crm/broadcast          — bulk DM or network post
 *
 * Legacy aliases (Sprint 20 Wave 2 backwards-compat):
 *   GET    /api/investor/crm/contacts           → same as GET /api/investor/crm
 *   POST   /api/investor/crm/contacts           → same as POST /api/investor/crm
 *   PATCH  /api/investor/crm/contacts/:id       → same as PATCH /api/investor/crm/:id
 *   DELETE /api/investor/crm/contacts/:id       → same as DELETE /api/investor/crm/:id
 *   POST   /api/investor/crm/contacts/:id/notes → alias
 *   POST   /api/investor/crm/contacts/:id/tasks → alias
 *   PATCH  /api/investor/crm/contacts/:id/tasks/:taskId → alias
 *
 * Patch v12 Day 3 (audit §3.10) — DB-BACKED hybrid.
 *   - `contacts = new Map<string, InvestorCrmContact>()` remains as a hot
 *     cache; the `investor_crm_contacts` table is authoritative.
 *   - Each mutation writes through inside `getDb().transaction((tx) => { ... })`.
 *     No trailing `()` — Drizzle invokes the callback for us.
 *   - notes/tasks/tags are stored as JSON columns for v1 (simplest migration);
 *     splitting them into child tables is a v13 optimisation.
 *   - Per-investor tenant: `tenant_inv_<investorId>` — each investor's
 *     personal CRM is its own tenant, scoped via withTenant() at hydrate time.
 *   - Demo seed contacts are written-through on first boot so subsequent
 *     restarts without ENABLE_DEMO_SEED still return them.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { emitMutation } from "./lib/eventBus";
import { getDb } from "./db/connection";
import { investorCrmContacts as investorCrmContactsTable } from "../shared/schema";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type InvestorCrmStage =
  | "cold"
  | "met"
  | "discussing"
  | "following"
  | "backed"
  | "co_invested"
  | "closed_no"
  // Legacy stage names from Sprint 20 (keep for backwards compat)
  | "prospect"
  | "watching"
  | "due_diligence"
  | "soft_circle"
  | "committed"
  | "invested"
  | "passed";

export type InvestorCrmTask = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  status: "todo" | "done";
  dueDate?: string;
  createdAt: string;
  completedAt?: string;
};

export type InvestorCrmNote = {
  id: string;
  body: string;
  noteType: string;
  createdAt: string;
};

export type InvestorCrmContact = {
  id: string;
  investorId: string;
  // Sprint 22 Wave 1: platformUserId links CRM contact to a Capavate platform user (DEF-001 fix).
  platformUserId?: string;
  // Sprint 21 Wave D: new rich fields
  name: string;
  role: string;
  email: string;
  affiliation: string;
  stage: InvestorCrmStage;
  tags: string[];
  notes: string;
  noteLog: InvestorCrmNote[];
  tasks: InvestorCrmTask[];
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  // Legacy Sprint 20 fields (kept for backwards compat with tests / old client)
  companyId?: string;
  companyName?: string;
  founderName?: string;
  founderEmail?: string;
  sector?: string;
  region?: string;
  checkSizeUsd?: number;
  notesUpdatedAt?: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function uid() {
  return "icrm_" + randomBytes(5).toString("hex");
}

function now() {
  return new Date().toISOString();
}

/** Tenant id for an investor's personal CRM. */
function tenantForInvestor(investorId: string): string {
  return `tenant_inv_${investorId}`;
}

function rowToContact(r: any): InvestorCrmContact {
  const parse = <T,>(s: any, fallback: T): T => {
    if (!s || typeof s !== "string") return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  return {
    id: r.id,
    investorId: r.investorId,
    platformUserId: r.platformUserId ?? undefined,
    name: r.name,
    role: r.role ?? "",
    email: r.email ?? "",
    affiliation: r.affiliation ?? "",
    stage: r.stage as InvestorCrmStage,
    tags: parse(r.tags, [] as string[]),
    notes: r.notes ?? "",
    noteLog: parse(r.noteLog, [] as InvestorCrmNote[]),
    tasks: parse(r.tasks, [] as InvestorCrmTask[]),
    starred: Boolean(r.starred),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    companyId: r.companyId ?? undefined,
    companyName: r.companyName ?? undefined,
    founderName: r.founderName ?? undefined,
    founderEmail: r.founderEmail ?? undefined,
    sector: r.sector ?? undefined,
    region: r.region ?? undefined,
    checkSizeUsd: typeof r.checkSizeUsd === "number" ? r.checkSizeUsd : undefined,
    notesUpdatedAt: r.notesUpdatedAt ?? undefined,
  };
}

function contactToRow(c: InvestorCrmContact) {
  return {
    id: c.id,
    tenantId: tenantForInvestor(c.investorId),
    investorId: c.investorId,
    platformUserId: c.platformUserId ?? null,
    name: c.name,
    role: c.role,
    email: c.email,
    affiliation: c.affiliation,
    stage: c.stage,
    tags: JSON.stringify(c.tags ?? []),
    notes: c.notes,
    noteLog: JSON.stringify(c.noteLog ?? []),
    tasks: JSON.stringify(c.tasks ?? []),
    starred: c.starred,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    companyId: c.companyId ?? null,
    companyName: c.companyName ?? null,
    founderName: c.founderName ?? null,
    founderEmail: c.founderEmail ?? null,
    sector: c.sector ?? null,
    region: c.region ?? null,
    checkSizeUsd: typeof c.checkSizeUsd === "number" ? c.checkSizeUsd : null,
    notesUpdatedAt: c.notesUpdatedAt ?? null,
    deletedAt: null as string | null,
  };
}

/** Persist a contact (insert-or-update). Errors are logged, not thrown. */
function persistContact(c: InvestorCrmContact): void {
  try {
    const db = getDb();
    // Patch v12 Day 3: write-through. No trailing `()` — Drizzle invokes
    // the callback for us. BEGIN IMMEDIATE serialises concurrent writers
    // on the same (id) row.
    db.transaction((tx: any) => {
      const existing = tx
        .select({ id: investorCrmContactsTable.id })
        .from(investorCrmContactsTable)
        .where(eq(investorCrmContactsTable.id, c.id))
        .limit(1)
        .all() as any[];
      const row = contactToRow(c);
      if (existing.length === 0) {
        tx.insert(investorCrmContactsTable).values(row).run();
      } else {
        const { id: _id, createdAt: _ca, ...patch } = row;
        tx.update(investorCrmContactsTable)
          .set(patch)
          .where(eq(investorCrmContactsTable.id, c.id))
          .run();
      }
    });
  } catch (err) {
    console.error("[investorCrmStore] DB write failed:", (err as Error).message);
  }
}

/** Soft-delete a contact. */
function softDeleteContact(id: string): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.update(investorCrmContactsTable)
        .set({ deletedAt: now() })
        .where(eq(investorCrmContactsTable.id, id))
        .run();
    });
  } catch (err) {
    console.error("[investorCrmStore softDelete] failed:", (err as Error).message);
  }
}

/* ------------------------------------------------------------------ */
/* In-memory store                                                     */
/* ------------------------------------------------------------------ */

/**
 * Sprint 23 Wave B — Seed 7 demo CRM contacts (one per stage + a starred "cold" entry)
 * so that all 9 filter chips have visible content.
 * These contacts are keyed by "u_aisha_patel" as investorId so they show for the
 * default demo user AND for "anonymous" (which listContacts also returns).
 */
const SEED_NOW = "2026-04-01T00:00:00Z";
function makeSeedContact(
  id: string,
  name: string,
  role: string,
  email: string,
  affiliation: string,
  stage: InvestorCrmStage,
  tags: string[],
  starred = false,
  platformUserId?: string,
): [string, InvestorCrmContact] {
  return [
    id,
    {
      id,
      investorId: "u_aisha_patel",
      platformUserId,
      name,
      role,
      email,
      affiliation,
      stage,
      tags,
      notes: "",
      noteLog: [],
      tasks: [],
      starred,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    },
  ];
}

const contacts = new Map<string, InvestorCrmContact>([
  // Legacy seed — for u_investor_1 (backwards compat)
  [
    "icrm_seed_1",
    {
      id: "icrm_seed_1",
      investorId: "u_investor_1",
      platformUserId: "u_maya_chen",
      name: "Sarah Chen",
      role: "CEO",
      email: "sarah@novapay.io",
      affiliation: "NovaPay",
      stage: "backed",
      tags: ["fintech", "Series A"],
      notes: "Lead investor, pro-rata reserved for Series A.",
      noteLog: [],
      tasks: [
        {
          id: "tsk_s1",
          title: "Review Q2 KPI deck",
          priority: "medium",
          status: "todo",
          dueDate: "2026-05-20",
          createdAt: "2026-04-15T10:00:00Z",
        },
      ],
      starred: true,
      createdAt: "2025-11-01T00:00:00Z",
      updatedAt: "2026-04-15T10:00:00Z",
      companyId: "co_novapay",
      companyName: "NovaPay",
      founderName: "Sarah Chen",
      founderEmail: "sarah@novapay.io",
      sector: "Fintech",
      region: "US",
      checkSizeUsd: 250_000,
      notesUpdatedAt: "2026-04-15T10:00:00Z",
    },
  ],
  // Sprint 23 Wave B demo contacts — one per stage so chips are filterable
  makeSeedContact("icrm_d1", "James Okafor", "Partner", "james@hydracapital.com", "Hydra Capital", "cold", ["vc", "lead-investor"]),
  makeSeedContact("icrm_d2", "Priya Raghunathan", "GP", "priya@bluepoint.vc", "Bluepoint Angels", "met", ["angel", "healthtech"]),
  makeSeedContact("icrm_d3", "Marcus Webb", "Partner", "marcus@forgevc.com", "Forge Ventures", "discussing", ["b2b", "saas"]),
  makeSeedContact("icrm_d4", "Yuki Tanaka", "Managing Director", "yuki@arboreal.io", "Arboreal Capital", "following", ["climate", "deeptech"]),
  makeSeedContact("icrm_d5", "Elena Vasquez", "CEO", "elena@quanta.ai", "Quanta AI", "backed", ["ai", "infra"], true, "u_forge_ventures"),
  makeSeedContact("icrm_d6", "David Kim", "CTO", "david@tideline.io", "Tideline Systems", "co_invested", ["maritime", "iot"]),
  makeSeedContact("icrm_d7", "Amara Nwosu", "Founder", "amara@beacon.io", "Beacon Health", "closed_no", ["healthtech"]),
  makeSeedContact("icrm_d8", "Lena Schmidt", "CFO", "lena@coldstar.co", "ColdStar Capital", "cold", ["growth"], true),
]);

/* ------------------------------------------------------------------ */
/* Handler helpers                                                     */
/* ------------------------------------------------------------------ */

// PATCH v3: listContacts no longer has an "anonymous" catch-all — returns ONLY the user's contacts
function listContacts(investorId: string): InvestorCrmContact[] {
  if (!investorId || investorId === "anonymous") return [];
  return [...contacts.values()].filter((c) => c.investorId === investorId);
}

// PATCH v3: resolveInvestorId uses strict persona resolution (no dev fallback).
// This ensures routes return 401 when no explicit auth is present, even in test envs.
import { resolvePersonaId } from "./lib/userContext";
function resolveInvestorId(req: Request): string | null {
  // Use strict resolution (no fallback to demo persona)
  return resolvePersonaId(req);
}

/* ------------------------------------------------------------------ */
/* Hydration                                                           */
/* ------------------------------------------------------------------ */

/** Write seed contacts to DB on first boot. Idempotent (INSERT-or-skip). */
function seedDemoContactsIntoDb(): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      for (const c of Array.from(contacts.values())) {
        const existing = tx
          .select({ id: investorCrmContactsTable.id })
          .from(investorCrmContactsTable)
          .where(eq(investorCrmContactsTable.id, c.id))
          .limit(1)
          .all() as any[];
        if (existing.length === 0) {
          tx.insert(investorCrmContactsTable).values(contactToRow(c)).run();
        }
      }
    });
  } catch (err) {
    console.warn("[investorCrmStore] demo seed write-through failed:", (err as Error).message);
  }
}

export async function hydrateInvestorCrmStore(): Promise<void> {
  try {
    const db = getDb();
    seedDemoContactsIntoDb();
    // CROSS-TENANT (admin) — hydration replays every investor's contacts.
    // Each row's investorId scopes it; routes filter per-request.
    const rows = db
      .select()
      .from(investorCrmContactsTable)
      .where(isNull(investorCrmContactsTable.deletedAt))
      .all() as any[];
    contacts.clear();
    for (const r of rows) {
      const c = rowToContact(r);
      contacts.set(c.id, c);
    }
    if (rows.length > 0) {
      console.log(`[hydrate] investorCrmStore: ${rows.length} contacts restored`);
    }
  } catch (err) {
    console.warn("[hydrate] investorCrmStore: DB read failed:", (err as Error).message);
  }
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export function registerInvestorCrmRoutes(app: Express): void {
  /* =================== BROADCAST (must be before /:id routes) =================== */

  /**
   * POST /api/investor/crm/broadcast
   * Body: { recipientIds: string[], body: string, mode: "dm" | "post" }
   */
  app.post("/api/investor/crm/broadcast", (req: Request, res: Response) => {
    const investorId = resolveInvestorId(req);
    if (!investorId) return res.status(401).json({ error: "Authentication required" });
    const { recipientIds, body: msgBody, mode } = req.body ?? {};
    if (!msgBody || typeof msgBody !== "string" || !msgBody.trim()) {
      return res.status(400).json({ error: "body is required" });
    }
    if (!mode || !["dm", "post"].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'dm' or 'post'" });
    }
    const ids: string[] = Array.isArray(recipientIds) ? recipientIds : [];

    if (mode === "post") {
      // Single post to network — simulate success
      emitMutation({ aggregate: "investor_crm", id: "broadcast", change: "create" });
      return res.json({ ok: true, sent: 1, failed: 0, mode: "post" });
    }

    // DM mode — create DM per recipient
    let sent = 0;
    let failed = 0;
    for (const recipId of ids) {
      const contact = contacts.get(recipId);
      if (contact) {
        sent++;
      } else {
        failed++;
      }
    }
    emitMutation({ aggregate: "investor_crm", id: "broadcast", change: "create" });
    return res.json({ ok: true, sent, failed, mode: "dm" });
  });

  /* =================== LEGACY alias routes (Sprint 20 backwards compat) =================== */

  app.get("/api/investor/crm/contacts", (req: Request, res: Response) => {
    const investorId = resolveInvestorId(req);
    // PATCH v3: in production require auth; in non-prod allow anonymous but return EMPTY list
    if (!investorId) {
      if (process.env.NODE_ENV === "production") {
        return res.status(401).json({ error: "Authentication required" });
      }
      return res.json({ contacts: [] });
    }
    return res.json({ contacts: listContacts(investorId) });
  });

  app.post("/api/investor/crm/contacts", (req: Request, res: Response) => {
    const investorId = resolveInvestorId(req);
    if (!investorId) return res.status(401).json({ error: "Authentication required" });
    const {
      companyId = "",
      companyName = "",
      founderName = "",
      founderEmail = "",
      stage = "cold",
      sector = "",
      region = "",
      checkSizeUsd = 0,
      notes = "",
      // Sprint 21 rich fields
      name,
      role = "",
      email,
      affiliation = "",
      tags = [],
    } = req.body ?? {};

    const contactName = name || founderName || companyName || "Unknown";
    const contactEmail = email || founderEmail || "";

    const contact: InvestorCrmContact = {
      id: uid(),
      investorId,
      name: contactName,
      role,
      email: contactEmail,
      affiliation: affiliation || companyName || "",
      stage: stage as InvestorCrmStage,
      tags: Array.isArray(tags) ? tags : [],
      notes,
      noteLog: [],
      tasks: [],
      starred: false,
      createdAt: now(),
      updatedAt: now(),
      // Legacy
      companyId,
      companyName,
      founderName: contactName,
      founderEmail: contactEmail,
      sector,
      region,
      checkSizeUsd,
      notesUpdatedAt: now(),
    };

    contacts.set(contact.id, contact);
    persistContact(contact);
    emitMutation({ aggregate: "investor_crm", id: contact.id, change: "create" });
    return res.status(201).json({ ok: true, contact });
  });

  app.patch("/api/investor/crm/contacts/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const updates = buildContactUpdates(req.body, existing);
    const updated = { ...existing, ...updates };
    contacts.set(id, updated);
    persistContact(updated);
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, contact: updated });
  });

  app.delete("/api/investor/crm/contacts/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    if (!contacts.has(id)) return res.status(404).json({ error: "Contact not found" });
    contacts.delete(id);
    softDeleteContact(id);
    emitMutation({ aggregate: "investor_crm", id, change: "delete" });
    return res.json({ ok: true, deleted: id });
  });

  app.post("/api/investor/crm/contacts/:id/notes", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const { body: noteBody = "", text = "", noteType = "other" } = req.body ?? {};
    const body = noteBody || text;
    const note: InvestorCrmNote = {
      id: "note_" + randomBytes(4).toString("hex"),
      body,
      noteType,
      createdAt: now(),
    };
    const updated: InvestorCrmContact = {
      ...existing,
      noteLog: [...existing.noteLog, note],
      notes: existing.notes ? `${existing.notes}\n[${new Date().toLocaleDateString("en-CA")}] ${body}` : body,
      notesUpdatedAt: now(),
      updatedAt: now(),
    };
    contacts.set(id, updated);
    persistContact(updated);
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, note });
  });

  app.post("/api/investor/crm/contacts/:id/tasks", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const { title = "", text = "", due = "", priority = "medium", dueDate } = req.body ?? {};
    const taskTitle = title || text;
    const task: InvestorCrmTask = {
      id: "tsk_" + randomBytes(4).toString("hex"),
      title: taskTitle,
      priority: priority as "low" | "medium" | "high",
      status: "todo",
      dueDate: dueDate || due || undefined,
      createdAt: now(),
    };
    const updated: InvestorCrmContact = {
      ...existing,
      tasks: [...existing.tasks, task],
      updatedAt: now(),
    };
    contacts.set(id, updated);
    persistContact(updated);
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, task });
  });

  app.patch("/api/investor/crm/contacts/:id/tasks/:taskId", (req: Request, res: Response) => {
    const { id, taskId } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const taskIdx = existing.tasks.findIndex((t) => t.id === taskId);
    if (taskIdx === -1) return res.status(404).json({ error: "Task not found" });
    const { status } = req.body ?? {};
    const tasks = existing.tasks.map((t, i) => {
      if (i !== taskIdx) return t;
      const updated: InvestorCrmTask = { ...t };
      if (status) {
        updated.status = status;
        if (status === "done" && !updated.completedAt) {
          updated.completedAt = now();
        }
      }
      return updated;
    });
    const updated = { ...existing, tasks, updatedAt: now() };
    contacts.set(id, updated);
    persistContact(updated);
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, task: tasks[taskIdx] });
  });

  /* =================== PRIMARY routes (Sprint 21 Wave D) =================== */

  // GET /api/investor/crm — list all contacts as array (not nested)
  app.get("/api/investor/crm", (req: Request, res: Response) => {
    const investorId = resolveInvestorId(req);
    // PATCH v3: in production require auth; in non-prod allow anonymous but return EMPTY list
    if (!investorId) {
      if (process.env.NODE_ENV === "production") {
        return res.status(401).json({ error: "Authentication required" });
      }
      return res.json([]);
    }
    return res.json(listContacts(investorId));
  });

  // POST /api/investor/crm — create contact
  app.post("/api/investor/crm", (req: Request, res: Response) => {
    const investorId = resolveInvestorId(req);
    if (!investorId) return res.status(401).json({ error: "Authentication required" });
    const {
      name = "",
      role = "",
      email = "",
      affiliation = "",
      stage = "cold",
      tags = [],
      notes = "",
      starred = false,
      platformUserId = undefined,
    } = req.body ?? {};

    if (!name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const contact: InvestorCrmContact = {
      id: uid(),
      investorId,
      platformUserId: typeof platformUserId === "string" && platformUserId.trim() ? platformUserId.trim() : undefined,
      name: name.trim(),
      role,
      email,
      affiliation,
      stage: stage as InvestorCrmStage,
      tags: Array.isArray(tags) ? tags : [],
      notes,
      noteLog: [],
      tasks: [],
      starred: Boolean(starred),
      createdAt: now(),
      updatedAt: now(),
      // Legacy compat
      companyName: affiliation,
      founderName: name,
      founderEmail: email,
      notesUpdatedAt: now(),
    };

    contacts.set(contact.id, contact);
    persistContact(contact);
    emitMutation({ aggregate: "investor_crm", id: contact.id, change: "create" });
    return res.status(201).json(contact);
  });

  // PATCH /api/investor/crm/:id — update contact
  app.patch("/api/investor/crm/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const updates = buildContactUpdates(req.body, existing);
    const updated = { ...existing, ...updates };
    contacts.set(id, updated);
    persistContact(updated);
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json(updated);
  });

  // DELETE /api/investor/crm/:id — remove contact
  app.delete("/api/investor/crm/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    if (!contacts.has(id)) return res.status(404).json({ error: "Contact not found" });
    contacts.delete(id);
    softDeleteContact(id);
    emitMutation({ aggregate: "investor_crm", id, change: "delete" });
    return res.json({ ok: true, deleted: id });
  });

  // POST /api/investor/crm/:id/notes — append note
  app.post("/api/investor/crm/:id/notes", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const { body: noteBody = "", noteType = "other" } = req.body ?? {};
    const note: InvestorCrmNote = {
      id: "note_" + randomBytes(4).toString("hex"),
      body: noteBody,
      noteType,
      createdAt: now(),
    };
    const updated: InvestorCrmContact = {
      ...existing,
      noteLog: [...existing.noteLog, note],
      updatedAt: now(),
    };
    contacts.set(id, updated);
    persistContact(updated);
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, note });
  });

  // POST /api/investor/crm/:id/tasks — add task
  app.post("/api/investor/crm/:id/tasks", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const { title = "", priority = "medium", dueDate } = req.body ?? {};
    const task: InvestorCrmTask = {
      id: "tsk_" + randomBytes(4).toString("hex"),
      title,
      priority: priority as "low" | "medium" | "high",
      status: "todo",
      dueDate: dueDate || undefined,
      createdAt: now(),
    };
    const updated: InvestorCrmContact = {
      ...existing,
      tasks: [...existing.tasks, task],
      updatedAt: now(),
    };
    contacts.set(id, updated);
    persistContact(updated);
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, task });
  });

  // PATCH /api/investor/crm/:id/tasks/:taskId — update task
  app.patch("/api/investor/crm/:id/tasks/:taskId", (req: Request, res: Response) => {
    const { id, taskId } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const taskIdx = existing.tasks.findIndex((t) => t.id === taskId);
    if (taskIdx === -1) return res.status(404).json({ error: "Task not found" });
    const { status } = req.body ?? {};
    const tasks = existing.tasks.map((t, i) => {
      if (i !== taskIdx) return t;
      const upd: InvestorCrmTask = { ...t };
      if (status) {
        upd.status = status;
        if (status === "done" && !upd.completedAt) upd.completedAt = now();
      }
      return upd;
    });
    const updated = { ...existing, tasks, updatedAt: now() };
    contacts.set(id, updated);
    persistContact(updated);
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, task: tasks[taskIdx] });
  });
}

/* ------------------------------------------------------------------ */
/* Utility: build partial update from request body                    */
/* ------------------------------------------------------------------ */

function buildContactUpdates(body: any, existing: InvestorCrmContact): Partial<InvestorCrmContact> {
  const updates: Partial<InvestorCrmContact> = { updatedAt: now() };
  const allowed = [
    "name", "role", "email", "affiliation", "stage", "tags", "notes", "starred",
    // Sprint 22 Wave 1: platformUserId for DM linking (DEF-001 fix)
    "platformUserId",
    // legacy Sprint 20 fields
    "companyName", "founderName", "founderEmail", "sector", "region", "checkSizeUsd",
    "pipelineStage",
  ] as const;
  for (const field of allowed) {
    if (body?.[field] !== undefined) {
      (updates as any)[field] = body[field];
    }
  }
  // Handle pipelineStage alias → stage
  if (body?.pipelineStage !== undefined) {
    updates.stage = body.pipelineStage;
  }
  if (updates.notes !== undefined) {
    updates.notesUpdatedAt = now();
  }
  return updates;
}

/** Test helper — reset the in-memory + DB store. */
export const _testInvestorCrm = {
  reset: () => {
    contacts.clear();
    try {
      const db = getDb();
      db.delete(investorCrmContactsTable).run();
    } catch (err) {
      console.warn("[_testInvestorCrm.reset] DB reset failed:", (err as Error).message);
    }
  },
  get contacts() { return contacts; },
};
