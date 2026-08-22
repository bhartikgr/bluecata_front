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
import crypto, { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { emitSync } from "./sprint10Telemetry";
import { requireAuth } from "./lib/authMiddleware";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
// B-V11-7 fix: log CRM-contact creation events to the central audit log so the
// activity timeline (/api/founder/companies/:id/activity) surfaces them.
import { appendAdminAudit } from "./adminPlatformStore";
// v23.4.7 Phase 14 / BUG 011 — best-effort invite email when a founder adds
// a new investor to their CRM. The email send is best-effort (DB-first
// pattern); failures are logged but do not block the contact creation.
import { sendEmail } from "./lib/emailSender";
import { escapeHtml as e } from "./lib/htmlEscape"; /* v25.17 Lane A NH9 */
import { getDb, rawDb } from "./db/connection";
import { withTenant, crossTenant } from "./lib/withTenant"; /* v14 Tier-1 Fix 4 — tenant scoping on writes */
import { founderCrmContacts as founderCrmContactsTable } from "../shared/schema";
import { log } from "./lib/logger";

export type FounderCrmContact = {
  id: string;
  companyId: string;
  investorId: string;
  name: string;
  // v25.51 6a — discrete identity fields (per Ozan). Optional/nullable so
  // existing rows + callers that only send name/firmName still work.
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  firmName: string;
  email: string;
  region: string;
  // Sprint 14 D3 — 7-stage pipeline.
  // v25.48.3 Q-K1 — added `invited_unregistered` ("Invited – not registered")
  // and `prospect` (the renamed "lead"; "lead" is confusing vs. "lead
  // investor"). Legacy `lead`/`engaged` remain valid so existing DB rows never
  // break; they render under the "Prospect"/"Engaged" labels client-side.
  stage: "invited_unregistered" | "prospect" | "lead" | "engaged" | "soft_circle" | "committed" | "signing" | "invested" | "longterm";
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

/** v25.51 6a — trimmed string or null. */
function optCrmStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * v25.51 6a — compose the backward-compat display `name`. Prefer "First Last"
 * from the new discrete fields; fall back to a caller-supplied `name`, then to
 * the composed contact, then a safe default.
 */
function composeCrmName(body: Record<string, unknown> | undefined): string {
  const first = optCrmStr(body?.firstName);
  const last = optCrmStr(body?.lastName);
  const composed = [first, last].filter(Boolean).join(" ").trim();
  if (composed) return composed;
  const name = optCrmStr(body?.name);
  if (name) return name;
  const contact = optCrmStr(body?.primaryContact);
  if (contact) return contact;
  /* WAVE 93 · ITEM 1, sub-defect — "New contact" AS A PERSON'S NAME.
     The live site rendered "New contact data" / "New contact" as investor/holder
     IDENTITY in the cap table and in round invitations (register M-11). This
     line is where that string was born, and the question the wave had to settle
     was whether it is seed data or a live write path. IT IS A LIVE WRITE PATH:
     `POST /api/founder/crm/contacts` reaches here with `req.body`, and a body
     carrying no firstName, no lastName, no name and no primaryContact PERSISTED
     the words "New contact" into `founder_crm_contacts.name` — a placeholder
     promoted to identity, permanently, with no way for a reader to tell it apart
     from a person actually called that. (Grep evidence: the string appears in NO
     migration and NO seed script; only in this fallback, in the partner CRM
     equivalent, and as three legitimate dialog TITLES in client code.)
     The fallback is now an EMPTY string, and `registerFounderCrmRoutes`'s POST
     handler REFUSES a contact with no identifying field at all rather than
     inventing a name for it — see the `crm_contact_no_identity` refusal. An
     empty return can therefore only be reached by a caller that the refusal has
     already rejected; it is kept (rather than thrown) so no other caller of this
     helper can crash on a body it used to tolerate. */
  return "";
}

/**
 * WAVE 93 · ITEM 1, sub-defect — is there ANY identifying information here?
 *
 * A contact needs at least one of: a first name, a last name, a composed name,
 * a primary-contact name, an email address, or a firm/company name. With none of
 * those there is no person and no organisation — only a row, and the old code
 * gave that row the name "New contact".
 */
function crmBodyHasIdentity(body: Record<string, unknown> | undefined): boolean {
  return Boolean(
    optCrmStr(body?.firstName) ||
    optCrmStr(body?.lastName) ||
    optCrmStr(body?.name) ||
    optCrmStr(body?.primaryContact) ||
    optCrmStr(body?.email) ||
    optCrmStr(body?.companyName) ||
    optCrmStr(body?.firmName),
  );
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
    firstName: r.firstName ?? null,
    lastName: r.lastName ?? null,
    companyName: r.companyName ?? null,
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
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? null,
    companyName: c.companyName ?? null,
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

/**
 * B10 (v24.0 LOCKDOWN) — tenant guard for per-id CRM mutations.
 *
 * Before v24.0, PATCH/DELETE /api/founder/investor-crm/:id loaded the contact
 * by global id and mutated it with no check that the contact's company belongs
 * to the caller (CAP-P0 cross-tenant mutate). This verifies the contact's
 * companyId is owned by the caller (or caller is admin). Returns true when the
 * caller may mutate; otherwise writes a 404 (not 403, to avoid id enumeration)
 * and returns false.
 */
function callerOwnsContactCompany(req: Request, res: Response, contactCompanyId: string): boolean {
  const ctx = (req as any).userContext;
  if (ctx?.isAdmin) return true;
  const companies: Array<{ companyId: string }> = Array.isArray(ctx?.founder?.companies)
    ? ctx.founder.companies
    : [];
  if (companies.some((c) => c.companyId === contactCompanyId)) return true;
  res.status(404).json({ error: "not_found" });
  return false;
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
    // v25.1 Bug 5 fix (Avi prod report 11-Jun):
    // The in-memory `contacts` array is per-worker in PM2 cluster mode. An
    // invitation upserted on worker 1 writes to DB but only worker 1's `contacts`
    // gets the push; worker 2's GET would miss it. Read from DB on each GET so
    // every worker sees consistent state. The in-memory array stays as a fast
    // path for filtering / mutations; we just refresh it before responding.
    try {
      const driver = rawDb() as unknown as { prepare?: (sql: string) => { all: (...a: unknown[]) => unknown[] } };
      if (driver && typeof driver.prepare === "function") {
        // v25.51 name-split — the physical columns are snake_case; alias them
        // to the camelCase keys rowToContact expects, and PROJECT the new
        // first_name/last_name/company_name discrete fields so the founder CRM
        // list surfaces them. `deleted_at IS NULL` mirrors the cache/hydrate
        // semantics so soft-deleted rows are not resurrected on refresh.
        const rows = driver.prepare(
          `SELECT id, tenant_id AS tenantId, company_id AS companyId, investor_id AS investorId,
                  name, first_name AS firstName, last_name AS lastName, company_name AS companyName,
                  firm_name AS firmName, email, region, stage,
                  ownership, soft_circle_history AS softCircleHistory, ma_signals AS maSignals,
                  thread_ids AS threadIds, notes, notes_updated_at AS notesUpdatedAt, tasks, series
           FROM founder_crm_contacts WHERE company_id = ? AND deleted_at IS NULL`
        ).all(companyId) as any[];
        // Merge: drop any in-memory cached contacts for this companyId, then
        // re-push the fresh DB rows. Keeps other companies' caches intact.
        for (let i = contacts.length - 1; i >= 0; i--) {
          if (contacts[i].companyId === companyId) contacts.splice(i, 1);
        }
        for (const r of rows) {
          try { contacts.push(rowToContact(r)); } catch { /* skip malformed row */ }
        }
      }
    } catch (err) {
      log.warn("[GET /api/founder/crm/contacts] DB refresh failed (serving from cache):", (err as Error).message);
    }
    res.json(contacts.filter((c) => c.companyId === companyId));
  });

  // B-V11-2 fix: server-side pipeline-stage validator. The CRM list view
  // crashes if a contact carries a stage value outside this enum, so we
  // reject (silently normalise to "lead") any unknown stage at write time.
  const VALID_STAGES = new Set(["invited_unregistered", "prospect", "lead", "engaged", "soft_circle", "committed", "signing", "invested", "longterm"]);
  function normalizeStage(s: unknown): string {
    return typeof s === "string" && VALID_STAGES.has(s) ? s : "prospect"; /* v25.48.3 Q-K1: default to prospect (was legacy lead) */
  }

  function normalizeRegion(r: unknown): string {
    return typeof r === "string" ? r.trim().toUpperCase() : "US";
  }

  // POST /api/founder/investor-crm — create contact
  // v23.4.7 Phase 14 / BUG 011 — the founder can now optionally have the new
  // investor receive an invitation email with a redemption link. The endpoint
  // also checks whether the email is already a known user (so the client can
  // surface a friendlier "already in the system" hint).
  app.post("/api/founder/investor-crm", requireAuth, async (req: Request, res: Response) => {
    const companyId = ensureCompanyId(req, res); if (!companyId) return;
    /* WAVE 93 · ITEM 1, sub-defect — REFUSE A NAMELESS CONTACT RATHER THAN
       INVENTING ONE. Before this, a body with no identifying field at all was
       accepted and stored with `name: "New contact"`, which then rendered as
       investor/holder IDENTITY in the founder cap table and in round invitations
       (register M-11). A placeholder must never become a person. Nothing is
       written; the caller is told exactly what is missing. */
    if (!crmBodyHasIdentity(req.body as Record<string, unknown> | undefined)) {
      return res.status(400).json({
        ok: false,
        error: "crm_contact_no_identity",
        message: "A contact needs at least a name, an email address, or a firm name. Nothing was saved.",
      });
    }
    const incomingEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const sendInvite = !!req.body?.sendInvite;

    // v25.52 Track 3.5.2 (GPT-5.5 blocker #1) — PRE-INSERT dedup guard.
    // The partial UNIQUE index (0098) EXCLUDES dedup_exempt=1 rows, so for a
    // shared-inbox email that already has 2+ exempt conflict rows the index
    // holds ZERO entries and a NEW non-exempt insert would NOT collide — silently
    // reopening "many Johns" for exactly that edge case. We therefore reject a
    // duplicate BEFORE inserting by checking ANY live row (exempt OR not) with
    // the same (company_id, normalized email). This makes the guard correct
    // independent of the index's exempt-exclusion, and covers the window before
    // the index even exists. Read-only; sacred/money paths untouched.
    if (incomingEmail) {
      try {
        // Use rawDb() (the raw better-sqlite3 handle) — getDb() returns the
        // Drizzle wrapper which has NO .prepare, so a getDb().prepare guard
        // would silently no-op. rawDb() is the pattern used elsewhere in this
        // file (e.g. the GET refresh + auth lookups) and shares the same
        // underlying connection, so it sees committed rows including the
        // dedup_exempt shared-inbox conflict rows that the partial index skips.
        const gdb = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
        // No usable prepare() => we cannot run the guard. Throw so the catch
        // below fails CLOSED rather than silently falling through to an insert
        // the partial index cannot protect for exempt rows.
        if (!gdb || typeof gdb.prepare !== "function") {
          throw new Error("rawDb().prepare unavailable — cannot run pre-insert dedup guard");
        }
        const dup = gdb
          .prepare(
            `SELECT * FROM founder_crm_contacts
             WHERE company_id = ? AND lower(trim(email)) = lower(trim(?))
               AND deleted_at IS NULL
             LIMIT 1`,
          )
          .get(companyId, incomingEmail) as Record<string, unknown> | undefined;
        if (dup) {
          let existing: FounderCrmContact | undefined;
          try { existing = rowToContact(dup); } catch { /* shape drift — ignore */ }
          return res.status(409).json({
            ok: false,
            error: "crm_contact_duplicate_email",
            message: "A contact with this email already exists for this company.",
            existing: existing ?? null,
          });
        }
      } catch (dupErr) {
        // FAIL CLOSED (GPT-5.5 blocker #1, v25.52 re-review). The partial UNIQUE
        // index (0098) EXCLUDES dedup_exempt=1 rows, so for an exempt shared-inbox
        // group the index holds ZERO entries and CANNOT reject a new duplicate.
        // The pre-insert guard is the ONLY protection for that case, so if it
        // cannot execute we must NOT fall through to an unprotected insert (that
        // would silently reopen "many Johns"). Reject with 503 so the caller can
        // retry; no row is written. Non-money/non-cap-table path, but we still
        // apply the fail-closed rule because a silent duplicate defeats the whole
        // dedup guarantee. (A missing/empty email skips this block entirely, so
        // legitimate email-less contacts are unaffected.)
        log.error("[founderCrmStore POST] pre-insert dedup check failed — failing closed:", (dupErr as Error).message);
        return res.status(503).json({
          ok: false,
          error: "crm_dedup_check_unavailable",
          message: "Could not verify contact uniqueness right now. Please retry.",
        });
      }
    }

    // Check for an existing user up-front so the response can surface it even
    // if the contact persists successfully.
    let existingUserId: string | null = null;
    if (incomingEmail) {
      try {
        const db = getDb();
        // SQLite path used elsewhere in this codebase; safe to fall through
        // gracefully if `prepare` is not available on the driver.
        const driver = db as unknown as { prepare?: (sql: string) => { get: (...args: unknown[]) => unknown } };
        if (typeof driver.prepare === "function") {
          const row = driver.prepare(`SELECT id FROM auth_users WHERE lower(email) = ?`).get(incomingEmail.toLowerCase()) as
            | { id: string } | undefined;
          if (row?.id) existingUserId = row.id;
        }
      } catch (err) {
        log.warn("[founderCrmStore POST] existing-user lookup failed:", (err as Error).message);
      }
    }

    const c: FounderCrmContact = {
      id: `fcrm_${randomBytes(3).toString("hex")}`,
      // v24.1 Bug J (BUG 043) — always bind the contact to the authenticated
      // founder's company (resolved by ensureCompanyId above). Trusting a
      // caller-supplied body.companyId let a contact be written under a
      // different company than the session owner, defeating the per-company
      // dedupe and leaking rows across tenants.
      companyId,
      investorId: req.body?.investorId ?? `u_${randomBytes(3).toString("hex")}`,
      // v25.51 6a — persist discrete first/last/company. Compose the legacy
      // `name` from "First Last" when supplied, and map company → firmName, so
      // existing readers/exports (which key off name/firmName) keep working.
      name: composeCrmName(req.body),
      firstName: optCrmStr(req.body?.firstName),
      lastName: optCrmStr(req.body?.lastName),
      companyName: optCrmStr(req.body?.companyName),
      firmName: optCrmStr(req.body?.companyName) ?? (typeof req.body?.firmName === "string" && req.body.firmName.trim() ? req.body.firmName.trim() : "—"),
      email: req.body?.email ?? "",
      region: normalizeRegion(req.body?.region ?? "US"),
      stage: normalizeStage(req.body?.stage) as FounderCrmContact["stage"],
      ownership: { sharesUsd: 0, pct: 0 },
      softCircleHistory: [], maSignals: 0, threadIds: [],
      notes: req.body?.notes ?? "",
      notesUpdatedAt: new Date().toISOString(),
      tasks: [], series: req.body?.series ?? "—",
    };
    // v23.4.5 BUG 013 fix: DB-FIRST write order. Previous behaviour pushed to
    // in-memory cache before attempting DB persist; a silent DB failure left
    // the contact visible only in the cache, and a restart wiped it ("CRM data
    // lost overnight"). Now we INSERT into founder_crm_contacts FIRST. Only if
    // the DB write succeeds do we add to the read cache. On failure, return
    // 500 so the client can surface the problem instead of silently dropping.
    try {
      const db = getDb();
      db.transaction((tx: any) => {
        tx.insert(founderCrmContactsTable).values(contactToRow(c)).run();
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // v25.52 Track 3.5.2 — the new partial UNIQUE index
      // uq_founder_crm_email_scope (migration 0098) rejects a second live
      // contact with the same (company_id, lower(trim(email))). Surface a
      // graceful 409 that points the caller at the EXISTING contact instead of
      // a generic 500 — this is the dedup guard on the create path (no new
      // "many Johns"). We look the existing row up read-only; the sacred/money
      // paths are untouched.
      if (/UNIQUE constraint failed/i.test(msg) && /email/i.test(msg) && incomingEmail) {
        let existing: FounderCrmContact | undefined;
        try {
          // rawDb() — see note on the pre-insert guard above; getDb() has no
          // .prepare so this must use the raw better-sqlite3 handle.
          const db = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
          if (db && typeof db.prepare === "function") {
            const row = db
              .prepare(
                `SELECT * FROM founder_crm_contacts
                 WHERE company_id = ? AND lower(trim(email)) = lower(trim(?))
                   AND deleted_at IS NULL
                 LIMIT 1`,
              )
              .get(companyId, incomingEmail) as Record<string, unknown> | undefined;
            if (row) { try { existing = rowToContact(row); } catch { /* shape drift — ignore */ } }
          }
        } catch (lookupErr) {
          log.warn("[founderCrmStore POST] dup-existing lookup failed:", (lookupErr as Error).message);
        }
        return res.status(409).json({
          ok: false,
          error: "crm_contact_duplicate_email",
          message: "A contact with this email already exists for this company.",
          existing: existing ?? null,
        });
      }
      log.error("[founderCrmStore POST] DB write failed:", msg);
      return res.status(500).json({ ok: false, error: "crm_contact_persist_failed" });
    }
    contacts.push(c);
    // B-V11-7 fix: emit a `crm.contact.created` audit entry so the company
    // activity timeline reflects investor-CRM growth.
    appendAdminAudit(
      (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "u_unknown",
      `company:${c.companyId}`,
      "crm.contact.created",
      { contactId: c.id, firmName: c.firmName, stage: c.stage },
    );

    // v23.4.7 Phase 14 / BUG 011 — optional invite email. We always mint a
    // redemption token BEFORE the email send so a transient SMTP failure
    // leaves a usable invite the founder/admin can resend later (same pattern
    // as Phase 1 partner-approval emails).
    let invitedUserId: string | null = null;
    let inviteSent = false;
    if (sendInvite && incomingEmail && !existingUserId) {
      try {
        const tokenRaw = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(tokenRaw).digest("hex");
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString();
        const tokenId = `tk_${crypto.randomBytes(6).toString("hex")}`;
        invitedUserId = tokenId;
        try {
          const db = getDb();
          const driver = db as unknown as { prepare?: (sql: string) => { run: (...args: unknown[]) => unknown } };
          if (typeof driver.prepare === "function") {
            driver.prepare(
              `INSERT INTO auth_redeem_tokens (id, token_hash, email, intent, expires_at, created_at)
               VALUES (?, ?, ?, 'invite', ?, ?)`,
            ).run(tokenId, tokenHash, incomingEmail.toLowerCase(), expiresAt, new Date().toISOString());
          }
        } catch (dbErr) {
          log.warn("[founderCrmStore POST] invite token persist failed:", (dbErr as Error).message);
        }
        const appUrl = (process.env.APP_URL ?? "http://localhost:5000").replace(/\/$/, "");
        const redeemUrl = `${appUrl}/auth/redeem?token=${tokenRaw}`;
        try {
          await sendEmail({
            to: incomingEmail,
            subject: `You have been invited to connect on Capavate`,
            text: `${c.firmName === "—" ? "A founder" : c.firmName} invited you to connect on Capavate.\n\nUse this link (valid for 14 days) to set up your account:\n${redeemUrl}\n`,
            html: `<p>${e(c.firmName === "—" ? "A founder" : c.firmName)} invited you to connect on Capavate.</p><p><a href="${e(redeemUrl)}">Set up your account</a></p><p>The link is valid for 14 days.</p>` /* v25.17 Lane A NH9: escape user-controlled firmName + redeemUrl */,
            category: "crm_invite",
            refId: tokenId,
          });
          inviteSent = true;
        } catch (emailErr) {
          log.warn("[founderCrmStore POST] invite email failed (token still minted)", { error: (emailErr as Error).message });
        }
      } catch (err) {
        log.warn("[founderCrmStore POST] invite flow failed", (err as Error).message);
      }
    }

    res.json({
      ...c,
      // Non-breaking augmentation: response still includes every contact field
      // the existing client expects. New fields are additive.
      existingUser: !!existingUserId,
      existingUserId,
      inviteSent,
      invitedUserId,
    });
  });

  // PATCH /api/founder/investor-crm/:id — update stage / notes / tasks / contact fields
  // v23.4.5 BUG 009 fix: PATCH now also accepts name/firmName/email/region/series
  // so the founder-side CRM "Edit" button can perform a full contact update.
  app.patch("/api/founder/investor-crm/:id", requireAuth, (req: Request, res: Response) => {
    const c = contacts.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: "not_found" });
    // B10 (v24.0) — verify the contact's company belongs to the caller before
    // any mutation, closing the cross-tenant CRM mutate hole.
    if (!callerOwnsContactCompany(req, res, c.companyId)) return;

    // v25.52 Track 3.5.2 (GPT-5.5 R3 blocker) — PRE-UPDATE email dedup guard.
    // Symmetric to the create-path guard: the 0098 partial UNIQUE index EXCLUDES
    // dedup_exempt=1 rows, so changing this contact's email to one that only
    // exists on an exempt shared-inbox group would NOT be rejected by the index
    // and would reopen "many Johns" via PATCH. We therefore reject the update
    // BEFORE any mutation if the NEW email matches ANY OTHER live row (exempt or
    // not) in the same company. FAIL CLOSED (503) if the guard cannot execute.
    // Only runs when email is actually being changed to a non-empty value.
    if (typeof req.body?.email === "string") {
      const nextEmail = req.body.email.trim();
      const emailChanged = nextEmail.toLowerCase() !== (c.email ?? "").trim().toLowerCase();
      if (nextEmail && emailChanged) {
        try {
          const gdb = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
          if (!gdb || typeof gdb.prepare !== "function") {
            throw new Error("rawDb().prepare unavailable — cannot run pre-update dedup guard");
          }
          const dup = gdb
            .prepare(
              `SELECT id FROM founder_crm_contacts
               WHERE company_id = ? AND lower(trim(email)) = lower(trim(?))
                 AND id <> ? AND deleted_at IS NULL
               LIMIT 1`,
            )
            .get(c.companyId, nextEmail, c.id) as { id?: string } | undefined;
          if (dup) {
            return res.status(409).json({
              ok: false,
              error: "crm_contact_duplicate_email",
              message: "Another contact with this email already exists for this company.",
              existingId: dup.id ?? null,
            });
          }
        } catch (dupErr) {
          log.error("[founderCrmStore PATCH] pre-update dedup check failed — failing closed:", (dupErr as Error).message);
          return res.status(503).json({
            ok: false,
            error: "crm_dedup_check_unavailable",
            message: "Could not verify contact uniqueness right now. Please retry.",
          });
        }
      }
    }

    // v25.52 Track 3.5.2 (GPT-5.5 R3 blocker) — snapshot BEFORE mutating the
    // in-memory cache object so we can ROLL BACK if the DB write fails. Prior
    // behaviour mutated `c` in place, and on a DB error logged it but still
    // returned res.json(c) (HTTP 200) — leaving the caller with a false success
    // and cache/DB divergence. We now restore the snapshot and return an error.
    const prevSnapshot: FounderCrmContact = JSON.parse(JSON.stringify(c));

    if (typeof req.body?.stage === "string") c.stage = normalizeStage(req.body.stage) as FounderCrmContact["stage"];
    if (typeof req.body?.notes === "string") { c.notes = req.body.notes; c.notesUpdatedAt = new Date().toISOString(); }
    // v25.51 name-split — accept discrete first/last/company edits. When either
    // name part changes, recompose the legacy `name` as "First Last" so all
    // name-keyed readers/exports stay consistent. A caller-supplied `name` still
    // wins if it is sent explicitly (handled just below).
    const firstChanged = typeof req.body?.firstName === "string";
    const lastChanged = typeof req.body?.lastName === "string";
    if (firstChanged) c.firstName = optCrmStr(req.body.firstName);
    if (lastChanged) c.lastName = optCrmStr(req.body.lastName);
    if (typeof req.body?.companyName === "string") {
      c.companyName = optCrmStr(req.body.companyName);
      // Mirror company → firmName (matches POST) so firm-keyed readers align.
      c.firmName = c.companyName ?? c.firmName;
    }
    if (firstChanged || lastChanged) {
      const composed = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      if (composed) c.name = composed;
    }
    if (typeof req.body?.name === "string" && req.body.name.trim().length > 0) c.name = req.body.name.trim();
    if (typeof req.body?.firmName === "string") c.firmName = req.body.firmName.trim() || "—";
    if (typeof req.body?.email === "string") c.email = req.body.email.trim();
    if (typeof req.body?.region === "string") c.region = normalizeRegion(req.body.region);
    if (typeof req.body?.series === "string") c.series = req.body.series.trim() || "—";
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
            name: c.name,
            firstName: c.firstName ?? null,
            lastName: c.lastName ?? null,
            companyName: c.companyName ?? null,
            firmName: c.firmName,
            email: c.email,
            region: c.region,
            series: c.series,
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
      const msg = (err as Error).message ?? String(err);
      // v25.52 Track 3.5.2 (GPT-5.5 R3 blocker) — DO NOT swallow the DB failure
      // and return success. Roll the in-memory cache object back to its
      // pre-mutation snapshot, then surface the real error. A UNIQUE-index
      // collision on email (0098) becomes a graceful 409; anything else is a 500.
      Object.assign(c, prevSnapshot);
      if (/UNIQUE constraint failed/i.test(msg) && /email/i.test(msg)) {
        log.warn("[founderCrmStore PATCH] duplicate-email update rejected by index:", msg);
        return res.status(409).json({
          ok: false,
          error: "crm_contact_duplicate_email",
          message: "Another contact with this email already exists for this company.",
        });
      }
      log.error("[founderCrmStore PATCH] DB write failed:", msg);
      return res.status(500).json({ ok: false, error: "crm_contact_update_failed" });
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

  // DELETE /api/founder/investor-crm/:id — soft-delete a contact.
  // v23.4.5 BUG 010 fix: the "Clear" / delete button on the founder CRM
  // requires a delete endpoint. Soft-delete via `deletedAt` to keep audit
  // trail intact, mirroring the investor-side CRM delete behaviour.
  app.delete("/api/founder/investor-crm/:id", requireAuth, (req: Request, res: Response) => {
    const idx = contacts.findIndex((x) => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "not_found" });
    const c = contacts[idx];
    // B10 (v24.0) — verify the contact's company belongs to the caller before
    // soft-deleting, closing the cross-tenant CRM mutate hole.
    if (!callerOwnsContactCompany(req, res, c.companyId)) return;
    // v25.52 Track 3.5.2 (GPT-5.5 R6 blocker) — DB-FIRST soft-delete. Previously
    // the cache row was spliced out BEFORE the DB write and a failed write was
    // swallowed while still returning { ok: true } — a false success that left
    // the authoritative row live but the contact gone from the UI cache. Now we
    // write the DB soft-delete first; only on success do we evict the cache and
    // return ok. On failure the cache is untouched and we return 500.
    try {
      const db = getDb();
      const tenantId = tenantForCompany(c.companyId);
      db.transaction((tx: any) => {
        tx.update(founderCrmContactsTable)
          .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
          .where(withTenant(eq(founderCrmContactsTable.id, c.id), { tenantId, table: founderCrmContactsTable }))
          .run();
      });
    } catch (err) {
      log.error("[founderCrmStore DELETE] DB write failed — cache preserved:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "crm_contact_delete_failed" });
    }
    // DB soft-delete confirmed — now evict from the in-memory cache.
    contacts.splice(idx, 1);
    appendAdminAudit(
      (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "u_unknown",
      `company:${c.companyId}`,
      "crm.contact.deleted",
      { contactId: c.id, firmName: c.firmName },
    );
    res.json({ ok: true, id: c.id });
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
 * v25.52 Track 3.5.2 (GPT-5.5 R4 blocker G) — shared, AUTHORITATIVE dedup check
 * for every founder CRM create/upsert/import path. 0097 exempts founder
 * shared-inbox conflict groups (dedup_exempt=1) and 0098's partial UNIQUE index
 * EXCLUDES them, so the index alone cannot stop a NEW write into an exempt
 * group. The aux helpers previously deduped against the IN-MEMORY cache only
 * (misses rows when the cache is cold/stale) and swallowed DB failures while
 * still returning success. This helper queries the authoritative
 * founder_crm_contacts table (any live row, exempt or not) via rawDb().
 *
 * Returns one of:
 *   { verdict: "ok" }         — no live duplicate; safe to write.
 *   { verdict: "duplicate" }  — a live row already exists; caller MUST NOT write.
 *   { verdict: "unavailable" }— the check could not run; caller MUST FAIL CLOSED
 *                               (skip the write / return a typed failure) rather
 *                               than fall through to an unprotected insert.
 * Empty email => { verdict: "ok" } (email-less contacts are unaffected).
 */
function checkLiveFounderEmailDuplicate(
  companyId: string,
  email: string,
  excludeId?: string,
): { verdict: "ok" | "duplicate" | "unavailable"; dupId?: string } {
  const trimmed = (email ?? "").trim();
  if (!companyId || !trimmed) return { verdict: "ok" };
  try {
    const rdb = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
    if (!rdb || typeof rdb.prepare !== "function") return { verdict: "unavailable" };
    const row = rdb
      .prepare(
        // Physical columns are snake_case (company_id, deleted_at) — verified
        // against the live schema; matches migrations 0097/0098 and the POST/PATCH
        // guards above.
        `SELECT id FROM founder_crm_contacts
         WHERE company_id = ? AND lower(trim(email)) = lower(trim(?))
           AND (? IS NULL OR id <> ?) AND deleted_at IS NULL
         LIMIT 1`,
      )
      .get(companyId, trimmed, excludeId ?? null, excludeId ?? null) as { id?: string } | undefined;
    return row?.id ? { verdict: "duplicate", dupId: row.id } : { verdict: "ok" };
  } catch (err) {
    log.warn("[checkLiveFounderEmailDuplicate] guard query failed — failing closed:", (err as Error).message);
    return { verdict: "unavailable" };
  }
}

/**
 * v25.0 B-J5-3 fix — Insert a contact directly into founderCrmStore (both DB and
 * in-memory cache). Used by the CRM CSV import handler (track1Routes) so that
 * imported contacts are visible via GET /api/founder/crm/contacts which reads
 * from this store.
 *
 * Skips duplicates (same companyId + email). Returns the new contact or null
 * if skipped.
 */
export function insertContactForImport(args: {
  companyId: string;
  email: string;
  name?: string;
  firmName?: string;
  stage?: string;
  series?: string;
}): FounderCrmContact | null {
  if (!args.companyId || !args.email) return null;
  const normalizedEmail = args.email.trim().toLowerCase();
  // Fast in-memory skip (cache hit is authoritative-enough to short-circuit).
  const cacheHit = contacts.find(
    (c) => c.companyId === args.companyId && c.email.trim().toLowerCase() === normalizedEmail
  );
  if (cacheHit) return null;
  // v25.52 blocker G — AUTHORITATIVE DB dedup (catches exempt shared-inbox rows
  // and rows missing from a cold cache). FAIL CLOSED: on "duplicate" or
  // "unavailable" we do NOT write and return null (import row is skipped rather
  // than silently reopening a duplicate).
  const guard = checkLiveFounderEmailDuplicate(args.companyId, args.email);
  if (guard.verdict !== "ok") {
    if (guard.verdict === "unavailable") {
      log.warn("[insertContactForImport] dedup guard unavailable — skipping import row (fail-closed)");
    }
    return null;
  }
  const newContact: FounderCrmContact = {
    id: `fcrm_imp_${randomBytes(4).toString("hex")}`,
    companyId: args.companyId,
    investorId: `u_imp_${randomBytes(4).toString("hex")}`,
    name: args.name ?? args.email.split("@")[0],
    firmName: args.firmName ?? "—",
    email: args.email,
    region: "US",
    stage: (args.stage as FounderCrmContact["stage"]) ?? "lead",
    ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0,
    threadIds: [],
    notes: "Imported via CSV",
    notesUpdatedAt: new Date().toISOString(),
    tasks: [],
    series: args.series ?? "—",
  };
  // v25.52 blocker G — write via Drizzle (maps camelCase→snake_case correctly;
  // the prior raw getDb().prepare(...) used camelCase columns against a
  // snake_case table AND getDb() has no .prepare, so the DB write silently
  // failed and only the cache was updated). Only push to cache after a CONFIRMED
  // DB write.
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(founderCrmContactsTable).values(contactToRow(newContact)).run();
    });
  } catch (err) {
    log.warn("[insertContactForImport] DB write failed — not caching:", (err as Error).message);
    return null;
  }
  contacts.push(newContact);
  return newContact;
}

/**
 * B4 (v24.0 LOCKDOWN) — list every CRM contact across all companies the
 * founder owns. Used by the legacy GET /api/crm route, which previously
 * returned a global mock list to any authenticated user. `ownedCompanyIds`
 * is the caller's owned-company set (from userContext.founder.companies);
 * pass an empty set for a non-founder to get no rows.
 */
export function listByFounder(ownedCompanyIds: Iterable<string>): FounderCrmContact[] {
  const owned = new Set<string>(ownedCompanyIds);
  if (owned.size === 0) return [];
  return contacts.filter((c) => owned.has(c.companyId));
}

/**
 * B-505 fix v23.6.1 — resolve a CRM contact by the investor identity used in
 * Message/DM deep-links (`?contactId=u_inv_*`). Matches either the contact's
 * investorId or its primary id. Used by the comms DM-start route to provision
 * a real comms identity for CRM-only contacts. Returns undefined if not found.
 */
export function findCrmContactByInvestorId(investorId: string): FounderCrmContact | undefined {
  if (!investorId) return undefined;
  return contacts.find((c) => c.investorId === investorId || c.id === investorId);
}

/**
 * L-010 fix v23.4.13: also create CRM contact
 * Upserts a CRM contact when an investor is invited via roundInvitationsStore.
 * If a contact with the same email + companyId already exists, leaves it unchanged.
 * Non-fatal: errors are swallowed so invitation creation is not blocked.
 */
export function upsertCrmContactForInvitation(args: {
  companyId: string;
  name: string | null;
  email: string;
  classification?: string;
  roundId?: string | null;
  // v25.53 8a — optional CRM-aligned fields captured on the invite form.
  company?: string | null;
  stageFocus?: string | null;
  typicalMarketSize?: string | null;
}): void {
  if (!args.companyId || !args.email) return;
  const normalizedEmail = args.email.trim().toLowerCase();
  // v25.53 REVISE NB-a (8a) — an ALREADY-KNOWN contact must be UPDATED in place,
  // not dropped. Resolve the cached row FIRST: when it exists we take the update
  // path (no new INSERT), so the insert-only dedup guard below must not short-
  // circuit us. Fill/refresh supplied optional fields; NEVER clobber a non-empty
  // value with a blank. Best-effort / non-fatal so invite creation is never
  // blocked by a CRM write failure.
  const existing = contacts.find(
    (c) => c.companyId === args.companyId && c.email.trim().toLowerCase() === normalizedEmail
  );
  if (existing) {
    updateExistingCrmContactOptionalFields(existing, args);
    return;
  }
  // v25.52 blocker G — AUTHORITATIVE DB dedup via the shared guard (checks any
  // live row incl. exempt shared-inbox groups). FAIL CLOSED: on "duplicate" OR
  // "unavailable" we do NOT insert. Previously a failed dedup lookup logged and
  // continued to insert (fail-open), which could reopen a duplicate; and the
  // dedup lookup omitted `deleted_at IS NULL`. The shared guard fixes both.
  // (Reached only when no cached row exists — the update path above already
  // handled a known contact.)
  const guard = checkLiveFounderEmailDuplicate(args.companyId, args.email);
  if (guard.verdict !== "ok") {
    if (guard.verdict === "unavailable") {
      log.warn("[upsertCrmContactForInvitation] dedup guard unavailable — skipping insert (fail-closed)");
    }
    return;
  }
  // v23.9 B9: record the originating round in the note so the founder CRM shows
  // why the contact appeared. The schema has no tags/affiliation columns, so the
  // round linkage lives in the human-readable note.
  const roundSuffix = args.roundId ? ` — round ${args.roundId}` : "";
  // v25.53 8a — the CRM schema has firmName (company) but no dedicated
  // stage-focus / market-size columns, so those two are appended to the
  // human-readable note rather than adding non-additive columns.
  const company = (args.company ?? "").trim();
  const extraNoteParts: string[] = [];
  if ((args.stageFocus ?? "").trim()) extraNoteParts.push(`Stage focus: ${(args.stageFocus ?? "").trim()}`);
  if ((args.typicalMarketSize ?? "").trim()) extraNoteParts.push(`Typical market size: ${(args.typicalMarketSize ?? "").trim()}`);
  const extraNote = extraNoteParts.length > 0 ? ` — ${extraNoteParts.join("; ")}` : "";
  const newContact: FounderCrmContact = {
    id: `fcrm_inv_${args.companyId.slice(-4)}_${randomBytes(3).toString("hex")}`,
    companyId: args.companyId,
    investorId: `u_inv_${randomBytes(3).toString("hex")}`,
    name: args.name ?? args.email.split("@")[0],
    firmName: company || "—",
    email: args.email,
    region: "US",
    /* v25.48.3 Q-K1 — an invited-but-not-yet-registered investor starts at
     * the distinct "Invited – not registered" stage (was "lead"). It flips to
     * "prospect" once they register (crmMarkInvitedRegistered). */
    stage: "invited_unregistered",
    ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0,
    threadIds: [],
    notes: `Auto-created from round invitation (${args.classification ?? "invited"})${roundSuffix}${extraNote}`,
    notesUpdatedAt: new Date().toISOString(),
    tasks: [],
    series: "—",
  };
  // v25.52 blocker G — write via Drizzle (maps camelCase→snake_case; the prior
  // raw getDb().prepare(...) used camelCase columns against a snake_case table
  // AND getDb() has no .prepare, so the DB write silently failed). Only push to
  // cache after a CONFIRMED write so we never leave a cache ghost with no row.
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(founderCrmContactsTable).values(contactToRow(newContact)).run();
    });
    contacts.push(newContact);
  } catch {
    // DB write failed — do NOT cache a ghost. Invitation creation is not blocked.
  }
}

/**
 * v25.53 REVISE NB-a (8a) — update an EXISTING founder CRM contact in place with
 * invite-supplied optional fields (Company → firmName, Stage focus / Market size
 * → note), so re-inviting an already-known contact no longer drops that data.
 *
 * Rules:
 *   - Only write a supplied value that is non-blank (never clobber an existing
 *     non-empty value with a blank).
 *   - firmName: refresh when a non-blank company is supplied (also fills the "—"
 *     placeholder used for company-less contacts).
 *   - Stage focus / Market size: appended to the human-readable note (the CRM
 *     schema has no dedicated columns), skipping a value already present.
 *   - No-op (no DB write) when nothing changes.
 * Best-effort / non-fatal: a DB failure is swallowed so invite creation proceeds.
 */
function updateExistingCrmContactOptionalFields(
  existing: FounderCrmContact,
  args: {
    company?: string | null;
    stageFocus?: string | null;
    typicalMarketSize?: string | null;
  },
): void {
  const company = (args.company ?? "").trim();
  const stageFocus = (args.stageFocus ?? "").trim();
  const market = (args.typicalMarketSize ?? "").trim();
  let changed = false;

  if (company && existing.firmName !== company) {
    existing.firmName = company;
    changed = true;
  }

  const noteParts: string[] = [];
  const currentNotes = existing.notes ?? "";
  if (stageFocus && !currentNotes.includes(`Stage focus: ${stageFocus}`)) {
    noteParts.push(`Stage focus: ${stageFocus}`);
  }
  if (market && !currentNotes.includes(`Typical market size: ${market}`)) {
    noteParts.push(`Typical market size: ${market}`);
  }
  if (noteParts.length > 0) {
    existing.notes = currentNotes
      ? `${currentNotes} — ${noteParts.join("; ")}`
      : noteParts.join("; ");
    existing.notesUpdatedAt = new Date().toISOString();
    changed = true;
  }

  if (!changed) return;

  try {
    const db = getDb();
    const tenantId = tenantForCompany(existing.companyId);
    db.transaction((tx: any) => {
      tx.update(founderCrmContactsTable)
        .set({
          firmName: existing.firmName,
          notes: existing.notes,
          notesUpdatedAt: existing.notesUpdatedAt,
          updatedAt: new Date().toISOString(),
        })
        .where(withTenant(eq(founderCrmContactsTable.id, existing.id), { tenantId, table: founderCrmContactsTable }))
        .run();
    });
  } catch (err) {
    log.warn("[updateExistingCrmContactOptionalFields] DB update failed (non-fatal):", (err as Error).message);
  }
}

/**
 * v25.51 5a — round → founder CRM unification.
 *
 * When a founder adds a manual (non-Capavate) investor to a round's initial
 * shareholders, that person should also become a first-class founder CRM
 * contact so the round and the CRM are one dataset (Ozan). This helper
 * upserts-and-links:
 *   1. Dedupe by normalized email (company-scoped). When no email is present,
 *      fall back to LOWER(TRIM(first + last + company)).
 *   2. If a live contact matches, return its id (link only — no new row).
 *   3. Otherwise create a new contact (discrete first/last/company + composed
 *      `name`) and return the new id.
 *
 * Idempotent: calling twice with the same identity returns the SAME id and
 * never creates a duplicate row. The DB write uses the reliable drizzle path
 * (contactToRow → snake_case mapping) so the row actually persists.
 *
 * Cap-table math is NOT touched — this only writes a CRM contact row.
 */
export function upsertFromRound(args: {
  companyId: string;
  tenantId?: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  roundId?: string | null;
}): { id: string; created: boolean } | null {
  if (!args.companyId) return null;
  const first = optCrmStr(args.firstName);
  const last = optCrmStr(args.lastName);
  const company = optCrmStr(args.companyName);
  const email = optCrmStr(args.email);
  const normalizedEmail = email ? email.toLowerCase() : "";
  const fbFirst = (first ?? "").toLowerCase();
  const fbLast = (last ?? "").toLowerCase();
  const fbCompany = (company ?? "").toLowerCase();

  // 1) Authoritative DB dedupe (survives cold caches / cluster workers).
  // v25.52 blocker G — FAIL CLOSED on any dedupe failure. Previously a failed
  // lookup logged and continued to create (fail-open), which could reopen an
  // exempt shared-inbox duplicate. For the email case we use the shared guard
  // (checks any live row incl. exempt); for the no-email name-fallback we keep
  // the explicit rawDb lookup but treat an unavailable driver as fail-closed.
  try {
    if (normalizedEmail) {
      const guard = checkLiveFounderEmailDuplicate(args.companyId, email as string);
      if (guard.verdict === "duplicate" && guard.dupId) return { id: guard.dupId, created: false };
      if (guard.verdict === "unavailable") {
        log.warn("[upsertFromRound] dedup guard unavailable — skipping create (fail-closed)");
        return null;
      }
    } else if (fbFirst || fbLast || fbCompany) {
      const driver = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
      if (!driver || typeof driver.prepare !== "function") {
        log.warn("[upsertFromRound] rawDb unavailable for name-fallback dedupe — skipping create (fail-closed)");
        return null;
      }
      const dbRow = driver.prepare(
        `SELECT id FROM founder_crm_contacts
           WHERE company_id = ?
             AND LOWER(TRIM(COALESCE(first_name,''))) = ?
             AND LOWER(TRIM(COALESCE(last_name,''))) = ?
             AND LOWER(TRIM(COALESCE(company_name,''))) = ?
             AND deleted_at IS NULL LIMIT 1`,
      ).get(args.companyId, fbFirst, fbLast, fbCompany) as { id: string } | undefined;
      if (dbRow?.id) return { id: dbRow.id, created: false };
    }
  } catch (err) {
    log.warn("[upsertFromRound] DB dedupe lookup failed — skipping create (fail-closed):", (err as Error).message);
    return null;
  }

  // 2) In-memory guard (no-DB/test paths + same-process races).
  const cacheMatch = contacts.find((c) => {
    if (c.companyId !== args.companyId) return false;
    if (normalizedEmail) return c.email.trim().toLowerCase() === normalizedEmail;
    return (
      (c.firstName ?? "").trim().toLowerCase() === fbFirst &&
      (c.lastName ?? "").trim().toLowerCase() === fbLast &&
      (c.companyName ?? "").trim().toLowerCase() === fbCompany &&
      (fbFirst !== "" || fbLast !== "" || fbCompany !== "")
    );
  });
  if (cacheMatch) return { id: cacheMatch.id, created: false };

  // 3) Create a new contact.
  const composed = [first, last].filter(Boolean).join(" ").trim();
  /* WAVE 93 · ITEM 1, sub-defect — the SECOND writer of the placeholder. This is
     the round-invitation auto-create path; a contact minted here with no name, no
     firm and no email used to be stored as "New contact" and then rendered as a
     holder/investor identity. Prefer the email LOCAL PART over the placeholder
     (already the case), and when there is genuinely nothing, DESCRIBE the record
     instead of naming it: "Invited contact (name not recorded)" tells the founder
     what the row is, which "New contact" did not. Wave 83's precedent. */
  const displayName = composed || company || (email ? email.split("@")[0] : "") || "Invited contact (name not recorded)";
  const roundSuffix = args.roundId ? ` — round ${args.roundId}` : "";
  const newContact: FounderCrmContact = {
    id: `fcrm_rnd_${args.companyId.slice(-4)}_${randomBytes(3).toString("hex")}`,
    companyId: args.companyId,
    investorId: `u_rnd_${randomBytes(3).toString("hex")}`,
    name: displayName,
    firstName: first,
    lastName: last,
    companyName: company,
    firmName: company ?? "—",
    email: email ?? "",
    region: "US",
    stage: "prospect",
    ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0,
    threadIds: [],
    notes: `Added from round initial shareholders${roundSuffix}`,
    notesUpdatedAt: new Date().toISOString(),
    tasks: [],
    series: "—",
  };
  // DB write first (drizzle path — reliable snake_case mapping), then cache.
  // v25.52 blocker G — only push to cache + return created on a CONFIRMED write;
  // on failure return null (do not leave a cache ghost or claim created:true).
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(founderCrmContactsTable).values(contactToRow(newContact)).run();
    });
  } catch (err) {
    log.warn("[upsertFromRound] DB write failed — not caching:", (err as Error).message);
    return null;
  }
  contacts.push(newContact);
  return { id: newContact.id, created: true };
}

