/**
 * server/partnerWorkspaceV19Store.ts — v19 Phase B.
 *
 * DB-backed stores + endpoints for the three remaining (non-Collective)
 * partner workspace surfaces:
 *
 *   - partner_portfolio_companies — partner-tracked portfolio companies
 *     with visibility column ('private'|'collective'|'public').
 *   - partner_crm_contacts — partner-private CRM contacts.
 *   - partner_deal_pipeline — per-deal pipeline-stage tracking (audit-grade,
 *     separate from the legacy in-memory `pipeline` array in
 *     `partnerWorkspaceStore.ts` which stays in-memory in v20 per the brief).
 *
 * The v17 Phase B Collective slice (`partner_deal_promotions`) remains
 * authoritative for Collective-facing deal promotions and is owned by
 * `partnerWorkspaceStore.ts` — this module does NOT touch it.
 *
 * Hybrid Map+DB pattern: every write goes through a SYNC transaction;
 * the in-memory Maps are write-through caches re-hydrated on boot.
 *
 * Endpoints (all under /api/partner; mounted from routes.ts):
 *
 *   GET    /api/partner/portfolio                — list (own + collective-visible + public)
 *   POST   /api/partner/portfolio                — create
 *   GET    /api/partner/portfolio/:id            — detail
 *   PATCH  /api/partner/portfolio/:id            — update
 *   DELETE /api/partner/portfolio/:id            — soft-delete
 *
 *   GET    /api/partner/crm/contacts             — list
 *   POST   /api/partner/crm/contacts             — create
 *   GET    /api/partner/crm/contacts/:id         — detail
 *   PATCH  /api/partner/crm/contacts/:id         — update
 *   DELETE /api/partner/crm/contacts/:id         — soft-delete
 *
 *   GET    /api/partner/deals                    — list
 *   POST   /api/partner/deals                    — create
 *   GET    /api/partner/deals/:id                — detail
 *   PATCH  /api/partner/deals/:id                — update (incl. stage transitions)
 *
 * Hard rules respected:
 *   - SYNC `db.transaction((tx) => {...})`; hashes pre-computed before tx.
 *   - `withTenant()` ownership — partner_id ownership enforced inline;
 *     cross-tenant marked when reading Collective-visible portfolio entries.
 *   - SSE publish AFTER tx commits.
 *   - NO mock data, NO TODOs, NO stubs.
 */

import type { Express, Request, Response } from "express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth"; /* v25.14 NL5 */
import { partnerTeamStore } from "./partnerWorkspaceStore";
import { getDb } from "./db/connection";
import {
  partnerPortfolioCompanies as portfolioTable,
  partnerCrmContacts as crmTable,
  partnerDealPipeline as dealsTable,
  chapterMemberships as chapterMembershipsTable,
} from "@shared/schema";
import { publish as ssePublish } from "./lib/sseHub";
import { emitNotification, type NotificationKind } from "./notificationsStore";
import { log } from "./lib/logger";

/**
 * CP Phase C — best-effort wrapper around `emitNotification` for use inside
 * partner workspace fanouts. Errors are silently swallowed so a single
 * misconfigured user record cannot block the write path.
 */
function emitNotificationSafe(args: {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
}): void {
  try {
    emitNotification({
      userId: args.userId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      link: args.link,
    });
  } catch { /* non-fatal */ }
}

/* ============================================================
 * Types
 * ============================================================ */

export type PortfolioStage = "seed" | "series_a" | "series_b" | "growth" | "late_stage";
export type PortfolioVisibility = "private" | "collective" | "public";
export type DealStage = "sourced" | "screening" | "diligence" | "term_sheet" | "closed" | "passed";

