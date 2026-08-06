/**
 * ============================================================================
 * Wave C-2.e / migration 0132 — KV-to-SQL pipeline backfill
 * ============================================================================
 *
 * Target file (on apply): `server/db/backfills/runWaveC2PipelineKvBackfill.ts`
 * Invoked from: the guarded boot step described in spec §2.2 (0132 row) —
 *   "KV-to-SQL backfill (guarded TypeScript boot step, `runWaveC2PipelineKvBackfill`,
 *    mirrors the 0114 precedent for lazy-KV backfills — not raw SQL)".
 *
 * WHAT THIS DOES
 * --------------
 * Moves partner deal-pipeline rows from the deprecated in-memory/KV shim
 * (`partnerPipelineStore`, `server/partnerWorkspaceStore.ts:1898`, durably
 * mirrored into `kv_partnerPipeline` by `storePersistenceShim.persistEntry`)
 * into the live, hash-chained V19 SQL table `partner_deal_pipeline`.
 *
 * BOOT SAFETY (V33-1-B1)
 * ----------------------
 * This function NEVER throws to boot. The entire body is wrapped in a single
 * try/catch that log.warn()s and returns a structured result. Every schema
 * prerequisite is guarded via `sqlite_master` + `PRAGMA table_info` before any
 * write, exactly as the three `applyWaveC2*Schema` self-heal functions do, so a
 * fresh, zero-migrations-run database is a clean no-op rather than a crash.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HASH-CHAIN SEMANTICS — READ THIS BEFORE CHANGING ANYTHING
 * ────────────────────────────────────────────────────────────────────────────
 * There are TWO DIFFERENT, INCOMPATIBLE hash chains in play. They are never
 * mixed. Getting this wrong silently corrupts compliance-critical audit data.
 *
 *  (A) The KV chain — PER-ROW REVISION chain.
 *      Columns/fields: `PartnerPipelineDeal.prevRevisionHash` / `.revisionHash`.
 *      Genesis: `GENESIS = "0".repeat(64)` (`partnerWorkspaceStore.ts:97`).
 *      Algorithm: `computeRevisionHash(record)` (`partnerWorkspaceStore.ts:103-109`)
 *        = sha256(`${record.prevRevisionHash ?? GENESIS}|${stableJson(record minus revisionHash)}`).
 *      Linkage: on `create` (`:1941`) `prevRevisionHash = GENESIS`; on `update`
 *        (`:1974`) `prevRevisionHash = <same row's previous revisionHash>`.
 *      => Each KV row is its OWN independent chain across its own revisions.
 *
 *  (B) The V19 chain — the `partner_deal_pipeline` table's own chain.
 *      Columns: `prev_hash` / `curr_hash` (`connection.ts:3969-3983`;
 *        `shared/schema.ts:2457-2478` -> `prevHash`/`currHash`).
 *      Algorithm: `computeHash(prevHash, payload)`
 *        (`partnerWorkspaceV19Store.ts:215-221`)
 *        = sha256(`${prevHash ?? "GENESIS"}|${JSON.stringify(payload)}`).
 *      Verified by `auditChainVerifier.ts:420-430`, which registers
 *        `partner_deal_pipeline` WITHOUT `chainPartitionByRowId` — i.e. as a
 *        SEQUENTIAL CROSS-ROW chain: rows sorted (created_at ASC, id ASC), and
 *        `row[i].prev_hash` MUST equal `row[i-1].curr_hash`, with the genesis
 *        row's `prev_hash` in `{null, "GENESIS"}`.
 *
 * There is NO `revision_hash` / `prev_revision_hash` column on
 * `partner_deal_pipeline` (grep-verified against both the live DDL and the
 * Drizzle model). Copying the KV per-row revision hashes into (B)'s
 * `prev_hash`/`curr_hash` would therefore FAIL `auditChainVerifier`'s
 * sequential linkage check on the second row of any tenant, and would also be
 * un-recomputable (the KV payload shape is the KV DTO, not the V19 insert
 * payload). See ASSUMPTIONS_D3.md D3-Q1.
 *
 * WHAT "HASH-CHAIN PRESERVATION" THEREFORE MEANS HERE:
 *   - (A) is preserved VERBATIM, byte-for-byte, in the dedicated provenance
 *     columns `kv_prev_revision_hash` / `kv_revision_hash` (migration 0132,
 *     spec §10.1's mapping table: "Preserved verbatim, provenance only —
 *     distinct from V19's own prev_hash/curr_hash chain, never mixed into it").
 *     The KV per-row chain stays independently verifiable forever.
 *   - (B) is COMPUTED FRESH, sequentially, per tenant, from the tenant's
 *     existing chain tip (spec §10.1 item 7: "chain-computed from the previous
 *     chain tip per tenant (never NULL/placeholder hash)").
 * Both facts are asserted by the probe. Neither is negotiable.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * SACRED-FILE BOUNDARY: this module imports nothing from
 * partnerConsortiumRoutes / notificationsStore / sseHub / captableCommitStore /
 * messagingStore / paymentGatewayAdapter / roundInvitationsStore, and contains
 * zero Airwallex/payment surface. Grep-asserted by the probe.
 */

import { createHash } from "crypto";
import { randomBytes } from "crypto";
import { hostname } from "os";

