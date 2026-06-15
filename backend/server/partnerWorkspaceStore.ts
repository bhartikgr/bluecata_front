/**
 * Foundation Build — Partner CRM + SPV/Fund Record-Keeping (Path B)
 *
 * In-memory stores for all partner workspace data: team members, invitations,
 * attributions, pipeline, notes, tasks, files, workspace settings, SPV records,
 * SPV positions, fund records, fund commitments.
 *
 * Every store function takes `partnerId` as the FIRST argument. Throws
 * `PARTNER_ID_REQUIRED` if missing. Every mutation:
 *   - Increments version + computes SHA-256 hash chain (where the table is
 *     marked hash-chained in Section 5.2 of consortium_spec_master.md)
 *   - Pushes a snapshot to the *_history shadow store
 *   - Appends admin audit
 *   - Emits a bridge event with deterministic idempotency key
 *
 * Money is integer minor units + ISO 4217. No floating point.
 *
 * Demo seed (TEST PARTNER, INC + avi_managing + avi_viewer) only loads when
 * DEMO_SEED_ENABLED = true (production never seeds; defense in depth).
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { createHash, randomBytes } from "node:crypto";
import { isNull, eq } from "drizzle-orm";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { getById as getContactById, _registerSeedPartner, TIER_RANK, TIER_SEAT_LIMITS, type PartnerTier, type PartnerSubRole } from "./adminContactsStoreShim";
import { getDb, rawDb } from "./db/connection";
import { pAll } from "./db/portable"; /* Wave H Track A — Postgres compatibility */
import { partnerDealPromotions as partnerDealPromotionsTable } from "@shared/schema";
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";
/* v25.23 NC-D / NH-K / NH-L — strict (fail-closed) persistence for the money
 * and identity surfaces. Default `persistEntry` semantics elsewhere remain
 * unchanged (Lane G preservation). */
import { persistEntryStrict } from "./lib/storePersistenceShim";

/* ============================================================
 * Sub-role + tier types
 * ============================================================ */

export type SubRole = "managing_partner" | "associate" | "bd" | "analyst" | "viewer";
export const ALL_SUB_ROLES: SubRole[] = ["managing_partner", "associate", "bd", "analyst", "viewer"];

/* ============================================================
 * Hash chain helper (per-record SHA-256, full 64-char)
 * ============================================================ */