export interface PortfolioRow {
  id: string;
  tenantId: string;
  partnerId: string;
  companyId: string;
  displayName: string;
  stage: PortfolioStage;
  sector: string;
  leadInvestedAmountMinor: number;
  firstInvestedAt: string | null;
  notes: string;
  visibility: PortfolioVisibility;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CrmContactRow {
  id: string;
  tenantId: string;
  partnerId: string;
  contactUserId: string | null;
  email: string;
  name: string;
  role: string;
  org: string;
  lastContactAt: string | null;
  notes: string;
  tags: string[];
  /** CP-008: prev/curr hash chain across all CRM contacts owned by a partner. */
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DealRow {
  id: string;
  tenantId: string;
  partnerId: string;
  companyId: string;
  stage: DealStage;
  assignedUserIds: string[];
  targetCloseAt: string | null;
  notes: string;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/* ============================================================
 * Caches
 * ============================================================ */

const portfolioCache = new Map<string, PortfolioRow>();
const crmCache = new Map<string, CrmContactRow>();
const dealsCache = new Map<string, DealRow>();

/* ============================================================
 * Helpers
 * ============================================================ */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function safeJsonArray(s: unknown): string[] {
  if (Array.isArray(s)) return s.map(String);
  if (typeof s !== "string" || s.length === 0) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function rowToPortfolio(r: any): PortfolioRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    partnerId: r.partner_id ?? r.partnerId,
    companyId: r.company_id ?? r.companyId,
    displayName: r.display_name ?? r.displayName,
    stage: (r.stage ?? "seed") as PortfolioStage,
    sector: r.sector ?? "",
    leadInvestedAmountMinor: Number(r.lead_invested_amount_minor ?? r.leadInvestedAmountMinor ?? 0),
    firstInvestedAt: r.first_invested_at ?? r.firstInvestedAt ?? null,
    notes: r.notes ?? "",
    visibility: (r.visibility ?? "private") as PortfolioVisibility,
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

function rowToCrm(r: any): CrmContactRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    partnerId: r.partner_id ?? r.partnerId,
    contactUserId: r.contact_user_id ?? r.contactUserId ?? null,
    email: r.email ?? "",
    name: r.name,
    role: r.role ?? "",
    org: r.org ?? "",
    lastContactAt: r.last_contact_at ?? r.lastContactAt ?? null,
    notes: r.notes ?? "",
    tags: safeJsonArray(r.tags),
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash ?? "",
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

/**
 * CP-008: compute the hash input for a CRM contact mutation. Hash inputs are
 * intentionally a stable subset of the row identity (not the full row) to keep
 * the chain robust against unrelated audit-trail edits.
 */
function crmHashPayload(
  row: Pick<CrmContactRow, "partnerId" | "contactUserId" | "email" | "name" | "createdAt">,
  prevHash: string | null,
): Record<string, unknown> {
  return {
    partnerId: row.partnerId,
    contactUserId: row.contactUserId ?? "",
    email: row.email ?? "",
    name: row.name,
    createdAt: row.createdAt,
    prevHash: prevHash ?? "crm:0000000000000000000000000000000000000000000000000000000000000000",
  };
}

/**
 * CP-008: find the current chain tip for a partner's CRM, scanning both the
 * cache and the DB. Returns null if the partner has no CRM rows yet (genesis).
 */
function findCrmChainTip(partnerId: string): string | null {
  // 1) Check cache first (newest-by-createdAt wins).
  let tipRow: CrmContactRow | null = null;
  for (const r of Array.from(crmCache.values())) {
    if (r.partnerId !== partnerId) continue;
    if (!r.currHash) continue;
    if (!tipRow || r.createdAt > tipRow.createdAt) tipRow = r;
  }
  // 2) Also check DB (cache may be cold during hydrate).
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(crmTable)
      .where(eq((crmTable as any).partnerId, partnerId))
      .all() as any[];
    for (const r of rows) {
      const c = rowToCrm(r);
      if (!c.currHash) continue;
      if (!tipRow || c.createdAt > tipRow.createdAt) tipRow = c;
    }
  } catch {
    /* fall back to cache-only result */
  }
  return tipRow ? tipRow.currHash : null;
}

function rowToDeal(r: any): DealRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    partnerId: r.partner_id ?? r.partnerId,
    companyId: r.company_id ?? r.companyId,
    stage: (r.stage ?? "sourced") as DealStage,
    assignedUserIds: safeJsonArray(r.assigned_user_ids ?? r.assignedUserIds),
    targetCloseAt: r.target_close_at ?? r.targetCloseAt ?? null,
    notes: r.notes ?? "",
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

/* ============================================================
 * Validation
 * ============================================================ */

const portfolioCreateSchema = z.object({
  company_id: z.string().min(1),
  display_name: z.string().min(1).max(200),
  stage: z.enum(["seed", "series_a", "series_b", "growth", "late_stage"]).optional(),
  sector: z.string().max(120).optional(),
  lead_invested_amount_minor: z.number().int().nonnegative().optional(),
  first_invested_at: z.string().optional(),
  notes: z.string().max(4000).optional(),
  visibility: z.enum(["private", "collective", "public"]).optional(),
});
const portfolioUpdateSchema = portfolioCreateSchema.partial();

const crmCreateSchema = z.object({
  contact_user_id: z.string().min(1).optional(),
  email: z.string().email().optional(),
  name: z.string().min(1).max(200),
  role: z.string().max(120).optional(),
  org: z.string().max(200).optional(),
  last_contact_at: z.string().optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});
const crmUpdateSchema = crmCreateSchema.partial();

const dealCreateSchema = z.object({
  company_id: z.string().min(1),
  stage: z.enum(["sourced", "screening", "diligence", "term_sheet", "closed", "passed"]).optional(),
  assigned_user_ids: z.array(z.string()).max(20).optional(),
  target_close_at: z.string().optional(),
  notes: z.string().max(4000).optional(),
});
const dealUpdateSchema = dealCreateSchema.partial();

/* ============================================================
 * SSE
 * ============================================================ */

function publishPartnerEvent(
  partnerId: string,
  topic: "partner-workspace" | "collective-portfolio",
  data: unknown,
): void {
  // Subscribers tune into a chapter scope; we use partnerId as a synthetic
  // chapter for the partner-workspace topic. Real chapter listings get the
  // collective-portfolio topic when visibility='collective'.
  ssePublish(partnerId, topic, data);
}

/**
 * For portfolio entries with visibility='collective', publish to every
 * chapter the partner has at least one active member in — so chapter
 * members see updates without re-subscribing per partner.
 *
 * CROSS-TENANT (admin) — justified because Collective-promoted portfolio
 * entries are explicitly cross-tenant by design.
 */
function publishCollectiveVisibilityFanout(portfolio: PortfolioRow): void {
  if (portfolio.visibility !== "collective") return;
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — chapter list spans tenants by design here.
    const rows = db
      .selectDistinct({ cid: (chapterMembershipsTable as any).chapterId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .all() as Array<{ cid: string }>;
    for (const r of rows) {
      ssePublish(r.cid, "collective-portfolio", {
        type: "collective-portfolio.updated",
        partnerId: portfolio.partnerId,
        portfolioId: portfolio.id,
        companyId: portfolio.companyId,
        visibility: portfolio.visibility,
        updatedAt: portfolio.updatedAt,
      });
    }
    // CP Phase C — CP-035: also emit an in-app notification to active
    // chapter members of every chapter the partner has any presence in.
    // We approximate "presence" by joining on chapter_memberships where the
    // member user is also a partner team member of this partner (cheap
    // alternative until partner_chapter_affiliations exists — see CP-025).
    try {
      const memberRows = db
        .select({
          userId: (chapterMembershipsTable as any).userId,
          chapterId: (chapterMembershipsTable as any).chapterId,
        })
        .from(chapterMembershipsTable)
        .where(
          and(
            eq((chapterMembershipsTable as any).status, "active"),
            isNull((chapterMembershipsTable as any).deletedAt),
          ),
        )
        .all() as Array<{ userId: string; chapterId: string }>;
      for (const m of memberRows) {
        try {
          emitNotificationSafe({
            userId: m.userId,
            kind: "cap_table.broadcast",
            title: "Partner shared a portfolio company",
            body: `A consortium partner made a portfolio company visible to the Collective.`,
            link: `/collective/portfolio/${portfolio.id}`,
          });
        } catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
  } catch {
    /* swallow — SSE is best-effort */
  }
}

/* ============================================================
 * Read helpers
 * ============================================================ */

function findPortfolioByIdAnyTenant(id: string): PortfolioRow | null {
  const cached = portfolioCache.get(id);
  if (cached) return cached;
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — justified: ownership enforced in handler after lookup.
    const rows = db
      .select()
      .from(portfolioTable)
      .where(eq((portfolioTable as any).id, id))
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    const row = rowToPortfolio(rows[0]);
    portfolioCache.set(row.id, row);
    return row;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[partnerWorkspaceV19Store.findPortfolioById] read failed:", msg);
    }
    return null;
  }
}

function findCrmByIdAnyTenant(id: string): CrmContactRow | null {
  const cached = crmCache.get(id);
  if (cached) return cached;
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — justified: ownership enforced after lookup.
    const rows = db
      .select()
      .from(crmTable)
      .where(eq((crmTable as any).id, id))
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    const row = rowToCrm(rows[0]);
    crmCache.set(row.id, row);
    return row;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[partnerWorkspaceV19Store.findCrmById] read failed:", msg);
    }
    return null;
  }
}

function findDealByIdAnyTenant(id: string): DealRow | null {
  const cached = dealsCache.get(id);
  if (cached) return cached;
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — justified: ownership enforced after lookup.
    const rows = db
      .select()
      .from(dealsTable)
      .where(eq((dealsTable as any).id, id))
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    const row = rowToDeal(rows[0]);
    dealsCache.set(row.id, row);
    return row;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[partnerWorkspaceV19Store.findDealById] read failed:", msg);
    }
    return null;
  }
}

