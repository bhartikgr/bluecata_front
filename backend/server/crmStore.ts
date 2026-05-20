/**
 * Sprint 10 — Investor Personal CRM (pcrm_contacts, pcrm_notes, pcrm_tasks).
 *
 * PATCH v3 — Per-company data scoping:
 *   - Contacts store is now per-user (Map<userId, StoredContact[]>).
 *   - GET /api/investor/crm/contacts requires auth; returns only session user's contacts.
 *   - Seed contacts (Maya Chen, Forge Ventures, etc.) are ONLY seeded for u_aisha_patel.
 *   - New users get EMPTY contacts — no Maya/Forge/Hydra leakage.
 *   - All mutations stamp the session userId on the contact's owner field.
 *
 * Routes:
 *   GET    /api/investor/crm/contacts
 *   POST   /api/investor/crm/contacts
 *   PATCH  /api/investor/crm/contacts/:id
 *   DELETE /api/investor/crm/contacts/:id
 *   GET    /api/investor/crm/notes?contactId=...
 *   POST   /api/investor/crm/notes
 *   GET    /api/investor/crm/tasks?contactId=...
 *   POST   /api/investor/crm/tasks
 *   PATCH  /api/investor/crm/tasks/:id            (status / completion)
 *   DELETE /api/investor/crm/tasks/:id
 *
 * Telemetry events match `capavate_collective_sync_schema.md §9` shape:
 *   crm_contact_added, crm_note_added, crm_task_completed, crm_pipeline_moved.
 *
 * Patch v12 Day 3 (audit §3.9) — DB-BACKED hybrid.
 *   - `contactsByUser`, `notes`, `tasks` are now READ CACHES; the DB tables
 *     `pcrm_contacts`, `pcrm_notes`, `pcrm_tasks` are authoritative.
 *   - Every mutation writes through inside `getDb().transaction((tx) => { ... })`.
 *     No trailing `()` — Drizzle invokes the callback for us.
 *   - Tenant id: `tenant_inv_<ownerId>` (the investor's personal CRM tenant).
 *   - `hydrateCrmStore()` rebuilds all three caches from the DB on boot.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import {
  pcrmContactSchema,
  pcrmNoteSchema,
  pcrmTaskSchema,
  type PcrmContact,
  type PcrmNote,
  type PcrmTask,
  type PcrmPipelineStage,
} from "@shared/schema";
import {
  pcrmContacts as pcrmContactsTable,
  pcrmNotes as pcrmNotesTable,
  pcrmTasks as pcrmTasksTable,
} from "@shared/schema";
import { emitSync } from "./sprint10Telemetry";
import { getUserContext } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { getDb } from "./db/connection";

type StoredContact = PcrmContact & { id: string; createdAt: string; ownerId: string };
type StoredNote    = PcrmNote    & { id: string; createdAt: string };
type StoredTask    = PcrmTask    & { id: string; createdAt: string; completedAt?: string };

// PATCH v3: Per-user contact store. Keyed by userId.
const contactsByUser = new Map<string, StoredContact[]>();
const notes:    StoredNote[]    = [];
const tasks:    StoredTask[]    = [];

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** Tenant id for the personal CRM of an investor user. */
function tenantForOwner(ownerId: string): string {
  return `tenant_inv_${ownerId}`;
}

/* ---------- DB row mappers ---------- */

function contactToRow(c: StoredContact) {
  return {
    id: c.id,
    tenantId: tenantForOwner(c.ownerId),
    ownerId: c.ownerId,
    name: c.name,
    kind: c.kind,
    firm: c.firm ?? null,
    email: c.email ?? null,
    linkedin: c.linkedin ?? null,
    pipelineStage: c.pipelineStage,
    tags: JSON.stringify(c.tags ?? []),
    lanes: JSON.stringify(c.lanes ?? []),
    companyId: c.companyId ?? null,
    createdAt: c.createdAt,
    deletedAt: null as string | null,
  };
}