const GENESIS = "0".repeat(64);

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function computeRevisionHash(record: Record<string, unknown>): string {
  // Stable JSON of everything EXCEPT revisionHash field itself
  const clone: Record<string, unknown> = { ...record };
  delete clone.revisionHash;
  const stable = JSON.stringify(clone, Object.keys(clone).sort());
  return sha256Hex(`${(record.prevRevisionHash as string) ?? GENESIS}|${stable}`);
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/* ============================================================
 * Type definitions for each table
 * ============================================================ */

export interface PartnerTeamMember {
  id: string;
  partnerId: string;
  userId: string;
  subRole: SubRole;
  status: "active" | "suspended" | "removed";
  joinedAt: string;
  removedAt: string | null;
  createdBy: string;
  isSeed: boolean;
}

export interface PartnerTeamInvitation {
  id: string;
  partnerId: string;
  invitedEmail: string;
  subRole: SubRole;
  tokenHash: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedUserId: string | null;
  createdAt: string;
  createdBy: string;
  ipLogged: string | null;
  uaLogged: string | null;
  isSeed: boolean;
}

export interface PartnerAttribution {
  id: string;
  partnerId: string;
  companyId: string;
  attributedAt: string;
  attributedBy: string;
  attributionSource: "admin_manual" | "referral_code" | "partner_claim";
  revokedAt: string | null;
  revokedBy: string | null;
  notes: string | null;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  isSeed: boolean;
}

export type PipelineStage =
  | "sourcing"
  | "qualifying"
  | "committee"
  | "committed"
  | "closed_won"
  | "closed_lost";
export const ALL_PIPELINE_STAGES: PipelineStage[] = [
  "sourcing",
  "qualifying",
  "committee",
  "committed",
  "closed_won",
  "closed_lost",
];

export interface PartnerPipelineDeal {
  id: string;
  partnerId: string;
  dealName: string;
  companyId: string | null;
  stage: PipelineStage;
  estCheckSizeMinor: number | null;
  currency: string | null;
  sector: string | null;
  geography: string | null;
  ownerUserId: string;
  expectedClose: string | null;
  notes: string | null;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  isSeed: boolean;
}

export interface PartnerPipelineActivity {
  id: string;
  pipelineId: string;
  activityType: "note" | "call" | "meeting" | "email" | "stage_change";
  body: string;
  occurredAt: string;
  createdBy: string;
  isSeed: boolean;
}

export interface PartnerNote {
  id: string;
  partnerId: string;
  scope: "general" | "client" | "pipeline" | "spv" | "fund";
  scopeId: string | null;
  title: string;
  body: string;
  authorUserId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  isSeed: boolean;
}

export interface PartnerTask {
  id: string;
  partnerId: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  priority: "low" | "normal" | "high";
  assignedToUserId: string | null;
  dueDate: string | null;
  scope: "general" | "client" | "pipeline" | "spv" | "fund" | null;
  scopeId: string | null;
  createdAt: string;
  createdBy: string;
  completedAt: string | null;
  isSeed: boolean;
}

export interface PartnerFile {
  id: string;
  partnerId: string;
  dataroomFileId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  scope: "private" | "team" | "client_shared";
  scopeId: string | null;
  uploadedBy: string;
  uploadedAt: string;
  isSeed: boolean;
  // v25.15 NH2 — soft-delete support. Files were previously permanent (no
  // delete method, no deletedAt field). Now nullable timestamp; reads filter
  // by deletedAt === null. Hard delete is reserved for admin-side workflows.
  deletedAt: string | null;
  deletedBy: string | null;
}

export interface PartnerWorkspaceSettings {
  partnerId: string;
  locale: string;
  currency: string;
  timezone: string;
  brandColor: string | null;
  logoUrl: string | null;
  customDomain: string | null;
  whiteLabelEnabled: boolean;
  configJson: string | null;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  isSeed: boolean;
}

export interface PartnerSpv {
  id: string;
  partnerId: string;
  spvName: string;
  targetCompanyId: string | null;
  jurisdiction: string;
  entityStructure: string | null;
  vintage: number;
  totalCommittedMinor: number;
  currency: string;
  status: "planned" | "open" | "closed" | "wound_down";
  externalAdminProvider: string | null;
  externalAdminRef: string | null;
  recordedAt: string;
  recordedBy: string;
  notes: string | null;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  isSeed: boolean;
}

export interface PartnerSpvPosition {
  id: string;
  partnerSpvId: string;
  lpContactId: string;
  positionAmountMinor: number;
  currency: string;
  fxRateToSpvBase: string | null;
  fxLockedAt: string | null;
  positionStatus: "pledged" | "funded" | "distributed" | "cancelled";
  recordedAt: string;
  recordedBy: string;
  notes: string | null;
  isSeed: boolean;
}

export interface PartnerFund {
  id: string;
  partnerId: string;
  fundName: string;
  fundType: "evergreen" | "closed_end" | "rolling";
  jurisdiction: string;
  vintage: number;
  targetSizeMinor: number | null;
  committedSizeMinor: number;
  currency: string;
  status: "planning" | "raising" | "investing" | "harvesting" | "wound_down";
  externalAdminProvider: string | null;
  externalAdminRef: string | null;
  recordedAt: string;
  recordedBy: string;
  notes: string | null;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  isSeed: boolean;
}

export interface PartnerFundCommitment {
  id: string;
  partnerFundId: string;
  lpContactId: string;
  commitmentMinor: number;
  currency: string;
  fxRateToFundBase: string | null;
  fxLockedAt: string | null;
  status: "pledged" | "called_in_part" | "called_in_full" | "cancelled";
  pledgedAt: string;
  recordedBy: string;
  isRolling: boolean;
  rollingPeriod: string | null;
  notes: string | null;
  isSeed: boolean;
}

/* ============================================================
 * Final Partner CRM — partner_deal_promotions
 *
 * Tracks the lifecycle of a partner pipeline deal as it is promoted to the
 * Collective Deal Room or referred to Capavate. Hash-chained (financial-trust
 * data) and is_seed flagged per the master spec.
 *
 * Index columns (for query): partnerId, pipelineDealId, promotionType, status.
 * ============================================================ */

export type PartnerDealPromotionType =
  | "collective_deal_room"
  | "capavate_referral";

export type PartnerDealPromotionStatus =
  | "pending"
  // v25.15 F2-NH1 — prior schema co-stamped status='live' + moderationStatus='pending'
  // on collective_deal_room create, which was a contradiction: any feed consumer
  // reading status alone would surface unmoderated content. We now use a
  // distinct "pending_collective_review" status on create; status is only
  // flipped to "live" upon explicit chapter-admin moderation approval.
  | "pending_collective_review"
  | "live"
  | "rejected"
  | "withdrawn";

export type PartnerDealModerationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "changes_requested";

export interface PartnerDealPromotion {
  id: string;
  partnerId: string;
  pipelineDealId: string;
  promotionType: PartnerDealPromotionType;
  companyId: string | null;
  targetEmail: string | null;
  status: PartnerDealPromotionStatus;
  promotedBy: string;
  promotedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectedReason: string | null;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  notes: string | null;
  // Hash chain
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  isSeed: boolean;
  /** CP Phase B — chapter-admin moderation (CP-015..CP-018). */
  moderationStatus: PartnerDealModerationStatus;
  moderatedByUserId: string | null;
  moderatedAt: string | null;
  moderationNotes: string | null;
  /** v25.23 NM-N (FALSE CLOSURE fix for v25.16 NH4) — the chapter this
   *  promotion is scoped to for chapter-admin moderation. Previously the
   *  field was referenced by `listPendingModeration(chapterId)` but never
   *  set on the row, so the filter `p.chapterId === chapterId` was always
   *  false and chapter-scoped admin queues silently returned empty. */
  chapterId: string;
}

/* ============================================================
 * In-memory tables
 * ============================================================ */

const teamMembers: PartnerTeamMember[] = [];
const teamInvitations: PartnerTeamInvitation[] = [];
const attributions: PartnerAttribution[] = [];
const attributionsHistory: PartnerAttribution[] = [];
const pipeline: PartnerPipelineDeal[] = [];
const pipelineHistory: PartnerPipelineDeal[] = [];
const pipelineActivities: PartnerPipelineActivity[] = [];
const notes: PartnerNote[] = [];
const notesHistory: PartnerNote[] = [];
const tasks: PartnerTask[] = [];
const files: PartnerFile[] = [];
const workspaceSettings = new Map<string, PartnerWorkspaceSettings>();
const spvs: PartnerSpv[] = [];
const spvsHistory: PartnerSpv[] = [];
const spvPositions: PartnerSpvPosition[] = [];
const funds: PartnerFund[] = [];
const fundsHistory: PartnerFund[] = [];
const fundCommitments: PartnerFundCommitment[] = [];
// Final Partner CRM — promotions (hash-chained)
const dealPromotions: PartnerDealPromotion[] = [];
const dealPromotionsHistory: PartnerDealPromotion[] = [];

/* ============================================================
 * v24.4.1 — RAM→DB write-through persistence layer.
 *
 * Until v24.4.1, six partner workspace collections were pure RAM:
 *   - teamMembers     → partner_team_members
 *   - teamInvitations → partner_team_invitations
 *   - notes           → partner_notes
 *   - tasks           → partner_tasks
 *   - files           → partner_files
 *   - workspaceSettings → partner_workspace_settings
 *
 * Every restart wiped all six — partner_team_members lost meant approved
 * partners couldn't access /api/partner/me/*, notes/tasks/files disappeared,
 * settings reverted to defaults. This was Avi's #1 production complaint.
 *
 * The pattern: read path stays in-memory caches (zero behavioural change for
 * existing callers); writes flow through to SQLite tables inside the same
 * function call. On boot, hydratePartnerWorkspaceStoreV241() rebuilds the
 * caches from the durable tables.
 *
 * The legacy spv/fund/attribution/pipeline arrays are NOT migrated here —
 * those code paths are dead in production (replaced by spvFundStore and
 * partnerWorkspaceV19Store, both DB-backed since v19/CP-028). They're
 * documented in V24_4_1_STORE_AUDIT.md for a future cleanup wave.
 * ============================================================ */

/* v25.23 NC-D (identity surface) — `strict` mode makes the team-member write
 * fail closed: a DB-write failure throws instead of being swallowed, so the
 * caller (partnerTeamStore.add) can avoid leaving a RAM-only membership row
 * (which would let an approved partner appear provisioned yet vanish on
 * restart). Default (strict=false) keeps the prior best-effort behaviour for
 * the non-identity-create callers (e.g. remove). */
function persistTeamMember(m: PartnerTeamMember, strict = false): void {
  try {
    rawDb().prepare(
      `INSERT INTO partner_team_members (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         sub_role = excluded.sub_role,
         status = excluded.status,
         removed_at = excluded.removed_at,
         updated_at = excluded.updated_at`,
    ).run(m.id, m.partnerId, m.userId, m.subRole, m.status, m.joinedAt, m.removedAt ?? null, m.createdBy, m.isSeed ? 1 : 0, new Date().toISOString());
  } catch (err) {
    log.warn("[partnerWorkspaceStore] teamMember write-through failed:", (err as Error).message);
    if (strict) {
      throw new Error(`STRICT_PERSIST_FAILED: partner_team_members.${m.id}: ${(err as Error).message}`);
    }
  }
}

/* v25.23 NC-D (identity + bootstrap surface) — `strict` mode throws on a
 * DB-write failure so the invitation create/redeem paths fail closed rather
 * than leaving a RAM-only invitation (a swallowed write would let a created
 * invite — or a redeemed-state flip — vanish on restart). Default best-effort
 * behaviour is unchanged for any non-strict caller. */
function persistTeamInvitation(inv: PartnerTeamInvitation, strict = false): void {
  try {
    rawDb().prepare(
      `INSERT INTO partner_team_invitations (id, partner_id, invitation_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         invitation_json = excluded.invitation_json,
         updated_at = excluded.updated_at`,
    ).run(inv.id, inv.partnerId, JSON.stringify(inv), new Date().toISOString());
  } catch (err) {
    log.warn("[partnerWorkspaceStore] teamInvitation write-through failed:", (err as Error).message);
    if (strict) {
      throw new Error(`STRICT_PERSIST_FAILED: partner_team_invitations.${inv.id}: ${(err as Error).message}`);
    }
  }
}

function persistNote(n: PartnerNote): void {
  try {
    rawDb().prepare(
      `INSERT INTO partner_notes (id, partner_id, note_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         note_json = excluded.note_json,
         updated_at = excluded.updated_at`,
    ).run(n.id, n.partnerId, JSON.stringify(n), new Date().toISOString());
  } catch (err) {
    log.warn("[partnerWorkspaceStore] note write-through failed:", (err as Error).message);
  }
}

function persistTask(t: PartnerTask): void {
  try {
    rawDb().prepare(
      `INSERT INTO partner_tasks (id, partner_id, task_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         task_json = excluded.task_json,
         updated_at = excluded.updated_at`,
    ).run(t.id, t.partnerId, JSON.stringify(t), new Date().toISOString());
  } catch (err) {
    log.warn("[partnerWorkspaceStore] task write-through failed:", (err as Error).message);
  }
}

function persistFile(f: PartnerFile): void {
  try {
    rawDb().prepare(
      `INSERT INTO partner_files (id, partner_id, file_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         file_json = excluded.file_json,
         updated_at = excluded.updated_at`,
    ).run(f.id, f.partnerId, JSON.stringify(f), new Date().toISOString());
  } catch (err) {
    log.warn("[partnerWorkspaceStore] file write-through failed:", (err as Error).message);
  }
}

function persistWorkspaceSettings(partnerId: string, s: PartnerWorkspaceSettings): void {
  try {
    rawDb().prepare(
      `INSERT INTO partner_workspace_settings (partner_id, settings_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(partner_id) DO UPDATE SET
         settings_json = excluded.settings_json,
         updated_at = excluded.updated_at`,
    ).run(partnerId, JSON.stringify(s), new Date().toISOString());
  } catch (err) {
    log.warn("[partnerWorkspaceStore] workspaceSettings write-through failed:", (err as Error).message);
  }
}

/** v24.4.1 — rebuild all 6 in-memory caches from durable rows on boot. */
export async function hydratePartnerWorkspaceStoreV241(): Promise<void> {
  const db = rawDb();
  try {
    // teamMembers
    {
      const rows = db.prepare(
        `SELECT id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed FROM partner_team_members`,
      ).all() as Array<{
        id: string; partner_id: string; user_id: string; sub_role: string; status: string;
        joined_at: string; removed_at: string | null; created_by: string; is_seed: number;
      }>;
      teamMembers.length = 0;
      for (const r of rows) {
        teamMembers.push({
          id: r.id,
          partnerId: r.partner_id,
          userId: r.user_id,
          subRole: r.sub_role as SubRole,
          status: r.status as "active" | "removed",
          joinedAt: r.joined_at,
          removedAt: r.removed_at,
          createdBy: r.created_by,
          isSeed: !!r.is_seed,
        });
      }
      if (rows.length > 0) log.info(`[hydrate] partnerWorkspaceStore: ${rows.length} team_members loaded`);
    }
    // teamInvitations
    {
      const rows = db.prepare(`SELECT id, invitation_json FROM partner_team_invitations`).all() as Array<{ id: string; invitation_json: string }>;
      teamInvitations.length = 0;
      for (const r of rows) {
        try { teamInvitations.push(JSON.parse(r.invitation_json) as PartnerTeamInvitation); }
        catch (e) { log.warn(`[hydrate] skip invitation ${r.id}: ${(e as Error).message}`); }
      }
      if (rows.length > 0) log.info(`[hydrate] partnerWorkspaceStore: ${rows.length} team_invitations loaded`);
    }
    // notes
    {
      const rows = db.prepare(`SELECT id, note_json FROM partner_notes`).all() as Array<{ id: string; note_json: string }>;
      notes.length = 0;
      for (const r of rows) {
        try { notes.push(JSON.parse(r.note_json) as PartnerNote); }
        catch (e) { log.warn(`[hydrate] skip note ${r.id}: ${(e as Error).message}`); }
      }
      if (rows.length > 0) log.info(`[hydrate] partnerWorkspaceStore: ${rows.length} notes loaded`);
    }
    // tasks
    {
      const rows = db.prepare(`SELECT id, task_json FROM partner_tasks`).all() as Array<{ id: string; task_json: string }>;
      tasks.length = 0;
      for (const r of rows) {
        try { tasks.push(JSON.parse(r.task_json) as PartnerTask); }
        catch (e) { log.warn(`[hydrate] skip task ${r.id}: ${(e as Error).message}`); }
      }
      if (rows.length > 0) log.info(`[hydrate] partnerWorkspaceStore: ${rows.length} tasks loaded`);
    }
    // files
    {
      const rows = db.prepare(`SELECT id, file_json FROM partner_files`).all() as Array<{ id: string; file_json: string }>;
      files.length = 0;
      let tombstoned = 0;
      for (const r of rows) {
        try {
          const parsed = JSON.parse(r.file_json) as PartnerFile;
          /* v25.16 cross-comp NH4 — do not inflate tombstoned files into the
             live array on boot. Runtime list/get already filter, but skipping
             them here avoids memory pollution and tombstone leakage from
             code paths that iterate raw.files without filtering. */
          if (parsed && parsed.deletedAt) { tombstoned += 1; continue; }
          files.push(parsed);
        } catch (e) { log.warn(`[hydrate] skip file ${r.id}: ${(e as Error).message}`); }
      }
      if (rows.length > 0) {
        log.info(`[hydrate] partnerWorkspaceStore: ${rows.length - tombstoned} files loaded${tombstoned ? ` (${tombstoned} tombstoned skipped)` : ""}`);
      }
    }
    // workspaceSettings
    {
      const rows = db.prepare(`SELECT partner_id, settings_json FROM partner_workspace_settings`).all() as Array<{ partner_id: string; settings_json: string }>;
      workspaceSettings.clear();
      for (const r of rows) {
        try { workspaceSettings.set(r.partner_id, JSON.parse(r.settings_json) as PartnerWorkspaceSettings); }
        catch (e) { log.warn(`[hydrate] skip workspaceSettings ${r.partner_id}: ${(e as Error).message}`); }
      }
      if (rows.length > 0) log.info(`[hydrate] partnerWorkspaceStore: ${rows.length} workspaceSettings loaded`);
    }
  } catch (err) {
    log.warn("[hydrate] partnerWorkspaceStore v24.4.1: DB read failed:", (err as Error).message);
  }
}

/**
 * v25.12 NM-7 / NM-9 — hydrate the pipeline / funds / attributions arrays
 * from the kv shim. The legacy `partnerWorkspaceStore` audit said these
 * were dead code; they are not — the partner UI uses them via
 * `partnerPipelineStore.*` / `partnerSpvStore.*` / `partnerFundsStore.*` /
 * `partnerAttributionStore.*`. Without this hydrator, every restart wipes
 * the in-memory arrays even though we now persist on write.
 *
 * Wired into HYDRATE_ORDER as `partnerWorkspaceShimStore`. Safe to fail.
 */
export function hydratePartnerWorkspaceShimStore(): number {
  let n = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hydrateEntries } = require("./lib/storePersistenceShim");

    const pipelineRows = (hydrateEntries("partnerPipeline") as Array<[string, PartnerPipelineDeal]>) ?? [];
    for (const [id, row] of pipelineRows) {
      if (typeof id !== "string" || !row) continue;
      if (!pipeline.find((p) => p.id === id)) {
        pipeline.push(row);
        n += 1;
      }
    }

    const fundRows = (hydrateEntries("partnerFunds") as Array<[string, PartnerFund]>) ?? [];
    for (const [id, row] of fundRows) {
      if (typeof id !== "string" || !row) continue;
      if (!funds.find((f) => f.id === id)) {
        funds.push(row);
        n += 1;
      }
    }

    const attrRows = (hydrateEntries("partnerAttributions") as Array<[string, PartnerAttribution]>) ?? [];
    for (const [id, row] of attrRows) {
      if (typeof id !== "string" || !row) continue;
      if (!attributions.find((a) => a.id === id)) {
        attributions.push(row);
        n += 1;
      }
    }

    /* v25.16 NC1 — partner SPVs (kv shim shard). */
    const spvRows = (hydrateEntries("partnerSpvs") as Array<[string, PartnerSpv]>) ?? [];
    for (const [id, row] of spvRows) {
      if (typeof id !== "string" || !row) continue;
      if (!spvs.find((s) => s.id === id)) {
        spvs.push(row);
        n += 1;
      }
    }

    /* v25.16 NL2 carry-over — partner SPV positions. */
    const posRows = (hydrateEntries("partnerSpvPositions") as Array<[string, PartnerSpvPosition]>) ?? [];
    for (const [id, row] of posRows) {
      if (typeof id !== "string" || !row) continue;
      if (!spvPositions.find((p) => p.id === id)) {
        spvPositions.push(row);
        n += 1;
      }
    }

    /* v25.16 NC3 — partner fund commitments. */
    const commRows = (hydrateEntries("partnerFundCommitments") as Array<[string, PartnerFundCommitment]>) ?? [];
    for (const [id, row] of commRows) {
      if (typeof id !== "string" || !row) continue;
      if (!fundCommitments.find((c) => c.id === id)) {
        fundCommitments.push(row);
        n += 1;
      }
    }

    /* v25.16 NC2 — partner pipeline activities. */
    const actRows = (hydrateEntries("partnerPipelineActivities") as Array<[string, PartnerPipelineActivity]>) ?? [];
    for (const [id, row] of actRows) {
      if (typeof id !== "string" || !row) continue;
      if (!pipelineActivities.find((a) => a.id === id)) {
        pipelineActivities.push(row);
        n += 1;
      }
    }
  } catch (err) {
    log.warn("[hydrate] partnerWorkspaceShimStore failed:", (err as Error).message);
  }
  return n;
}

/* ============================================================
 * Guard helpers
 * ============================================================ */

function requirePid(partnerId: string | null | undefined): void {
  if (!partnerId) throw new Error("PARTNER_ID_REQUIRED");
}

function audit(actor: string, target: string, action: string, details: Record<string, unknown>): void {
  try { appendAdminAudit(actor, target, action, details); } catch { /* non-fatal */ }
}

function emit(eventType: string, aggregateId: string, payload: Record<string, unknown>): void {
  try {
    emitBridgeEvent({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventType: eventType as any,
      aggregateId,
      aggregateKind: "platform",
      payload,
    });
  } catch { /* non-fatal */ }
}

/* ============================================================
 * Team members
 * ============================================================ */