import { rawDb } from "../connection";
import { log } from "../../lib/logger";
import { hydrateEntries } from "../../lib/storePersistenceShim";
import type { PartnerPipelineDeal, PipelineStage } from "../../partnerWorkspaceStore";
import type { DealStage } from "../../partnerWorkspaceV19Store";

/**
 * R1 FIX B4 (D3-Q2 blocker, resolved per Ozan sign-off, see
 * ASSUMPTIONS_D3.md §5 "R1 FIX B4"): the real `DealStage` union
 * (`partnerWorkspaceV19Store.ts:101`) is only
 * `"sourced" | "screening" | "diligence" | "term_sheet" | "closed" | "passed"`
 * and therefore has NO room for `funded`/`committed` as distinct values—both
 * would have to collapse onto `closed`, which is exactly the lossy behavior
 * this fix removes. This backfill module is documented as NOT touching any
 * real file (including `partnerWorkspaceV19Store.ts`), so rather than editing
 * the real union, this module writes a locally-declared, DELIBERATELY WIDER
 * superset type into the `stage` TEXT column (which has no CHECK constraint—
 * grep-verified, spec §10.1). `V19WrittenStage` is `DealStage` plus the two
 * KV-identity passthrough values. Any code path consuming `stage` that still
 * types against the narrow `DealStage` union is unaffected for the 4
 * pre-existing values and gains two new legal literals it did not previously
 * need to special-case; this is additive, not breaking. Real-file follow-up
 * (widening `DealStage` itself) is a separate, out-of-scope change and is
 * flagged for Ozan in ASSUMPTIONS_D3.md.
 */
export type V19WrittenStage = DealStage | "funded" | "committed";

/* ==========================================================================
 * Constants
 * ========================================================================== */

/** Marker-row primary key, spec §2.2/0132 verbatim. */
export const BACKFILL_LOCK_ID = "backfill_0132";

/** `stage_machine_type` literal for this surface (0132 CHECK constraint). */
export const PIPELINE_STAGE_MACHINE_TYPE = "partner_pipeline";

/** `c2_backfill_skip_log.source_table` value for every row this module logs. */
export const SKIP_LOG_SOURCE_TABLE = "kv_partnerPipeline";

/**
 * Currency-minor -> major divisor. `estCheckSizeMinor` is in currency-minor
 * units (cents); `deal_size_usd REAL` is major units.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * CANONICAL KV -> V19 FIELD MAP (spec §10.1, grep-verified field-by-field
 * against the REAL `PartnerPipelineDeal` interface at
 * `server/partnerWorkspaceStore.ts:214-233`).
 *
 * This object is the single source of truth for the mapping and is parsed
 * directly out of this source file by `probe_kv_backfill_d3.py` — the probe's
 * 13 field-mapping tests assert against THIS literal, not against a copy.
 * Do not reformat it into a computed expression.
 *
 * `kind`:
 *   "existing"   -> lands in a column that already existed on partner_deal_pipeline
 *   "additive"   -> lands in a column added by migration 0132
 *   "identity"   -> not a value copy (documented for completeness, spec §10.1)
 */
export const KV_TO_V19_FIELD_MAP = {
  // --- the 13 canonically-mapped fields the D3 brief enumerates -------------
  dealName:         { column: "deal_name",             kind: "additive", transform: "verbatim" },
  currency:         { column: "currency",              kind: "additive", transform: "verbatim" },
  sector:           { column: "sector",                kind: "additive", transform: "verbatim" },
  geography:        { column: "geography",             kind: "additive", transform: "verbatim" },
  notes:            { column: "kv_notes",              kind: "additive", transform: "verbatim" },
  version:          { column: "kv_version",            kind: "additive", transform: "verbatim" },
  updatedAt:        { column: "kv_updated_at",         kind: "additive", transform: "verbatim" },
  updatedBy:        { column: "kv_updated_by",         kind: "additive", transform: "verbatim" },
  isSeed:           { column: "kv_is_seed",            kind: "additive", transform: "boolean_to_int" },
  prevRevisionHash: { column: "kv_prev_revision_hash", kind: "additive", transform: "verbatim" },
  revisionHash:     { column: "kv_revision_hash",      kind: "additive", transform: "verbatim" },
  expectedClose:    { column: "target_close_at",       kind: "existing", transform: "verbatim" },
  estCheckSizeMinor:{ column: "deal_size_usd",         kind: "existing", transform: "minor_div_100" },
  // --- remaining real interface fields (no field is silently dropped) -------
  id:               { column: "legacy_id",             kind: "existing", transform: "verbatim" },
  partnerId:        { column: "partner_id",            kind: "existing", transform: "verbatim" },
  companyId:        { column: "company_id",            kind: "existing", transform: "not_null_required" },
  ownerUserId:      { column: "assigned_user_ids",     kind: "existing", transform: "single_element_json_array" },
  stage:            { column: "stage",                 kind: "existing", transform: "stage_vocabulary_map" },
} as const;

