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
import { requireSignedAgreement } from "./lib/requireSignedAgreement"; /* W2-I override — fail-closed sign gate on partner writes */
import { partnerTeamStore, partnerAttributionStore } from "./partnerWorkspaceStore";
import { listMembersForCompany } from "./membershipStore";
import { partnerClientCrmStore } from "./partnerClientCrmStore";
import { getDb, rawDb } from "./db/connection";
import {
  partnerPortfolioCompanies as portfolioTable,
  partnerCrmContacts as crmTable,
  partnerDealPipeline as dealsTable,
  chapterMemberships as chapterMembershipsTable,
  spvs as spvsTable,
  spvCommitments as spvCommitmentsTable,
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

/** GROUP F1 — structured note-log entry (parity with investor CRM). */
export interface CrmNote {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
}

export type CrmTaskPriority = "low" | "medium" | "high";
export type CrmTaskStatus = "open" | "done";

/** GROUP F1 — structured task (priority / status / due). */
export interface CrmTask {
  id: string;
  title: string;
  priority: CrmTaskPriority;
  status: CrmTaskStatus;
  due: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CrmContactRow {
  id: string;
  tenantId: string;
  partnerId: string;
  contactUserId: string | null;
  email: string;
  name: string;
  // v25.51 name-split — discrete identity (additive). `name` stays composed
  // "First Last" and remains the ONLY name field in the CP-008 hash payload,
  // so the partner CRM hash-chain is unaffected.
  firstName: string | null;
  lastName: string | null;
  role: string;
  org: string;
  lastContactAt: string | null;
  notes: string;
  tags: string[];
  // GROUP F1 (migration 0106) — parity fields. None of these enter the CP-008
  // hash payload (which stays the stable identity subset), so writing them
  // still extends the SAME chain via the existing computeHash/findCrmChainTip.
  stage: string | null;
  companyId: string | null;
  noteLog: CrmNote[];
  tasks: CrmTask[];
  starred: boolean;
  sourceKind: string | null;
  sourceRef: string | null;
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

/** Parse a JSON array of objects (note_log / tasks), tolerant of null/garbage. */
function safeJsonObjArray<T>(s: unknown): T[] {
  if (Array.isArray(s)) return s as T[];
  if (typeof s !== "string" || s.length === 0) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function rowToCrm(r: any): CrmContactRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    partnerId: r.partner_id ?? r.partnerId,
    contactUserId: r.contact_user_id ?? r.contactUserId ?? null,
    email: r.email ?? "",
    name: r.name,
    firstName: r.first_name ?? r.firstName ?? null,
    lastName: r.last_name ?? r.lastName ?? null,
    role: r.role ?? "",
    org: r.org ?? "",
    lastContactAt: r.last_contact_at ?? r.lastContactAt ?? null,
    notes: r.notes ?? "",
    tags: safeJsonArray(r.tags),
    stage: r.stage ?? null,
    companyId: r.company_id ?? r.companyId ?? null,
    noteLog: safeJsonObjArray<CrmNote>(r.note_log ?? r.noteLog),
    tasks: safeJsonObjArray<CrmTask>(r.tasks),
    starred: (r.starred ?? 0) === 1 || r.starred === true,
    sourceKind: r.source_kind ?? r.sourceKind ?? null,
    sourceRef: r.source_ref ?? r.sourceRef ?? null,
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

// v25.51 name-split — first_name/last_name are the new discrete inputs. `name`
// stays accepted (and required-on-create via refine) as the composed
// "First Last" for the CP-008 hash-chain + all existing readers.
const crmBaseSchema = z.object({
  contact_user_id: z.string().min(1).optional(),
  email: z.string().email().optional(),
  name: z.string().min(1).max(200).optional(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  role: z.string().max(120).optional(),
  org: z.string().max(200).optional(),
  last_contact_at: z.string().optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});
const crmCreateSchema = crmBaseSchema.refine(
  (d) => (typeof d.name === "string" && d.name.trim().length > 0) || (!!d.first_name && !!d.last_name),
  { message: "name (or both first_name and last_name) is required" },
);
const crmUpdateSchema = crmBaseSchema.partial();

/** v25.51 — compose "First Last", preferring an explicit name. */
function composeCrmContactName(
  name: string | undefined,
  first: string | undefined | null,
  last: string | undefined | null,
  fallback: string,
): string {
  if (typeof name === "string" && name.trim()) return name.trim();
  const composed = [first, last].filter((s) => typeof s === "string" && s.trim()).map((s) => (s as string).trim()).join(" ");
  return composed || fallback;
}

const dealCreateSchema = z.object({
  company_id: z.string().min(1),
  stage: z.enum(["sourced", "screening", "diligence", "term_sheet", "closed", "passed"]).optional(),
  assigned_user_ids: z.array(z.string()).max(20).optional(),
  target_close_at: z.string().optional(),
  notes: z.string().max(4000).optional(),
});
const dealUpdateSchema = dealCreateSchema.partial();

/* ============================================================
 * GROUP F1 — parity CRM (full person-level surface)
 *
 * All of the following operate on the SAME partner_crm_contacts table and the
 * SAME CP-008 hash chain (via findCrmChainTip + computeHash + crmHashPayload).
 * There is NO second store and NO second chain — every parity mutation extends
 * the existing per-partner chain. Every read/write is fail-closed partner-scoped
 * (partnerId always comes from the session, never a client-supplied field).
 * ============================================================ */

// Rule #13 — BOTH first and last name are mandatory on the full-parity create.
const crmMeCreateSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  contact_user_id: z.string().min(1).optional(),
  role: z.string().max(120).optional(),
  org: z.string().max(200).optional(),
  stage: z.string().max(60).optional(),
  company_id: z.string().min(1).max(120).optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  last_contact_at: z.string().optional(),
});

const crmMeUpdateSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.string().max(120).optional(),
  org: z.string().max(200).optional(),
  stage: z.string().max(60).nullable().optional(),
  company_id: z.string().min(1).max(120).nullable().optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  last_contact_at: z.string().optional(),
});

const crmNoteSchema = z.object({ body: z.string().min(1).max(4000) });
const crmTaskCreateSchema = z.object({
  title: z.string().min(1).max(300),
  priority: z.enum(["low", "medium", "high"]).optional(),
  due: z.string().max(40).optional(),
});
const crmTaskUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["open", "done"]).optional(),
  due: z.string().max(40).nullable().optional(),
});
const crmStarSchema = z.object({ starred: z.boolean() });