/**
 * v25.47 APD-033 (HIGH-1) — when an invited investor redeems their token and
 * registers, flip the auto-created CRM contact from "lead" to "engaged" and
 * stamp the registration in the note so the founder sees the invite converted.
 * Idempotent: a contact already past "lead" (or already stamped) is left as-is.
 * Keyed by (companyId, LOWER(TRIM(email))). Non-fatal — redemption is never
 * blocked by a CRM bookkeeping failure.
 */
export function crmMarkInvitedRegistered(args: {
  companyId: string;
  email: string;
}): boolean {
  if (!args.companyId || !args.email) return false;
  const normalizedEmail = args.email.trim().toLowerCase();
  const stamp = "Registered via invitation redemption";
  const now = new Date().toISOString();

  let targetId: string | undefined;
  try {
    const driver = rawDb() as unknown as {
      prepare?: (sql: string) => {
        get: (...a: unknown[]) => unknown;
        run: (...a: unknown[]) => unknown;
      };
    };
    if (driver && typeof driver.prepare === "function") {
      const dbRow = driver
        .prepare(
          `SELECT id, stage, notes FROM founder_crm_contacts WHERE company_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1`,
        )
        .get(args.companyId, normalizedEmail) as
        | { id: string; stage: string; notes: string | null }
        | undefined;
      if (dbRow?.id) {
        targetId = dbRow.id;
        const alreadyRegistered = (dbRow.notes ?? "").includes(stamp);
        if (!alreadyRegistered) {
          /* v25.48.3 Q-K1 — on registration, an "invited_unregistered" (or
           * legacy "lead") contact becomes a "prospect". Any stage already past
           * that is left untouched. */
          const nextStage = (dbRow.stage === "invited_unregistered" || dbRow.stage === "lead") ? "prospect" : dbRow.stage;
          const nextNotes = `${dbRow.notes ?? ""}${dbRow.notes ? " — " : ""}${stamp} (${now})`;
          driver
            .prepare(
              `UPDATE founder_crm_contacts SET stage = ?, notes = ?, notes_updated_at = ? WHERE id = ?`,
            )
            .run(nextStage, nextNotes, now, dbRow.id);
        }
      }
    }
  } catch (err) {
    log.warn("[crmMarkInvitedRegistered] DB update failed:", (err as Error).message);
  }

  // Mirror into the read cache when present so reads before the next hydrate
  // pass reflect the registration.
  const cached = contacts.find(
    (c) => c.companyId === args.companyId && c.email.trim().toLowerCase() === normalizedEmail,
  );
  if (cached) {
    targetId = targetId ?? cached.id;
    if (!cached.notes.includes(stamp)) {
      /* v25.48.3 Q-K1 — mirror the invited_unregistered/lead → prospect flip. */
      if (cached.stage === "invited_unregistered" || cached.stage === "lead") cached.stage = "prospect";
      cached.notes = `${cached.notes}${cached.notes ? " — " : ""}${stamp} (${now})`;
      cached.notesUpdatedAt = now;
    }
  }
  return Boolean(targetId);
}

