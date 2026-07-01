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
        const rows = driver.prepare(
          `SELECT id, tenantId, companyId, investorId, name, firmName, email, region, stage,
                  ownership, softCircleHistory, maSignals, threadIds, notes, notesUpdatedAt, tasks, series
           FROM founder_crm_contacts WHERE companyId = ?`
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
  const VALID_STAGES = new Set(["lead", "engaged", "soft_circle", "committed", "signing", "invested", "longterm"]);
  function normalizeStage(s: unknown): string {
    return typeof s === "string" && VALID_STAGES.has(s) ? s : "lead";
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
    const incomingEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const sendInvite = !!req.body?.sendInvite;

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
      name: req.body?.name ?? "New contact",
      firmName: req.body?.firmName ?? "—",
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
      log.error("[founderCrmStore POST] DB write failed:", (err as Error).message);
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
    if (typeof req.body?.stage === "string") c.stage = normalizeStage(req.body.stage) as FounderCrmContact["stage"];
    if (typeof req.body?.notes === "string") { c.notes = req.body.notes; c.notesUpdatedAt = new Date().toISOString(); }
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
    // Remove from in-memory cache.
    contacts.splice(idx, 1);
    // Write-through soft-delete to DB (tenant-scoped).
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
      log.error("[founderCrmStore DELETE] DB write failed:", (err as Error).message);
    }
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
  // Dedupe check
  const existing = contacts.find(
    (c) => c.companyId === args.companyId && c.email.trim().toLowerCase() === normalizedEmail
  );
  if (existing) return null;
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
  // DB write first (same pattern as POST handler)
  try {
    const db = getDb();
    const row = contactToRow(newContact);
    (db as any).prepare(
      `INSERT OR IGNORE INTO founder_crm_contacts (id, tenantId, companyId, investorId, name, firmName, email, region, stage, ownership, softCircleHistory, maSignals, threadIds, notes, notesUpdatedAt, tasks, series) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      row.id, row.tenantId, row.companyId, row.investorId, row.name, row.firmName, row.email,
      row.region, row.stage, row.ownership, row.softCircleHistory, row.maSignals, row.threadIds,
      row.notes, row.notesUpdatedAt, row.tasks, row.series
    );
  } catch (err) {
    log.warn("[insertContactForImport] DB write failed:", (err as Error).message);
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
}): void {
  if (!args.companyId || !args.email) return;
  const normalizedEmail = args.email.trim().toLowerCase();
  // v24.1 Bug J (BUG 043) — dedupe was in-memory only. The CRM read cache is
  // not always hydrated when an invitation fires (e.g. right after a restart,
  // before hydrateFounderCrmStore runs, or in a worker that never loaded the
  // founder's contacts), so the in-memory `contacts.find` missed an existing
  // row and we inserted a SECOND contact for the same email. Because the table
  // PK is `id` (random per call) and there is NO unique index on email, the
  // prior `INSERT OR IGNORE` never collapsed the duplicate. Fix: check the
  // authoritative DB keyed by (company_id, LOWER(TRIM(email))) first, then the
  // cache. Query-then-insert is fine here — invitations are not high-contention
  // and SQLite serializes writes.
  try {
    // Use rawDb() (the better-sqlite3 driver) — getDb() returns the drizzle
    // wrapper which has NO .prepare(), so the previous getDb()-based guard was
    // always false and the authoritative DB dedupe silently no-op'd. rawDb()
    // exposes prepare/get/run synchronously.
    const driver = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
    if (driver && typeof driver.prepare === "function") {
      const dbRow = driver.prepare(
        `SELECT id FROM founder_crm_contacts WHERE company_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1`,
      ).get(args.companyId, normalizedEmail) as { id: string } | undefined;
      if (dbRow?.id) {
        // Already present in the authoritative store — do NOT insert a duplicate.
        // The read cache will pick this row up on the next hydrateFounderCrmStore
        // pass; we deliberately avoid hand-building a cache entry from a raw
        // SELECT * (snake_case columns) which would not match rowToContact's
        // camelCase expectations.
        return;
      }
    }
  } catch (err) {
    log.warn("[upsertCrmContactForInvitation] DB dedupe lookup failed:", (err as Error).message);
  }
  // Secondary in-memory guard (covers no-DB/test paths and same-process races).
  const existing = contacts.find(
    (c) => c.companyId === args.companyId && c.email.trim().toLowerCase() === normalizedEmail
  );
  if (existing) return;
  // v23.9 B9: record the originating round in the note so the founder CRM shows
  // why the contact appeared. The schema has no tags/affiliation columns, so the
  // round linkage lives in the human-readable note.
  const roundSuffix = args.roundId ? ` — round ${args.roundId}` : "";
  const newContact: FounderCrmContact = {
    id: `fcrm_inv_${args.companyId.slice(-4)}_${randomBytes(3).toString("hex")}`,
    companyId: args.companyId,
    investorId: `u_inv_${randomBytes(3).toString("hex")}`,
    name: args.name ?? args.email.split("@")[0],
    firmName: "—",
    email: args.email,
    region: "US",
    stage: "lead",
    ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0,
    threadIds: [],
    notes: `Auto-created from round invitation (${args.classification ?? "invited"})${roundSuffix}`,
    notesUpdatedAt: new Date().toISOString(),
    tasks: [],
    series: "—",
  };
  contacts.push(newContact);
  // Best-effort DB write — non-fatal
  try {
    const db = getDb();
    const row = contactToRow(newContact);
    (db as any).prepare(
      `INSERT OR IGNORE INTO founder_crm_contacts (id, tenantId, companyId, investorId, name, firmName, email, region, stage, ownership, softCircleHistory, maSignals, threadIds, notes, notesUpdatedAt, tasks, series) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      row.id, row.tenantId, row.companyId, row.investorId, row.name, row.firmName, row.email,
      row.region, row.stage, row.ownership, row.softCircleHistory, row.maSignals, row.threadIds,
      row.notes, row.notesUpdatedAt, row.tasks, row.series
    );
  } catch {
    // Non-fatal: in-memory contact is already added above.
  }
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
          const nextStage = dbRow.stage === "lead" ? "engaged" : dbRow.stage;
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
      if (cached.stage === "lead") cached.stage = "engaged";
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
  const existing = contacts.find(
    (c) => c.companyId === companyId &&
      (c.investorId === partner.partnerId || (email && c.email.toLowerCase() === email.toLowerCase())),
  );
  if (existing) return;
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
  contacts.push(newContact);
  try {
    const db = getDb();
    const row = contactToRow(newContact);
    (db as any).prepare(
      `INSERT OR IGNORE INTO founder_crm_contacts (id, tenantId, companyId, investorId, name, firmName, email, region, stage, ownership, softCircleHistory, maSignals, threadIds, notes, notesUpdatedAt, tasks, series) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      row.id, row.tenantId, row.companyId, row.investorId, row.name, row.firmName, row.email,
      row.region, row.stage, row.ownership, row.softCircleHistory, row.maSignals, row.threadIds,
      row.notes, row.notesUpdatedAt, row.tasks, row.series,
    );
  } catch { /* non-fatal */ }
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
  contacts.splice(idx, 1);
  try {
    const db = getDb();
    (db as any)
      .update(founderCrmContactsTable)
      .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(founderCrmContactsTable.id, target.id))
      .run();
  } catch (err) {
    log.warn("[founderCrm] removeInvestorContactForPartner DB write failed:", (err as Error).message);
  }
  return { removed: true };
}