const crmFromSourceSchema = z.object({
  source_kind: z.enum(["spv_lp"]),
  source_ref: z.string().min(1).max(200),
  identity: z.object({
    email: z.string().email().optional(),
    name: z.string().max(200).optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
  }),
});

/**
 * Resolve an email to a platform userId (partner-owned email identity). This is
 * the ONLY way we derive a user linkage — we NEVER trust a client-supplied
 * contact_user_id for cross-module connection reads. Fail-closed: any error or
 * missing row yields null (no connection is surfaced).
 */
function findUserIdByEmail(email: string | null | undefined): string | null {
  const e = typeof email === "string" ? email.trim() : "";
  if (!e) return null;
  try {
    const pdb = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
    if (!pdb || typeof pdb.prepare !== "function") return null;
    const row = pdb
      .prepare(`SELECT id FROM users WHERE lower(trim(email)) = lower(trim(?)) AND deleted_at IS NULL LIMIT 1`)
      .get(e) as { id?: string } | undefined;
    return row?.id ?? null;
  } catch (err) {
    log.warn("[partner CRM] findUserIdByEmail failed (fail-closed to null):", (err as Error).message);
    return null;
  }
}

export interface CrmContactConnections {
  /** Resolved from the contact EMAIL (partner-owned identity), not a client id. */
  resolvedUserId: string | null;
  spvLpMemberships: Array<{ spvId: string; spvName: string; status: string; amountMinor: number }>;
  capTableHoldings: Array<{ companyId: string; ownershipPct: number }>;
  portfolio: Array<{ id: string; companyId: string; displayName: string; stage: string }>;
  collectiveMembership: { userId: string; chapterId: string; role: string; status: string } | null;
  client: { companyId: string; stage: string; lastActivityAt: string | null } | null;
}

/**
 * Partner-scoped, READ-ONLY cross-module connections for a CRM contact. Every
 * join is bounded by the caller's partnerId; a contact belonging to partner A
 * can never surface partner B's SPVs, attributions, portfolio, or client rows.
 * The Collective linkage is derived from the contact's EMAIL → userId only.
 */
export function resolveContactConnections(
  partnerId: string,
  contact: Pick<CrmContactRow, "email" | "companyId">,
): CrmContactConnections {
  const out: CrmContactConnections = {
    resolvedUserId: null,
    spvLpMemberships: [],
    capTableHoldings: [],
    portfolio: [],
    collectiveMembership: null,
    client: null,
  };
  const resolvedUserId = findUserIdByEmail(contact.email);
  out.resolvedUserId = resolvedUserId;

  // 1) SPV LP memberships — only THIS partner's SPVs, matched by the
  //    email-derived userId against spv_commitments.lp_user_id.
  if (resolvedUserId) {
    try {
      const db: any = getDb();
      const spvRows = db
        .select()
        .from(spvsTable)
        .where(and(eq((spvsTable as any).partnerId, partnerId), isNull((spvsTable as any).deletedAt)))
        .all() as any[];
      const spvById = new Map<string, any>();
      for (const s of spvRows) spvById.set(s.id, s);
      if (spvById.size > 0) {
        const commits = db
          .select()
          .from(spvCommitmentsTable)
          .where(
            and(
              eq((spvCommitmentsTable as any).lpUserId, resolvedUserId),
              inArray((spvCommitmentsTable as any).spvId, Array.from(spvById.keys())),
            ),
          )
          .all() as any[];
        for (const c of commits) {
          const s = spvById.get(c.spv_id ?? c.spvId);
          if (!s) continue; // defensive: only this partner's SPVs
          out.spvLpMemberships.push({
            spvId: c.spv_id ?? c.spvId,
            spvName: s.name ?? "",
            status: c.status ?? "pending",
            amountMinor: Number(c.amount_minor ?? c.amountMinor ?? 0),
          });
        }
      }
    } catch (err) {
      log.warn("[partner CRM] SPV LP connection read failed:", (err as Error).message);
    }
  }

  // 2) Cap-table holdings — READ-ONLY via listMembersForCompany over companies
  //    attributed to THIS partner. No ledger write. Matched by email→userId.
  if (resolvedUserId) {
    try {
      const attrs = partnerAttributionStore.listByPartner(partnerId);
      for (const a of attrs) {
        if (!a.companyId) continue;
        const members = listMembersForCompany(a.companyId);
        const mine = members.find((m) => m.userId === resolvedUserId);
        if (mine) out.capTableHoldings.push({ companyId: a.companyId, ownershipPct: mine.ownershipPct });
      }
    } catch (err) {
      log.warn("[partner CRM] cap-table connection read failed:", (err as Error).message);
    }
  }

  // 3) Portfolio — this partner's portfolio rows for the contact's company_id.
  if (contact.companyId) {
    try {
      const db: any = getDb();
      const pRows = db
        .select()
        .from(portfolioTable)
        .where(
          and(
            eq((portfolioTable as any).partnerId, partnerId),
            eq((portfolioTable as any).companyId, contact.companyId),
            isNull((portfolioTable as any).deletedAt),
          ),
        )
        .all() as any[];
      for (const r of pRows) {
        const p = rowToPortfolio(r);
        out.portfolio.push({ id: p.id, companyId: p.companyId, displayName: p.displayName, stage: p.stage });
      }
    } catch (err) {
      log.warn("[partner CRM] portfolio connection read failed:", (err as Error).message);
    }
  }

  // 4) Collective membership — from the email-derived userId ONLY (fail-closed;
  //    NEVER a client-supplied contact id). Person-level, not partner data.
  if (resolvedUserId) {
    try {
      const db: any = getDb();
      const cm = db
        .select()
        .from(chapterMembershipsTable)
        .where(
          and(
            eq((chapterMembershipsTable as any).userId, resolvedUserId),
            eq((chapterMembershipsTable as any).status, "active"),
            isNull((chapterMembershipsTable as any).deletedAt),
          ),
        )
        .limit(1)
        .all() as any[];
      if (cm.length > 0) {
        const r = cm[0];
        out.collectiveMembership = {
          userId: r.user_id ?? r.userId,
          chapterId: r.chapter_id ?? r.chapterId,
          role: r.role ?? "member",
          status: r.status ?? "active",
        };
      }
    } catch (err) {
      log.warn("[partner CRM] collective connection read failed:", (err as Error).message);
    }
  }

  // 5) Client stage/activity — existing company-level partner_client_crm surface
  //    (kept intact), scoped to this partner + the contact's company_id.
  if (contact.companyId) {
    try {
      const stage = partnerClientCrmStore.getStage(partnerId, contact.companyId);
      const activity = partnerClientCrmStore.listActivity(partnerId, contact.companyId);
      out.client = {
        companyId: contact.companyId,
        stage,
        lastActivityAt: activity.length > 0 ? activity[0].occurredAt : null,
      };
    } catch (err) {
      log.warn("[partner CRM] client connection read failed:", (err as Error).message);
    }
  }

  return out;
}