/**
 * v23.9 C8/CP-6 — seed a consortium partner into a founder's CRM when the
 * company is linked to that partner (A4). Idempotent by email + companyId.
 * The partner is recorded as a longterm-stage relationship so it reads as a
 * standing sponsor rather than a fresh lead.
 */
export function upsertInvestorContactFromPartner(
  companyId: string,
  partner: { partnerId: string; name: string; email: string; region?: string | null },
): void {
  if (!companyId) return;
  const email = partner.email ?? "";
  // Cache short-circuit (partnerId link OR email).
  const cacheHit = contacts.find(
    (c) => c.companyId === companyId &&
      (c.investorId === partner.partnerId || (email && c.email.toLowerCase() === email.toLowerCase())),
  );
  if (cacheHit) return;
  // v25.52 blocker G — AUTHORITATIVE email dedup (catches exempt shared-inbox
  // rows + cold-cache misses). FAIL CLOSED on duplicate/unavailable. (When email
  // is empty the guard returns ok; the partnerId cache check above still applies.)
  const guard = checkLiveFounderEmailDuplicate(companyId, email);
  if (guard.verdict !== "ok") {
    if (guard.verdict === "unavailable") {
      log.warn("[upsertInvestorContactFromPartner] dedup guard unavailable — skipping insert (fail-closed)");
    }
    return;
  }
  const newContact: FounderCrmContact = {
    id: `fcrm_cp_${companyId.slice(-4)}_${randomBytes(3).toString("hex")}`,
    companyId,
    investorId: partner.partnerId,
    name: partner.name || email.split("@")[0] || "Consortium Partner",
    firmName: partner.name || "—",
    email,
    region: partner.region || "US",
    stage: "longterm",
    ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0,
    threadIds: [],
    notes: "Consortium partner (sponsor)",
    notesUpdatedAt: new Date().toISOString(),
    tasks: [],
    series: "—",
  };
  // v25.52 blocker G — Drizzle write (correct snake_case mapping); cache only
  // after a CONFIRMED write.
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(founderCrmContactsTable).values(contactToRow(newContact)).run();
    });
    contacts.push(newContact);
  } catch { /* non-fatal: do NOT cache a ghost on DB failure */ }
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