export const partnerTeamStore = {
  add(partnerId: string, userId: string, subRole: SubRole, createdBy: string, opts: { isSeed?: boolean } = {}): PartnerTeamMember {
    requirePid(partnerId);
    if (!userId) throw new Error("USER_ID_REQUIRED");
    // Uniqueness: (partnerId, userId)
    const exists = teamMembers.find((m) => m.partnerId === partnerId && m.userId === userId && m.status === "active");
    if (exists) return exists;
    const tm: PartnerTeamMember = {
      id: newId("ptm"),
      partnerId,
      userId,
      subRole,
      status: "active",
      joinedAt: new Date().toISOString(),
      removedAt: null,
      createdBy,
      isSeed: !!opts.isSeed,
    };
    /* v25.23 NC-D (identity surface) — fail closed: write the membership to
     * the DB FIRST in strict mode, then push into the RAM cache only once the
     * durable write succeeds. A persist failure throws (leaving no RAM-only
     * membership) so the caller — e.g. the consortium-approval A8 step or an
     * invite redeem — cannot believe a partner is provisioned when the row
     * would vanish on restart. */
    persistTeamMember(tm, true);
    teamMembers.push(tm);
    audit(createdBy, `partner:${partnerId}`, "partner.team_member.added", { userId, subRole });
    emit("partner.team_member_added", partnerId, { partnerId, userId, subRole, idempotencyKey: `${partnerId}|${userId}` });
    return tm;
  },

  remove(partnerId: string, userId: string, removedBy: string): PartnerTeamMember | null {
    requirePid(partnerId);
    const m = teamMembers.find((m) => m.partnerId === partnerId && m.userId === userId && m.status === "active");
    if (!m) return null;
    /* v25.23 NL-U fix — server-side guard against removing the LAST
     * managing_partner from a workspace. Without this, an admin (or the
     * managing_partner themselves) could orphan the workspace: no member
     * left with destructive authority, no recovery path short of admin
     * intervention. Mirror of the chapter-admin same-class guard. The
     * client also disables the UI control (NL-U client fix), but defense
     * in depth requires the server enforcement too. */
    if (m.subRole === "managing_partner") {
      const remainingManagingPartners = teamMembers.filter(
        (tm) =>
          tm.partnerId === partnerId &&
          tm.status === "active" &&
          tm.subRole === "managing_partner" &&
          tm.userId !== userId,
      ).length;
      if (remainingManagingPartners === 0) {
        throw new Error("LAST_MANAGING_PARTNER_CANNOT_BE_REMOVED");
      }
    }
    m.status = "removed";
    m.removedAt = new Date().toISOString();
    persistTeamMember(m);
    audit(removedBy, `partner:${partnerId}`, "partner.team_member.removed", { userId });
    emit("partner.team_member_removed", partnerId, { partnerId, userId, removedAt: m.removedAt, idempotencyKey: `${partnerId}|${userId}|${m.removedAt}` });
    return m;
  },

  listByPartner(partnerId: string): PartnerTeamMember[] {
    requirePid(partnerId);
    // v25.14 NH1 — was leaking removed/suspended team members (PII leak +
    // confused team view). The auth path findByUserId already filters on
    // status === "active"; the list path now does the same.
    return teamMembers.filter((m) => m.partnerId === partnerId && m.status === "active");
  },

  findByUserId(userId: string): PartnerTeamMember | null {
    const cached = teamMembers.find((m) => m.userId === userId && m.status === "active");
    if (cached) return cached;
    // v24.4.1 cross-process safety: a sibling process (e.g.
    // create_partner_admin.ts CLI) may have written a new active row that the
    // running server has not yet hydrated into RAM. Fall through to DB so the
    // workspace becomes reachable without a server restart. On hit, prime the
    // RAM cache so subsequent reads stay in-process fast.
    try {
      const row = rawDb().prepare(
        `SELECT id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed
           FROM partner_team_members
          WHERE user_id = ? AND status = 'active'
          LIMIT 1`,
      ).get(userId) as Record<string, unknown> | undefined;
      if (!row) return null;
      const tm: PartnerTeamMember = {
        id: String(row.id),
        partnerId: String(row.partner_id),
        userId: String(row.user_id),
        subRole: String(row.sub_role) as SubRole,
        status: "active",
        joinedAt: String(row.joined_at),
        removedAt: row.removed_at ? String(row.removed_at) : null,
        createdBy: String(row.created_by),
        isSeed: Boolean(row.is_seed),
      };
      // Prime cache (avoid duplicate if a concurrent path inserted).
      if (!teamMembers.find((m) => m.id === tm.id)) teamMembers.push(tm);
      return tm;
    } catch (err) {
      log.warn("[partnerWorkspaceStore.findByUserId] DB fallback failed:", (err as Error).message);
      return null;
    }
  },

  /**
   * A8 (v24.0) — idempotently bind a user as an owner/managing-partner of an
   * admin-contact partner record. Consortium approval calls this so the
   * approved partner passes requirePartnerAuth (which requires an active
   * partner_team_members row whose partnerId is an active consortium_partner
   * admin contact). Safe to call repeatedly: returns the existing active
   * membership if one already exists.
   */
  upsertOwner(userId: string, partnerId: string, subRole: SubRole = "managing_partner"): PartnerTeamMember {
    requirePid(partnerId);
    if (!userId) throw new Error("USER_ID_REQUIRED");
    const existing = teamMembers.find((m) => m.partnerId === partnerId && m.userId === userId && m.status === "active");
    if (existing) return existing;
    return this.add(partnerId, userId, subRole, userId, {});
  },

  countActiveSeats(partnerId: string): number {
    requirePid(partnerId);
    return teamMembers.filter((m) => m.partnerId === partnerId && m.status === "active").length;
  },
};

/* ============================================================
 * Team invitations (magic-link with hashed tokens)
 * ============================================================ */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashInviteToken(plainToken: string): string {
  return sha256Hex(`partner-invite-token:${plainToken}`);
}

export const partnerInvitationStore = {
  create(
    partnerId: string,
    invitedEmail: string,
    subRole: SubRole,
    createdBy: string,
    opts: { isSeed?: boolean; ip?: string; ua?: string } = {},
  ): { invitation: PartnerTeamInvitation; plainToken: string } {
    requirePid(partnerId);
    if (!invitedEmail) throw new Error("EMAIL_REQUIRED");

    const plainToken = randomBytes(24).toString("hex");
    const tokenHash = hashInviteToken(plainToken);
    const now = new Date();
    const inv: PartnerTeamInvitation = {
      id: newId("pinv"),
      partnerId,
      invitedEmail: invitedEmail.toLowerCase(),
      subRole,
      tokenHash,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
      redeemedAt: null,
      redeemedUserId: null,
      createdAt: now.toISOString(),
      createdBy,
      ipLogged: opts.ip ?? null,
      uaLogged: opts.ua ?? null,
      isSeed: !!opts.isSeed,
    };
    /* v25.23 NC-D (identity + bootstrap) — fail closed: persist the invitation
     * to the DB FIRST in strict mode, then add it to the RAM cache only on
     * success. Throws on persist failure so an invite that the admin believes
     * was issued can never live only in memory (and disappear on restart). */
    persistTeamInvitation(inv, true);
    teamInvitations.push(inv);
    audit(createdBy, `partner:${partnerId}`, "partner.team_invitation.created", { email: inv.invitedEmail, subRole });
    return { invitation: inv, plainToken };
  },

  /* v25.16 NH5 — listByPartner now defaults to active invites only (not
     redeemed, not expired) so the team UI shows the correct pending count.
     Pass { includeRedeemed | includeExpired } to opt back into history. */
  listByPartner(
    partnerId: string,
    opts: { includeRedeemed?: boolean; includeExpired?: boolean } = {},
  ): PartnerTeamInvitation[] {
    requirePid(partnerId);
    const now = Date.now();
    return teamInvitations.filter((i) => {
      if (i.partnerId !== partnerId) return false;
      if (!opts.includeRedeemed && i.redeemedAt !== null) return false;
      if (!opts.includeExpired && Date.parse(i.expiresAt) <= now) return false;
      return true;
    });
  },

  countPendingByPartner(partnerId: string): number {
    requirePid(partnerId);
    const now = Date.now();
    return teamInvitations.filter(
      (i) => i.partnerId === partnerId && i.redeemedAt === null && Date.parse(i.expiresAt) > now,
    ).length;
  },

  /* v25.23 NH-L — atomic invitation redeem.
   *
   * Lane D NH-5 / NH-6 found the prior redeem was a non-atomic
   * check-then-set: it read `redeemedAt`, flipped it in RAM, swallow-persisted
   * the invitation, then separately added the team membership. Two concurrent
   * redeems of the same token could both pass the check and both mint a
   * membership; and a failure between the invitation flip and the membership
   * insert left a half-redeemed state.
   *
   * Fix: wrap "find pending → mark redeemed → insert team membership" in a
   * SINGLE better-sqlite3 IMMEDIATE transaction (the SELECT ... FOR UPDATE
   * equivalent — acquires the write lock up front). The redeemed-state guard
   * is re-checked against the durable invitation row INSIDE the tx, so a
   * concurrent double-redeem loses (one tx sees redeemedAt already set and
   * throws, rolling the whole tx back). If any step fails, nothing commits.
   * RAM caches are updated only AFTER the tx commits. */
  redeem(plainToken: string, redeemingUserId: string, opts: { ip?: string; ua?: string } = {}): PartnerTeamInvitation {
    if (!plainToken) throw new Error("PARTNER_INVITATION_INVALID_TOKEN");
    const hash = hashInviteToken(plainToken);
    // Locate the invitation id (RAM cache first; DB fallback if not hydrated).
    let invId: string | null = teamInvitations.find((i) => i.tokenHash === hash)?.id ?? null;
    if (!invId) {
      try {
        const row = rawDb()
          .prepare(`SELECT id FROM partner_team_invitations WHERE invitation_json LIKE ? LIMIT 1`)
          .get(`%"tokenHash":"${hash}"%`) as { id: string } | undefined;
        invId = row?.id ?? null;
      } catch { /* fall through to invalid-token below */ }
    }
    if (!invId) throw new Error("PARTNER_INVITATION_INVALID_TOKEN");

    const nowIso = new Date().toISOString();
    const db: any = rawDb();

    // The transaction body. Returns the redeemed invitation + the (possibly
    // pre-existing) team-member row so the RAM caches can be reconciled after
    // commit. Throws inside the tx to trigger rollback.
    const run = db.transaction(() => {
      const row = db
        .prepare(`SELECT id, partner_id, invitation_json FROM partner_team_invitations WHERE id = ?`)
        .get(invId) as { id: string; partner_id: string; invitation_json: string } | undefined;
      if (!row) throw new Error("PARTNER_INVITATION_INVALID_TOKEN");
      const durable = JSON.parse(row.invitation_json) as PartnerTeamInvitation;
      // Atomic single-use guard — re-checked against the durable row under lock.
      if (durable.redeemedAt) throw new Error("PARTNER_INVITATION_ALREADY_REDEEMED");
      if (Date.parse(durable.expiresAt) < Date.now()) throw new Error("PARTNER_INVITATION_EXPIRED");

      // 1) Mark the invitation redeemed (durable).
      durable.redeemedAt = nowIso;
      durable.redeemedUserId = redeemingUserId;
      durable.ipLogged = opts.ip ?? durable.ipLogged ?? null;
      durable.uaLogged = opts.ua ?? durable.uaLogged ?? null;
      db.prepare(
        `UPDATE partner_team_invitations SET invitation_json = ?, updated_at = ? WHERE id = ?`,
      ).run(JSON.stringify(durable), nowIso, durable.id);

      // 2) Insert the team membership (idempotent on (partnerId, userId) active).
      const existingMember = db
        .prepare(
          `SELECT id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed
             FROM partner_team_members
            WHERE partner_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
        )
        .get(durable.partnerId, redeemingUserId) as Record<string, unknown> | undefined;
      let member: PartnerTeamMember;
      if (existingMember) {
        member = {
          id: String(existingMember.id),
          partnerId: String(existingMember.partner_id),
          userId: String(existingMember.user_id),
          subRole: String(existingMember.sub_role) as SubRole,
          status: "active",
          joinedAt: String(existingMember.joined_at),
          removedAt: existingMember.removed_at ? String(existingMember.removed_at) : null,
          createdBy: String(existingMember.created_by),
          isSeed: Boolean(existingMember.is_seed),
        };
      } else {
        member = {
          id: newId("ptm"),
          partnerId: durable.partnerId,
          userId: redeemingUserId,
          subRole: durable.subRole,
          status: "active",
          joinedAt: nowIso,
          removedAt: null,
          createdBy: redeemingUserId,
          isSeed: false,
        };
        db.prepare(
          `INSERT INTO partner_team_members (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(member.id, member.partnerId, member.userId, member.subRole, member.status, member.joinedAt, null, member.createdBy, 0, nowIso);
      }
      return { durable, member, memberWasNew: !existingMember };
    });

    // better-sqlite3: run the immediate variant so the write lock is taken at
    // BEGIN (SELECT ... FOR UPDATE equivalent), serialising concurrent redeems.
    const result = (run.immediate ? run.immediate() : run()) as {
      durable: PartnerTeamInvitation;
      member: PartnerTeamMember;
      memberWasNew: boolean;
    };

    // Tx committed — reconcile RAM caches with the durable state.
    const cachedInv = teamInvitations.find((i) => i.id === result.durable.id);
    if (cachedInv) {
      Object.assign(cachedInv, result.durable);
    } else {
      teamInvitations.push(result.durable);
    }
    if (result.memberWasNew && !teamMembers.find((m) => m.id === result.member.id)) {
      teamMembers.push(result.member);
      emit("partner.team_member_added", result.member.partnerId, {
        partnerId: result.member.partnerId,
        userId: result.member.userId,
        subRole: result.member.subRole,
        idempotencyKey: `${result.member.partnerId}|${result.member.userId}`,
      });
    }
    audit(redeemingUserId, `partner:${result.durable.partnerId}`, "partner.team_invitation.redeemed", { invitationId: result.durable.id });
    return result.durable;
  },

  findByTokenHash(hash: string): PartnerTeamInvitation | null {
    return teamInvitations.find((i) => i.tokenHash === hash) ?? null;
  },
};

/* ============================================================
 * Attributions (hash-chained)
 * ============================================================ */

export const partnerAttributionStore = {
  create(
    partnerId: string,
    companyId: string,
    attributedBy: string,
    source: PartnerAttribution["attributionSource"] = "admin_manual",
    notes: string | null = null,
  ): PartnerAttribution {
    requirePid(partnerId);
    if (!companyId) throw new Error("COMPANY_ID_REQUIRED");
    // Unique (partnerId, companyId)
    const existing = attributions.find((a) => a.partnerId === partnerId && a.companyId === companyId && !a.revokedAt);
    if (existing) return existing;
    const now = new Date().toISOString();
    const base: PartnerAttribution = {
      id: newId("patr"),
      partnerId,
      companyId,
      attributedAt: now,
      attributedBy,
      attributionSource: source,
      revokedAt: null,
      revokedBy: null,
      notes,
      version: 1,
      prevRevisionHash: GENESIS,
      revisionHash: "",
      updatedAt: now,
      updatedBy: attributedBy,
      isSeed: false,
    };
    base.revisionHash = computeRevisionHash(base as unknown as Record<string, unknown>);
    attributions.push(base);
    attributionsHistory.push({ ...base });
    /* v25.12 NM-9 — persist attribution via kv shim so admin attributions survive restart. */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntry } = require("./lib/storePersistenceShim");
      persistEntry("partnerAttributions", base.id, base);
    } catch { /* non-fatal */ }
    audit(attributedBy, `partner:${partnerId}`, "partner.attribution.created", { companyId, attributionId: base.id });
    emit("partner.attribution_created", partnerId, { partnerId, companyId, attributionId: base.id, idempotencyKey: `${partnerId}|${companyId}` });
    return base;
  },

  revoke(partnerId: string, companyId: string, revokedBy: string): PartnerAttribution {
    requirePid(partnerId);
    const a = attributions.find((a) => a.partnerId === partnerId && a.companyId === companyId && !a.revokedAt);
    if (!a) throw new Error("ATTRIBUTION_NOT_FOUND");
    const now = new Date().toISOString();
    const next: PartnerAttribution = {
      ...a,
      revokedAt: now,
      revokedBy,
      version: a.version + 1,
      prevRevisionHash: a.revisionHash,
      revisionHash: "",
      updatedAt: now,
      updatedBy: revokedBy,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    Object.assign(a, next);
    attributionsHistory.push({ ...next });
    /* v25.12 NM-9 — persist revoke transition. */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntry } = require("./lib/storePersistenceShim");
      persistEntry("partnerAttributions", a.id, a);
    } catch { /* non-fatal */ }
    audit(revokedBy, `partner:${partnerId}`, "partner.attribution.revoked", { companyId });
    emit("partner.attribution_revoked", partnerId, { partnerId, companyId, revokedAt: now, idempotencyKey: `${partnerId}|${companyId}|${now}` });
    return next;
  },

  listByPartner(partnerId: string, opts: { includeRevoked?: boolean } = {}): PartnerAttribution[] {
    requirePid(partnerId);
    return attributions.filter((a) => a.partnerId === partnerId && (opts.includeRevoked || !a.revokedAt));
  },

  historyForPartner(partnerId: string): PartnerAttribution[] {
    requirePid(partnerId);
    return attributionsHistory.filter((a) => a.partnerId === partnerId);
  },

  verifyChain(partnerId: string, companyId: string): { ok: boolean; brokenAt?: number; length: number } {
    requirePid(partnerId);
    const chain = attributionsHistory.filter(
      (a) => a.partnerId === partnerId && a.companyId === companyId,
    ).sort((a, b) => a.version - b.version);
    let prev = GENESIS;
    for (const r of chain) {
      if (r.prevRevisionHash !== prev) return { ok: false, brokenAt: r.version, length: chain.length };
      const expected = computeRevisionHash(r as unknown as Record<string, unknown>);
      if (r.revisionHash !== expected) return { ok: false, brokenAt: r.version, length: chain.length };
      prev = r.revisionHash;
    }
    return { ok: true, length: chain.length };
  },
};