/**
 * Fail-closed pre-write dedup check for the partner CRM. Returns the existing
 * contact id when a live (partner_id, lower(trim(email))) row already exists
 * (optionally excluding one id), or null. Throws on infra failure so callers
 * can fail closed (503). Mirrors the create/patch guards already in this file.
 */
function findLiveDuplicateEmailId(partnerId: string, email: string, excludeId?: string): string | null {
  const e = typeof email === "string" ? email.trim() : "";
  if (!e) return null;
  const pdb = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
  if (!pdb || typeof pdb.prepare !== "function") {
    throw new Error("rawDb().prepare unavailable — cannot run partner dedup guard");
  }
  const sql = excludeId
    ? `SELECT id FROM partner_crm_contacts WHERE partner_id = ? AND lower(trim(email)) = lower(trim(?)) AND id <> ? AND deleted_at IS NULL LIMIT 1`
    : `SELECT id FROM partner_crm_contacts WHERE partner_id = ? AND lower(trim(email)) = lower(trim(?)) AND deleted_at IS NULL LIMIT 1`;
  const stmt = pdb.prepare(sql);
  const dup = (excludeId ? stmt.get(partnerId, e, excludeId) : stmt.get(partnerId, e)) as { id?: string } | undefined;
  return dup?.id ?? null;
}

/**
 * CP-008 chain-extending write for a set of parity column changes on an existing
 * contact. Every parity mutation (notes/tasks/star/stage/tags) funnels through
 * here so the SAME per-partner chain is extended (never forked). The hash uses
 * the stable identity payload + a mutation marker (mirrors the delete path's
 * `{ ...payload, deleted: true }`).
 */
function writeCrmMutation(
  row: CrmContactRow,
  fields: Partial<CrmContactRow>,
  columns: Record<string, unknown>,
  mutation: string,
): CrmContactRow {
  const now = nowIso();
  const nextPrev = findCrmChainTip(row.partnerId);
  const seed: Pick<CrmContactRow, "partnerId" | "contactUserId" | "email" | "name" | "createdAt"> = {
    partnerId: row.partnerId,
    contactUserId: row.contactUserId,
    email: fields.email ?? row.email,
    name: fields.name ?? row.name,
    createdAt: now,
  };
  const nextHash = computeHash(nextPrev, { ...crmHashPayload(seed, nextPrev), mutation });
  const next: CrmContactRow = { ...row, ...fields, prevHash: nextPrev, currHash: nextHash, updatedAt: now };
  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.update(crmTable)
      .set({ ...columns, prevHash: nextPrev, currHash: nextHash, updatedAt: now })
      .where(eq((crmTable as any).id, row.id))
      .run();
  });
  crmCache.set(next.id, next);
  ssePublish(row.partnerId, "crm", { type: mutation, contactId: next.id, partnerId: row.partnerId });
  return next;
}

/** Build + persist a NEW parity contact (chain-extended). Assumes caller has
 *  already validated input + run the dedup guard. */
