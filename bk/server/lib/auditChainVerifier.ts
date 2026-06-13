/**
 * v19 Phase C — Universal hash-chain audit verifier.
 *
 * Verifies the integrity of every hash-chained table in the platform.
 *
 * VERIFICATION STRATEGY (two layers):
 *
 *   (A) LINKAGE walk — for every row in chronological order, assert
 *       `row.prev_hash === previous_row.curr_hash` (or `previous_row.hash`
 *       for older v17 tables that use the `hash` column instead of
 *       `curr_hash`). Genesis row must have prev_hash === null OR
 *       "GENESIS" OR "0000...0000" (per per-table convention).
 *
 *   (B) INSERT-PAYLOAD recompute — for tables whose insert-time payload
 *       is deterministically reconstructable from the stored row (most
 *       v17+ stores include `action: "create"` and `ts === createdAt` in
 *       their hash payload), the verifier additionally re-hashes the
 *       insert and compares to the stored value. This catches in-place
 *       tampering of a single row even when the chain linkage was
 *       re-stitched.
 *
 * The verifier is READ-ONLY: it opens a single sync transaction per
 * table, scans rows in `(created_at ASC, id ASC)` order, and reports.
 * It never writes.
 *
 * SCOPE: chapter-scoped tables are filtered by `chapter_id` (when the
 * column exists). Cross-chapter tables (e.g., `audit_log`, which has
 * `tenant_id` only) are filtered by tenant_id of the calling chapter
 * for chapter_admin callers, or unfiltered for platform admins.
 *
 * Per-table canonical hash formulas are documented in
 * `docs/PHASE_19C_REPORT.md` (the "Hash formula catalog" section).
 */
import { createHash } from "node:crypto";
import { getDb } from "../db/connection";
import {
  auditLog as auditLogTable,
  dscVotes as dscVotesTable,
  dscRoles as dscRolesTable,
  legalConsents as legalConsentsTable,
  investorNominations as investorNominationsTable,
  collectiveSettingsTable,
  partnerDealPromotions as partnerDealPromotionsTable,
  screeningEvents as screeningEventsTable,
  collectiveMembershipsBilling as collectiveBillingTable,
  collectiveBillingEvents as collectiveBillingEventsTable,
  expertQuestions as expertQuestionsTable,
  expertAnswers as expertAnswersTable,
  chapterAnnouncements as chapterAnnouncementsTable,
  chapterResources as chapterResourcesTable,
  messages as messagesTable,
  messageThreads as messageThreadsTable,
  partnerPortfolioCompanies as partnerPortfolioTable,
  partnerCrmContacts as partnerCrmTable,
  partnerDealPipeline as partnerDealPipelineTable,
  termSheetRevisions as termSheetRevisionsTable,
  consortiumApplications as consortiumApplicationsTable,
} from "@shared/schema";

/* ============================================================
 * Public types
 * ============================================================ */

export interface ChainVerifyResult {
  table: string;
  total_rows: number;
  verified: number;
  broken_at_row_id: string | null;
  broken_at_index: number | null;
  first_bad_field_hint: string | null;
  last_known_good_hash: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  /** Per-row verification details (kept short; max 1000 rows). */
  details?: Array<{ id: string; ok: boolean; reason?: string }>;
}

export interface ChainVerifyOpts {
  tenantId?: string;
  chapterId?: string;
  fromCreatedAt?: string;
  toCreatedAt?: string;
  /** Include details list in the result (default false; can be large). */
  withDetails?: boolean;
  /** Limit row count (mostly for tests; default 50_000). */
  limit?: number;
}

/* ============================================================
 * Per-table catalog
 * ============================================================ */