/* ============================================================
 * Pipeline (hash-chained)
 * ============================================================ */

export const partnerPipelineStore = {
  create(
    partnerId: string,
    data: {
      dealName: string;
      companyId?: string | null;
      stage?: PipelineStage;
      estCheckSizeMinor?: number | null;
      currency?: string | null;
      sector?: string | null;
      geography?: string | null;
      ownerUserId: string;
      expectedClose?: string | null;
      notes?: string | null;
    },
    actor: string,
  ): PartnerPipelineDeal {
    requirePid(partnerId);
    if (!data.dealName) throw new Error("DEAL_NAME_REQUIRED");
    if (!data.ownerUserId) throw new Error("OWNER_REQUIRED");
    // Patch v9 (PT-FIX-4): validate stage against the whitelist.
    if (data.stage !== undefined && !ALL_PIPELINE_STAGES.includes(data.stage as PipelineStage)) {
      throw new Error("INVALID_STAGE");
    }
    const now = new Date().toISOString();
    const deal: PartnerPipelineDeal = {
      id: newId("ppl"),
      partnerId,
      dealName: data.dealName,
      companyId: data.companyId ?? null,
      stage: data.stage ?? "sourcing",
      estCheckSizeMinor: data.estCheckSizeMinor ?? null,
      currency: data.currency ?? null,
      sector: data.sector ?? null,
      geography: data.geography ?? null,
      ownerUserId: data.ownerUserId,
      expectedClose: data.expectedClose ?? null,
      notes: data.notes ?? null,
      version: 1,
      prevRevisionHash: GENESIS,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
      isSeed: false,
    };
    deal.revisionHash = computeRevisionHash(deal as unknown as Record<string, unknown>);
    pipeline.push(deal);
    pipelineHistory.push({ ...deal });
    /* v25.12 NM-9 — persist via kv shim so partner deal pipeline survives restart. */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntry } = require("./lib/storePersistenceShim");
      persistEntry("partnerPipeline", deal.id, deal);
    } catch { /* non-fatal */ }
    audit(actor, `partner:${partnerId}`, "partner.pipeline.created", { dealId: deal.id, stage: deal.stage });
    return deal;
  },

  update(partnerId: string, dealId: string, patch: Partial<PartnerPipelineDeal>, actor: string): PartnerPipelineDeal {
    requirePid(partnerId);
    const d = pipeline.find((p) => p.partnerId === partnerId && p.id === dealId);
    if (!d) throw new Error("DEAL_NOT_FOUND");
    // Patch v9 (PT-FIX-4): validate stage against the whitelist on update too.
    if (patch.stage !== undefined && !ALL_PIPELINE_STAGES.includes(patch.stage as PipelineStage)) {
      throw new Error("INVALID_STAGE");
    }
    const now = new Date().toISOString();
    const prevStage = d.stage;
    const next: PartnerPipelineDeal = {
      ...d,
      ...patch,
      id: d.id,
      partnerId: d.partnerId,
      version: d.version + 1,
      prevRevisionHash: d.revisionHash,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    Object.assign(d, next);
    pipelineHistory.push({ ...next });
    /* v25.12 NM-9 — mirror the updated row through the kv shim so the
     * latest version survives restart (not just the create snapshot). */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntry } = require("./lib/storePersistenceShim");
      persistEntry("partnerPipeline", d.id, d);
    } catch { /* non-fatal */ }
    if (patch.stage && patch.stage !== prevStage) {
      partnerPipelineActivityStore.add(d.id, "stage_change", `Stage changed from ${prevStage} to ${patch.stage}`, actor);
    }
    audit(actor, `partner:${partnerId}`, "partner.pipeline.updated", { dealId, changes: Object.keys(patch) });
    return next;
  },

  archive(partnerId: string, dealId: string, actor: string): void {
    requirePid(partnerId);
    const idx = pipeline.findIndex((p) => p.partnerId === partnerId && p.id === dealId);
    if (idx === -1) throw new Error("DEAL_NOT_FOUND");
    const removed = pipeline[idx];
    pipeline.splice(idx, 1);
    /* v25.12 NM-7 — archive must also remove the kv shim entry so the deal
     * does not reappear after restart. Previously this was an in-memory only
     * splice and the row was rehydrated from the shim, undoing the archive. */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { softDeleteEntry } = require("./lib/storePersistenceShim");
      softDeleteEntry("partnerPipeline", removed.id);
    } catch { /* non-fatal */ }
    audit(actor, `partner:${partnerId}`, "partner.pipeline.archived", { dealId });
  },

  listByPartner(partnerId: string): PartnerPipelineDeal[] {
    requirePid(partnerId);
    return pipeline.filter((p) => p.partnerId === partnerId);
  },

  byStage(partnerId: string, stage: PipelineStage): PartnerPipelineDeal[] {
    requirePid(partnerId);
    return pipeline.filter((p) => p.partnerId === partnerId && p.stage === stage);
  },

  getById(partnerId: string, dealId: string): PartnerPipelineDeal | null {
    requirePid(partnerId);
    return pipeline.find((p) => p.partnerId === partnerId && p.id === dealId) ?? null;
  },
};

export const partnerPipelineActivityStore = {
  add(pipelineId: string, type: PartnerPipelineActivity["activityType"], body: string, createdBy: string): PartnerPipelineActivity {
    const a: PartnerPipelineActivity = {
      id: newId("pact"),
      pipelineId,
      activityType: type,
      body,
      occurredAt: new Date().toISOString(),
      createdBy,
      isSeed: false,
    };
    pipelineActivities.push(a);
    /* v25.16 NC2 — persist activity entries so pipeline history survives restart. */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntry } = require("./lib/storePersistenceShim");
      persistEntry("partnerPipelineActivities", a.id, a);
    } catch { /* non-fatal */ }
    return a;
  },
  listForPipeline(pipelineId: string): PartnerPipelineActivity[] {
    return pipelineActivities.filter((a) => a.pipelineId === pipelineId);
  },
};

/* ============================================================
 * Notes (hash-chained)
 * ============================================================ */