function insertCrmContact(args: {
  partnerId: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  contactUserId: string | null;
  role: string;
  org: string;
  stage: string | null;
  companyId: string | null;
  notes: string;
  tags: string[];
  lastContactAt: string | null;
  sourceKind: string | null;
  sourceRef: string | null;
}): CrmContactRow {
  const id = newId("pcc");
  const now = nowIso();
  const tenantId = `tenant_partner_${args.partnerId}`;
  const prevHash = findCrmChainTip(args.partnerId);
  const seed: Pick<CrmContactRow, "partnerId" | "contactUserId" | "email" | "name" | "createdAt"> = {
    partnerId: args.partnerId,
    contactUserId: args.contactUserId,
    email: args.email,
    name: args.name,
    createdAt: now,
  };
  const currHash = computeHash(prevHash, crmHashPayload(seed, prevHash));
  const row: CrmContactRow = {
    id,
    tenantId,
    partnerId: args.partnerId,
    contactUserId: args.contactUserId,
    email: args.email,
    name: args.name,
    firstName: args.firstName,
    lastName: args.lastName,
    role: args.role,
    org: args.org,
    lastContactAt: args.lastContactAt,
    notes: args.notes,
    tags: args.tags,
    stage: args.stage,
    companyId: args.companyId,
    noteLog: [],
    tasks: [],
    starred: false,
    sourceKind: args.sourceKind,
    sourceRef: args.sourceRef,
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
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      org: row.org,
      lastContactAt: row.lastContactAt,
      notes: row.notes,
      tags: JSON.stringify(row.tags),
      stage: row.stage,
      companyId: row.companyId,
      noteLog: JSON.stringify(row.noteLog),
      tasks: JSON.stringify(row.tasks),
      starred: row.starred,
      sourceKind: row.sourceKind,
      sourceRef: row.sourceRef,
      prevHash: row.prevHash,
      currHash: row.currHash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: null,
    }).run();
  });
  crmCache.set(row.id, row);
  ssePublish(args.partnerId, "crm", { type: "crm.created", contactId: row.id, partnerId: args.partnerId });
  return row;
}

export type FromSourceResult =
  | { status: 201; contact: CrmContactRow }
  | { status: 200; contact: CrmContactRow; existing: true }
  | { status: 404; error: string }
  | { status: 400; error: string }
  | { status: 409; error: string; existingId: string | null }
  | { status: 503; error: string };

/**
 * Idempotent creation of a CRM contact from an owned source (e.g. an SPV LP
 * row). Verifies the source belongs to THIS partner (else 404), then upserts by
 * (partnerId, lower(trim(email))). Chain-extended via insertCrmContact.
 */
export function createFromSource(args: {
  partnerId: string;
  sourceKind: string;
  sourceRef: string;
  identity: { email?: string; name?: string; first_name?: string; last_name?: string };
}): FromSourceResult {
  const { partnerId, sourceKind, sourceRef, identity } = args;

  // Verify source ownership. Only 'spv_lp' is supported: sourceRef = spvId, and
  // the SPV must belong to this partner. Cross-partner / unknown source → 404.
  if (sourceKind === "spv_lp") {
    try {
      const db: any = getDb();
      const spv = db
        .select()
        .from(spvsTable)
        .where(and(eq((spvsTable as any).id, sourceRef), eq((spvsTable as any).partnerId, partnerId)))
        .limit(1)
        .all() as any[];
      if (spv.length === 0) return { status: 404, error: "source_not_found" };
    } catch (err) {
      log.error("[partner CRM from-source] source verify failed — failing closed:", (err as Error).message);
      return { status: 503, error: "source_verify_unavailable" };
    }
  } else {
    return { status: 400, error: "unsupported_source_kind" };
  }

  const email = typeof identity.email === "string" ? identity.email.trim() : "";
  const first = identity.first_name?.trim() || null;
  const last = identity.last_name?.trim() || null;
  const composed = composeCrmContactName(identity.name, first, last, email || "SPV LP");

  // Idempotent by (partnerId, email). If a live contact already exists, return
  // it unchanged (no duplicate chain row written).
  if (email) {
    let existingId: string | null = null;
    try {
      existingId = findLiveDuplicateEmailId(partnerId, email);
    } catch (err) {
      log.error("[partner CRM from-source] dedup guard failed — failing closed:", (err as Error).message);
      return { status: 503, error: "crm_dedup_check_unavailable" };
    }
    if (existingId) {
      const existing = findCrmByIdAnyTenant(existingId);
      if (existing) return { status: 200, contact: existing, existing: true };
    }
  }

  const row = insertCrmContact({
    partnerId,
    email,
    name: composed,
    firstName: first,
    lastName: last,
    contactUserId: null,
    role: "",
    org: "",
    stage: null,
    companyId: null,
    notes: "",
    tags: [],
    lastContactAt: null,
    sourceKind,
    sourceRef,
  });
  return { status: 201, contact: row };
}

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

/* ============================================================
 * WAVE 35 · F9 (THIRD instance of the enumeration-oracle class)
 * ============================================================
 * Review A named three cap-table sinks that answered 403 for a company the
 * caller has no relationship to, while the codebase's own stated policy
 * (`server/routes.ts`) is 404 precisely so the id's EXISTENCE is not leaked.
 * The same oracle lived here, on eight partner-tenant sinks keyed on
 * `*ByIdAnyTenant` lookups (portfolio rows, CRM contacts, deals):
 *
 *     row missing            -> 404 NOT_FOUND
 *     row exists, other partner -> 403 NOT_OWNER      <-- the leak
 *
 * A partner walking an id space could therefore read off exactly which
 * portfolio-company, CRM-contact and deal ids are real across EVERY other
 * partner on the platform — the deal-flow surface is the most commercially
 * sensitive data a partner holds. Both branches now answer 404 NOT_FOUND;
 * "exists but forbidden" is indistinguishable from "does not exist".
 *
 * This is a DELIBERATE contract change, not a silent one: two assertions in
 * `server/__tests__/partnerWorkspaceMigration.test.ts` pinned the old 403 and
 * were updated in the same change, with the cross-tenant-isolation intent they
 * were written to protect preserved (the row is still refused, and the
 * OWNER's 200 and the collective-visibility 200 are both still asserted).
 * ============================================================ */
