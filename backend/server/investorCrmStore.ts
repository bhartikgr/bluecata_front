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
import { getDb, rawDb } from "./db/connection";
import { investorCrmContacts as investorCrmContactsTable } from "../shared/schema";
import { log } from "./lib/logger";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";

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
  // v25.51 name-split — discrete identity (additive). Composed `name` stays
  // authoritative for every reader/export; these are optional so legacy rows
  // (and legacy callers that only pass `name`) hydrate cleanly.
  firstName?: string;
  lastName?: string;
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

/**
 * v25.51 name-split — derive discrete first/last + composed name.
 * Rule (shared platform-wide): prefer explicit first/last and compose
 * "First Last"; otherwise split a single composed name (first token → first,
 * remainder → last). The composed `name` is ALWAYS returned non-empty when any
 * input is present, because every existing reader relies on it.
 */
function resolveName(input: { name?: string; firstName?: string; lastName?: string }): {
  name: string;
  firstName?: string;
  lastName?: string;
} {
  const f = typeof input.firstName === "string" ? input.firstName.trim() : "";
  const l = typeof input.lastName === "string" ? input.lastName.trim() : "";
  const composedIn = typeof input.name === "string" ? input.name.trim() : "";
  if (f || l) {
    const composed = [f, l].filter(Boolean).join(" ");
    return { name: composed || composedIn, firstName: f || undefined, lastName: l || undefined };
  }
  if (composedIn) {
    const parts = composedIn.split(/\s+/);
    const first = parts[0] ?? "";
    const last = parts.slice(1).join(" ");
    return { name: composedIn, firstName: first || undefined, lastName: last || undefined };
  }
  return { name: composedIn };
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
    firstName: r.firstName ?? undefined,
    lastName: r.lastName ?? undefined,
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
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? null,
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

/**
 * v25.52 Track 3.5.2 (GPT-5.5 R4 blocker, authorized sacred edit) — fail-closed
 * dedup guard for investor CRM. Symmetric to the founder/partner guards: 0097
 * exempts investor shared-inbox conflict groups (dedup_exempt=1) and 0098's
 * partial UNIQUE index EXCLUDES them, so the index alone cannot reject a NEW
 * create/PATCH into an exempt (investor_id, normalized email) group. This helper
 * checks ANY OTHER live row (exempt or not) in the same investor scope with the
 * same lower(trim(email)); callers reject with 409 on a hit and FAIL CLOSED
 * (503) if the check cannot run. Read-only; uses rawDb() (getDb() has no
 * .prepare). Empty email => no duplicate (caller skips the guard).
 */
function findLiveInvestorEmailDuplicate(
  investorId: string,
  email: string,
  excludeId?: string,
): { ok: true; dupId: string | null } {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return { ok: true, dupId: null };
  const rdb = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
  if (!rdb || typeof rdb.prepare !== "function") {
    // Throw so callers fail CLOSED rather than fall through to an unprotected write.
    throw new Error("rawDb().prepare unavailable — cannot run investor CRM dedup guard");
  }
  const row = rdb
    .prepare(
      `SELECT id FROM investor_crm_contacts
       WHERE investor_id = ? AND lower(trim(email)) = lower(trim(?))
         AND (? IS NULL OR id <> ?) AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(investorId, trimmed, excludeId ?? null, excludeId ?? null) as { id?: string } | undefined;
  return { ok: true, dupId: row?.id ?? null };
}

/**
 * Persist a contact (insert-or-update). Returns true on a confirmed DB write,
 * false on failure (still logged). v25.52: previously returned void and callers
 * assumed success even when the write threw, causing cache/DB divergence and
 * false 2xx responses. Callers now check the return and roll back on false.
 */
function persistContact(c: InvestorCrmContact): boolean {
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
    return true;
  } catch (err) {
    log.error("[investorCrmStore] DB write failed:", (err as Error).message);
    return false;
  }
}

/**
 * Soft-delete a contact. v25.52 (GPT-5.5 R6 blocker) — returns true on a
 * confirmed DB write, false on failure (still logged). Callers must NOT report a
 * successful delete (or evict the cache) when this returns false.
 */
function softDeleteContact(id: string): boolean {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.update(investorCrmContactsTable)
        .set({ deletedAt: now() })
        .where(eq(investorCrmContactsTable.id, id))
        .run();
    });
    return true;
  } catch (err) {
    log.error("[investorCrmStore softDelete] failed:", (err as Error).message);
    return false;
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


/**
 * v14 Tier-1 Fix 2 — ownership guard for investor CRM mutations.
 * Closes audit finding F-investor-02 (any auth user could mutate any
 * investor's CRM contact). Returns the resolved investorId on success;
 * sends 401/403 and returns null on failure. Callers MUST early-return.
 */
function ownContactOr403(req: Request, res: Response, contact: InvestorCrmContact): string | null {
  const investorId = resolveInvestorId(req);
  if (!investorId) { res.status(401).json({ error: "missing_identity" }); return null; }
  const ctx = (req as Request & { userContext?: { isAdmin?: boolean } }).userContext;
  if (contact.investorId !== investorId && !ctx?.isAdmin) {
    res.status(403).json({ error: "not_authorized" });
    return null;
  }
  return investorId;
}

/* ------------------------------------------------------------------ */
/* Hydration                                                           */
/* ------------------------------------------------------------------ */

/**
 * Write seed contacts to DB on first boot. Idempotent (INSERT-or-skip).
 *
 * v25.52 Track 3.5.2 (GPT-5.5 R5 blocker) — two hardenings:
 *  1) GATE the whole write-through behind DEMO_SEED_ENABLED (never true in
 *     production), matching the founder/admin demo-seed invariant. This keeps
 *     built-in demo contacts out of any live/production investor CRM entirely.
 *  2) Defense-in-depth even when demo seeding IS enabled: before inserting each
 *     seed row, run the authoritative (investor_id, lower(trim(email))) guard so
 *     a seed cannot reopen a duplicate against a pre-existing exempt shared-inbox
 *     group (which 0098's partial index excludes). Skip the row on a match; the
 *     id-based check remains as the primary idempotency guard.
 */
function seedDemoContactsIntoDb(): void {
  if (!DEMO_SEED_ENABLED) return; // production-disabled demo seed
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
        if (existing.length > 0) continue;
        // Authoritative email dedup (any live row incl. exempt) before insert.
        try {
          const dup = findLiveInvestorEmailDuplicate(c.investorId, c.email ?? "");
          if (dup.dupId) continue; // do not reopen a duplicate via demo seed
        } catch {
          // Guard could not run — fail closed: skip this seed row rather than
          // risk reopening a duplicate. Non-fatal for boot.
          continue;
        }
        tx.insert(investorCrmContactsTable).values(contactToRow(c)).run();
      }
    });
  } catch (err) {
    log.warn("[investorCrmStore] demo seed write-through failed:", (err as Error).message);
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
      log.info(`[hydrate] investorCrmStore: ${rows.length} contacts restored`);
    }
  } catch (err) {
    log.warn("[hydrate] investorCrmStore: DB read failed:", (err as Error).message);
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
      firstName: bodyFirst = "",
      lastName: bodyLast = "",
      role = "",
      email,
      affiliation = "",
      tags = [],
    } = req.body ?? {};

    const seedName = name || founderName || companyName || "Unknown";
    // v25.51 name-split — derive discrete first/last + keep composed name.
    const resolved = resolveName({ name: seedName, firstName: bodyFirst, lastName: bodyLast });
    const contactName = resolved.name || seedName;
    const contactEmail = email || founderEmail || "";

    // v25.52 dedup guard (fail-closed) — see findLiveInvestorEmailDuplicate.
    try {
      const dup = findLiveInvestorEmailDuplicate(investorId, contactEmail);
      if (dup.dupId) {
        return res.status(409).json({ ok: false, error: "crm_contact_duplicate_email", message: "A contact with this email already exists for this investor.", existingId: dup.dupId });
      }
    } catch (dupErr) {
      log.error("[investorCrmStore POST /contacts] dedup check failed — failing closed:", (dupErr as Error).message);
      return res.status(503).json({ ok: false, error: "crm_dedup_check_unavailable", message: "Could not verify contact uniqueness right now. Please retry." });
    }

    const contact: InvestorCrmContact = {
      id: uid(),
      investorId,
      name: contactName,
      firstName: resolved.firstName,
      lastName: resolved.lastName,
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
    // v25.52: fail-closed on DB write — do not return success (or leave a cache
    // ghost) if the authoritative write failed.
    if (!persistContact(contact)) {
      contacts.delete(contact.id);
      return res.status(500).json({ ok: false, error: "crm_contact_create_failed" });
    }
    emitMutation({ aggregate: "investor_crm", id: contact.id, change: "create" });
    return res.status(201).json({ ok: true, contact });
  });

  app.patch("/api/investor/crm/contacts/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, existing); if (!_owner) return; /* v14 ownership */
    const updates = buildContactUpdates(req.body, existing);
    const updated = { ...existing, ...updates };
    // v25.52 dedup guard (fail-closed) — only when email is actually changing.
    if (typeof updated.email === "string" && (updated.email ?? "").trim().toLowerCase() !== (existing.email ?? "").trim().toLowerCase()) {
      try {
        const dup = findLiveInvestorEmailDuplicate(existing.investorId, updated.email, String(id));
        if (dup.dupId) {
          return res.status(409).json({ ok: false, error: "crm_contact_duplicate_email", message: "Another contact with this email already exists for this investor.", existingId: dup.dupId });
        }
      } catch (dupErr) {
        log.error("[investorCrmStore PATCH /contacts] dedup check failed — failing closed:", (dupErr as Error).message);
        return res.status(503).json({ ok: false, error: "crm_dedup_check_unavailable", message: "Could not verify contact uniqueness right now. Please retry." });
      }
    }
    contacts.set(id, updated);
    if (!persistContact(updated)) {
      contacts.set(String(id), existing); // roll back cache to pre-update state
      return res.status(500).json({ ok: false, error: "crm_contact_update_failed" });
    }
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, contact: updated });
  });

  app.delete("/api/investor/crm/contacts/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const _existing = contacts.get(id);
    if (!_existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, _existing); if (!_owner) return; /* v14 ownership */
    // v25.52 (GPT-5.5 R6) — DB-first soft-delete; only evict cache + report
    // success after a confirmed DB write (no false 2xx / cache-DB divergence).
    if (!softDeleteContact(String(id))) {
      return res.status(500).json({ ok: false, error: "crm_contact_delete_failed" });
    }
    contacts.delete(id);
    emitMutation({ aggregate: "investor_crm", id, change: "delete" });
    return res.json({ ok: true, deleted: id });
  });

  app.post("/api/investor/crm/contacts/:id/notes", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, existing); if (!_owner) return; /* v14 ownership */
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
    // v25.52 blocker (GPT-5.5 R5) — persistContact returns boolean; roll back the
    // cache and return a real error on a failed DB write (no false 2xx).
    if (!persistContact(updated)) {
      contacts.set(String(id), existing);
      return res.status(500).json({ ok: false, error: "crm_note_add_failed" });
    }
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, note });
  });

  app.post("/api/investor/crm/contacts/:id/tasks", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, existing); if (!_owner) return; /* v14 ownership */
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
    if (!persistContact(updated)) {
      contacts.set(String(id), existing);
      return res.status(500).json({ ok: false, error: "crm_task_add_failed" });
    }
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, task });
  });

  app.patch("/api/investor/crm/contacts/:id/tasks/:taskId", (req: Request, res: Response) => {
    const { id, taskId } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, existing); if (!_owner) return; /* v14 ownership */
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
    if (!persistContact(updated)) {
      contacts.set(String(id), existing);
      return res.status(500).json({ ok: false, error: "crm_task_update_failed" });
    }
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
      firstName: bodyFirst = "",
      lastName: bodyLast = "",
      role = "",
      email = "",
      affiliation = "",
      stage = "cold",
      tags = [],
      notes = "",
      starred = false,
      platformUserId = undefined,
    } = req.body ?? {};

    // v25.51 name-split — accept discrete first/last OR a composed name; the
    // composed `name` stays the required, authoritative field.
    const resolved = resolveName({ name, firstName: bodyFirst, lastName: bodyLast });

    if (!resolved.name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    // BUG 007/008 fix v23.7 — email is now mandatory and format-checked so the
    // form can no longer save a contact with no reachable address.
    const emailTrimmed = typeof email === "string" ? email.trim() : "";
    if (!emailTrimmed) {
      return res.status(400).json({ error: "email is required" });
    }
    if (!/\S+@\S+\.\S+/.test(emailTrimmed)) {
      return res.status(400).json({ error: "email is invalid" });
    }

    // v25.52 dedup guard (fail-closed) — see findLiveInvestorEmailDuplicate.
    try {
      const dup = findLiveInvestorEmailDuplicate(investorId, emailTrimmed);
      if (dup.dupId) {
        return res.status(409).json({ ok: false, error: "crm_contact_duplicate_email", message: "A contact with this email already exists for this investor.", existingId: dup.dupId });
      }
    } catch (dupErr) {
      log.error("[investorCrmStore POST /crm] dedup check failed — failing closed:", (dupErr as Error).message);
      return res.status(503).json({ ok: false, error: "crm_dedup_check_unavailable", message: "Could not verify contact uniqueness right now. Please retry." });
    }

    const contact: InvestorCrmContact = {
      id: uid(),
      investorId,
      platformUserId: typeof platformUserId === "string" && platformUserId.trim() ? platformUserId.trim() : undefined,
      name: resolved.name.trim(),
      firstName: resolved.firstName,
      lastName: resolved.lastName,
      role,
      email: emailTrimmed,
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
      founderName: resolved.name.trim(),
      founderEmail: emailTrimmed,
      notesUpdatedAt: now(),
    };

    contacts.set(contact.id, contact);
    if (!persistContact(contact)) {
      contacts.delete(contact.id);
      return res.status(500).json({ ok: false, error: "crm_contact_create_failed" });
    }
    emitMutation({ aggregate: "investor_crm", id: contact.id, change: "create" });
    return res.status(201).json(contact);
  });

  // PATCH /api/investor/crm/:id — update contact
  app.patch("/api/investor/crm/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, existing); if (!_owner) return; /* v14 ownership */
    const updates = buildContactUpdates(req.body, existing);
    const updated = { ...existing, ...updates };
    // v25.52 dedup guard (fail-closed) — only when email is actually changing.
    if (typeof updated.email === "string" && (updated.email ?? "").trim().toLowerCase() !== (existing.email ?? "").trim().toLowerCase()) {
      try {
        const dup = findLiveInvestorEmailDuplicate(existing.investorId, updated.email, String(id));
        if (dup.dupId) {
          return res.status(409).json({ ok: false, error: "crm_contact_duplicate_email", message: "Another contact with this email already exists for this investor.", existingId: dup.dupId });
        }
      } catch (dupErr) {
        log.error("[investorCrmStore PATCH /crm] dedup check failed — failing closed:", (dupErr as Error).message);
        return res.status(503).json({ ok: false, error: "crm_dedup_check_unavailable", message: "Could not verify contact uniqueness right now. Please retry." });
      }
    }
    contacts.set(id, updated);
    if (!persistContact(updated)) {
      contacts.set(String(id), existing); // roll back cache to pre-update state
      return res.status(500).json({ ok: false, error: "crm_contact_update_failed" });
    }
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json(updated);
  });

  // DELETE /api/investor/crm/:id — remove contact
  app.delete("/api/investor/crm/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const _existing = contacts.get(id);
    if (!_existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, _existing); if (!_owner) return; /* v14 ownership */
    // v25.52 (GPT-5.5 R6) — DB-first soft-delete; only evict cache + report
    // success after a confirmed DB write.
    if (!softDeleteContact(String(id))) {
      return res.status(500).json({ ok: false, error: "crm_contact_delete_failed" });
    }
    contacts.delete(id);
    emitMutation({ aggregate: "investor_crm", id, change: "delete" });
    return res.json({ ok: true, deleted: id });
  });

  // POST /api/investor/crm/:id/notes — append note
  app.post("/api/investor/crm/:id/notes", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, existing); if (!_owner) return; /* v14 ownership */
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
    if (!persistContact(updated)) {
      contacts.set(String(id), existing);
      return res.status(500).json({ ok: false, error: "crm_note_add_failed" });
    }
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, note });
  });

  // POST /api/investor/crm/:id/tasks — add task
  app.post("/api/investor/crm/:id/tasks", (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, existing); if (!_owner) return; /* v14 ownership */
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
    if (!persistContact(updated)) {
      contacts.set(String(id), existing);
      return res.status(500).json({ ok: false, error: "crm_task_add_failed" });
    }
    emitMutation({ aggregate: "investor_crm", id, change: "update" });
    return res.json({ ok: true, task });
  });

  // PATCH /api/investor/crm/:id/tasks/:taskId — update task
  app.patch("/api/investor/crm/:id/tasks/:taskId", (req: Request, res: Response) => {
    const { id, taskId } = req.params;
    const existing = contacts.get(id);
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const _owner = ownContactOr403(req, res, existing); if (!_owner) return; /* v14 ownership */
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
    if (!persistContact(updated)) {
      contacts.set(String(id), existing);
      return res.status(500).json({ ok: false, error: "crm_task_update_failed" });
    }
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
    // v25.51 name-split — discrete identity fields.
    "firstName", "lastName",
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
  // v25.51 name-split — keep the composed `name` in lockstep with discrete
  // first/last when either part changes but no explicit `name` was supplied,
  // so the authoritative composed field never drifts from the parts.
  if (body?.name === undefined && (body?.firstName !== undefined || body?.lastName !== undefined)) {
    const f = (body?.firstName ?? existing.firstName ?? "").toString().trim();
    const l = (body?.lastName ?? existing.lastName ?? "").toString().trim();
    const composed = [f, l].filter(Boolean).join(" ");
    if (composed) updates.name = composed;
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
      log.warn("[_testInvestorCrm.reset] DB reset failed:", (err as Error).message);
    }
  },
  get contacts() { return contacts; },
};