function rowToContact(r: any): StoredContact {
  const parse = <T,>(s: any, fallback: T): T => {
    if (!s || typeof s !== "string") return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  return {
    id: r.id,
    ownerId: r.ownerId,
    name: r.name,
    kind: r.kind as PcrmContact["kind"],
    firm: r.firm ?? undefined,
    email: r.email ?? undefined,
    linkedin: r.linkedin ?? undefined,
    pipelineStage: r.pipelineStage as PcrmPipelineStage,
    tags: parse(r.tags, [] as string[]),
    lanes: parse(r.lanes, [] as any[]),
    companyId: r.companyId ?? undefined,
    createdAt: r.createdAt,
  };
}

function noteToRow(n: StoredNote, ownerId: string) {
  return {
    id: n.id,
    tenantId: tenantForOwner(ownerId),
    contactId: n.contactId,
    body: n.body,
    noteType: n.noteType,
    createdAt: n.createdAt,
    deletedAt: null as string | null,
  };
}

function rowToNote(r: any): StoredNote {
  return {
    id: r.id,
    contactId: r.contactId,
    body: r.body,
    noteType: r.noteType,
    createdAt: r.createdAt,
  };
}

function taskToRow(t: StoredTask, ownerId: string) {
  return {
    id: t.id,
    tenantId: tenantForOwner(ownerId),
    contactId: t.contactId,
    title: t.title,
    dueDate: t.dueDate ?? null,
    priority: t.priority,
    status: t.status,
    completedAt: t.completedAt ?? null,
    createdAt: t.createdAt,
    deletedAt: null as string | null,
  };
}

function rowToTask(r: any): StoredTask {
  return {
    id: r.id,
    contactId: r.contactId,
    title: r.title,
    dueDate: r.dueDate ?? undefined,
    priority: r.priority,
    status: r.status,
    completedAt: r.completedAt ?? undefined,
    createdAt: r.createdAt,
  };
}

/* ---------- write-through helpers ---------- */

function persistContact(c: StoredContact): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      const existing = tx
        .select({ id: pcrmContactsTable.id })
        .from(pcrmContactsTable)
        .where(eq(pcrmContactsTable.id, c.id))
        .limit(1)
        .all() as any[];
      const row = contactToRow(c);
      if (existing.length === 0) {
        tx.insert(pcrmContactsTable).values(row).run();
      } else {
        const { id: _id, createdAt: _ca, ...patch } = row;
        tx.update(pcrmContactsTable)
          .set(patch)
          .where(eq(pcrmContactsTable.id, c.id))
          .run();
      }
    });
  } catch (err) {
    console.error("[crmStore persistContact] DB write failed:", (err as Error).message);
  }
}

function persistNote(n: StoredNote, ownerId: string): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(pcrmNotesTable).values(noteToRow(n, ownerId)).run();
    });
  } catch (err) {
    console.error("[crmStore persistNote] DB write failed:", (err as Error).message);
  }
}

function persistTask(t: StoredTask, ownerId: string): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      const existing = tx
        .select({ id: pcrmTasksTable.id })
        .from(pcrmTasksTable)
        .where(eq(pcrmTasksTable.id, t.id))
        .limit(1)
        .all() as any[];
      const row = taskToRow(t, ownerId);
      if (existing.length === 0) {
        tx.insert(pcrmTasksTable).values(row).run();
      } else {
        const { id: _id, createdAt: _ca, ...patch } = row;
        tx.update(pcrmTasksTable)
          .set(patch)
          .where(eq(pcrmTasksTable.id, t.id))
          .run();
      }
    });
  } catch (err) {
    console.error("[crmStore persistTask] DB write failed:", (err as Error).message);
  }
}

function softDeleteContactRow(id: string): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.update(pcrmContactsTable)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(pcrmContactsTable.id, id))
        .run();
    });
  } catch (err) {
    console.error("[crmStore softDeleteContact] failed:", (err as Error).message);
  }
}

function softDeleteTaskRow(id: string): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.update(pcrmTasksTable)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(pcrmTasksTable.id, id))
        .run();
    });
  } catch (err) {
    console.error("[crmStore softDeleteTask] failed:", (err as Error).message);
  }
}

/**
 * Get contacts for a specific user.
 * Returns empty array for new users — NEVER falls back to demo data.
 */
function getContactsForUser(userId: string): StoredContact[] {
  if (!userId) return [];
  // Lazy-seed ONLY for the demo investor persona, AND only when demo gate is on.
  if (DEMO_SEED_ENABLED && userId === "u_aisha_patel" && !contactsByUser.has(userId)) {
    seedDemoContacts();
  }
  return contactsByUser.get(userId) ?? [];
}