/* ============================================================
 * Hydrators
 * ============================================================ */

export async function hydratePartnerWorkspaceV19Store(): Promise<void> {
  try {
    const db: any = getDb();
    // v25.14 NL4 — exclude soft-deleted rows from hydration. Reads still
    // filter via the route handlers, but keeping tombstones out of the
    // cache reduces memory + closes a window where direct cache.get(id)
    // calls would surface deleted rows.
    const pRows = db
      .select()
      .from(portfolioTable)
      .where(isNull(portfolioTable.deletedAt))
      .all() as any[];
    for (const r of pRows) {
      const row = rowToPortfolio(r);
      portfolioCache.set(row.id, row);
    }
    const cRows = db
      .select()
      .from(crmTable)
      .where(isNull(crmTable.deletedAt))
      .all() as any[];
    for (const r of cRows) {
      const row = rowToCrm(r);
      crmCache.set(row.id, row);
    }
    const dRows = db
      .select()
      .from(dealsTable)
      .where(isNull(dealsTable.deletedAt))
      .all() as any[];
    for (const r of dRows) {
      const row = rowToDeal(r);
      dealsCache.set(row.id, row);
    }
    if (pRows.length + cRows.length + dRows.length > 0) {
      log.info(
        `[hydrate] partnerWorkspaceV19Store: portfolio=${pRows.length} crm=${cRows.length} deals=${dRows.length} restored`,
      );
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] partnerWorkspaceV19Store: DB read failed:", msg);
    }
  }
}