export const PARTNER_TENANT_REFUSAL = { error: "NOT_FOUND" as const };
export const PARTNER_TENANT_REFUSAL_STATUS = 404;

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
  app.post("/api/partner/portfolio", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), requireSignedAgreement, (req, res) => {
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
        res.status(PARTNER_TENANT_REFUSAL_STATUS).json(PARTNER_TENANT_REFUSAL); // WAVE 35 · F9
        return;
      }
      // public / collective allowed
    }
    res.json({ portfolio: row });
  });

  /* v25.16 NH3 — was missing assertSubRole gate; viewers/analysts could PATCH. */
  app.patch("/api/partner/portfolio/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), requireSignedAgreement, (req, res) => {
    const ctx = req.partnerContext!;
    const row = findPortfolioByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(PARTNER_TENANT_REFUSAL_STATUS).json(PARTNER_TENANT_REFUSAL); // WAVE 35 · F9
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
  app.delete("/api/partner/portfolio/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), requireSignedAgreement, (req, res) => {
    const ctx = req.partnerContext!;
    const row = findPortfolioByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(PARTNER_TENANT_REFUSAL_STATUS).json(PARTNER_TENANT_REFUSAL); // WAVE 35 · F9
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
  app.post("/api/partner/crm/contacts", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), requireSignedAgreement, (req, res) => {
    const ctx = req.partnerContext!;
    const parsed = crmCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    // v25.52 Track 3.5.2 (GPT-5.5 R2 blocker) — PRE-INSERT dedup guard for the
    // partner CRM create path. 0097 exempts ALL existing partner duplicate
    // (partner_id, normalized email) groups from the 0098 partial UNIQUE index
    // (to keep the audit hash chain byte-identical — never soft-deletes a chain
    // row). Consequently the index alone CANNOT reject a NEW insert into an
    // exempt group (it sees only one non-exempt row), so without this guard a
    // user could reopen "many <name>s" for a shared-inbox email. We therefore
    // reject a duplicate BEFORE computing/writing the chain row by checking ANY
    // live row (exempt OR not) with the same (partner_id, lower(trim(email))).
    // FAIL CLOSED: if the guard cannot execute we return 503 rather than fall
    // through to an unprotected insert. Read-only; the hash chain is untouched.
    // Empty email skips this block (email-less contacts are unaffected).
    const incomingPartnerEmail = typeof parsed.data.email === "string" ? parsed.data.email.trim() : "";
    if (incomingPartnerEmail) {
      try {
        const pdb = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
        if (!pdb || typeof pdb.prepare !== "function") {
          throw new Error("rawDb().prepare unavailable — cannot run partner pre-insert dedup guard");
        }
        const dup = pdb
          .prepare(
            `SELECT id FROM partner_crm_contacts
             WHERE partner_id = ? AND lower(trim(email)) = lower(trim(?))
               AND deleted_at IS NULL
             LIMIT 1`,
          )
          .get(ctx.partnerId, incomingPartnerEmail) as { id?: string } | undefined;
        if (dup) {
          res.status(409).json({
            ok: false,
            error: "crm_contact_duplicate_email",
            message: "A contact with this email already exists for this partner.",
            existingId: dup.id ?? null,
          });
          return;
        }
      } catch (dupErr) {
        log.error("[partner CRM POST] pre-insert dedup check failed — failing closed:", (dupErr as Error).message);
        res.status(503).json({
          ok: false,
          error: "crm_dedup_check_unavailable",
          message: "Could not verify contact uniqueness right now. Please retry.",
        });
        return;
      }
    }

    const id = newId("pcc");
    const now = nowIso();
    const tenantId = `tenant_partner_${ctx.partnerId}`;
    // CP-008: compute hash chain (prev = current tip, curr = sha256 of canonical payload).
    const prevHash = findCrmChainTip(ctx.partnerId);
    const composedName = composeCrmContactName(parsed.data.name, parsed.data.first_name, parsed.data.last_name, "New contact");
    const seed: Pick<CrmContactRow, "partnerId" | "contactUserId" | "email" | "name" | "createdAt"> = {
      partnerId: ctx.partnerId,
      contactUserId: parsed.data.contact_user_id ?? null,
      email: parsed.data.email ?? "",
      name: composedName,
      createdAt: now,
    };
    const currHash = computeHash(prevHash, crmHashPayload(seed, prevHash));
    const row: CrmContactRow = {
      id,
      tenantId,
      partnerId: ctx.partnerId,
      contactUserId: parsed.data.contact_user_id ?? null,
      email: parsed.data.email ?? "",
      name: composedName,
      firstName: parsed.data.first_name ?? null,
      lastName: parsed.data.last_name ?? null,
      role: parsed.data.role ?? "",
      org: parsed.data.org ?? "",
      lastContactAt: parsed.data.last_contact_at ?? null,
      notes: parsed.data.notes ?? "",
      tags: parsed.data.tags ?? [],
      stage: null,
      companyId: null,
      noteLog: [],
      tasks: [],
      starred: false,
      sourceKind: null,
      sourceRef: null,
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
        firstName: row.firstName,
        lastName: row.lastName,
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
      res.status(PARTNER_TENANT_REFUSAL_STATUS).json(PARTNER_TENANT_REFUSAL); // WAVE 35 · F9
      return;
    }
    res.json({ contact: row });
  });

  /* v25.16 NH3 — was missing assertSubRole gate; viewers/analysts could PATCH. */
  app.patch("/api/partner/crm/contacts/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), requireSignedAgreement, (req, res) => {
    const ctx = req.partnerContext!;
    const row = findCrmByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(PARTNER_TENANT_REFUSAL_STATUS).json(PARTNER_TENANT_REFUSAL); // WAVE 35 · F9
      return;
    }
    const parsed = crmUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    // v25.52 Track 3.5.2 (GPT-5.5 R3 blocker) — PRE-UPDATE email dedup guard,
    // symmetric to the create-path guard. crmUpdateSchema allows changing email;
    // 0098's partial UNIQUE index EXCLUDES dedup_exempt=1 rows, so PATCHing this
    // row's email to one that only exists on an exempt shared-inbox group would
    // NOT be rejected by the index — and since PATCH is a CHAIN-EXTENDING write,
    // the fail-open would be committed into the partner CRM audit chain. We reject
    // the update BEFORE reading the chain tip / computing the hash / writing, if
    // the NEW email matches ANY OTHER live row (exempt or not) for this partner.
    // FAIL CLOSED (503) if the guard cannot execute. Only runs when email is
    // actually being changed to a non-empty value; a rejected PATCH writes NO
    // chain row, so the hash chain is untouched.
    if (typeof parsed.data.email === "string") {
      const nextEmail = parsed.data.email.trim();
      const emailChanged = nextEmail.toLowerCase() !== String(row.email ?? "").trim().toLowerCase();
      if (nextEmail && emailChanged) {
        try {
          const pdb = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
          if (!pdb || typeof pdb.prepare !== "function") {
            throw new Error("rawDb().prepare unavailable — cannot run partner pre-update dedup guard");
          }
          const dup = pdb
            .prepare(
              `SELECT id FROM partner_crm_contacts
               WHERE partner_id = ? AND lower(trim(email)) = lower(trim(?))
                 AND id <> ? AND deleted_at IS NULL
               LIMIT 1`,
            )
            .get(ctx.partnerId, nextEmail, row.id) as { id?: string } | undefined;
          if (dup) {
            res.status(409).json({
              ok: false,
              error: "crm_contact_duplicate_email",
              message: "Another contact with this email already exists for this partner.",
              existingId: dup.id ?? null,
            });
            return;
          }
        } catch (dupErr) {
          log.error("[partner CRM PATCH] pre-update dedup check failed — failing closed:", (dupErr as Error).message);
          res.status(503).json({
            ok: false,
            error: "crm_dedup_check_unavailable",
            message: "Could not verify contact uniqueness right now. Please retry.",
          });
          return;
        }
      }
    }
    const now = nowIso();
    // CP-008: extend the partner's CRM chain. prevHash for an UPDATE is the
    // partner's chain tip at the time of the write (which may be this row's
    // own currHash if it was the most recent mutation).
    const nextPrev = findCrmChainTip(ctx.partnerId);
    const nextFirst = parsed.data.first_name ?? row.firstName;
    const nextLast = parsed.data.last_name ?? row.lastName;
    // Recompose `name` when a name part changed and no explicit name was sent.
    const nameChangedParts = parsed.data.first_name !== undefined || parsed.data.last_name !== undefined;
    const nextName = typeof parsed.data.name === "string" && parsed.data.name.trim()
      ? parsed.data.name.trim()
      : (nameChangedParts ? composeCrmContactName(undefined, nextFirst, nextLast, row.name) : row.name);
    const nextSeed: Pick<CrmContactRow, "partnerId" | "contactUserId" | "email" | "name" | "createdAt"> = {
      partnerId: row.partnerId,
      contactUserId: parsed.data.contact_user_id ?? row.contactUserId,
      email: parsed.data.email ?? row.email,
      name: nextName,
      createdAt: now,
    };
    const nextHash = computeHash(nextPrev, crmHashPayload(nextSeed, nextPrev));
    const next: CrmContactRow = {
      ...row,
      contactUserId: parsed.data.contact_user_id ?? row.contactUserId,
      email: parsed.data.email ?? row.email,
      name: nextName,
      firstName: nextFirst,
      lastName: nextLast,
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
          firstName: next.firstName,
          lastName: next.lastName,
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
  app.delete("/api/partner/crm/contacts/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), requireSignedAgreement, (req, res) => {
    const ctx = req.partnerContext!;
    const row = findCrmByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(PARTNER_TENANT_REFUSAL_STATUS).json(PARTNER_TENANT_REFUSAL); // WAVE 35 · F9
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
  app.post("/api/partner/deals", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), requireSignedAgreement, (req, res) => {
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
      res.status(PARTNER_TENANT_REFUSAL_STATUS).json(PARTNER_TENANT_REFUSAL); // WAVE 35 · F9
      return;
    }
    res.json({ deal: row });
  });

  /* v25.16 NH3 — was missing assertSubRole gate; viewers/analysts could PATCH. */
  app.patch("/api/partner/deals/:id", requirePartnerAuth, assertSubRole("managing_partner", "associate", "bd"), requireSignedAgreement, (req, res) => {
    const ctx = req.partnerContext!;
    const row = findDealByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (row.partnerId !== ctx.partnerId) {
      res.status(PARTNER_TENANT_REFUSAL_STATUS).json(PARTNER_TENANT_REFUSAL); // WAVE 35 · F9
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

  /* ===================== GROUP F1 — full-parity person CRM =====================
   * New `/api/partner/me/crm/contacts` surface over the SAME partner_crm_contacts
   * table + CP-008 chain as the legacy `/api/partner/crm/contacts` routes above
   * (which stay intact — no silent drop). Adds list-filter, connections,
   * notes/tasks/star, and idempotent from-source import. Writes are role- and
   * signed-agreement-gated exactly like the other partner writes.
   */
  const CRM_WRITE = [
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    requireSignedAgreement,
  ] as const;

  /** Load a contact owned by the session partner, or write 404/403 + return null. */
  function loadOwnedContact(req: Request, res: Response): CrmContactRow | null {
    const ctx = req.partnerContext!;
    const row = findCrmByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "NOT_FOUND" });
      return null;
    }
    if (row.partnerId !== ctx.partnerId) {
      // Fail-closed: cross-partner access is indistinguishable from not-found.
      res.status(404).json({ error: "NOT_FOUND" });
      return null;
    }
    return row;
  }

  // ---- List (filter: q / stage / starred / tag) ----
  app.get("/api/partner/me/crm/contacts", requirePartnerAuth, (req, res) => {
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
      rows = Array.from(crmCache.values()).filter((r) => !r.deletedAt && r.partnerId === ctx.partnerId);
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const stage = typeof req.query.stage === "string" ? req.query.stage.trim() : "";
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim().toLowerCase() : "";
    const starredOnly = req.query.starred === "1" || req.query.starred === "true";
    let filtered = rows;
    if (q) {
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.org ?? "").toLowerCase().includes(q),
      );
    }
    if (stage) filtered = filtered.filter((r) => (r.stage ?? "") === stage);
    if (tag) filtered = filtered.filter((r) => r.tags.some((t) => t.toLowerCase() === tag));
    if (starredOnly) filtered = filtered.filter((r) => r.starred);
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ contacts: filtered, count: filtered.length });
  });

  // ---- From-source import (idempotent; registered before /:id GET is fine
  //      since this is POST on a distinct path) ----
  app.post("/api/partner/me/crm/contacts/from-source", ...CRM_WRITE, (req, res) => {
    const ctx = req.partnerContext!;
    const parsed = crmFromSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const result = createFromSource({
      partnerId: ctx.partnerId,
      sourceKind: parsed.data.source_kind,
      sourceRef: parsed.data.source_ref,
      identity: parsed.data.identity,
    });
    if (result.status === 201) {
      res.status(201).json({ ok: true, contact: result.contact });
    } else if (result.status === 200) {
      res.status(200).json({ ok: true, contact: result.contact, existing: true });
    } else {
      res.status(result.status).json({ ok: false, error: result.error });
    }
  });

  // ---- Detail incl. connections ----
  app.get("/api/partner/me/crm/contacts/:id", requirePartnerAuth, (req, res) => {
    const ctx = req.partnerContext!;
    const row = loadOwnedContact(req, res);
    if (!row) return;
    const connections = resolveContactConnections(ctx.partnerId, row);
    res.json({ contact: row, connections });
  });

  // ---- Create (Rule #13: first + last mandatory; per-partner dedup) ----
  app.post("/api/partner/me/crm/contacts", ...CRM_WRITE, (req, res) => {
    const ctx = req.partnerContext!;
    const parsed = crmMeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const email = parsed.data.email?.trim() ?? "";
    if (email) {
      try {
        const dupId = findLiveDuplicateEmailId(ctx.partnerId, email);
        if (dupId) {
          res.status(409).json({ ok: false, error: "crm_contact_duplicate_email", existingId: dupId });
          return;
        }
      } catch (err) {
        log.error("[partner CRM me POST] dedup check failed — failing closed:", (err as Error).message);
        res.status(503).json({ ok: false, error: "crm_dedup_check_unavailable" });
        return;
      }
    }
    const name = composeCrmContactName(undefined, parsed.data.first_name, parsed.data.last_name, "New contact");
    const row = insertCrmContact({
      partnerId: ctx.partnerId,
      email,
      name,
      firstName: parsed.data.first_name,
      lastName: parsed.data.last_name,
      contactUserId: parsed.data.contact_user_id ?? null,
      role: parsed.data.role ?? "",
      org: parsed.data.org ?? "",
      stage: parsed.data.stage ?? null,
      companyId: parsed.data.company_id ?? null,
      notes: parsed.data.notes ?? "",
      tags: parsed.data.tags ?? [],
      lastContactAt: parsed.data.last_contact_at ?? null,
      sourceKind: null,
      sourceRef: null,
    });
    res.status(201).json({ ok: true, contact: row });
  });

  // ---- Update (email change re-runs the dedup guard) ----
  app.patch("/api/partner/me/crm/contacts/:id", ...CRM_WRITE, (req, res) => {
    const ctx = req.partnerContext!;
    const row = loadOwnedContact(req, res);
    if (!row) return;
    const parsed = crmMeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    if (typeof parsed.data.email === "string") {
      const nextEmail = parsed.data.email.trim();
      const changed = nextEmail.toLowerCase() !== String(row.email ?? "").trim().toLowerCase();
      if (nextEmail && changed) {
        try {
          const dupId = findLiveDuplicateEmailId(ctx.partnerId, nextEmail, row.id);
          if (dupId) {
            res.status(409).json({ ok: false, error: "crm_contact_duplicate_email", existingId: dupId });
            return;
          }
        } catch (err) {
          log.error("[partner CRM me PATCH] dedup check failed — failing closed:", (err as Error).message);
          res.status(503).json({ ok: false, error: "crm_dedup_check_unavailable" });
          return;
        }
      }
    }
    const nextFirst = parsed.data.first_name ?? row.firstName;
    const nextLast = parsed.data.last_name ?? row.lastName;
    const nameChanged = parsed.data.first_name !== undefined || parsed.data.last_name !== undefined;
    const nextName = nameChanged ? composeCrmContactName(undefined, nextFirst, nextLast, row.name) : row.name;
    const nextEmail = parsed.data.email ?? row.email;
    const fields: Partial<CrmContactRow> = {
      email: nextEmail,
      name: nextName,
      firstName: nextFirst,
      lastName: nextLast,
      role: parsed.data.role ?? row.role,
      org: parsed.data.org ?? row.org,
      stage: parsed.data.stage !== undefined ? parsed.data.stage : row.stage,
      companyId: parsed.data.company_id !== undefined ? parsed.data.company_id : row.companyId,
      notes: parsed.data.notes ?? row.notes,
      tags: parsed.data.tags ?? row.tags,
      lastContactAt: parsed.data.last_contact_at ?? row.lastContactAt,
    };
    const columns: Record<string, unknown> = {
      email: fields.email,
      name: fields.name,
      firstName: fields.firstName,
      lastName: fields.lastName,
      role: fields.role,
      org: fields.org,
      stage: fields.stage,
      companyId: fields.companyId,
      notes: fields.notes,
      tags: JSON.stringify(fields.tags),
      lastContactAt: fields.lastContactAt,
    };
    const next = writeCrmMutation(row, fields, columns, "crm.updated");
    res.json({ ok: true, contact: next });
  });

  // ---- Soft delete (chain-extended tombstone) ----
  app.delete("/api/partner/me/crm/contacts/:id", ...CRM_WRITE, (req, res) => {
    const row = loadOwnedContact(req, res);
    if (!row) return;
    const now = nowIso();
    const next = writeCrmMutation(row, { deletedAt: now }, { deletedAt: now }, "crm.deleted");
    res.json({ ok: true, contact: next });
  });

  // ---- Append a note to note_log ----
  app.post("/api/partner/me/crm/contacts/:id/notes", ...CRM_WRITE, (req, res) => {
    const ctx = req.partnerContext!;
    const row = loadOwnedContact(req, res);
    if (!row) return;
    const parsed = crmNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const actorId = (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? null;
    const note: CrmNote = { id: newId("pcn"), body: parsed.data.body, createdAt: nowIso(), authorId: actorId };
    const nextLog = [note, ...row.noteLog];
    const next = writeCrmMutation(row, { noteLog: nextLog }, { noteLog: JSON.stringify(nextLog) }, "crm.note.added");
    res.status(201).json({ ok: true, note, contact: next });
  });

  // ---- Append a task ----
  app.post("/api/partner/me/crm/contacts/:id/tasks", ...CRM_WRITE, (req, res) => {
    const row = loadOwnedContact(req, res);
    if (!row) return;
    const parsed = crmTaskCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const task: CrmTask = {
      id: newId("pct"),
      title: parsed.data.title,
      priority: parsed.data.priority ?? "medium",
      status: "open",
      due: parsed.data.due ?? null,
      createdAt: nowIso(),
      completedAt: null,
    };
    const nextTasks = [task, ...row.tasks];
    const next = writeCrmMutation(row, { tasks: nextTasks }, { tasks: JSON.stringify(nextTasks) }, "crm.task.added");
    res.status(201).json({ ok: true, task, contact: next });
  });

  // ---- Update a task (status/title/priority/due) ----
  app.patch("/api/partner/me/crm/contacts/:id/tasks/:taskId", ...CRM_WRITE, (req, res) => {
    const row = loadOwnedContact(req, res);
    if (!row) return;
    const parsed = crmTaskUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const taskId = String(req.params.taskId);
    const idx = row.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      res.status(404).json({ error: "TASK_NOT_FOUND" });
      return;
    }
    const cur = row.tasks[idx];
    const nextStatus = parsed.data.status ?? cur.status;
    const updated: CrmTask = {
      ...cur,
      title: parsed.data.title ?? cur.title,
      priority: parsed.data.priority ?? cur.priority,
      status: nextStatus,
      due: parsed.data.due !== undefined ? parsed.data.due : cur.due,
      completedAt: nextStatus === "done" ? (cur.completedAt ?? nowIso()) : null,
    };
    const nextTasks = row.tasks.slice();
    nextTasks[idx] = updated;
    const next = writeCrmMutation(row, { tasks: nextTasks }, { tasks: JSON.stringify(nextTasks) }, "crm.task.updated");
    res.json({ ok: true, task: updated, contact: next });
  });

  // ---- Star / unstar ----
  app.post("/api/partner/me/crm/contacts/:id/star", ...CRM_WRITE, (req, res) => {
    const row = loadOwnedContact(req, res);
    if (!row) return;
    const parsed = crmStarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const next = writeCrmMutation(row, { starred: parsed.data.starred }, { starred: parsed.data.starred }, "crm.starred");
    res.json({ ok: true, contact: next });
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
  findCrmChainTip,
  findUserIdByEmail,
  resolveContactConnections,
  createFromSource,
  portfolioCache,
  crmCache,
  dealsCache,
  rowToPortfolio,
  rowToCrm,
  rowToDeal,
};