export const partnerNotesStore = {
  create(partnerId: string, data: { scope: PartnerNote["scope"]; scopeId?: string | null; title: string; body: string }, actor: string): PartnerNote {
    requirePid(partnerId);
    if (!data.title) throw new Error("TITLE_REQUIRED");
    const now = new Date().toISOString();
    const note: PartnerNote = {
      id: newId("pnote"),
      partnerId,
      scope: data.scope,
      scopeId: data.scopeId ?? null,
      title: data.title,
      body: data.body,
      authorUserId: actor,
      createdAt: now,
      updatedAt: now,
      version: 1,
      prevRevisionHash: GENESIS,
      revisionHash: "",
      isSeed: false,
    };
    note.revisionHash = computeRevisionHash(note as unknown as Record<string, unknown>);
    notes.push(note);
    persistNote(note);
    notesHistory.push({ ...note });
    audit(actor, `partner:${partnerId}`, "partner.note.created", { noteId: note.id, scope: note.scope });
    return note;
  },
  update(partnerId: string, noteId: string, patch: Partial<PartnerNote>, actor: string, isManagingPartner = false): PartnerNote {
    requirePid(partnerId);
    const n = notes.find((nn) => nn.partnerId === partnerId && nn.id === noteId);
    if (!n) throw new Error("NOTE_NOT_FOUND");
    if (n.authorUserId !== actor && !isManagingPartner) throw new Error("NOTE_NOT_AUTHOR");
    // v25.14 NL2 — tombstone bypass: the delete path overwrites title+body
    // to "[DELETED]"; the update path used to happily un-delete by writing
    // new content on top. Block PATCH on tombstoned notes to preserve the
    // audit chain integrity.
    if (n.title === "[DELETED]") throw new Error("NOTE_TOMBSTONED");
    const now = new Date().toISOString();
    const next: PartnerNote = {
      ...n,
      ...patch,
      id: n.id,
      partnerId: n.partnerId,
      version: n.version + 1,
      prevRevisionHash: n.revisionHash,
      revisionHash: "",
      updatedAt: now,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    Object.assign(n, next);
    persistNote(n);
    notesHistory.push({ ...next });
    audit(actor, `partner:${partnerId}`, "partner.note.updated", { noteId, changes: Object.keys(patch) });
    return next;
  },
  listByPartner(partnerId: string, filters: { scope?: PartnerNote["scope"]; scopeId?: string } = {}): PartnerNote[] {
    requirePid(partnerId);
    /* v25.12 NL-3 — filter out tombstoned notes from list reads. The delete
     * path sets title/body to "[DELETED]" without a deleted flag; UX showed
     * those rows in the notes list with "[DELETED]" as content. */
    return notes.filter((n) =>
      n.partnerId === partnerId &&
      n.title !== "[DELETED]" &&
      (!filters.scope || n.scope === filters.scope) &&
      (!filters.scopeId || n.scopeId === filters.scopeId)
    );
  },
};

/* ============================================================
 * Tasks (no hash chain — operational ephemera)
 * ============================================================ */

export const partnerTasksStore = {
  create(partnerId: string, data: Partial<PartnerTask>, actor: string): PartnerTask {
    requirePid(partnerId);
    if (!data.title) throw new Error("TITLE_REQUIRED");
    const now = new Date().toISOString();
    const t: PartnerTask = {
      id: newId("ptsk"),
      partnerId,
      title: data.title,
      description: data.description ?? null,
      status: data.status ?? "open",
      priority: data.priority ?? "normal",
      assignedToUserId: data.assignedToUserId ?? null,
      dueDate: data.dueDate ?? null,
      scope: data.scope ?? null,
      scopeId: data.scopeId ?? null,
      createdAt: now,
      createdBy: actor,
      completedAt: null,
      isSeed: false,
    };
    tasks.push(t);
    persistTask(t);
    audit(actor, `partner:${partnerId}`, "partner.task.created", { taskId: t.id });
    return t;
  },
  update(partnerId: string, taskId: string, patch: Partial<PartnerTask>, actor: string): PartnerTask {
    requirePid(partnerId);
    const t = tasks.find((tt) => tt.partnerId === partnerId && tt.id === taskId);
    if (!t) throw new Error("TASK_NOT_FOUND");
    Object.assign(t, patch);
    if (patch.status === "done" && !t.completedAt) t.completedAt = new Date().toISOString();
    persistTask(t);
    audit(actor, `partner:${partnerId}`, "partner.task.updated", { taskId, changes: Object.keys(patch) });
    return t;
  },
  listByPartner(partnerId: string): PartnerTask[] {
    requirePid(partnerId);
    // v25.14 NM3 — exclude cancelled tasks from the default list view.
    return tasks.filter((t) => t.partnerId === partnerId && t.status !== "cancelled");
  },
};

/* ============================================================
 * Files
 * ============================================================ */

export const partnerFilesStore = {
  add(partnerId: string, data: Omit<PartnerFile, "id" | "isSeed" | "uploadedAt" | "partnerId" | "deletedAt" | "deletedBy">, actor: string): PartnerFile {
    requirePid(partnerId);
    const f: PartnerFile = {
      id: newId("pfile"),
      partnerId,
      ...data,
      uploadedAt: new Date().toISOString(),
      isSeed: false,
      // v25.15 NH2 — default soft-delete fields.
      deletedAt: null,
      deletedBy: null,
    };
    files.push(f);
    persistFile(f);
    audit(actor, `partner:${partnerId}`, "partner.file.uploaded", { fileId: f.id, fileName: f.fileName });
    return f;
  },
  // v25.15 NH2 — list now filters out tombstoned files. Pass
  // `{ includeDeleted: true }` only for admin audit surfaces that need them.
  listByPartner(partnerId: string, opts: { includeDeleted?: boolean } = {}): PartnerFile[] {
    requirePid(partnerId);
    return files.filter((f) =>
      f.partnerId === partnerId && (opts.includeDeleted || !f.deletedAt)
    );
  },
  getById(partnerId: string, fileId: string): PartnerFile | null {
    requirePid(partnerId);
    // v25.15 NH2 — detail reads also exclude tombstoned rows.
    return files.find(
      (f) => f.partnerId === partnerId && f.id === fileId && !f.deletedAt,
    ) ?? null;
  },
  // v25.15 NH2 — soft delete. Sets deletedAt + deletedBy and persists the
  // row so the tombstone survives restart. Returns the tombstoned record.
  remove(partnerId: string, fileId: string, actor: string): PartnerFile {
    requirePid(partnerId);
    const f = files.find((x) => x.partnerId === partnerId && x.id === fileId);
    if (!f) throw new Error("FILE_NOT_FOUND");
    if (f.deletedAt) return f; // idempotent
    f.deletedAt = new Date().toISOString();
    f.deletedBy = actor;
    persistFile(f);
    audit(actor, `partner:${partnerId}`, "partner.file.deleted", { fileId: f.id, fileName: f.fileName });
    return f;
  },
};

/* ============================================================
 * Workspace settings (hash-chained)
 * ============================================================ */

export const partnerWorkspaceSettingsStore = {
  get(partnerId: string): PartnerWorkspaceSettings {
    requirePid(partnerId);
    let s = workspaceSettings.get(partnerId);
    if (!s) {
      const now = new Date().toISOString();
      s = {
        partnerId,
        locale: "en",
        currency: "USD",
        timezone: "UTC",
        brandColor: null,
        logoUrl: null,
        customDomain: null,
        whiteLabelEnabled: false,
        configJson: null,
        version: 1,
        prevRevisionHash: GENESIS,
        revisionHash: "",
        updatedAt: now,
        updatedBy: "u_system_seed",
        isSeed: false,
      };
      s.revisionHash = computeRevisionHash(s as unknown as Record<string, unknown>);
      workspaceSettings.set(partnerId, s);
      persistWorkspaceSettings(partnerId, s);
    }
    return s;
  },
  patch(partnerId: string, patch: Partial<PartnerWorkspaceSettings>, actor: string, opts: { whiteLabelAllowed?: boolean } = {}): PartnerWorkspaceSettings {
    requirePid(partnerId);
    const s = partnerWorkspaceSettingsStore.get(partnerId);
    // Server-side tier-gate enforcement for white-label fields:
    if (!opts.whiteLabelAllowed) {
      const wlKeys = ["brandColor", "logoUrl", "customDomain", "whiteLabelEnabled"] as const;
      for (const k of wlKeys) {
        if (k in patch) throw new Error("PARTNER_TIER_INSUFFICIENT");
      }
    }
    const now = new Date().toISOString();
    const next: PartnerWorkspaceSettings = {
      ...s,
      ...patch,
      partnerId: s.partnerId,
      version: s.version + 1,
      prevRevisionHash: s.revisionHash,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    workspaceSettings.set(partnerId, next);
    persistWorkspaceSettings(partnerId, next);
    audit(actor, `partner:${partnerId}`, "partner.workspace_settings.updated", { changes: Object.keys(patch) });
    return next;
  },
};

/* ============================================================
 * SPV records + LP positions (hash-chained on SPV)
 * ============================================================ */

export const partnerSpvStore = {
  create(partnerId: string, data: Partial<PartnerSpv> & { spvName: string; jurisdiction: string; vintage: number; currency: string; status: PartnerSpv["status"] }, actor: string): PartnerSpv {
    requirePid(partnerId);
    const now = new Date().toISOString();
    const spv: PartnerSpv = {
      id: newId("pspv"),
      partnerId,
      spvName: data.spvName,
      targetCompanyId: data.targetCompanyId ?? null,
      jurisdiction: data.jurisdiction,
      entityStructure: data.entityStructure ?? null,
      vintage: data.vintage,
      totalCommittedMinor: data.totalCommittedMinor ?? 0,
      currency: data.currency,
      status: data.status,
      externalAdminProvider: data.externalAdminProvider ?? null,
      externalAdminRef: data.externalAdminRef ?? null,
      recordedAt: now,
      recordedBy: actor,
      notes: data.notes ?? null,
      version: 1,
      prevRevisionHash: GENESIS,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
      isSeed: false,
    };
    spv.revisionHash = computeRevisionHash(spv as unknown as Record<string, unknown>);
    /* v25.24 NC-2 fix — migrate the legacy partnerSpvStore.create money path
     * from non-strict `persistEntry` (failure swallowed) to `persistEntryStrict`
     * (failure throws). v25.23 NC-D only migrated partnerFundsStore; this
     * parallel SPV path was missed and remained the live SPV create path.
     * RAM is updated only after DB persistence succeeds; on failure the
     * route handler surfaces 500 to the client. */
    {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntryStrict } = require("./lib/storePersistenceShim");
      persistEntryStrict("partnerSpvs", spv.id, spv);
    }
    spvs.push(spv);
    spvsHistory.push({ ...spv });
    // CP-028: shadow-persist to the DB-backed spvFundStore so the row survives
    //   process restart. Best-effort — failure does NOT block the legacy path.
    try {
      // Lazy require to break the circular dep at module-load time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sf = require("./spvFundStore") as typeof import("./spvFundStore");
      sf.spvFundStore.shadowPersistFromLegacy({
        legacyId: spv.id,
        partnerId,
        name: spv.spvName,
        leadCompanyId: spv.targetCompanyId,
        gpUserId: actor,
        targetMinor: spv.totalCommittedMinor,
        formedAt: now,
        status: spv.status,
      });
    } catch { /* swallow — legacy path keeps working */ }
    audit(actor, `partner:${partnerId}`, "partner.spv.recorded", { spvId: spv.id });
    emit("partner.spv_recorded", spv.id, { partnerId, spvId: spv.id, idempotencyKey: spv.id });
    return spv;
  },
  update(partnerId: string, spvId: string, patch: Partial<PartnerSpv>, actor: string): PartnerSpv {
    requirePid(partnerId);
    const s = spvs.find((x) => x.partnerId === partnerId && x.id === spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const now = new Date().toISOString();
    const next: PartnerSpv = {
      ...s,
      ...patch,
      id: s.id,
      partnerId: s.partnerId,
      version: s.version + 1,
      prevRevisionHash: s.revisionHash,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    /* v25.24 NC-2 fix — see SPV create above. Strict persist BEFORE the RAM
     * mutation so a failed DB write doesn't leave RAM ahead of disk. */
    {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntryStrict } = require("./lib/storePersistenceShim");
      persistEntryStrict("partnerSpvs", s.id, next);
    }
    Object.assign(s, next);
    spvsHistory.push({ ...next });
    /* v25.16 NC1 / v25.24 NC-2 — keep the original best-effort persist below
     * for breadcrumb continuity (no-op now that strict above succeeded, but
     * idempotent so prior wave behaviour is preserved). */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntry } = require("./lib/storePersistenceShim");
      persistEntry("partnerSpvs", s.id, s);
    } catch { /* non-fatal */ }
    /* v25.16 NM7 — emit bridge event so downstream Collective surfaces react
       to SPV state transitions (status / structure / notes). */
    emit("partner.spv_updated", s.id, { partnerId, spvId, patch: Object.keys(patch), idempotencyKey: `spv-upd-${s.id}-v${next.version}` });
    audit(actor, `partner:${partnerId}`, "partner.spv.updated", { spvId });
    return next;
  },
  listByPartner(partnerId: string): PartnerSpv[] {
    requirePid(partnerId);
    return spvs.filter((s) => s.partnerId === partnerId);
  },
  getById(partnerId: string, spvId: string): PartnerSpv | null {
    requirePid(partnerId);
    return spvs.find((s) => s.partnerId === partnerId && s.id === spvId) ?? null;
  },
  addPosition(
    partnerId: string,
    spvId: string,
    data: { lpContactId: string; positionAmountMinor: number; currency: string; positionStatus?: PartnerSpvPosition["positionStatus"]; fxRateToSpvBase?: string; notes?: string },
    actor: string,
  ): PartnerSpvPosition {
    requirePid(partnerId);
    const s = partnerSpvStore.getById(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    // Unique (spvId, lpContactId)
    const existing = spvPositions.find((p) => p.partnerSpvId === spvId && p.lpContactId === data.lpContactId);
    if (existing) throw new Error("POSITION_EXISTS");
    const now = new Date().toISOString();
    const pos: PartnerSpvPosition = {
      id: newId("pspvp"),
      partnerSpvId: spvId,
      lpContactId: data.lpContactId,
      positionAmountMinor: data.positionAmountMinor,
      currency: data.currency,
      fxRateToSpvBase: data.fxRateToSpvBase ?? null,
      fxLockedAt: data.fxRateToSpvBase ? now : null,
      positionStatus: data.positionStatus ?? "pledged",
      recordedAt: now,
      recordedBy: actor,
      notes: data.notes ?? null,
      isSeed: false,
    };
    /* v25.16 NM3 — honour fxRateToSpvBase when provided so cross-currency
       positions are normalized into the SPV's base currency before being
       added to the running committed total. If no rate is supplied we keep
       the v1 behaviour (raw sum) for backward compatibility. */
    const rateNum = data.fxRateToSpvBase ? Number(data.fxRateToSpvBase) : NaN;
    const normalizedMinor =
      Number.isFinite(rateNum) && rateNum > 0
        ? Math.round(data.positionAmountMinor * rateNum)
        : data.positionAmountMinor;
    /* v25.24 NC-2 fix — SPV addPosition is the worst v25.23 NC-D miss:
     * the previous code did `s.totalCommittedMinor += normalizedMinor`
     * BEFORE the swallowed persistEntry, so a failed DB write left the RAM
     * denorm ahead of disk. The bridge event then fired with a value that
     * is irreproducible from the DB. We now compute the next denorm value,
     * strict-persist BOTH the spv (with updated denorm) and the position
     * row, and update RAM only on DB success. */
    const nextTotalCommittedMinor = s.totalCommittedMinor + normalizedMinor;
    {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntryStrict } = require("./lib/storePersistenceShim");
      const spvAfter = { ...s, totalCommittedMinor: nextTotalCommittedMinor, updatedAt: now, updatedBy: actor };
      persistEntryStrict("partnerSpvs", s.id, spvAfter);
      persistEntryStrict("partnerSpvPositions", pos.id, pos);
    }
    // DB persisted: now update RAM denorm.
    spvPositions.push(pos);
    s.totalCommittedMinor = nextTotalCommittedMinor;
    s.updatedAt = now;
    s.updatedBy = actor;
    // CP-028: shadow-persist position as a commitment in the DB-backed store.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sf = require("./spvFundStore") as typeof import("./spvFundStore");
      sf.spvFundStore.shadowCommitmentFromLegacy({
        legacyId: pos.id,
        legacySpvId: spvId,
        partnerId,
        lpUserId: data.lpContactId,
        amountMinor: data.positionAmountMinor,
      });
    } catch { /* swallow */ }
    audit(actor, `partner:${partnerId}`, "partner.spv.position_recorded", { spvId, positionId: pos.id });
    return pos;
  },
  listPositions(partnerId: string, spvId: string): PartnerSpvPosition[] {
    requirePid(partnerId);
    // Validate SPV ownership
    const s = partnerSpvStore.getById(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    return spvPositions.filter((p) => p.partnerSpvId === spvId);
  },
};