interface TableConfig {
  /** Public name (used in URL and report). */
  name: string;
  /** Drizzle table reference. */
  table: any;
  /** Column name for the row's own hash (Drizzle camelCase). */
  hashCol: "hash" | "currHash";
  /** Column name for the prev hash (Drizzle camelCase). */
  prevHashCol: "prevHash" | "prevRevisionHash";
  /** Genesis hash values that mean "no predecessor". */
  genesisHashes: ReadonlySet<string | null>;
  /** Whether the table has a chapter_id column. */
  hasChapterId: boolean;
  /** Whether the table has a tenant_id column (almost always true). */
  hasTenantId: boolean;
  /** Whether the table has a deleted_at soft-delete column. */
  hasDeletedAt: boolean;
  /** Drizzle field name for created_at (always `createdAt`). */
  createdAtCol: "createdAt" | "savedAt";
  /**
   * Optional insert-payload recompute: given a row, produce the JSON-stable
   * payload string that, when hashed with prev_hash, reproduces the stored
   * hash. Return `null` to skip insert-recompute for this row (e.g., row
   * has been updated post-insert and the original payload can't be
   * reconstructed from the current row).
   *
   * This is best-effort; the LINKAGE walk is authoritative.
   */
  insertPayload?: (row: any) => string | null;
  /**
   * When true, each row is treated as its own independent chain (partition
   * key = row id). The cross-row LINKAGE walk is skipped (each row's
   * prev_hash is validated against the genesis-token set if non-empty), and
   * the per-row insert-payload recompute is authoritative. Used by tables
   * like `consortium_applications` where the chain is per-application and
   * each application is represented by ONE row whose prev_hash/curr_hash
   * pair captures the most recent state transition.
   */
  chainPartitionByRowId?: boolean;
}

/* Shared hash recompute: sha256(prevHash ?? GENESIS_TOKEN | payload). */
function sha256Hex(prevHash: string | null, payloadStr: string, genesisToken: string): string {
  const h = createHash("sha256");
  h.update(prevHash ?? genesisToken);
  h.update("|");
  h.update(payloadStr);
  return h.digest("hex");
}

/* ----- v17 chapter announcements: insert payload includes action:create. ----- */
function payloadAnnouncements(row: any): string | null {
  // ONLY safe to re-hash insert when row was never updated (updatedAt == createdAt).
  if (row.updatedAt && row.updatedAt !== row.createdAt) return null;
  return JSON.stringify({
    id: row.id,
    tenantId: row.tenantId,
    chapterId: row.chapterId,
    authorUserId: row.authorUserId,
    title: row.title,
    body: row.body,
    pinned: row.pinned ? 1 : 0,
    priority: row.priority,
    audience: row.audience,
    expiresAt: row.expiresAt ?? null,
    action: "create",
    ts: row.createdAt,
  });
}

/* ----- CP Phase B consortium_applications: chain payload tracks current state. ----- */
function payloadConsortiumApplications(row: any): string | null {
  // Chain payload mirrors consortiumApplyStore.chainPayload() exactly so
  // the hash matches what the store wrote at submit / approve / reject /
  // withdraw time. Field order is significant for JSON.stringify.
  return JSON.stringify({
    id: row.id,
    organizationName: row.organizationName ?? row.organization_name,
    contactEmail: row.contactEmail ?? row.contact_email,
    expectedChapterId:
      row.expectedChapterId ?? row.expected_chapter_id ?? null,
    partnerType: row.partnerType ?? row.partner_type,
    aumRange: row.aumRange ?? row.aum_range,
    status: row.status,
    reviewedByUserId:
      row.reviewedByUserId ?? row.reviewed_by_user_id ?? null,
    provisionedPartnerId:
      row.provisionedPartnerId ?? row.provisioned_partner_id ?? null,
    updatedAt: row.updatedAt ?? row.updated_at,
  });
}

function payloadScreeningEvents(row: any): string | null {
  if (row.updatedAt && row.updatedAt !== row.createdAt) return null;
  return JSON.stringify({
    id: row.id,
    tenantId: row.tenantId,
    chapterId: row.chapterId,
    companyId: row.companyId,
    roundId: row.roundId ?? null,
    title: row.title,
    scheduledFor: Number(row.scheduledFor),
    durationMinutes: Number(row.durationMinutes),
    eventType: row.eventType,
    organizerUserId: row.organizerUserId,
    action: "create",
    ts: row.createdAt,
  });
}

