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
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import {
  pcrmContactSchema,
  pcrmNoteSchema,
  pcrmTaskSchema,
  type PcrmContact,
  type PcrmNote,
  type PcrmTask,
  type PcrmPipelineStage,
} from "@shared/schema";
import { emitSync } from "./sprint10Telemetry";
import { getUserContext } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";

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
  // A starter note + task on Maya
  const maya = aiContacts[0];
  notes.push({ id: newId("nt"), createdAt: new Date().toISOString(), contactId: maya.id, body: "Diligence call on cross-border rails. Asking about Adyen pipeline.", noteType: "call" });
  tasks.push({ id: newId("tk"), createdAt: new Date().toISOString(), contactId: maya.id, title: "Send Q1 board deck", priority: "high", status: "todo", dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) });
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
  return { ok: true, from, to, contact: c };
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
    res.json({ ok: true, task: t });
  });

  app.patch("/api/investor/crm/tasks/:id", (req: Request, res: Response) => {
    const t = tasks.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: "task_not_found" });
    const { status, completedAt } = req.body ?? {};
    if (status) t.status = status;
    if (completedAt) t.completedAt = completedAt;
    else if (status === "done" && !t.completedAt) t.completedAt = new Date().toISOString();
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
    res.json({ ok: true, removed: t });
  });
}