/**
 * Stage-vocabulary map, R1 FIX B4 (supersedes the pre-fix spec §2.2/0132 +
 * §10.1 mapping, which read: "invited->sourced, viewed->screening,
 * soft_circle->diligence, signed->term_sheet, funded->closed,
 * committed->closed"):
 *   invited->sourced, viewed->screening, soft_circle->diligence,
 *   signed->term_sheet, funded->funded, committed->committed
 *
 * LHS keys are the REAL KV vocabulary (`PipelineStage`,
 * `partnerWorkspaceStore.ts:177-183`). RHS values are `V19WrittenStage`
 * (REAL V19 vocabulary `DealStage`, `partnerWorkspaceV19Store.ts:101`, PLUS
 * the two identity-passthrough literals `funded`/`committed` added by this
 * fix — see the `V19WrittenStage` doc comment above for why the union must
 * be widened here rather than in the real file).
 *
 * PRE-FIX BEHAVIOR (lossy, now removed): `funded` and `committed` BOTH
 * collapsed to `closed`, making the mapping non-injective — after the
 * backfill, `stage` alone could not tell you whether a deal was funded or
 * merely committed. This was D3-Q2 in ASSUMPTIONS_D3.md, escalated as a
 * BLOCKER by all three R1 reviewers (Gemini: "breaking Ozan's #6 requirement
 * by dropping historical fidelity"; Opus D3-Q2; GPT-5.6 concurred).
 *
 * POST-FIX BEHAVIOR: `funded` and `committed` are now IDENTITY-mapped (KV
 * key === V19 written value), so no two distinct KV stages ever land on the
 * same `stage` value. `passed` remains absent from this map because the REAL
 * KV `PipelineStage` union (`partnerWorkspaceStore.ts:177-183`,
 * `shared/crmStages.ts:125-127` `PARTNER_PIPELINE_STAGES`) has only 6
 * members — `invited/viewed/soft_circle/signed/funded/committed` — and does
 * NOT include `passed` at all. There is therefore no KV source value that
 * could ever need a `passed` mapping entry; `passed` being "unreachable" as
 * a BACKFILL OUTPUT is a fact about the source data's vocabulary, not a bug
 * in this map. (0128's `mfc_stages` seed for `partner_pipeline` was
 * separately extended to include a `passed` row — see
 * `0128_wave_c2_mfc_stages.sql` R1 FIX B4 note — purely so a `passed` V19
 * value would have a resolvable `current_stage_id` target if one is ever
 * written by a future, non-backfill code path.)
 *
 * The KV stage is still additionally recorded verbatim in `mapping_note` for
 * defense in depth, but is no longer the ONLY way to recover it.
 * See ASSUMPTIONS_D3.md D3-Q2 and the "R1 FIX B4" note appended below it.
 */
export const KV_STAGE_TO_V19_STAGE: Record<PipelineStage, V19WrittenStage> = {
  invited: "sourced",
  viewed: "screening",
  soft_circle: "diligence",
  signed: "term_sheet",
  funded: "funded",
  committed: "committed",
};

/** Reasons written into `c2_backfill_skip_log.reason` (spec §10.1 items 4/6). */
export const SKIP_REASON_NULL_COMPANY = "pipeline_create_null_company";
export const SKIP_REASON_LEGACY_ID_CONFLICT = "pipeline_legacy_id_conflict_v19_wins";

/** Additive columns 0132 must have installed before this backfill may write. */
const REQUIRED_PIPELINE_COLUMNS = [
  "current_stage_id",
  "current_stage_machine_type",
  "probability_pct_override",
  "deal_size_usd",
  "mapping_note",
  "deal_name",
  "currency",
  "sector",
  "geography",
  "kv_notes",
  "kv_version",
  "kv_updated_at",
  "kv_updated_by",
  "kv_is_seed",
  "kv_prev_revision_hash",
  "kv_revision_hash",
] as const;

const REQUIRED_TABLES = [
  "partner_deal_pipeline",
  "_c2_pipeline_backfill_lock",
  "c2_backfill_skip_log",
  "mfc_stages",
  "mfc_stage_transitions",
] as const;

/* ==========================================================================
 * Types
 * ========================================================================== */

export type BackfillSkipCode =
  | null
  | "schema_not_ready"
  | "lock_held"
  | "already_completed"
  | "error";

export type ChainStatus = "clean" | "drifted" | "preexisting_drift";

export interface TenantChainVerifyResult {
  tenantId: string;
  partnerId: string;
  status: ChainStatus;
  totalRows: number;
  verified: number;
  backfilledRows: number;
  brokenAtRowId: string | null;
  hint: string | null;
}

export interface PipelineKvBackfillResult {
  ok: boolean;
  skipped: BackfillSkipCode;
  kvRowsRead: number;
  tenantsSeen: number;
  tenantsCommitted: number;
  inserted: number;
  skippedNullCompany: number;
  skippedLegacyIdConflict: number;
  transitionsInserted: number;
  stagesUnresolved: number;
  chainVerify: TenantChainVerifyResult[];
  errors: string[];
}

/* ==========================================================================
 * Local helpers — deliberate, exact mirrors of the live implementations.
 * ========================================================================== */

/**
 * EXACT mirror of `partnerWorkspaceV19Store.ts:215-221`. Re-declared locally
 * rather than imported because `partnerWorkspaceV19Store.ts` does not export
 * it (grep-verified: `function computeHash(` is module-private) and that file
 * is effective-sacred for its chain-write functions (spec §1). Any divergence
 * here breaks `auditChainVerifier`'s recompute; the probe pins byte-equality
 * against the live formula.
 */