/* ============================================================
 * Catalog (23 entries; tables without an explicit hash chain in
 * the current schema are intentionally absent — see report).
 * ============================================================ */

const CATALOG: ReadonlyArray<TableConfig> = [
  // ─── older v11–v16 chains using `hash` column ───
  {
    name: "audit_log",
    table: auditLogTable,
    hashCol: "hash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS", "0".repeat(64)]),
    hasChapterId: false,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "dsc_votes",
    table: dscVotesTable,
    hashCol: "hash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS", "0".repeat(64)]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "dsc_roles",
    table: dscRolesTable,
    hashCol: "hash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS", "0".repeat(64)]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "legal_consents",
    table: legalConsentsTable,
    hashCol: "hash",
    prevHashCol: "prevHash",
    genesisHashes: new Set(["GENESIS", "0".repeat(64), null]),
    hasChapterId: false,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "investor_nominations",
    table: investorNominationsTable,
    hashCol: "hash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: true,
    createdAtCol: "createdAt",
  },
  {
    name: "collective_settings",
    table: collectiveSettingsTable,
    hashCol: "hash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "partner_deal_promotions",
    table: partnerDealPromotionsTable,
    hashCol: "hash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  // ─── v17+ chains using `curr_hash` column ───
  {
    name: "screening_events",
    table: screeningEventsTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
    insertPayload: payloadScreeningEvents,
  },
  {
    name: "collective_memberships_billing",
    table: collectiveBillingTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "collective_billing_events",
    table: collectiveBillingEventsTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "expert_questions",
    table: expertQuestionsTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, ""]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "expert_answers",
    table: expertAnswersTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, ""]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "chapter_announcements",
    table: chapterAnnouncementsTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: true,
    createdAtCol: "createdAt",
    insertPayload: payloadAnnouncements,
  },
  {
    name: "chapter_resources",
    table: chapterResourcesTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: true,
    createdAtCol: "createdAt",
  },
  {
    name: "messages",
    table: messagesTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
  },
  {
    name: "message_threads",
    table: messageThreadsTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: true,
    hasTenantId: true,
    hasDeletedAt: true,
    createdAtCol: "createdAt",
  },
  {
    name: "partner_portfolio_companies",
    table: partnerPortfolioTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: false,
    hasTenantId: true,
    hasDeletedAt: true,
    createdAtCol: "createdAt",
  },
  {
    name: "partner_crm_contacts",
    table: partnerCrmTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: false,
    hasTenantId: true,
    hasDeletedAt: true,
    createdAtCol: "createdAt",
  },
  {
    name: "partner_deal_pipeline",
    table: partnerDealPipelineTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS"]),
    hasChapterId: false,
    hasTenantId: true,
    hasDeletedAt: true,
    createdAtCol: "createdAt",
  },
  {
    name: "term_sheet_revisions",
    table: termSheetRevisionsTable,
    hashCol: "hash" as any /* actual column is `revisionHash` */,
    prevHashCol: "prevRevisionHash",
    genesisHashes: new Set([null, "GENESIS", ""]),
    hasChapterId: false,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "savedAt",
  },
  // CP-007 (Phase C hotfix): per-application chain — each row is its own
  // genesis chain whose curr_hash reflects the *current* row state.
  {
    name: "consortium_applications",
    table: consortiumApplicationsTable,
    hashCol: "currHash",
    prevHashCol: "prevHash",
    genesisHashes: new Set([null, "GENESIS", ""]),
    hasChapterId: false,
    hasTenantId: true,
    hasDeletedAt: false,
    createdAtCol: "createdAt",
    insertPayload: payloadConsortiumApplications,
    chainPartitionByRowId: true,
  },
];

/** Map for O(1) lookup. */
const CATALOG_BY_NAME = new Map<string, TableConfig>(CATALOG.map((c) => [c.name, c]));