/**
 * v25.16 cross-comp NH1 — inverse of upsertInvestorContactFromPartner.
 *
 * When an admin unlinks a consortium partner from a company, the founder's
 * CRM row that was auto-created at link time should be soft-deleted so it
 * no longer appears as an active longterm contact. Idempotent: callers that
 * unlink an already-unlinked relationship get a clean no-op.
 */
export function removeInvestorContactForPartner(companyId: string, partnerId: string): { removed: boolean } {
  if (!companyId || !partnerId) return { removed: false };
  const idx = contacts.findIndex(
    (c) => c.companyId === companyId && c.investorId === partnerId,
  );
  if (idx < 0) return { removed: false };
  const target = contacts[idx];
  // v25.52 (GPT-5.5 R6 blocker) — DB-FIRST soft-delete. Previously the cache row
  // was spliced out BEFORE the DB write and a failed write was swallowed while
  // still returning { removed: true }, so an admin unlink could report a
  // successful CRM removal while the authoritative founder_crm_contacts row
  // stayed live. Now: write the DB soft-delete first; only evict the cache and
  // report removed:true on success; return removed:false on failure.
  try {
    const db = getDb();
    (db as any)
      .update(founderCrmContactsTable)
      .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(founderCrmContactsTable.id, target.id))
      .run();
  } catch (err) {
    log.warn("[founderCrm] removeInvestorContactForPartner DB write failed — cache preserved:", (err as Error).message);
    return { removed: false };
  }
  contacts.splice(idx, 1);
  return { removed: true };
}