function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

/** Mirror of `partnerWorkspaceV19Store.ts:211-213` (`pdp` prefix per :1752). */
function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/**
 * The V19 insert-payload shape, byte-identical in key set AND key order to
 * `partnerWorkspaceV19Store.ts:1757-1763` (`POST /api/partner/deals`), so a
 * backfilled row recomputes under exactly the same rule as a natively-created
 * one. Key ORDER matters: `JSON.stringify` is order-sensitive.
 */
function v19InsertPayload(args: {
  id: string;
  partnerId: string;
  companyId: string;
  stage: V19WrittenStage;
  createdAt: string;
}): Record<string, unknown> {
  return {
    id: args.id,
    partnerId: args.partnerId,
    companyId: args.companyId,
    stage: args.stage,
    createdAt: args.createdAt,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function tenantIdFor(partnerId: string): string {
  /* Spec §10.1 item 5, verified live convention
   * (`partnerWorkspaceV19Store.ts:1754`): `tenant_partner_${partnerId}`. */
  return `tenant_partner_${partnerId}`;
}

/**
 * Stage-mapping annotation written to `mapping_note`.
 * Prefix `kv_stage:<kvStage>` is byte-compatible with the contract literal in
 * `0132_wave_c2_soft_circle_provenance.sql` ("mapping_note='kv_stage:invited'");
 * the suffix carries the full mapping intent. Post-R1-FIX-B4 the KV->V19
 * mapping is injective (no collapse), so this note is defense-in-depth
 * provenance rather than the ONLY way to recover the original KV stage.
 */
function buildMappingNote(
  kvStage: string,
  v19Stage: V19WrittenStage,
  mfcStageId: string | null,
): string {
  const base = `kv_stage:${kvStage}->v19_stage:${v19Stage}`;
  return mfcStageId ? `${base};mfc_stage_id=${mfcStageId}` : `${base};mfc_stage_unresolved`;
}

function tableExists(db: any, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return !!row;
}

function columnSet(db: any, table: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(cols.map((c) => c.name));
}

/* ==========================================================================
 * Main entry point
 * ========================================================================== */

/**
 * @param dbArg  Optional raw better-sqlite3 handle (tests inject; boot omits).
 * @param opts.verifyOnly  Skip all writes; run the chain-verify pass only.
 *                         This is what a completed-lock second run does.
 */
export function runWaveC2PipelineKvBackfill(
  dbArg?: any,
  opts: { verifyOnly?: boolean } = {},
): PipelineKvBackfillResult {
  const result: PipelineKvBackfillResult = {
    ok: false,
    skipped: null,
    kvRowsRead: 0,
    tenantsSeen: 0,
    tenantsCommitted: 0,
    inserted: 0,
    skippedNullCompany: 0,
    skippedLegacyIdConflict: 0,
    transitionsInserted: 0,
    stagesUnresolved: 0,
    chainVerify: [],
    errors: [],
  };

  /* ── Outermost guard: NEVER throw to boot (V33-1-B1). ──────────────────── */
  let lockAcquired = false;
  let db: any = null;
  try {
    db = dbArg ?? rawDb();

    /* ── Step 0: schema prerequisites ─────────────────────────────────────
     * On a fresh, zero-migrations-run DB this is the normal path: silent
     * no-op, no log noise beyond a single debug-grade warn, no writes. */
    for (const t of REQUIRED_TABLES) {
      if (!tableExists(db, t)) {
        result.skipped = "schema_not_ready";
        log.warn({
          route: "runWaveC2PipelineKvBackfill",
          message: `prerequisite table absent (${t}); backfill skipped (no-op, not an error)`,
        });
        return result;
      }
    }
    const have = columnSet(db, "partner_deal_pipeline");
    const missingCols = REQUIRED_PIPELINE_COLUMNS.filter((c) => !have.has(c));
    if (missingCols.length > 0) {
      result.skipped = "schema_not_ready";
      log.warn({
        route: "runWaveC2PipelineKvBackfill",
        message: `migration 0132 columns absent (${missingCols.join(",")}); backfill skipped (no-op)`,
      });
      return result;
    }

    /* ── Step 1: backfill lock (spec §2.2/0132, §10.1 item 11) ─────────────
     * Marker-row insert with ON CONFLICT DO NOTHING. `changes === 0` means the
     * row already exists, i.e. either (a) another boot process owns an
     * in-flight backfill, or (b) a previous run already completed.
     * NOT a true advisory lock — honestly labeled as such per spec. */
    const startedAt = nowIso();
    if (!opts.verifyOnly) {
      const ins = db
        .prepare(
          `INSERT INTO _c2_pipeline_backfill_lock (id, started_at, host, completed_at)
             VALUES (?, ?, ?, NULL)
             ON CONFLICT (id) DO NOTHING`,
        )
        .run(BACKFILL_LOCK_ID, startedAt, hostname());

      if (ins.changes === 0) {
        const existing = db
          .prepare(
            `SELECT started_at, host, completed_at FROM _c2_pipeline_backfill_lock WHERE id = ?`,
          )
          .get(BACKFILL_LOCK_ID) as
          | { started_at: string; host: string; completed_at: string | null }
          | undefined;

        if (existing?.completed_at) {
          /* Idempotency: a completed run means there is nothing to insert.
           * The second run "does nothing except verify chain". */
          result.skipped = "already_completed";
          log.warn({
            route: "runWaveC2PipelineKvBackfill",
            message: `backfill already completed at ${existing.completed_at} by ${existing.host}; running verify-only pass`,
          });
          result.chainVerify = verifyAllTenantChains(db);
          result.ok = result.chainVerify.every((v) => v.status !== "drifted");
          return result;
        }

        /* In-flight elsewhere -> skip cleanly, do not retry, do not error. */
        result.skipped = "lock_held";
        log.warn({
          route: "runWaveC2PipelineKvBackfill",
          message: `_c2_pipeline_backfill_lock held by ${existing?.host ?? "unknown"} since ${existing?.started_at ?? "unknown"}; skipping backfill on this instance`,
        });
        return result;
      }
      lockAcquired = true;
    }

    if (opts.verifyOnly) {
      result.chainVerify = verifyAllTenantChains(db);
      result.ok = result.chainVerify.every((v) => v.status !== "drifted");
      return result;
    }

    /* ── Step 2: read every KV row ─────────────────────────────────────────
     * `hydrateEntries('partnerPipeline')` is the canonical durable read of the
     * KV shim (`storePersistenceShim.ts:191-219`): it reads
     * `kv_partnerPipeline WHERE deleted_at IS NULL ORDER BY updated_at ASC`
     * and JSON-parses each payload. Reading the shim table rather than
     * `partnerPipelineStore`'s in-memory array means the backfill does not
     * depend on hydration order or on the store module being warm, and it
     * naturally excludes archived rows (`softDeleteEntry`, :1994-2003).
     * A throw here is caught by the outer catch, which releases the lock. */
    const kvEntries = hydrateEntries<PartnerPipelineDeal>("partnerPipeline");
    result.kvRowsRead = kvEntries.length;

    /* ── Step 3: group per tenant (per-tenant chain integrity) ─────────────
     * Deterministic per-tenant ordering by (updatedAt ASC, id ASC) so the
     * chain we build matches the order `auditChainVerifier` will later read it
     * in — the verifier sorts (created_at ASC, id ASC) and we set
     * created_at := kv.updatedAt (see ASSUMPTIONS_D3.md D3-A5). */
    const byPartner = new Map<string, PartnerPipelineDeal[]>();
    for (const [, deal] of kvEntries) {
      if (!deal || typeof deal !== "object" || !deal.partnerId) {
        result.errors.push(`kv row missing partnerId; ignored`);
        continue;
      }
      const list = byPartner.get(deal.partnerId) ?? [];
      list.push(deal);
      byPartner.set(deal.partnerId, list);
    }
    /* APPLY-TIME FIX (A-APPLY-TS2): `Array.from(...)` wrapper, not a bare `for...of` over
     * the Map iterator. This repo's tsconfig sets neither `downlevelIteration` nor a
     * `target` of es2015+, so iterating a Map/Set iterator directly raises TS2802 (and,
     * downstream, TS7006 implicit-any on this sort callback's params). `Array.from` is the
     * idiom already used elsewhere in the tree for the same reason. Iteration order is
     * unchanged — Map insertion order is preserved by Array.from — so the deterministic
     * ordering contract in §2.2 still holds. */
    for (const list of Array.from(byPartner.values())) {
      list.sort((a, b) => {
        const ua = String(a.updatedAt ?? "");
        const ub = String(b.updatedAt ?? "");
        if (ua !== ub) return ua < ub ? -1 : 1;
        return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
      });
    }
    result.tenantsSeen = byPartner.size;

    /* ── Step 4: one atomic transaction over ALL tenants ───────────────────
     * A single outer transaction (rather than per-tenant sub-transactions,
     * which §2.2's contract permits as "implementer's choice") so that ANY
     * mid-run failure — including a KV read failure or a chain-verify drift on
     * the last tenant — leaves ZERO partial writes committed. The lock row is
     * inserted OUTSIDE this transaction (Step 1) and released in the catch,
     * so it is never rolled back independently of the data.
     * See ASSUMPTIONS_D3.md D3-A7 for the row-count bound this assumes. */
    const runAt = nowIso();
    const verifyResults: TenantChainVerifyResult[] = [];

    db.transaction(() => {
      /* APPLY-TIME FIX (A-APPLY-TS2), same rationale as above: Map insertion order is
       * preserved, so the per-tenant sequence inside the single outer transaction is
       * byte-for-byte the same as a direct `for...of byPartner`. */
      for (const [partnerId, deals] of Array.from(byPartner.entries())) {
        const tenantId = tenantIdFor(partnerId);

        /* Chain tip for this tenant: the LAST row in the exact order the
         * verifier walks (created_at ASC, id ASC), among live rows. NULL only
         * when the tenant has no rows at all, in which case this backfill
         * writes the genesis row and prev_hash is legitimately NULL. */
        const tip = db
          .prepare(
            `SELECT curr_hash FROM partner_deal_pipeline
              WHERE tenant_id = ? AND deleted_at IS NULL
              ORDER BY created_at DESC, id DESC LIMIT 1`,
          )
          .get(tenantId) as { curr_hash: string } | undefined;
        let prevHash: string | null = tip?.curr_hash ?? null;

        let insertedForTenant = 0;

        for (const deal of deals) {
          /* ── 4a. companyId IS NULL -> NOT backfilled (spec §10.1 item 4,
           * V32-N8). Row stays in the KV shim; there is no
           * partner_deal_pipeline_unassigned table. ─────────────────────── */
          if (deal.companyId === null || deal.companyId === undefined || deal.companyId === "") {
            insertSkipLog(db, {
              sourceId: deal.id,
              missingFk: "company_id",
              reason: SKIP_REASON_NULL_COMPANY,
              skippedAt: runAt,
            });
            result.skippedNullCompany += 1;
            continue;
          }

          /* ── 4b. legacy_id dedup -> V19 WINS (spec §10.1 item 6). ───────
           * The dedup key is the KV row's own `id`, copied into V19
           * `legacy_id`. NOTE: the real `PartnerPipelineDeal` interface has NO
           * `legacyId` field (grep-verified, :214-233) — see
           * ASSUMPTIONS_D3.md D3-A3. `legacy_id` on the V19 side is documented
           * for exactly this purpose at `shared/schema.ts:2468-2472`
           * ("legacy in-memory pipeline rows migrated on startup carry their
           * original legacy id here"). */
          const dup = db
            .prepare(
              `SELECT id FROM partner_deal_pipeline WHERE legacy_id = ? LIMIT 1`,
            )
            .get(deal.id) as { id: string } | undefined;
          if (dup) {
            insertSkipLog(db, {
              sourceId: deal.id,
              missingFk: "legacy_id",
              reason: `${SKIP_REASON_LEGACY_ID_CONFLICT}:v19_row=${dup.id}`,
              skippedAt: runAt,
            });
            result.skippedLegacyIdConflict += 1;
            continue;
          }

          /* ── 4c. stage-vocabulary mapping ───────────────────────────────
           * Two distinct stage surfaces, deliberately:
           *  - legacy free-text `stage` column  <- V19 vocabulary (mapped,
           *    R1 FIX B4: no longer lossy — see KV_STAGE_TO_V19_STAGE above)
           *  - `current_stage_id`               <- mfc_stages row for the
           *    ORIGINAL KV key, because 0128 seeds the `partner_pipeline`
           *    stage machine with the KV vocabulary verbatim
           *    (invited/viewed/soft_circle/signed/funded/committed —
           *    `0128_wave_c2_mfc_stages.sql:189-236`). There is no
           *    `sourced`/`screening`/... mfc_stages row for this machine type
           *    to point at. This resolution path is UNCHANGED by R1 FIX B4.
           *    See ASSUMPTIONS_D3.md D3-Q2 (TOUGH QUESTION) and the R1 FIX B4
           *    note appended below it. */
          const kvStage = String(deal.stage ?? "invited") as PipelineStage;
          const v19Stage: V19WrittenStage = KV_STAGE_TO_V19_STAGE[kvStage] ?? "sourced";
          const stageRow = db
            .prepare(
              `SELECT id FROM mfc_stages
                WHERE partner_id = ? AND stage_machine_type = ? AND key = ? LIMIT 1`,
            )
            .get(partnerId, PIPELINE_STAGE_MACHINE_TYPE, kvStage) as
            | { id: string }
            | undefined;
          const mfcStageId: string | null = stageRow?.id ?? null;
          if (!mfcStageId) result.stagesUnresolved += 1;
          const mappingNote = buildMappingNote(kvStage, v19Stage, mfcStageId);

          /* ── 4d. field mapping (spec §10.1, canonical) ──────────────────
           * Mirrors KV_TO_V19_FIELD_MAP exactly. */
          const newRowId = newId("pdp");
          /* KV has no createdAt (grep-verified: the interface's only timestamp
           * is `updatedAt`, :230). `updatedAt` is the best available temporal
           * anchor and keeps the row's position in the verifier's
           * created_at-ordered walk stable. ASSUMPTIONS_D3.md D3-A5. */
          const createdAt = String(deal.updatedAt ?? runAt);
          const dealSizeUsd =
            deal.estCheckSizeMinor === null || deal.estCheckSizeMinor === undefined
              ? null
              : deal.estCheckSizeMinor / MINOR_UNITS_PER_MAJOR;

          const payload = v19InsertPayload({
            id: newRowId,
            partnerId,
            companyId: deal.companyId,
            stage: v19Stage,
            createdAt,
          });
          const currHash = computeHash(prevHash, payload);

          db.prepare(
            `INSERT INTO partner_deal_pipeline (
               id, tenant_id, partner_id, company_id, stage, assigned_user_ids,
               target_close_at, notes, prev_hash, curr_hash, legacy_id,
               created_at, updated_at, deleted_at,
               current_stage_id, current_stage_machine_type,
               probability_pct_override, deal_size_usd, mapping_note,
               deal_name, currency, sector, geography,
               kv_notes, kv_version, kv_updated_at, kv_updated_by, kv_is_seed,
               kv_prev_revision_hash, kv_revision_hash
             ) VALUES (
               ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, NULL,
               ?, ?,
               NULL, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?
             )`,
          ).run(
            newRowId,
            tenantId,
            partnerId,
            deal.companyId,
            v19Stage,
            /* ownerUserId -> assigned_user_ids: single-element array wrap
             * (spec §10.1). Column is NOT NULL DEFAULT '[]'. */
            JSON.stringify(deal.ownerUserId ? [deal.ownerUserId] : []),
            /* expectedClose -> target_close_at. The REAL field name is
             * `expectedClose` (:225); `expectedCloseDate` never existed. */
            deal.expectedClose ?? null,
            /* V19 `notes` is NOT NULL DEFAULT '' (connection.ts:3977); the
             * KV value is additionally preserved verbatim (incl. NULL) in
             * kv_notes. ASSUMPTIONS_D3.md D3-A4. */
            deal.notes ?? "",
            prevHash,
            currHash,
            /* KV id -> legacy_id (dedup key). */
            deal.id,
            createdAt,
            createdAt,
            mfcStageId,
            PIPELINE_STAGE_MACHINE_TYPE,
            dealSizeUsd,
            mappingNote,
            deal.dealName ?? null,
            deal.currency ?? null,
            deal.sector ?? null,
            deal.geography ?? null,
            deal.notes ?? null,
            deal.version ?? null,
            deal.updatedAt ?? null,
            deal.updatedBy ?? null,
            deal.isSeed ? 1 : 0,
            /* HASH-CHAIN PRESERVATION: KV per-row revision chain copied
             * VERBATIM into the provenance columns. Never into
             * prev_hash/curr_hash. */
            deal.prevRevisionHash ?? null,
            deal.revisionHash ?? null,
          );

          /* ── 4e. initial mfc_stage_transitions row (spec §10.1 item 8,
           * §10.5) so last_stage_transition_at is never null. Only possible
           * when the stage resolved — `to_stage_id` is NOT NULL and carries a
           * composite FK to mfc_stages(id, stage_machine_type). */
          if (mfcStageId) {
            db.prepare(
              `INSERT INTO mfc_stage_transitions (
                 id, partner_id, stage_machine_type, subject_id,
                 from_stage_id, to_stage_id, actor_user_id, actor_role,
                 reason, note, created_at
               ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
            ).run(
              newId("mfcst"),
              partnerId,
              PIPELINE_STAGE_MACHINE_TYPE,
              newRowId,
              mfcStageId,
              /* Tree-wide convention for non-human actors: the literal
               * "system" (0128 DDL note; no users row with id='system'). */
              "system",
              "system",
              "c2_migration_0132_kv_backfill",
              mappingNote,
              runAt,
            );
            result.transitionsInserted += 1;
          }

          prevHash = currHash;
          insertedForTenant += 1;
          result.inserted += 1;
        }

        /* ── 4f. post-backfill chain verify, INSIDE the transaction ───────
         * Running verify inside the tx is what makes "abort with no partial
         * writes" true: a `drifted` verdict throws, rolling the whole run
         * back. See chain_verify.md for the clean/drifted decision table. */
        const v = verifyTenantChain(db, tenantId, partnerId);
        v.backfilledRows = insertedForTenant;
        verifyResults.push(v);
        if (v.status === "drifted") {
          throw new Error(
            `CHAIN_DRIFT_ABORT: tenant=${tenantId} row=${v.brokenAtRowId} hint=${v.hint}`,
          );
        }
        result.tenantsCommitted += 1;
      }

      /* ── Step 5: mark the lock complete, in the SAME transaction as the
       * data, so "lock says completed" and "data is committed" can never
       * disagree. */
      db.prepare(
        `UPDATE _c2_pipeline_backfill_lock SET completed_at = ? WHERE id = ?`,
      ).run(nowIso(), BACKFILL_LOCK_ID);
    })();

    result.chainVerify = verifyResults;
    result.ok = true;
    log.warn({
      route: "runWaveC2PipelineKvBackfill",
      message:
        `backfill complete: kvRead=${result.kvRowsRead} inserted=${result.inserted} ` +
        `skipNullCompany=${result.skippedNullCompany} skipLegacyIdConflict=${result.skippedLegacyIdConflict} ` +
        `tenants=${result.tenantsCommitted}/${result.tenantsSeen} transitions=${result.transitionsInserted} ` +
        `stagesUnresolved=${result.stagesUnresolved}`,
    });
    return result;
  } catch (err) {
    /* ── Fail-safe (V33-1-B1): never throw to boot. ────────────────────────
     * The outer transaction has already rolled back (better-sqlite3's
     * `db.transaction()` rolls back on any throw), so no partial writes are
     * committed. Release the lock so a subsequent boot can retry rather than
     * being permanently blocked by our own marker row. */
    const msg = (err as Error)?.message ?? String(err);
    result.ok = false;
    result.skipped = "error";
    result.errors.push(msg);
    if (lockAcquired && db) {
      try {
        db.prepare(`DELETE FROM _c2_pipeline_backfill_lock WHERE id = ? AND completed_at IS NULL`)
          .run(BACKFILL_LOCK_ID);
      } catch (relErr) {
        result.errors.push(`lock_release_failed: ${(relErr as Error)?.message ?? String(relErr)}`);
      }
    }
    log.warn({
      route: "runWaveC2PipelineKvBackfill",
      message: `backfill failed and was rolled back (boot continues): ${msg}`,
    });
    return result;
  }
}

/* ==========================================================================
 * Skip log
 * ========================================================================== */

function insertSkipLog(
  db: any,
  args: {
    sourceId: string;
    missingFk: "company_id" | "partner_id" | "legacy_id" | "duplicate_grain" | "none";
    reason: string;
    skippedAt: string;
  },
): void {
  /* Canonical shape, spec §2.1. `missing_fk` CHECK is the V33-M1 widened
   * 5-value set. `id` is generated, not derived from source_id, so a re-run
   * after a rollback can log the same source row again without a PK clash. */
  db.prepare(
    `INSERT INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("c2skip"),
    SKIP_LOG_SOURCE_TABLE,
    args.sourceId,
    args.missingFk,
    args.reason,
    args.skippedAt,
  );
}

/* ==========================================================================
 * Chain verification
 * ==========================================================================
 * Full prose specification, including the exact clean/drifted decision table
 * Avi and Shadie use during staging validation, lives in chain_verify.md.
 * This implementation is the executable form of that document.
 */

/** A row is "backfilled by us" iff it carries a legacy_id AND a kv_stage note. */
function isBackfilledRow(row: any): boolean {
  return (
    row.legacy_id !== null &&
    row.legacy_id !== undefined &&
    typeof row.mapping_note === "string" &&
    row.mapping_note.startsWith("kv_stage:")
  );
}

export function verifyTenantChain(
  db: any,
  tenantId: string,
  partnerId: string,
): TenantChainVerifyResult {
  const out: TenantChainVerifyResult = {
    tenantId,
    partnerId,
    status: "clean",
    totalRows: 0,
    verified: 0,
    backfilledRows: 0,
    brokenAtRowId: null,
    hint: null,
  };

  /* Same filter + same sort as `auditChainVerifier.verifyChainForTable`:
   * deleted rows excluded, ORDER BY created_at ASC, id ASC. */
  const rows = db
    .prepare(
      `SELECT id, prev_hash, curr_hash, partner_id, company_id, stage,
              created_at, legacy_id, mapping_note, kv_revision_hash,
              kv_prev_revision_hash
         FROM partner_deal_pipeline
        WHERE tenant_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC`,
    )
    .all(tenantId) as any[];

  out.totalRows = rows.length;
  let priorHash: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mine = isBackfilledRow(row);

    /* ── Check 1: linkage ─────────────────────────────────────────────────
     * Genesis row: prev_hash must be NULL or "GENESIS"
     * (`auditChainVerifier.ts:424` genesisHashes). Non-genesis: prev_hash
     * must equal the prior row's curr_hash. */
    const linkageOk =
      i === 0
        ? row.prev_hash === null || row.prev_hash === "GENESIS"
        : row.prev_hash === priorHash;

    /* ── Check 2: payload recompute (backfilled rows only) ────────────────
     * We can only recompute rows we wrote, because we know their exact
     * payload shape. Rows written by the live `POST /api/partner/deals` path
     * are linkage-checked but not recomputed here — the verifier's own
     * catalog entry has no `insertPayload` for this table either
     * (`auditChainVerifier.ts:419-429`), so recompute is strictly additional
     * assurance on our own writes, never a new failure mode for legacy rows. */
    let recomputeOk = true;
    if (mine) {
      const expected = computeHash(
        row.prev_hash,
        v19InsertPayload({
          id: row.id,
          partnerId: row.partner_id,
          companyId: row.company_id,
          stage: row.stage as V19WrittenStage,
          createdAt: row.created_at,
        }),
      );
      recomputeOk = expected === row.curr_hash;
      if (!recomputeOk) {
        out.brokenAtRowId = row.id;
        out.hint = `insert_hash_mismatch:expected=${expected.slice(0, 16)} got=${String(row.curr_hash).slice(0, 16)}`;
      }
    }

    if (!linkageOk && out.hint === null) {
      out.brokenAtRowId = row.id;
      out.hint =
        i === 0
          ? `genesis_prev_hash_unexpected:${String(row.prev_hash)}`
          : `prev_hash_mismatch:expected=${priorHash} got=${String(row.prev_hash)}`;
    }

    if (!linkageOk || !recomputeOk) {
      /* Attribution decides severity, NOT the failure itself:
       *  - a break AT a row we wrote  -> `drifted`  -> abort + rollback
       *  - a break at a row we did not write -> `preexisting_drift` -> report
       *    and continue. The live POST path writes prev_hash=NULL on every
       *    create (`partnerWorkspaceV19Store.ts:1764`), so any tenant with
       *    two or more natively-created deals is ALREADY non-sequential
       *    before this backfill ever runs. Aborting on that would make the
       *    backfill permanently unrunnable on real data through no fault of
       *    its own. See chain_verify.md §4 and ASSUMPTIONS_D3.md D3-Q3. */
      out.status = mine ? "drifted" : "preexisting_drift";
      break;
    }

    out.verified += 1;
    priorHash = row.curr_hash;
  }

  return out;
}

/** Verify every tenant that has at least one pipeline row. */
export function verifyAllTenantChains(db: any): TenantChainVerifyResult[] {
  const tenants = db
    .prepare(
      `SELECT DISTINCT tenant_id, partner_id FROM partner_deal_pipeline
        WHERE deleted_at IS NULL ORDER BY tenant_id ASC`,
    )
    .all() as { tenant_id: string; partner_id: string }[];
  return tenants.map((t) => verifyTenantChain(db, t.tenant_id, t.partner_id));
}