/** Seed demo contacts for u_aisha_patel ONLY. */
let demoSeeded = false;
function seedDemoContacts(): void {
  if (demoSeeded) return;
  demoSeeded = true;
  const seed: (PcrmContact & { ownerId: string })[] = [
    { ownerId: "u_aisha_patel", name: "Maya Chen",      kind: "founder",     firm: "NovaPay AI",       email: "maya@novapay.ai",       linkedin: "https://linkedin.com/in/mayachen",   pipelineStage: "soft_circle", tags: ["fintech", "lead"],  lanes: ["cap_table", "round"], companyId: "co_novapay" },
    { ownerId: "u_aisha_patel", name: "Daniel Okafor",  kind: "founder",     firm: "NovaPay AI",       email: "daniel@novapay.ai",     linkedin: "",                                   pipelineStage: "soft_circle", tags: ["fintech"],          lanes: ["cap_table", "round"], companyId: "co_novapay" },
    { ownerId: "u_aisha_patel", name: "Forge Ventures", kind: "co_investor", firm: "Forge Ventures",   email: "deals@forge.vc",        linkedin: "",                                   pipelineStage: "invested",    tags: ["lead", "warm"],     lanes: ["cap_table"],          companyId: "co_novapay" },
    { ownerId: "u_aisha_patel", name: "Hydra Capital",  kind: "co_investor", firm: "Hydra Capital",    email: "ir@hydra.capital",      linkedin: "",                                   pipelineStage: "invested",    tags: ["growth"],           lanes: ["cap_table", "dsc"],   companyId: "co_novapay" },
    { ownerId: "u_aisha_patel", name: "Hannah Park",    kind: "founder",     firm: "Helia AI",         email: "hp@helia.ai",           linkedin: "",                                   pipelineStage: "diligence",   tags: ["ai"],               lanes: ["cap_table", "social"], companyId: "co_helia" },
  ];
  const aiContacts: StoredContact[] = seed.map((c) => ({ ...c, id: newId("ct"), createdAt: new Date().toISOString() }));
  contactsByUser.set("u_aisha_patel", aiContacts);
  // Write-through to DB
  for (const c of aiContacts) persistContact(c);
  // A starter note + task on Maya
  const maya = aiContacts[0];
  const seedNote: StoredNote = { id: newId("nt"), createdAt: new Date().toISOString(), contactId: maya.id, body: "Diligence call on cross-border rails. Asking about Adyen pipeline.", noteType: "call" };
  notes.push(seedNote);
  persistNote(seedNote, "u_aisha_patel");
  const seedTask: StoredTask = { id: newId("tk"), createdAt: new Date().toISOString(), contactId: maya.id, title: "Send Q1 board deck", priority: "high", status: "todo", dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) };
  tasks.push(seedTask);
  persistTask(seedTask, "u_aisha_patel");
}

/** @deprecated — only for backward-compat with tests that call getAllContacts() */
export function getAllContacts(): StoredContact[] {
  // Return demo contacts for backward compat
  return getContactsForUser("u_aisha_patel");
}
export function getNotes(contactId?: string): StoredNote[] { return contactId ? notes.filter((n) => n.contactId === contactId) : notes.slice(); }
export function getTasks(contactId?: string): StoredTask[] { return contactId ? tasks.filter((t) => t.contactId === contactId) : tasks.slice(); }

export function clearCrm(): void {
  contactsByUser.clear(); notes.length = 0; tasks.length = 0; demoSeeded = false;
  // Patch v12 Day 3: also truncate the DB tables (used by tests for isolation).
  try {
    const db = getDb();
    db.delete(pcrmContactsTable).run();
    db.delete(pcrmNotesTable).run();
    db.delete(pcrmTasksTable).run();
  } catch (err) {
    console.warn("[crmStore.clearCrm] DB truncate failed:", (err as Error).message);
  }
}

/**
 * addContact - PATCH v3: ownerId param added.
 * Backward compat: when called as addContact(input) with 1 arg, uses demo ownerId.
 * New usage: addContact(input, userId) for scoped contact creation.
 */