/* ============================================================
 * Funds + commitments (hash-chained on fund)
 * ============================================================ */

export const partnerFundsStore = {
  create(partnerId: string, data: Partial<PartnerFund> & { fundName: string; fundType: PartnerFund["fundType"]; jurisdiction: string; vintage: number; currency: string; status: PartnerFund["status"] }, actor: string): PartnerFund {
    requirePid(partnerId);
    const now = new Date().toISOString();
    const f: PartnerFund = {
      id: newId("pfnd"),
      partnerId,
      fundName: data.fundName,
      fundType: data.fundType,
      jurisdiction: data.jurisdiction,
      vintage: data.vintage,
      targetSizeMinor: data.targetSizeMinor ?? null,
      committedSizeMinor: data.committedSizeMinor ?? 0,
      currency: data.currency,
      status: data.status,
      externalAdminProvider: data.externalAdminProvider ?? null,
      externalAdminRef: data.externalAdminRef ?? null,
      recordedAt: now,
      recordedBy: actor,
      notes: data.notes ?? null,
      version: 1,
      prevRevisionHash: GENESIS,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
      isSeed: false,
    };
    f.revisionHash = computeRevisionHash(f as unknown as Record<string, unknown>);
    /* v25.12 NM-9 — persist via kv shim so partner funds survive restart.
     * v25.23 NC-D (money surface) — fail closed: write to DB FIRST via the
     * strict shim; only mutate the in-memory arrays once the durable write
     * succeeds. A persist failure throws and leaves zero RAM-only state. */
    persistEntryStrict("partnerFunds", f.id, f);
    funds.push(f);
    fundsHistory.push({ ...f });
    audit(actor, `partner:${partnerId}`, "partner.fund.recorded", { fundId: f.id });
    return f;
  },
  update(partnerId: string, fundId: string, patch: Partial<PartnerFund>, actor: string): PartnerFund {
    requirePid(partnerId);
    const f = funds.find((x) => x.partnerId === partnerId && x.id === fundId);
    if (!f) throw new Error("FUND_NOT_FOUND");
    const now = new Date().toISOString();
    const next: PartnerFund = {
      ...f,
      ...patch,
      id: f.id,
      partnerId: f.partnerId,
      version: f.version + 1,
      prevRevisionHash: f.revisionHash,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    /* v25.12 NM-9 — persist update.
     * v25.23 NC-D (money surface) — fail closed: persist the new revision to
     * the DB FIRST. Only commit the change into the in-memory fund + history
     * once the durable write succeeds. Snapshot the prior state so a persist
     * failure rolls back the RAM mutation and re-throws to the caller. */
    const fundSnapshot: PartnerFund = { ...f };
    Object.assign(f, next);
    try {
      persistEntryStrict("partnerFunds", f.id, f);
    } catch (persistErr) {
      Object.assign(f, fundSnapshot); // roll back RAM mutation
      throw persistErr;
    }
    fundsHistory.push({ ...next });
    audit(actor, `partner:${partnerId}`, "partner.fund.updated", { fundId });
    return next;
  },
  listByPartner(partnerId: string): PartnerFund[] {
    requirePid(partnerId);
    return funds.filter((f) => f.partnerId === partnerId);
  },
  getById(partnerId: string, fundId: string): PartnerFund | null {
    requirePid(partnerId);
    return funds.find((f) => f.partnerId === partnerId && f.id === fundId) ?? null;
  },
  pledge(partnerId: string, fundId: string, data: { lpContactId: string; commitmentMinor: number; currency: string; isRolling?: boolean; rollingPeriod?: string; fxRateToFundBase?: string; notes?: string }, actor: string): PartnerFundCommitment {
    requirePid(partnerId);
    const f = partnerFundsStore.getById(partnerId, fundId);
    if (!f) throw new Error("FUND_NOT_FOUND");
    // Unique (fundId, lpContactId, rollingPeriod)
    const dupe = fundCommitments.find((c) => c.partnerFundId === fundId && c.lpContactId === data.lpContactId && (c.rollingPeriod ?? null) === (data.rollingPeriod ?? null));
    if (dupe) throw new Error("COMMITMENT_EXISTS");
    const now = new Date().toISOString();
    /* v25.23 NH-K — duplicate-create race guard for fund commitments.
     * Lane D NH-4 found the only uniqueness backstop is the RAM `find` above,
     * which races across the await boundary (and double-click / two-tab
     * submits, amplified by the missing client guard NM-2). Add an idempotent
     * server-side dedup on the natural key (fundId, lpContactId,
     * commitmentMinor, day-bucket): if an identical commitment was created
     * < 5s ago, return that existing row instead of inserting a second one
     * (which would double-count committedSizeMinor). The 5s window keeps this
     * to genuine rapid-retry races, not legitimate later re-pledges. */
    const calledAtIsoDay = now.slice(0, 10); // YYYY-MM-DD natural-key day bucket
    const DEDUP_WINDOW_MS = 5_000;
    const recentDupe = fundCommitments.find(
      (c) =>
        c.partnerFundId === fundId &&
        c.lpContactId === data.lpContactId &&
        c.commitmentMinor === data.commitmentMinor &&
        (c.pledgedAt ?? "").slice(0, 10) === calledAtIsoDay &&
        Date.now() - Date.parse(c.pledgedAt ?? now) < DEDUP_WINDOW_MS,
    );
    if (recentDupe) return recentDupe;
    const c: PartnerFundCommitment = {
      id: newId("pfcom"),
      partnerFundId: fundId,
      lpContactId: data.lpContactId,
      commitmentMinor: data.commitmentMinor,
      currency: data.currency,
      fxRateToFundBase: data.fxRateToFundBase ?? null,
      fxLockedAt: data.fxRateToFundBase ? now : null,
      status: "pledged",
      pledgedAt: now,
      recordedBy: actor,
      isRolling: !!data.isRolling,
      rollingPeriod: data.rollingPeriod ?? null,
      notes: data.notes ?? null,
      isSeed: false,
    };
    /* v25.16 NM3 — honour fxRateToFundBase when provided so cross-currency
       fund commitments contribute their normalized amount to committedSizeMinor.
       v1 fallback retained when no rate supplied. */
    const rate = data.fxRateToFundBase ? Number(data.fxRateToFundBase) : NaN;
    const normalizedMinor =
      Number.isFinite(rate) && rate > 0
        ? Math.round(data.commitmentMinor * rate)
        : data.commitmentMinor;
    /* v25.16 NC3 — persist the new commitment record AND the updated parent
       fund so committedSizeMinor + the pledge survive restart.
       v25.23 NC-D (money surface) — fail closed. Build the candidate fund
       state, persist the commitment AND the updated fund to the DB FIRST via
       the strict shim; only mutate the in-memory commitment array + parent
       fund once BOTH durable writes succeed. On any persist failure we throw
       WITHOUT having touched RAM, so committedSizeMinor can never drift to a
       value that exists only in memory. (committedSizeMinor math itself is
       unchanged — still integer minor units, fx-normalized.) */
    const fundCommittedBefore = f.committedSizeMinor;
    const fundUpdatedAtBefore = f.updatedAt;
    const fundUpdatedByBefore = f.updatedBy;
    f.committedSizeMinor += normalizedMinor;
    f.updatedAt = now;
    f.updatedBy = actor;
    try {
      persistEntryStrict("partnerFundCommitments", c.id, c);
      persistEntryStrict("partnerFunds", f.id, f);
    } catch (persistErr) {
      // Roll back the parent-fund mutation; the commitment was never pushed.
      f.committedSizeMinor = fundCommittedBefore;
      f.updatedAt = fundUpdatedAtBefore;
      f.updatedBy = fundUpdatedByBefore;
      throw persistErr;
    }
    fundCommitments.push(c);
    audit(actor, `partner:${partnerId}`, "partner.fund.commitment_pledged", { fundId, commitmentId: c.id });
    emit("partner.fund_commitment_pledged", c.id, { partnerId, fundId, commitmentId: c.id, lpContactId: c.lpContactId, idempotencyKey: c.id });
    return c;
  },
  listCommitments(partnerId: string, fundId: string): PartnerFundCommitment[] {
    requirePid(partnerId);
    const f = partnerFundsStore.getById(partnerId, fundId);
    if (!f) throw new Error("FUND_NOT_FOUND");
    return fundCommitments.filter((c) => c.partnerFundId === fundId);
  },
};

/* ============================================================
 * Dashboard aggregator
 * ============================================================ */

export function partnerDashboardSnapshot(partnerId: string): {
  portfolio: { attributedCompanies: number; totalSpvCommittedMinor: number; totalFundCommittedMinor: number };
  pipeline: { byStage: Record<PipelineStage, number>; topDeals: PartnerPipelineDeal[] };
  recentActivity: PartnerPipelineActivity[];
  team: { activeSeats: number; pendingInvitations: number; seatLimit: number };
  empty: boolean;
} {
  requirePid(partnerId);
  const attrs = partnerAttributionStore.listByPartner(partnerId);
  const pSpvs = partnerSpvStore.listByPartner(partnerId);
  const pFunds = partnerFundsStore.listByPartner(partnerId);
  const pl = partnerPipelineStore.listByPartner(partnerId);
  const partner = getContactById(partnerId);
  const tier: PartnerTier = (partner?.tier as PartnerTier) ?? "catalyst";

  const byStage: Record<PipelineStage, number> = {
    sourcing: 0, qualifying: 0, committee: 0, committed: 0, closed_won: 0, closed_lost: 0,
  };
  for (const d of pl) byStage[d.stage] += 1;

  const topDeals = [...pl]
    .filter((d) => d.stage !== "closed_lost" && d.stage !== "closed_won")
    .sort((a, b) => (b.estCheckSizeMinor ?? 0) - (a.estCheckSizeMinor ?? 0))
    .slice(0, 5);

  // Last 10 pipeline activities across all of partner's deals
  const partnerDealIds = new Set(pl.map((d) => d.id));
  const recentActivity = pipelineActivities
    .filter((a) => partnerDealIds.has(a.pipelineId))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 10);

  const activeSeats = partnerTeamStore.countActiveSeats(partnerId);
  const pendingInvitations = partnerInvitationStore.countPendingByPartner(partnerId);
  const seatLimit = TIER_SEAT_LIMITS[tier];

  return {
    portfolio: {
      attributedCompanies: attrs.length,
      totalSpvCommittedMinor: pSpvs.reduce((s, x) => s + x.totalCommittedMinor, 0),
      totalFundCommittedMinor: pFunds.reduce((s, x) => s + x.committedSizeMinor, 0),
    },
    pipeline: { byStage, topDeals },
    recentActivity,
    team: { activeSeats, pendingInvitations, seatLimit },
    empty: attrs.length === 0 && pl.length === 0 && pSpvs.length === 0 && pFunds.length === 0,
  };
}

/* ============================================================
 * Final Partner CRM — partner_deal_promotions store
 *
 * Every state change is:
 *   1. Hash-chained (version++ + prevRevisionHash + revisionHash)
 *   2. Snapshotted to dealPromotionsHistory
 *   3. Audit-logged via appendAdminAudit
 *   4. Emitted on the bridge with idempotency key = promotionId
 * ============================================================ */

export class PromotionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotionConflictError";
  }
}