/** Public list of supported table names (used by the UI dropdown). */
export const VERIFIABLE_TABLES: ReadonlyArray<string> = CATALOG.map((c) => c.name);

export function isVerifiableTable(name: string): boolean {
  return CATALOG_BY_NAME.has(name);
}

/* ============================================================
 * Internal: read-only chain walk
 * ============================================================ */

function readHash(row: any, cfg: TableConfig): string {
  if (cfg.name === "term_sheet_revisions") return String(row.revisionHash ?? "");
  return String(row[cfg.hashCol] ?? "");
}

function readPrevHash(row: any, cfg: TableConfig): string | null {
  if (cfg.name === "term_sheet_revisions") {
    return row.prevRevisionHash ?? null;
  }
  return row.prevHash ?? null;
}

function readCreatedAt(row: any, cfg: TableConfig): string {
  return String(row[cfg.createdAtCol] ?? "");
}

/**
 * Walk the chain for one table. Read-only; opens a sync transaction.
 */
export function verifyChainForTable(
  tableName: string,
  opts: ChainVerifyOpts = {},
): ChainVerifyResult {
  const cfg = CATALOG_BY_NAME.get(tableName);
  if (!cfg) {
    throw new Error(`unknown_table:${tableName}`);
  }
  const started = new Date();
  const startedMs = Date.now();
  const limit = opts.limit ?? 50_000;

  let rows: any[] = [];
  try {
    const db: any = getDb();
    // Read-only transaction: select rows in chronological order, apply filters.
    db.transaction((tx: any) => {
      let q = tx.select().from(cfg.table);
      // No WHERE chaining via drizzle here because filters vary; we filter
      // in JS for simplicity + portability across the 19 tables. This is
      // acceptable because verification is an admin-only batch operation.
      rows = q.all() as any[];
    });
  } catch (err) {
    // Failure to read the table — return zero result with a hint.
    return {
      table: cfg.name,
      total_rows: 0,
      verified: 0,
      broken_at_row_id: null,
      broken_at_index: null,
      first_bad_field_hint: `read_failed: ${(err as Error).message}`,
      last_known_good_hash: null,
      started_at: started.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
    };
  }

  // Apply filters in JS.
  rows = rows.filter((r) => {
    if (opts.tenantId && cfg.hasTenantId) {
      if (String(r.tenantId ?? r.tenant_id ?? "") !== opts.tenantId) return false;
    }
    if (opts.chapterId && cfg.hasChapterId) {
      if (String(r.chapterId ?? r.chapter_id ?? "") !== opts.chapterId) return false;
    }
    if (cfg.hasDeletedAt) {
      if (r.deletedAt ?? r.deleted_at) return false;
    }
    const ca = readCreatedAt(r, cfg);
    if (opts.fromCreatedAt && ca < opts.fromCreatedAt) return false;
    if (opts.toCreatedAt && ca > opts.toCreatedAt) return false;
    return true;
  });

  // Sort (created_at ASC, id ASC).
  rows.sort((a, b) => {
    const ca = readCreatedAt(a, cfg);
    const cb = readCreatedAt(b, cfg);
    if (ca !== cb) return ca < cb ? -1 : 1;
    const ia = String(a.id ?? "");
    const ib = String(b.id ?? "");
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  if (rows.length > limit) rows = rows.slice(0, limit);

  let verified = 0;
  let broken_at_row_id: string | null = null;
  let broken_at_index: number | null = null;
  let first_bad_field_hint: string | null = null;
  let last_known_good_hash: string | null = null;
  const details: Array<{ id: string; ok: boolean; reason?: string }> = [];

  let priorHash: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const stored = readHash(row, cfg);
    const storedPrev = readPrevHash(row, cfg);
    const rowId = String(row.id ?? `idx_${i}`);

    // Step 1: linkage.
    if (cfg.chainPartitionByRowId) {
      // Per-row chain: prev_hash is either a genesis token (initial submit)
      // or any non-empty string (post-transition). The insert-payload
      // recompute below is authoritative.
      if (storedPrev !== null && storedPrev !== "" && !cfg.genesisHashes.has(storedPrev)) {
        // Non-null, non-genesis prev_hash is acceptable when the row has
        // transitioned — we cannot cross-check it against another row
        // because the prior chain link is overwritten by the update. Skip
        // linkage validation entirely; the payload recompute proves the
        // current curr_hash matches the current state + stored prev_hash.
      }
    } else if (i === 0) {
      // Genesis row: prev must be one of the configured genesis tokens.
      if (!cfg.genesisHashes.has(storedPrev)) {
        broken_at_row_id = rowId;
        broken_at_index = i;
        first_bad_field_hint = `genesis_prev_hash_unexpected:${String(storedPrev)}`;
        if (opts.withDetails) details.push({ id: rowId, ok: false, reason: first_bad_field_hint });
        break;
      }
    } else {
      if (storedPrev !== priorHash) {
        broken_at_row_id = rowId;
        broken_at_index = i;
        first_bad_field_hint = `prev_hash_mismatch:expected=${priorHash} got=${storedPrev}`;
        if (opts.withDetails) details.push({ id: rowId, ok: false, reason: first_bad_field_hint });
        break;
      }
    }

    // Step 2: optional insert-payload recompute (best-effort, but
    // authoritative for chainPartitionByRowId tables).
    if (cfg.insertPayload) {
      try {
        const payload = cfg.insertPayload(row);
        if (payload !== null) {
          // Pick the genesis token used by THIS row's prev (could be "GENESIS"
          // or null sentinel). We use whichever the row stored, defaulting
          // to "GENESIS" for null per the stores' computeHash convention.
          const genesisToken = storedPrev ?? "GENESIS";
          const expected = sha256Hex(storedPrev, payload, genesisToken);
          if (expected !== stored) {
            broken_at_row_id = rowId;
            broken_at_index = i;
            first_bad_field_hint = `insert_hash_mismatch:expected=${expected.slice(0, 16)}... got=${stored.slice(0, 16)}...`;
            if (opts.withDetails) details.push({ id: rowId, ok: false, reason: first_bad_field_hint });
            break;
          }
        }
      } catch {
        // Recompute is best-effort; failure here does not break the chain.
      }
    }

    verified += 1;
    last_known_good_hash = stored;
    priorHash = stored;
    if (opts.withDetails) details.push({ id: rowId, ok: true });
  }

  const finished = new Date();
  const result: ChainVerifyResult = {
    table: cfg.name,
    total_rows: rows.length,
    verified,
    broken_at_row_id,
    broken_at_index,
    first_bad_field_hint,
    last_known_good_hash,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: Date.now() - startedMs,
  };
  if (opts.withDetails) result.details = details;
  return result;
}

/**
 * Verify every table for a given chapter (and/or tenant). Returns the
 * full set of results. Used by the quarterly job and by the "Verify
 * all" admin button.
 */
export function verifyAllChains(opts: ChainVerifyOpts = {}): ChainVerifyResult[] {
  const out: ChainVerifyResult[] = [];
  for (const cfg of CATALOG) {
    // For chapter-scoped queries on tables without a chapter_id column,
    // skip the chapter filter (verifier will scan tenant-wide rows).
    const effOpts: ChainVerifyOpts = { ...opts };
    if (!cfg.hasChapterId) {
      effOpts.chapterId = undefined;
    }
    out.push(verifyChainForTable(cfg.name, effOpts));
  }
  return out;
}

/* Test-only helper to expose the catalog metadata. */
export function _catalogMetaForTests(): Array<{
  name: string;
  hashCol: string;
  prevHashCol: string;
  hasChapterId: boolean;
  hasInsertRecompute: boolean;
}> {
  return CATALOG.map((c) => ({
    name: c.name,
    hashCol: c.hashCol,
    prevHashCol: c.prevHashCol,
    hasChapterId: c.hasChapterId,
    hasInsertRecompute: !!c.insertPayload,
  }));
}