export function addContact(input: PcrmContact, ownerId: string = "u_aisha_patel"): StoredContact {
  const c: StoredContact = { ...input, id: (input as StoredContact).id ?? newId("ct"), createdAt: new Date().toISOString(), ownerId };
  const userContacts = contactsByUser.get(ownerId) ?? [];
  userContacts.push(c);
  contactsByUser.set(ownerId, userContacts);
  persistContact(c);
  return c;
}

/**
 * movePipeline - PATCH v3: ownerId added for user-scoped lookup.
 * Backward compat: 2-arg form movePipeline(id, to) searches across all contacts (demo compat).
 * New usage: movePipeline(id, ownerId, to) for scoped update.
 */
export function movePipeline(id: string, ownerIdOrTo: string, toOrUndef?: PcrmPipelineStage): { ok: true; from: PcrmPipelineStage; to: PcrmPipelineStage; contact: StoredContact } | { ok: false; error: string } {
  let ownerId: string;
  let to: PcrmPipelineStage;
  if (toOrUndef !== undefined) {
    // 3-arg form: (id, ownerId, to)
    ownerId = ownerIdOrTo;
    to = toOrUndef;
  } else {
    // 2-arg legacy form: (id, to) — search across all users for backward compat with tests
    ownerId = "";
    to = ownerIdOrTo as PcrmPipelineStage;
  }
  // For legacy 2-arg calls, search all contacts globally
  const searchContacts = ownerId
    ? (contactsByUser.get(ownerId) ?? [])
    : Array.from(contactsByUser.values()).flat();
  const c = searchContacts.find((x) => x.id === id);
  if (!c) return { ok: false, error: "contact_not_found" };
  const from = c.pipelineStage;
  c.pipelineStage = to;
  persistContact(c);
  return { ok: true, from, to, contact: c };
}

/* ---------- Hydration ---------- */

export async function hydrateCrmStore(): Promise<void> {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — hydration replays every owner's pcrm into caches.
    const cRows = db
      .select()
      .from(pcrmContactsTable)
      .where(isNull(pcrmContactsTable.deletedAt))
      .all() as any[];
    contactsByUser.clear();
    for (const r of cRows) {
      const c = rowToContact(r);
      const arr = contactsByUser.get(c.ownerId) ?? [];
      arr.push(c);
      contactsByUser.set(c.ownerId, arr);
    }
    const nRows = db
      .select()
      .from(pcrmNotesTable)
      .where(isNull(pcrmNotesTable.deletedAt))
      .all() as any[];
    notes.length = 0;
    for (const r of nRows) notes.push(rowToNote(r));
    const tRows = db
      .select()
      .from(pcrmTasksTable)
      .where(isNull(pcrmTasksTable.deletedAt))
      .all() as any[];
    tasks.length = 0;
    for (const r of tRows) tasks.push(rowToTask(r));
    // Demo seed (only if DB empty AND demo gate on AND user_aisha_patel not present).
    if (DEMO_SEED_ENABLED && !contactsByUser.has("u_aisha_patel")) {
      seedDemoContacts();
    } else if (contactsByUser.has("u_aisha_patel")) {
      // Mark seeded so we don't double-seed via lazy path.
      demoSeeded = true;
    }
    const total = cRows.length + nRows.length + tRows.length;
    if (total > 0) {
      console.log(`[hydrate] crmStore: ${cRows.length} contacts, ${nRows.length} notes, ${tRows.length} tasks restored`);
    }
  } catch (err) {
    console.warn("[hydrate] crmStore: DB read failed:", (err as Error).message);
  }
}