export const partnerDealPromotionsStore = {
  /** Create a new promotion. Throws PromotionConflictError(409) if an active
   *  (pending or live) promotion of the same type already exists for this deal. */
  create(
    partnerId: string,
    pipelineDealId: string,
    data: {
      promotionType: PartnerDealPromotionType;
      companyId?: string | null;
      targetEmail?: string | null;
      notes?: string | null;
    },
    actor: string,
  ): PartnerDealPromotion {
    requirePid(partnerId);
    if (!pipelineDealId) throw new Error("PIPELINE_DEAL_ID_REQUIRED");
    const existing = dealPromotions.find(
      (p) =>
        p.partnerId === partnerId &&
        p.pipelineDealId === pipelineDealId &&
        p.promotionType === data.promotionType &&
        // v25.15 F2-NH1 — include pending_collective_review when checking for
        // an existing active promotion of the same type (prior code missed it).
        (p.status === "pending" ||
          p.status === "pending_collective_review" ||
          p.status === "live"),
    );
    if (existing) {
      throw new PromotionConflictError(
        `Deal ${pipelineDealId} is already promoted (${data.promotionType}, status=${existing.status}).`,
      );
    }
    /* v25.23 NH-K — duplicate-create race guard for promotions. Lane D NH-4
     * found the only backstop is the RAM `find` above, which races across the
     * await boundary (two-tab / double-submit). Add an idempotent dedup on the
     * natural key (partnerId, companyId, promotionType): if an identical
     * promotion was created < 5s ago, return it instead of inserting a second
     * row that would cascade a duplicate into the Collective dealroom. Only
     * applies when companyId is present (the natural key requires it). */
    if (data.companyId) {
      const DEDUP_WINDOW_MS = 5_000;
      const recentDupe = dealPromotions.find(
        (p) =>
          p.partnerId === partnerId &&
          p.companyId === data.companyId &&
          p.promotionType === data.promotionType &&
          Date.now() - Date.parse(p.promotedAt ?? "") < DEDUP_WINDOW_MS,
      );
      if (recentDupe) return recentDupe;
    }
    const now = new Date().toISOString();
    const p: PartnerDealPromotion = {
      // v25.15 NH4 — was "pdp" which collided with partnerWorkspaceV19Store's
      // deal-pipeline rows. Use "ppromo" (partner promotion) for clarity in
      // audit logs and cross-store ID inspection.
      id: newId("ppromo"),
      partnerId,
      pipelineDealId,
      promotionType: data.promotionType,
      companyId: data.companyId ?? null,
      targetEmail: data.targetEmail ?? null,
      // v25.15 F2-NH1 — status now correctly reflects the moderation gate:
      //   collective_deal_room → "pending_collective_review" (not live until approved)
      //   capavate_referral    → "pending" (admin must approve)
      // approvedAt / approvedBy stay null on create; both are only set on the
      // approve()/applyModeration("approved") path. This eliminates the prior
      // status='live'+moderationStatus='pending' data-contract contradiction.
      status:
        data.promotionType === "collective_deal_room"
          ? "pending_collective_review"
          : "pending",
      promotedBy: actor,
      promotedAt: now,
      approvedAt: null,
      approvedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      rejectedReason: null,
      withdrawnAt: null,
      withdrawnBy: null,
      notes: data.notes ?? null,
      version: 1,
      prevRevisionHash: GENESIS,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
      isSeed: false,
      // CP Phase B — default moderation_status='pending'.
      moderationStatus: "pending",
      moderatedByUserId: null,
      moderatedAt: null,
      moderationNotes: null,
      // v25.23 NM-N — stamp the chapter so listPendingModeration(chapterId)
      // actually filters. Until per-promotion chapter selection ships from
      // the UI, default to DEFAULT_CHAPTER_ID so the same-chapter admin
      // queue resolves the row, and cross-chapter callers correctly see it
      // filtered out.
      chapterId: DEFAULT_CHAPTER_ID,
    };
    p.revisionHash = computeRevisionHash(p as unknown as Record<string, unknown>);
    /* DB write-through (v17 Phase B) — synchronous; in-memory remains source of truth.
     * v25.23 NC-D (visibility surface) — fail closed. Persist a strict kv-shim
     * backstop FIRST so the promotion is durable before any RAM mutation; the
     * typed partner_deal_promotions write (persistDealPromotion, which the
     * Collective hydrator reads) is then attempted as before. Only push into
     * the in-memory arrays once the durable strict write succeeds — on failure
     * we throw with zero RAM-only state. (No new typed table introduced; the
     * kv_partnerDealPromotions shim is the durable backstop per scope.) */
    persistEntryStrict("partnerDealPromotions", p.id, p);
    persistDealPromotion(p, true);
    dealPromotions.push(p);
    dealPromotionsHistory.push({ ...p });
    audit(actor, `partner:${partnerId}`, "partner.deal_promotion.created", {
      promotionId: p.id,
      pipelineDealId,
      promotionType: p.promotionType,
      status: p.status,
    });
    const eventType =
      p.promotionType === "collective_deal_room"
        ? "partner.deal.promoted_to_collective"
        : "partner.deal.referred_to_capavate";
    emit(eventType, p.id, {
      promotionId: p.id,
      partnerId,
      pipelineDealId,
      promotionType: p.promotionType,
      companyId: p.companyId,
      status: p.status,
      idempotencyKey: p.id,
    });
    return p;
  },

  /** Approve a pending promotion (admin-only path for capavate referrals or
   *  for review-required collective promotions). */
  approve(promotionId: string, approver: string): PartnerDealPromotion {
    const p = dealPromotions.find((x) => x.id === promotionId);
    if (!p) throw new Error("PROMOTION_NOT_FOUND");
    if (p.status === "live") return p;
    // v25.15 F2-NH1 — accept BOTH "pending" (capavate referrals) and
    // "pending_collective_review" (collective deal room) as approvable inputs.
    if (p.status !== "pending" && p.status !== "pending_collective_review") {
      throw new Error("PROMOTION_NOT_PENDING");
    }
    const now = new Date().toISOString();
    const next: PartnerDealPromotion = {
      ...p,
      status: "live",
      approvedAt: now,
      approvedBy: approver,
      version: p.version + 1,
      prevRevisionHash: p.revisionHash,
      revisionHash: "",
      updatedAt: now,
      updatedBy: approver,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    // v25.23 NC-D — fail-closed: persist durably before mutating RAM.
    commitPromotionTransitionStrict(p, next);
    audit(approver, `partner:${p.partnerId}`, "partner.deal_promotion.approved", {
      promotionId, promotionType: p.promotionType,
    });
    return next;
  },

  /** Withdraw a promotion. The historical row is preserved; the live row
   *  flips to status='withdrawn' and the Deal Room aggregator filters it out. */
  withdraw(partnerId: string, promotionId: string, actor: string): PartnerDealPromotion {
    requirePid(partnerId);
    const p = dealPromotions.find((x) => x.id === promotionId && x.partnerId === partnerId);
    if (!p) throw new Error("PROMOTION_NOT_FOUND");
    if (p.status === "withdrawn" || p.status === "rejected") return p;
    const now = new Date().toISOString();
    const next: PartnerDealPromotion = {
      ...p,
      status: "withdrawn",
      withdrawnAt: now,
      withdrawnBy: actor,
      version: p.version + 1,
      prevRevisionHash: p.revisionHash,
      revisionHash: "",
      updatedAt: now,
      updatedBy: actor,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    // v25.23 NC-D — fail-closed: persist durably before mutating RAM.
    commitPromotionTransitionStrict(p, next);
    audit(actor, `partner:${p.partnerId}`, "partner.deal_promotion.withdrawn", { promotionId });
    return next;
  },

  /** Reject a pending promotion (admin path — referrals only). */
  reject(promotionId: string, rejector: string, reason: string): PartnerDealPromotion {
    const p = dealPromotions.find((x) => x.id === promotionId);
    if (!p) throw new Error("PROMOTION_NOT_FOUND");
    /* v25.16 NH2 — mirror approve() guard so collective deal room promotions
       (which start in pending_collective_review since v25.15 F2-NH1) can also
       be rejected by the admin referral-reject route. */
    if (p.status !== "pending" && p.status !== "pending_collective_review") {
      throw new Error("PROMOTION_NOT_PENDING");
    }
    const now = new Date().toISOString();
    const next: PartnerDealPromotion = {
      ...p,
      status: "rejected",
      rejectedAt: now,
      rejectedBy: rejector,
      rejectedReason: reason,
      version: p.version + 1,
      prevRevisionHash: p.revisionHash,
      revisionHash: "",
      updatedAt: now,
      updatedBy: rejector,
    };
    next.revisionHash = computeRevisionHash(next as unknown as Record<string, unknown>);
    // v25.23 NC-D — fail-closed: persist durably before mutating RAM.
    commitPromotionTransitionStrict(p, next);
    audit(rejector, `partner:${p.partnerId}`, "partner.deal_promotion.rejected", {
      promotionId, reason,
    });
    return next;
  },

  getById(promotionId: string): PartnerDealPromotion | null {
    return dealPromotions.find((x) => x.id === promotionId) ?? null;
  },

  listByPartner(partnerId: string): PartnerDealPromotion[] {
    requirePid(partnerId);
    return dealPromotions.filter((p) => p.partnerId === partnerId);
  },

  listByPipelineDeal(partnerId: string, pipelineDealId: string): PartnerDealPromotion[] {
    requirePid(partnerId);
    return dealPromotions.filter(
      (p) => p.partnerId === partnerId && p.pipelineDealId === pipelineDealId,
    );
  },

  /** Live (non-withdrawn, non-rejected) Collective Deal Room promotions across
   *  all partners — used by GET /api/collective/dealroom/companies to merge
   *  partner-promoted entries into the existing Deal Room list.
   *  CP Phase B: also requires moderation_status='approved' (CP-015). */
  listLiveCollectivePromotions(): PartnerDealPromotion[] {
    /* v25.16 cross-comp NH2 — also hide promotions whose owning partner has
       been suspended/archived. Lazy-require to avoid circular import. */
    let getContactStatus: (id: string) => string = () => "active";
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ac = require("./adminContactsStoreShim") as { getById?: (id: string) => { status?: string } | undefined };
      if (typeof ac.getById === "function") {
        getContactStatus = (id: string) => ac.getById!(id)?.status ?? "active";
      }
    } catch { /* non-fatal */ }
    return dealPromotions.filter(
      (p) =>
        p.promotionType === "collective_deal_room" &&
        p.status === "live" &&
        p.moderationStatus === "approved" &&
        getContactStatus(p.partnerId) === "active",
    );
  },

  /** CP Phase B: list pending-moderation promotions for a chapter admin queue.
   *  Filter is by current chapter_id stamp on the row. */
  listPendingModeration(chapterId?: string): PartnerDealPromotion[] {
    /* v25.16 NH4 — honour the chapterId parameter to prevent cross-chapter
       queue leakage. v25.16 cross-comp NM2 — also hide promotions from
       suspended partners. */
    let getContactStatus: (id: string) => string = () => "active";
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ac = require("./adminContactsStoreShim") as { getById?: (id: string) => { status?: string } | undefined };
      if (typeof ac.getById === "function") {
        getContactStatus = (id: string) => ac.getById!(id)?.status ?? "active";
      }
    } catch { /* non-fatal */ }
    return dealPromotions.filter(
      (p) =>
        p.promotionType === "collective_deal_room" &&
        (p.moderationStatus === "pending" ||
          p.moderationStatus === "changes_requested") &&
        (chapterId == null || p.chapterId === chapterId) &&
        getContactStatus(p.partnerId) === "active",
    );
  },

  /** Internal helper for chapter-admin moderation transition. */
  applyModeration(
    promotionId: string,
    nextStatus: PartnerDealModerationStatus,
    actor: string,
    notes?: string | null,
  ): PartnerDealPromotion {
    const p = dealPromotions.find((x) => x.id === promotionId);
    if (!p) throw new Error("PROMOTION_NOT_FOUND");
    if (p.promotionType !== "collective_deal_room") {
      throw new Error("PROMOTION_NOT_MODERATABLE");
    }
    const now = new Date().toISOString();
    const next = { ...p } as PartnerDealPromotion;
    next.moderationStatus = nextStatus;
    next.moderatedByUserId = actor;
    next.moderatedAt = now;
    next.moderationNotes = notes ?? null;
    // v25.15 F2-NH1 — promote status alongside the moderation transition so
    // the two fields stay consistent. Approved → live, rejected → rejected,
    // changes_requested stays in pending_collective_review (or pending).
    if (nextStatus === "approved") {
      next.status = "live";
      next.approvedAt = now;
      next.approvedBy = actor;
    } else if (nextStatus === "rejected") {
      next.status = "rejected";
      next.rejectedAt = now;
      next.rejectedBy = actor;
      next.rejectedReason = notes ?? null;
    }
    next.version = (p.version ?? 1) + 1;
    next.prevRevisionHash = p.revisionHash;
    next.updatedAt = now;
    next.updatedBy = actor;
    next.revisionHash = computeRevisionHash(
      next as unknown as Record<string, unknown>,
    );
    // v25.23 NC-D — fail-closed: persist durably (strict backstop + typed
    // write) BEFORE mutating in place + history snapshot.
    commitPromotionTransitionStrict(p, next);
    audit(actor, `partner:${p.partnerId}`, "partner.promotion.moderated", {
      promotionId: p.id,
      nextStatus,
    });
    /* v25.23 NM-O fix — emit a bridge event so other components (Collective
     * dealroom, Capavate founder homepage, notifications) can react to the
     * moderation outcome instead of polling. Mirrors create()'s emit at
     * partner.deal.promoted_to_collective. Non-fatal; the moderation row is
     * already durably persisted by persistDealPromotion above. */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { emitBridgeEvent } = require("./bridgeStore");
      const eventType =
        nextStatus === "approved"
          ? "partner.promotion.approved"
          : nextStatus === "rejected"
          ? "partner.promotion.rejected"
          : "partner.promotion.changes_requested";
      emitBridgeEvent({
        eventType,
        aggregateId: p.id,
        aggregateKind: "partner",
        payload: {
          promotionId: p.id,
          partnerId: p.partnerId,
          companyId: p.companyId,
          pipelineDealId: p.pipelineDealId,
          moderationStatus: nextStatus,
          status: p.status,
          moderatedBy: actor,
          moderatedAt: now,
          notes: notes ?? null,
          chapterId: p.chapterId,
        },
      });
    } catch { /* non-fatal: bridge consumers may not be wired in test */ }
    return p;
  },

  /** Capavate referrals queued for admin review. Admin-only consumer. */
  listPendingCapavateReferrals(): PartnerDealPromotion[] {
    return dealPromotions.filter(
      (p) =>
        p.promotionType === "capavate_referral" &&
        p.status === "pending",
    );
  },

  history(): PartnerDealPromotion[] {
    return dealPromotionsHistory.slice();
  },
};