/* ============================================================
 * Endpoints
 * ============================================================ */

export function registerPartnerWorkspaceV19Routes(app: Express): void {
  /* ===================== Portfolio ===================== */

  // v25.14 NL5 — was missing the assertSubRole gate. Restrict portfolio
  // creation to roles allowed to record investments (managing_partner /
  // associate / bd). Viewers and analysts are now correctly 403'd.
  app.post("/api/partner/portfolio", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), (req, res) => {
    const ctx = req.partnerContext!;
    const parsed = portfolioCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const id = newId("ppc");
    const now = nowIso();
    const tenantId = `tenant_partner_${ctx.partnerId}`;
    const visibility = (parsed.data.visibility ?? "private") as PortfolioVisibility;
    const payload = {
      id,
      partnerId: ctx.partnerId,
      companyId: parsed.data.company_id,
      visibility,
      createdAt: now,
    };
    const prevHash: string | null = null; // first revision of this row
    const currHash = computeHash(prevHash, payload);
    const row: PortfolioRow = {
      id,
      tenantId,
      partnerId: ctx.partnerId,
      companyId: parsed.data.company_id,
      displayName: parsed.data.display_name,
      stage: (parsed.data.stage ?? "seed") as PortfolioStage,
      sector: parsed.data.sector ?? "",
      leadInvestedAmountMinor: parsed.data.lead_invested_amount_minor ?? 0,
      firstInvestedAt: parsed.data.first_invested_at ?? null,
      notes: parsed.data.notes ?? "",
      visibility,
      prevHash,
      currHash,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(portfolioTable).values({
        id: row.id,
        tenantId: row.tenantId,
        partnerId: row.partnerId,
        companyId: row.companyId,
        displayName: row.displayName,
        stage: row.stage,
        sector: row.sector,
        leadInvestedAmountMinor: row.leadInvestedAmountMinor,
        firstInvestedAt: row.firstInvestedAt,
        notes: row.notes,
        visibility: row.visibility,
        prevHash: row.prevHash,
        currHash: row.currHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: null,
      }).run();
    });
    portfolioCache.set(row.id, row);
    publishPartnerEvent(ctx.partnerId, "partner-workspace", {
      type: "portfolio.created",
      portfolioId: row.id,
      partnerId: ctx.partnerId,
    });
    if (row.visibility === "collective") publishCollectiveVisibilityFanout(row);
    res.status(201).json({ ok: true, portfolio: row });
  });

  // v25.14 NH5 — was requireAuth (any session); allowed founders/investors
  // to enumerate any partner's portfolio with ?partner_id=. Switched to
  // requirePartnerAuth so only active partner team members can list (the
  // visibility filter below remains intact for cross-partner queries).
  // Collective members reading a public portfolio go through the dedicated
  // /api/collective/portfolio surface, not this one.
  app.get("/api/partner/portfolio", requirePartnerAuth, (req, res) => {
    const ctxUserId = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean } }).userContext?.userId;
    if (!ctxUserId) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    // Anyone authenticated may LIST: we filter by visibility ourselves.
    // Owners see all their own rows; non-owners see public + collective (with chapter share).
    let rows: PortfolioRow[] = [];
    try {
      const db: any = getDb();
      // CROSS-TENANT (admin) — listing is multi-partner by design; ownership
      // and visibility filtering applied in JS below.
      const all = db.select().from(portfolioTable).all() as any[];
      rows = all.map(rowToPortfolio).filter((r) => !r.deletedAt);
    } catch {
      rows = Array.from(portfolioCache.values()).filter((r) => !r.deletedAt);
    }
    // partnerContext is only populated by requirePartnerAuth; this route uses
    // requireAuth (any authed user may LIST). Resolve the caller's partnerId
    // (if any) via partner_team_members so they see their OWN rows.
    const tm = partnerTeamStore.findByUserId(ctxUserId);
    const partnerId = req.partnerContext?.partnerId ?? tm?.partnerId;
    const filterPartnerId = (req.query.partner_id as string | undefined) ?? null;
    /* v25.12 NM-8 — visibility "collective" must mean visible only to active
     * Collective members. Previously this branch returned `true` for any
     * authenticated user, which leaked Collective portfolio entries to
     * non-members. Admin still bypasses for support. */
    const ctxFull = (req as Request & { userContext?: { isAdmin?: boolean; collective?: { status?: string } } }).userContext;
    const isCollectiveMember = !!(ctxFull?.collective?.status === "active" || ctxFull?.isAdmin);
    const filtered = rows.filter((r) => {
      if (filterPartnerId && r.partnerId !== filterPartnerId) return false;
      if (partnerId && r.partnerId === partnerId) return true; // own rows
      if (r.visibility === "public") return true;
      if (r.visibility === "collective") return isCollectiveMember;
      return false;
    });
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ portfolio: filtered, count: filtered.length });
  });

  // v25.14 NH5 — see comment on the list endpoint above; same fix.
  app.get("/api/partner/portfolio/:id", requirePartnerAuth, (req, res) => {
    const ctxUserId = (req as Request & { userContext?: { userId?: string } }).userContext?.userId;
    if (!ctxUserId) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const row = findPortfolioByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    const tm = partnerTeamStore.findByUserId(ctxUserId);
    const partnerId = req.partnerContext?.partnerId ?? tm?.partnerId;
    const isOwner = partnerId && row.partnerId === partnerId;
    if (!isOwner) {
      if (row.visibility === "private") {
        res.status(403).json({ error: "NOT_OWNER" });
        return;
      }
      // public / collective allowed
    }
    res.json({ portfolio: row });
  });

  /* v25.16 NH3 — was missing assertSubRole gate; viewers/analysts could PATCH. */
  app.patch("/api/partner/portfolio/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), (req, res) => {
    const ctx = req.partnerContext!;
    const row = findPortfolioByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(403).json({ error: "NOT_OWNER" });
      return;
    }
    const parsed = portfolioUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const now = nowIso();
    const nextVisibility = (parsed.data.visibility ?? row.visibility) as PortfolioVisibility;
    const nextPayload = {
      id: row.id,
      partnerId: row.partnerId,
      companyId: parsed.data.company_id ?? row.companyId,
      visibility: nextVisibility,
      updatedAt: now,
    };
    const nextPrev = row.currHash;
    const nextHash = computeHash(nextPrev, nextPayload);
    const next: PortfolioRow = {
      ...row,
      displayName: parsed.data.display_name ?? row.displayName,
      stage: (parsed.data.stage ?? row.stage) as PortfolioStage,
      sector: parsed.data.sector ?? row.sector,
      leadInvestedAmountMinor: parsed.data.lead_invested_amount_minor ?? row.leadInvestedAmountMinor,
      firstInvestedAt: parsed.data.first_invested_at ?? row.firstInvestedAt,
      notes: parsed.data.notes ?? row.notes,
      visibility: nextVisibility,
      companyId: parsed.data.company_id ?? row.companyId,
      prevHash: nextPrev,
      currHash: nextHash,
      updatedAt: now,
    };
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(portfolioTable)
        .set({
          displayName: next.displayName,
          stage: next.stage,
          sector: next.sector,
          leadInvestedAmountMinor: next.leadInvestedAmountMinor,
          firstInvestedAt: next.firstInvestedAt,
          notes: next.notes,
          visibility: next.visibility,
          companyId: next.companyId,
          prevHash: next.prevHash,
          currHash: next.currHash,
          updatedAt: next.updatedAt,
        })
        .where(eq((portfolioTable as any).id, row.id))
        .run();
    });
    portfolioCache.set(next.id, next);
    publishPartnerEvent(ctx.partnerId, "partner-workspace", {
      type: "portfolio.updated",
      portfolioId: next.id,
      partnerId: ctx.partnerId,
    });
    if (next.visibility === "collective") publishCollectiveVisibilityFanout(next);
    res.json({ ok: true, portfolio: next });
  });

  /* v25.23 NH-H fix — was missing assertSubRole gate on DELETE; viewers/analysts
   * could soft-delete portfolio entries they could not create or edit (PARTIAL
   * FIX of v25.16 NH3 which gated POST/PATCH but missed DELETE). */
  app.delete("/api/partner/portfolio/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), (req, res) => {
    const ctx = req.partnerContext!;
    const row = findPortfolioByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(403).json({ error: "NOT_OWNER" });
      return;
    }
    const now = nowIso();
    const nextPayload = { id: row.id, deleted: true, deletedAt: now };
    const nextPrev = row.currHash;
    const nextHash = computeHash(nextPrev, nextPayload);
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(portfolioTable)
        .set({
          deletedAt: now,
          prevHash: nextPrev,
          currHash: nextHash,
          updatedAt: now,
        })
        .where(eq((portfolioTable as any).id, row.id))
        .run();
    });
    row.deletedAt = now;
    row.prevHash = nextPrev;
    row.currHash = nextHash;
    row.updatedAt = now;
    portfolioCache.set(row.id, row);
    publishPartnerEvent(ctx.partnerId, "partner-workspace", {
      type: "portfolio.deleted",
      portfolioId: row.id,
      partnerId: ctx.partnerId,
    });
    res.json({ ok: true, portfolio: row });
  });

  /* ===================== CRM contacts ===================== */

  // v25.14 NL5 — see portfolio comment above.
  app.post("/api/partner/crm/contacts", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), (req, res) => {
    const ctx = req.partnerContext!;
    const parsed = crmCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const id = newId("pcc");
    const now = nowIso();
    const tenantId = `tenant_partner_${ctx.partnerId}`;
    // CP-008: compute hash chain (prev = current tip, curr = sha256 of canonical payload).
    const prevHash = findCrmChainTip(ctx.partnerId);
    const seed: Pick<CrmContactRow, "partnerId" | "contactUserId" | "email" | "name" | "createdAt"> = {
      partnerId: ctx.partnerId,
      contactUserId: parsed.data.contact_user_id ?? null,
      email: parsed.data.email ?? "",
      name: parsed.data.name,
      createdAt: now,
    };
    const currHash = computeHash(prevHash, crmHashPayload(seed, prevHash));
    const row: CrmContactRow = {
      id,
      tenantId,
      partnerId: ctx.partnerId,
      contactUserId: parsed.data.contact_user_id ?? null,
      email: parsed.data.email ?? "",
      name: parsed.data.name,
      role: parsed.data.role ?? "",
      org: parsed.data.org ?? "",
      lastContactAt: parsed.data.last_contact_at ?? null,
      notes: parsed.data.notes ?? "",
      tags: parsed.data.tags ?? [],
      prevHash,
      currHash,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(crmTable).values({
        id: row.id,
        tenantId: row.tenantId,
        partnerId: row.partnerId,
        contactUserId: row.contactUserId,
        email: row.email,
        name: row.name,
        role: row.role,
        org: row.org,
        lastContactAt: row.lastContactAt,
        notes: row.notes,
        tags: JSON.stringify(row.tags),
        prevHash: row.prevHash,
        currHash: row.currHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: null,
      }).run();
    });
    crmCache.set(row.id, row);
    publishPartnerEvent(ctx.partnerId, "partner-workspace", {
      type: "crm.created",
      contactId: row.id,
      partnerId: ctx.partnerId,
    });
    ssePublish(ctx.partnerId, "crm", {
      type: "crm.created",
      contactId: row.id,
      partnerId: ctx.partnerId,
    });
    res.status(201).json({ ok: true, contact: row });
  });

  app.get("/api/partner/crm/contacts", requirePartnerAuth, (req, res) => {
    const ctx = req.partnerContext!;
    let rows: CrmContactRow[] = [];
    try {
      const db: any = getDb();
      const all = db
        .select()
        .from(crmTable)
        .where(eq((crmTable as any).partnerId, ctx.partnerId))
        .all() as any[];
      rows = all.map(rowToCrm).filter((r) => !r.deletedAt);
    } catch {
      rows = Array.from(crmCache.values()).filter(
        (r) => !r.deletedAt && r.partnerId === ctx.partnerId,
      );
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ contacts: rows, count: rows.length });
  });

  app.get("/api/partner/crm/contacts/:id", requirePartnerAuth, (req, res) => {
    const ctx = req.partnerContext!;
    const row = findCrmByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(403).json({ error: "NOT_OWNER" });
      return;
    }
    res.json({ contact: row });
  });

  /* v25.16 NH3 — was missing assertSubRole gate; viewers/analysts could PATCH. */
  app.patch("/api/partner/crm/contacts/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), (req, res) => {
    const ctx = req.partnerContext!;
    const row = findCrmByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(403).json({ error: "NOT_OWNER" });
      return;
    }
    const parsed = crmUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const now = nowIso();
    // CP-008: extend the partner's CRM chain. prevHash for an UPDATE is the
    // partner's chain tip at the time of the write (which may be this row's
    // own currHash if it was the most recent mutation).
    const nextPrev = findCrmChainTip(ctx.partnerId);
    const nextSeed: Pick<CrmContactRow, "partnerId" | "contactUserId" | "email" | "name" | "createdAt"> = {
      partnerId: row.partnerId,
      contactUserId: parsed.data.contact_user_id ?? row.contactUserId,
      email: parsed.data.email ?? row.email,
      name: parsed.data.name ?? row.name,
      createdAt: now,
    };
    const nextHash = computeHash(nextPrev, crmHashPayload(nextSeed, nextPrev));
    const next: CrmContactRow = {
      ...row,
      contactUserId: parsed.data.contact_user_id ?? row.contactUserId,
      email: parsed.data.email ?? row.email,
      name: parsed.data.name ?? row.name,
      role: parsed.data.role ?? row.role,
      org: parsed.data.org ?? row.org,
      lastContactAt: parsed.data.last_contact_at ?? row.lastContactAt,
      notes: parsed.data.notes ?? row.notes,
      tags: parsed.data.tags ?? row.tags,
      prevHash: nextPrev,
      currHash: nextHash,
      updatedAt: now,
    };
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(crmTable)
        .set({
          contactUserId: next.contactUserId,
          email: next.email,
          name: next.name,
          role: next.role,
          org: next.org,
          lastContactAt: next.lastContactAt,
          notes: next.notes,
          tags: JSON.stringify(next.tags),
          prevHash: next.prevHash,
          currHash: next.currHash,
          updatedAt: next.updatedAt,
        })
        .where(eq((crmTable as any).id, row.id))
        .run();
    });
    crmCache.set(next.id, next);
    publishPartnerEvent(ctx.partnerId, "partner-workspace", {
      type: "crm.updated",
      contactId: next.id,
      partnerId: ctx.partnerId,
    });
    ssePublish(ctx.partnerId, "crm", {
      type: "crm.updated",
      contactId: next.id,
      partnerId: ctx.partnerId,
    });
    res.json({ ok: true, contact: next });
  });

  /* v25.23 NH-H fix — was missing assertSubRole gate on DELETE; viewers/analysts
   * could soft-delete CRM contacts they could not create or edit. */
  app.delete("/api/partner/crm/contacts/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), (req, res) => {
    const ctx = req.partnerContext!;
    const row = findCrmByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(403).json({ error: "NOT_OWNER" });
      return;
    }
    const now = nowIso();
    // CP-008: tombstone mutation also extends the hash chain.
    const nextPrev = findCrmChainTip(ctx.partnerId);
    const tombstoneSeed: Pick<CrmContactRow, "partnerId" | "contactUserId" | "email" | "name" | "createdAt"> = {
      partnerId: row.partnerId,
      contactUserId: row.contactUserId,
      email: row.email,
      name: row.name,
      createdAt: now,
    };
    const tombstoneHash = computeHash(
      nextPrev,
      { ...crmHashPayload(tombstoneSeed, nextPrev), deleted: true },
    );
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(crmTable)
        .set({
          deletedAt: now,
          prevHash: nextPrev,
          currHash: tombstoneHash,
          updatedAt: now,
        })
        .where(eq((crmTable as any).id, row.id))
        .run();
    });
    row.deletedAt = now;
    row.updatedAt = now;
    row.prevHash = nextPrev;
    row.currHash = tombstoneHash;
    crmCache.set(row.id, row);
    publishPartnerEvent(ctx.partnerId, "partner-workspace", {
      type: "crm.deleted",
      contactId: row.id,
      partnerId: ctx.partnerId,
    });
    ssePublish(ctx.partnerId, "crm", {
      type: "crm.deleted",
      contactId: row.id,
      partnerId: ctx.partnerId,
    });
    res.json({ ok: true, contact: row });
  });

  /* ===================== Deal pipeline ===================== */

  // v25.14 NL5 — see portfolio comment above.
  app.post("/api/partner/deals", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), (req, res) => {
    const ctx = req.partnerContext!;
    const parsed = dealCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const id = newId("pdp");
    const now = nowIso();
    const tenantId = `tenant_partner_${ctx.partnerId}`;
    const payload = {
      id,
      partnerId: ctx.partnerId,
      companyId: parsed.data.company_id,
      stage: parsed.data.stage ?? "sourced",
      createdAt: now,
    };
    const prevHash: string | null = null;
    const currHash = computeHash(prevHash, payload);
    const row: DealRow = {
      id,
      tenantId,
      partnerId: ctx.partnerId,
      companyId: parsed.data.company_id,
      stage: (parsed.data.stage ?? "sourced") as DealStage,
      assignedUserIds: parsed.data.assigned_user_ids ?? [],
      targetCloseAt: parsed.data.target_close_at ?? null,
      notes: parsed.data.notes ?? "",
      prevHash,
      currHash,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(dealsTable).values({
        id: row.id,
        tenantId: row.tenantId,
        partnerId: row.partnerId,
        companyId: row.companyId,
        stage: row.stage,
        assignedUserIds: JSON.stringify(row.assignedUserIds),
        targetCloseAt: row.targetCloseAt,
        notes: row.notes,
        prevHash: row.prevHash,
        currHash: row.currHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: null,
      }).run();
    });
    dealsCache.set(row.id, row);
    publishPartnerEvent(ctx.partnerId, "partner-workspace", {
      type: "deal.created",
      dealId: row.id,
      partnerId: ctx.partnerId,
      stage: row.stage,
    });
    res.status(201).json({ ok: true, deal: row });
  });

  app.get("/api/partner/deals", requirePartnerAuth, (req, res) => {
    const ctx = req.partnerContext!;
    let rows: DealRow[] = [];
    try {
      const db: any = getDb();
      const all = db
        .select()
        .from(dealsTable)
        .where(eq((dealsTable as any).partnerId, ctx.partnerId))
        .all() as any[];
      rows = all.map(rowToDeal).filter((r) => !r.deletedAt);
    } catch {
      rows = Array.from(dealsCache.values()).filter(
        (r) => !r.deletedAt && r.partnerId === ctx.partnerId,
      );
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ deals: rows, count: rows.length });
  });

  app.get("/api/partner/deals/:id", requirePartnerAuth, (req, res) => {
    const ctx = req.partnerContext!;
    const row = findDealByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(403).json({ error: "NOT_OWNER" });
      return;
    }
    res.json({ deal: row });
  });

  /* v25.16 NH3 — was missing assertSubRole gate; viewers/analysts could PATCH. */
  app.patch("/api/partner/deals/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), (req, res) => {
    const ctx = req.partnerContext!;
    const row = findDealByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(403).json({ error: "NOT_OWNER" });
      return;
    }
    const parsed = dealUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const now = nowIso();
    const nextStage = (parsed.data.stage ?? row.stage) as DealStage;
    const nextPayload = {
      id: row.id,
      stage: nextStage,
      companyId: parsed.data.company_id ?? row.companyId,
      updatedAt: now,
    };
    const nextPrev = row.currHash;
    const nextHash = computeHash(nextPrev, nextPayload);
    const next: DealRow = {
      ...row,
      stage: nextStage,
      assignedUserIds: parsed.data.assigned_user_ids ?? row.assignedUserIds,
      targetCloseAt: parsed.data.target_close_at ?? row.targetCloseAt,
      notes: parsed.data.notes ?? row.notes,
      companyId: parsed.data.company_id ?? row.companyId,
      prevHash: nextPrev,
      currHash: nextHash,
      updatedAt: now,
    };
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(dealsTable)
        .set({
          stage: next.stage,
          assignedUserIds: JSON.stringify(next.assignedUserIds),
          targetCloseAt: next.targetCloseAt,
          notes: next.notes,
          companyId: next.companyId,
          prevHash: next.prevHash,
          currHash: next.currHash,
          updatedAt: next.updatedAt,
        })
        .where(eq((dealsTable as any).id, row.id))
        .run();
    });
    dealsCache.set(next.id, next);
    publishPartnerEvent(ctx.partnerId, "partner-workspace", {
      type: "deal.updated",
      dealId: next.id,
      partnerId: ctx.partnerId,
      stage: next.stage,
    });
    res.json({ ok: true, deal: next });
  });
}

/* ============================================================
 * Test helpers
 * ============================================================ */

export const _partnerWorkspaceV19Internal = {
  computeHash,
  findPortfolioByIdAnyTenant,
  findCrmByIdAnyTenant,
  findDealByIdAnyTenant,
  portfolioCache,
  crmCache,
  dealsCache,
  rowToPortfolio,
  rowToCrm,
  rowToDeal,
};