export function registerCrmRoutes(app: Express): void {
  /* ---------- contacts ---------- */
  app.get("/api/investor/crm/contacts", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const userContacts = getContactsForUser(ctx.userId);
    res.json(userContacts);
  });

  app.post("/api/investor/crm/contacts", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const parsed = pcrmContactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    const c = addContact(parsed.data, ctx.userId);
    const env = emitSync({
      eventType: "crm_contact_added",
      aggregateId: c.id,
      aggregateKind: "contact",
      payload: { contactId: c.id, name: c.name, kind: c.kind, pipelineStage: c.pipelineStage, companyId: c.companyId },
      req,
    });
    res.json({ ok: true, contact: c, telemetry: env });
  });

  app.patch("/api/investor/crm/contacts/:id", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const userContacts = getContactsForUser(ctx.userId);
    const c = userContacts.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: "contact_not_found" });
    const parsed = pcrmContactSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    const oldStage = c.pipelineStage;
    Object.assign(c, parsed.data);
    persistContact(c);
    let env;
    if (parsed.data.pipelineStage && parsed.data.pipelineStage !== oldStage) {
      env = emitSync({
        eventType: "crm_pipeline_moved",
        aggregateId: c.id,
        aggregateKind: "contact",
        payload: { contactId: c.id, from: oldStage, to: parsed.data.pipelineStage },
        req,
      });
    }
    res.json({ ok: true, contact: c, telemetry: env });
  });

  app.delete("/api/investor/crm/contacts/:id", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const userContacts = getContactsForUser(ctx.userId);
    const idx = userContacts.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "contact_not_found" });
    const [c] = userContacts.splice(idx, 1);
    softDeleteContactRow(c.id);
    res.json({ ok: true, removed: c });
  });

  /* ---------- notes ---------- */
  app.get("/api/investor/crm/notes", (req: Request, res: Response) => {
    const contactId = typeof req.query.contactId === "string" ? req.query.contactId : undefined;
    res.json(getNotes(contactId));
  });

  app.post("/api/investor/crm/notes", (req: Request, res: Response) => {
    const parsed = pcrmNoteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    const n: StoredNote = { ...parsed.data, id: newId("nt"), createdAt: new Date().toISOString() };
    notes.push(n);
    // Use the requester's ownerId for tenant; fall back to "u_aisha_patel" for legacy clients.
    const ctx = getUserContext(req);
    const ownerId = ctx.isAuthed ? ctx.userId : "u_aisha_patel";
    persistNote(n, ownerId);
    const env = emitSync({
      eventType: "crm_note_added",
      aggregateId: n.contactId,
      aggregateKind: "contact",
      payload: { noteId: n.id, contactId: n.contactId, noteType: n.noteType },
      req,
    });
    res.json({ ok: true, note: n, telemetry: env });
  });

  /* ---------- tasks ---------- */
  app.get("/api/investor/crm/tasks", (req: Request, res: Response) => {
    const contactId = typeof req.query.contactId === "string" ? req.query.contactId : undefined;
    res.json(getTasks(contactId));
  });

  app.post("/api/investor/crm/tasks", (req: Request, res: Response) => {
    const parsed = pcrmTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    const t: StoredTask = { ...parsed.data, id: newId("tk"), createdAt: new Date().toISOString() };
    tasks.push(t);
    const ctx = getUserContext(req);
    const ownerId = ctx.isAuthed ? ctx.userId : "u_aisha_patel";
    persistTask(t, ownerId);
    res.json({ ok: true, task: t });
  });

  app.patch("/api/investor/crm/tasks/:id", (req: Request, res: Response) => {
    const t = tasks.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: "task_not_found" });
    const { status, completedAt } = req.body ?? {};
    if (status) t.status = status;
    if (completedAt) t.completedAt = completedAt;
    else if (status === "done" && !t.completedAt) t.completedAt = new Date().toISOString();
    const ctx = getUserContext(req);
    const ownerId = ctx.isAuthed ? ctx.userId : "u_aisha_patel";
    persistTask(t, ownerId);
    let env;
    if (status === "done") {
      env = emitSync({
        eventType: "crm_task_completed",
        aggregateId: t.contactId,
        aggregateKind: "contact",
        payload: { taskId: t.id, contactId: t.contactId },
        req,
      });
    }
    res.json({ ok: true, task: t, telemetry: env });
  });

  app.delete("/api/investor/crm/tasks/:id", (req: Request, res: Response) => {
    const idx = tasks.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "task_not_found" });
    const [t] = tasks.splice(idx, 1);
    softDeleteTaskRow(t.id);
    res.json({ ok: true, removed: t });
  });
}

/** Test helper — exposed for v12 persistence tests. */
export const _testCrm = {
  reset: clearCrm,
  get contactsByUser() { return contactsByUser; },
  get notes() { return notes; },
  get tasks() { return tasks; },
};