/* ============================================================
 * Test seed (DEMO_SEED_ENABLED only)
 * ============================================================ */

export const TEST_PARTNER_ID = "ac_consortium_partner_test_partner_inc";
export const TEST_PARTNER_LEGAL_NAME = "TEST PARTNER, INC";
export const TEST_PARTNER_USERS = {
  managing: { userId: "u_avi_managing", email: "avi.managing@test-partner.example", name: "Avi Managing" },
  viewer: { userId: "u_avi_viewer", email: "avi.viewer@test-partner.example", name: "Avi Viewer" },
};

let _testSeeded = false;
/**
 * Seed the TEST PARTNER, INC sandbox account plus avi_managing + avi_viewer.
 * NEVER runs in production (defense in depth via DEMO_SEED_ENABLED).
 * Idempotent — safe to call multiple times.
 */
export function seedTestPartnerSandbox(opts: { force?: boolean } = {}): void {
  if (_testSeeded && !opts.force) return;
  if (!DEMO_SEED_ENABLED && !opts.force) return;
  _testSeeded = true;

  // Inject the partner record by direct map mutation — bypasses the public
  // createContact API because we need a stable ID for test rounding.
  _registerSeedPartner({
    id: TEST_PARTNER_ID,
    legalName: TEST_PARTNER_LEGAL_NAME,
    displayName: "TEST PARTNER, INC",
    email: "ops@test-partner.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });

  partnerTeamStore.add(TEST_PARTNER_ID, TEST_PARTNER_USERS.managing.userId, "managing_partner", "u_system_seed", { isSeed: true });
  partnerTeamStore.add(TEST_PARTNER_ID, TEST_PARTNER_USERS.viewer.userId, "viewer", "u_system_seed", { isSeed: true });

  // Emit partner.onboarded once
  emit("partner.onboarded", TEST_PARTNER_ID, {
    partnerId: TEST_PARTNER_ID,
    legalName: TEST_PARTNER_LEGAL_NAME,
    tier: "builder",
    partnerType: "accelerator",
    onboardedBy: "u_system_seed",
    idempotencyKey: TEST_PARTNER_ID,
  });
}

/* ============================================================
 * Test-only inspection helpers (used by partner store unit tests)
 * ============================================================ */

/* ============================================================
 * DB write-through for partner_deal_promotions (v17 Phase B)
 * ============================================================ */

function toDbRow(p: PartnerDealPromotion): Record<string, unknown> {
  return {
    id: p.id,
    tenantId: DEFAULT_CHAPTER_TENANT_ID,
    chapterId: DEFAULT_CHAPTER_ID,
    partnerId: p.partnerId,
    pipelineDealId: p.pipelineDealId,
    promotionType: p.promotionType,
    companyId: p.companyId,
    targetEmail: p.targetEmail,
    status: p.status,
    promotedBy: p.promotedBy,
    promotedAt: p.promotedAt,
    approvedAt: p.approvedAt,
    approvedBy: p.approvedBy,
    rejectedAt: p.rejectedAt,
    rejectedBy: p.rejectedBy,
    rejectedReason: p.rejectedReason,
    withdrawnAt: p.withdrawnAt,
    withdrawnBy: p.withdrawnBy,
    notes: p.notes,
    version: p.version,
    prevHash: p.prevRevisionHash === GENESIS ? null : p.prevRevisionHash,
    hash: p.revisionHash,
    updatedAt: p.updatedAt,
    updatedBy: p.updatedBy,
    isSeed: p.isSeed ? 1 : 0,
    createdAt: p.promotedAt,
    // CP Phase B moderation columns (CP-015..CP-018).
    moderationStatus: p.moderationStatus,
    moderatedByUserId: p.moderatedByUserId,
    moderatedAt: p.moderatedAt,
    moderationNotes: p.moderationNotes,
  };
}

/* v25.23 NC-D (visibility surface) — fail-closed commit for promotion status
 * transitions (approve / withdraw / reject / applyModeration). Persist the
 * NEXT revision durably FIRST (strict kv-shim backstop + the typed v17 Phase B
 * write), and only THEN mutate the in-memory promotion + push history. If the
 * durable write fails, throw before touching RAM so a status change can never
 * live only in memory. Returns the committed `next` (now == the live `p`). */
function commitPromotionTransitionStrict(
  p: PartnerDealPromotion,
  next: PartnerDealPromotion,
): PartnerDealPromotion {
  // DB first — strict backstop throws on failure (no RAM mutation yet).
  persistEntryStrict("partnerDealPromotions", next.id, next);
  // Typed partner_deal_promotions write (read by the Collective hydrator).
  persistDealPromotion(next, false);
  // Durable writes succeeded — now commit to RAM.
  Object.assign(p, next);
  dealPromotionsHistory.push({ ...next });
  return next;
}

/* v25.24 NH-1 fix — the v25.23 NC-D migration added
 * `commitPromotionTransitionStrict` which strict-persists to `kv_partnerDealPromotions`,
 * but Lane D2 second-pass confirmed that `kv_partnerDealPromotions` is NEVER
 * read by the hydrator. The authoritative source is the typed
 * `partner_deal_promotions` table, hydrated by `hydratePartnerWorkspaceCollectiveStore`
 * below. The strict guard therefore protected an unhydrated shadow while the
 * authoritative write here continued to swallow DB failures.
 *
 * We now make THIS function strict-on-real-error (still tolerating "no such
 * table" which is the legitimate early-boot / pre-migration case). Callers
 * already had try/catch around prior failure modes; we re-throw a tagged
 * error they can handle. */
function persistDealPromotion(p: PartnerDealPromotion, isInsert: boolean): void {
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      const row = toDbRow(p);
      if (isInsert) {
        tx.insert(partnerDealPromotionsTable).values(row as any).run();
      } else {
        // Update existing row (status change via approve/withdraw/reject)
        tx
          .update(partnerDealPromotionsTable)
          .set(row as any)
          .where(eq(partnerDealPromotionsTable.id, p.id))
          .run();
      }
    });
  } catch (err) {
    const msg = String(err);
    if (/no such table/i.test(msg)) {
      // Early-boot before migrations have run; tolerate (table will exist later).
      log.warn("[partnerWorkspaceStore.persistDealPromotion] no such table yet (early boot)");
      return;
    }
    log.error({
      route: "partnerWorkspaceStore.persistDealPromotion",
      errorType: "DEAL_PROMOTION_PERSIST_FAILED",
      message: msg,
      promotionId: p.id,
      isInsert,
    });
    throw new Error("DEAL_PROMOTION_PERSIST_FAILED");
  }
}

/**
 * Hydrate the Collective slice (partner_deal_promotions only) from DB.
 * Other partner store tables (teamMembers, pipeline, etc.) remain in-memory
 * and are deferred to v20.
 */
export async function hydratePartnerWorkspaceCollectiveStore(): Promise<void> {
  try {
    const db = getDb();
    /* Wave H Track A — was `await db.select()...all()` which crashes on
     * postgres-js (no .all method). Converted to portable pAll() so this
     * hydrate path works on both drivers. This was one of the three crash
     * sites in Avi's production logs:
     *   `[hydrate] partnerWorkspaceStore: hydrate failed`. */
    const rows: any[] = await pAll<any>(
      db
        .select()
        .from(partnerDealPromotionsTable)
        .where(isNull((partnerDealPromotionsTable as any).deletedAt))
    );
    dealPromotions.length = 0;
    dealPromotionsHistory.length = 0;
    for (const r of rows) {
      const p: PartnerDealPromotion = {
        id: r.id,
        partnerId: r.partner_id ?? r.partnerId,
        pipelineDealId: r.pipeline_deal_id ?? r.pipelineDealId,
        promotionType: (r.promotion_type ?? r.promotionType) as PartnerDealPromotionType,
        companyId: r.company_id ?? r.companyId ?? null,
        targetEmail: r.target_email ?? r.targetEmail ?? null,
        status: (r.status) as PartnerDealPromotionStatus,
        promotedBy: r.promoted_by ?? r.promotedBy,
        promotedAt: r.promoted_at ?? r.promotedAt,
        approvedAt: r.approved_at ?? r.approvedAt ?? null,
        approvedBy: r.approved_by ?? r.approvedBy ?? null,
        rejectedAt: r.rejected_at ?? r.rejectedAt ?? null,
        rejectedBy: r.rejected_by ?? r.rejectedBy ?? null,
        rejectedReason: r.rejected_reason ?? r.rejectedReason ?? null,
        withdrawnAt: r.withdrawn_at ?? r.withdrawnAt ?? null,
        withdrawnBy: r.withdrawn_by ?? r.withdrawnBy ?? null,
        notes: r.notes ?? null,
        version: r.version ?? 1,
        prevRevisionHash: (r.prev_hash ?? r.prevHash) ?? GENESIS,
        revisionHash: r.hash,
        updatedAt: r.updated_at ?? r.updatedAt,
        updatedBy: r.updated_by ?? r.updatedBy,
        isSeed: (r.is_seed ?? r.isSeed) === 1 || (r.is_seed ?? r.isSeed) === true,
        // CP Phase B moderation columns. Fallback to 'pending' if absent
        // (pre-0047 rows that the backfill stamps on next boot).
        moderationStatus: (r.moderation_status ?? r.moderationStatus ?? "pending") as PartnerDealModerationStatus,
        moderatedByUserId: r.moderated_by_user_id ?? r.moderatedByUserId ?? null,
        moderatedAt: r.moderated_at ?? r.moderatedAt ?? null,
        moderationNotes: r.moderation_notes ?? r.moderationNotes ?? null,
        // v25.23 NM-N — hydrate the chapter_id column with DEFAULT_CHAPTER_ID
        // fallback for legacy rows that pre-date this fix.
        chapterId: r.chapter_id ?? r.chapterId ?? DEFAULT_CHAPTER_ID,
      };
      dealPromotions.push(p);
      dealPromotionsHistory.push({ ...p });
    }
    if (rows.length > 0) {
      log.info(`[partnerWorkspaceStore] hydrated ${rows.length} partner_deal_promotions row(s)`);
    }
  } catch (err) {
    if (!/no such table/i.test(String(err))) {
      log.warn("[partnerWorkspaceStore] hydrate failed:", err);
    }
  }
}

export const _testPartnerStore = {
  reset(): void {
    teamMembers.length = 0;
    teamInvitations.length = 0;
    attributions.length = 0;
    attributionsHistory.length = 0;
    pipeline.length = 0;
    pipelineHistory.length = 0;
    pipelineActivities.length = 0;
    notes.length = 0;
    notesHistory.length = 0;
    tasks.length = 0;
    files.length = 0;
    workspaceSettings.clear();
    spvs.length = 0;
    spvsHistory.length = 0;
    spvPositions.length = 0;
    funds.length = 0;
    fundsHistory.length = 0;
    fundCommitments.length = 0;
    dealPromotions.length = 0;
    dealPromotionsHistory.length = 0;
    _testSeeded = false;
  },
  computeRevisionHash,
  GENESIS,
  raw: {
    teamMembers, teamInvitations, attributions, attributionsHistory, pipeline, pipelineHistory,
    pipelineActivities, notes, notesHistory, tasks, files, workspaceSettings, spvs, spvsHistory,
    spvPositions, funds, fundsHistory, fundCommitments,
    dealPromotions, dealPromotionsHistory,
  },
};
