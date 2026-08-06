-- migrations/0132_wave_c2_soft_circle_provenance.sql
-- Wave C-2.e v26.6.0 — Pipeline unification (V32-B5/N8/N9).
--
-- FILENAME NOTE (read before editing — see ASSUMPTIONS_C2E.md item A1):
-- This file is named 0132_wave_c2_soft_circle_provenance.sql per the task
-- brief, but per the LOCKED spec's own §2.2 migration table (row "0132"),
-- migration 0132 is exclusively the partner_deal_pipeline unification —
-- additive columns on partner_deal_pipeline + the KV-to-SQL backfill. The
-- soft_circles provenance columns (`sourced_from_partner_id`,
-- `sourced_from_partner_attribution_id`, `partner_crm_contact_id`,
-- `partner_workflow_stage_id`, `current_stage_machine_type`) are assigned
-- to migration 0133 by name, in the same §2.2 table, and by §14.1's own
-- DDL block ("Migration 0133 adds soft_circles.partner_crm_contact_id...").
-- soft_circles.source_type/source_id ALREADY EXIST in the live tree
-- (server/db/connection.ts:2350-2351, "v25.0 Track 3 C1 — soft_circles
-- partner-sourcing columns") — they are NOT new columns this migration (or
-- any Wave C-2 migration) creates; LOCK 1 only imposes a CO-WRITE
-- discipline on the application layer for these pre-existing columns.
-- This file therefore contains ONLY the spec's real 0132 scope
-- (partner_deal_pipeline + KV backfill), matching the LOCKED spec exactly.
-- Zero soft_circles DDL appears below, by design, per the spec boundary —
-- fabricating soft_circles ALTERs here would duplicate 0133's real scope
-- and violate the "byte-format matches predecessors / no fabrications"
-- constraint.
--
-- SPEC ANCHORS: §2.2 (migration 0132 row), §10.1 (PL-1 full canonical
-- mapping), V32-B5, V32-N8, V32-N9.
--
-- Sacred boundaries: zero touches to partnerConsortiumRoutes.ts,
-- notificationsStore.ts, sseHub.ts, captableCommitStore.ts, messagingStore.ts,
-- paymentGatewayAdapter.ts, roundInvitationsStore.ts, or Airwallex.
--
-- Ground truth (grep-verified against server/db/connection.ts:3969-3990):
--   partner_deal_pipeline already has: id, tenant_id, partner_id, company_id,
--   stage, assigned_user_ids, target_close_at, notes, prev_hash, curr_hash,
--   legacy_id (migration 0043), created_at, updated_at, deleted_at.
--   This migration adds ONLY new additive columns; the hash-chain columns
--   (prev_hash/curr_hash) are never touched or included in the new columns'
--   payload (per §10.1 item 7 / §17's "additive columns land outside the
--   hash-chain payload" discipline, same pattern as 0129/0130).
--
-- Additive: every new column below is nullable (or has a DEFAULT), so
-- every existing partner_deal_pipeline row parses under the new schema
-- with no data loss and no required backfill of the *schema* itself.
-- KV-row DATA backfill (separate from the schema-level ALTERs) is a
-- guarded TypeScript boot step (`runWaveC2PipelineKvBackfill`), NOT raw
-- SQL — per spec's explicit instruction ("mirrors the 0114 precedent for
-- lazy-KV backfills — not raw SQL"). This file still creates the lock
-- table + skip-log table the backfill step depends on, and documents the
-- backfill's SQL-level contract in comments for the TS implementer.
--
-- Idempotent: guarded by the platform migration runner's duplicate-column/
-- duplicate-table handling and the inline self-heal function
-- `applyWaveC2SoftCircleProvenanceSchema` in server/db/connection.ts
-- (V33-1-B1 pattern: sqlite_master + PRAGMA table_info guarded, tolerates
-- duplicate-column/duplicate-table errors, idempotent under re-run,
-- log.warn + continue on any other error — never rethrows and kills boot).

-- ═════════════════════════════════════════════════════════════════════════
-- partner_deal_pipeline — additive columns (stage-machine dual-column period)
-- ═════════════════════════════════════════════════════════════════════════
-- Dual-column period (§10.1 item 9): the existing `stage` free-text column
-- stays; current_stage_id/current_stage_machine_type are additive. The read
-- layer prefers current_stage_id when present, falling back to a
-- stage-string-to-mfc_stages.key mapping otherwise. Full cutover deferred
-- to Wave D (§22).
ALTER TABLE partner_deal_pipeline ADD COLUMN current_stage_id TEXT REFERENCES mfc_stages(id);
ALTER TABLE partner_deal_pipeline ADD COLUMN current_stage_machine_type TEXT CHECK (current_stage_machine_type = 'partner_pipeline');
ALTER TABLE partner_deal_pipeline ADD COLUMN probability_pct_override INTEGER;
ALTER TABLE partner_deal_pipeline ADD COLUMN deal_size_usd REAL;
ALTER TABLE partner_deal_pipeline ADD COLUMN mapping_note TEXT;

-- Canonical-field-preservation set (§10.1's full mapping table, V32-B5):
-- every KV DTO field (`PartnerPipelineDeal`, partnerWorkspaceStore.ts:214-232)
-- either maps to an existing V19 column, or lands here as a new additive
-- column, or is explicitly stated as preserved-but-not-surfaced. No field
-- is silently dropped.
ALTER TABLE partner_deal_pipeline ADD COLUMN deal_name TEXT;              -- KV dealName
ALTER TABLE partner_deal_pipeline ADD COLUMN currency TEXT;               -- KV currency
ALTER TABLE partner_deal_pipeline ADD COLUMN sector TEXT;                 -- KV sector
ALTER TABLE partner_deal_pipeline ADD COLUMN geography TEXT;              -- KV geography
-- KV estCheckSizeMinor -> deal_size_usd (added above), /100 conversion, no new column.
-- KV expectedClose -> target_close_at (EXISTING V19 column, direct rename-on-map,
--   no new column needed). NOTE: the real PartnerPipelineDeal field is named
--   `expectedClose`, NOT `expectedCloseDate` — v3.2 of the spec had this wrong;
--   v3.3.5 (this migration's basis) corrects it. See probe test 7.
-- KV ownerUserId -> assigned_user_ids (EXISTING V19 column, single-element array wrap).
ALTER TABLE partner_deal_pipeline ADD COLUMN kv_notes TEXT;               -- KV notes (kept
  -- separate from mapping_note above so KV free-text notes are never
  -- overwritten by the stage-mapping annotation — §10.1 row for `notes`).
ALTER TABLE partner_deal_pipeline ADD COLUMN kv_version INTEGER;             -- KV version
ALTER TABLE partner_deal_pipeline ADD COLUMN kv_updated_at TEXT;             -- KV updatedAt
ALTER TABLE partner_deal_pipeline ADD COLUMN kv_updated_by TEXT;             -- KV updatedBy
ALTER TABLE partner_deal_pipeline ADD COLUMN kv_is_seed INTEGER;             -- KV isSeed (0/1)
ALTER TABLE partner_deal_pipeline ADD COLUMN kv_prev_revision_hash TEXT;     -- KV prevRevisionHash
                                                                              -- (provenance only —
                                                                              -- distinct from this
                                                                              -- table's own prev_hash/
                                                                              -- curr_hash chain, never
                                                                              -- mixed into it)
ALTER TABLE partner_deal_pipeline ADD COLUMN kv_revision_hash TEXT;          -- KV revisionHash
                                                                              -- (provenance only —
                                                                              -- distinct from this
                                                                              -- table's own chain)
-- KV id -> existing V19 `id` primary key (not a value copy; preserved only via legacy_id).
-- KV partnerId -> existing V19 `partner_id` (direct copy, no transformation).
-- KV stage -> existing V19 `stage` (mapped vocabulary) + mapping_note (added above).
-- KV legacy_id -> existing V19 `legacy_id` column (migration 0043). Dedup key, see index below.

CREATE INDEX IF NOT EXISTS idx_partner_deal_pipeline_current_stage
  ON partner_deal_pipeline(current_stage_id) WHERE current_stage_id IS NOT NULL;

-- §10.1 item 6: legacy_id unique constraint. Backfill conflict resolution
-- (both for this migration's own backfill and for any future write): a KV
-- row whose legacy_id collides with an existing V19 row is dropped — V19
-- wins — and the dropped KV row is logged to c2_backfill_skip_log with
-- reason='pipeline_legacy_id_conflict_v19_wins'.
--
-- R2 FIX (root fix 6, SHARED-M1 / Opus MAJOR M-e2): pre-flight, fail LOUDLY
-- if duplicate non-null legacy_id values already exist in
-- partner_deal_pipeline BEFORE this index is created. Unlike 0129, this
-- migration previously had NO pre-flight anywhere (neither SQL nor TS) —
-- on live data with pre-existing legacy_id duplicates (e.g. from a partial
-- prior backfill attempt), `CREATE UNIQUE INDEX` would raise `UNIQUE
-- constraint failed: partner_deal_pipeline.legacy_id`, which
-- `migrate.ts::isIdempotentSqliteError` swallows unconditionally — the
-- migration would be recorded as applied while the constraint is actually
-- absent, silently removing the only structural guard behind the KV
-- backfill's "V19 wins on legacy_id conflict" rule. Same `_preflight_check`
-- CHECK-constraint mechanism as 0129 (see that file's header note for why
-- `RAISE(ABORT, ...)` cannot be used outside a trigger body): a message of
-- `CHECK constraint failed: n <= 1` does not match any pattern
-- `isIdempotentSqliteError` swallows (duplicate column name / already
-- exists / UNIQUE constraint failed / no such table), so this fails the
-- migration run loudly instead of silently.
CREATE TABLE IF NOT EXISTS _preflight_check (
  check_name  TEXT NOT NULL,
  status      TEXT NOT NULL,
  dim1        TEXT,
  dim2        TEXT,
  n           INTEGER NOT NULL CHECK (n <= 1)
);

INSERT INTO _preflight_check (check_name, status, dim1, dim2, n)
  SELECT 'uq_partner_deal_pipeline_legacy_id_preflight',
         'DUPLICATE_LEGACY_ID_PRESENT',
         legacy_id, NULL, COUNT(*) as n
    FROM partner_deal_pipeline
   WHERE legacy_id IS NOT NULL
   GROUP BY legacy_id
  HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_deal_pipeline_legacy_id
  ON partner_deal_pipeline(legacy_id) WHERE legacy_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- c2_backfill_skip_log — shared skip/orphan log across Wave C-2 migrations
-- (0129/0132/0136 all write here; §2.1). CREATE TABLE IF NOT EXISTS so this
-- migration is safe to run whether or not 0129 already created it.
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS c2_backfill_skip_log (
  id            TEXT PRIMARY KEY NOT NULL,
  source_table  TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  missing_fk    TEXT NOT NULL CHECK (missing_fk IN ('company_id','partner_id','legacy_id','duplicate_grain','none')),
  reason        TEXT NOT NULL,
  skipped_at    TEXT NOT NULL
);

-- ═════════════════════════════════════════════════════════════════════════
-- _c2_pipeline_backfill_lock — single-writer race protection for the KV
-- backfill (§10.1 item 11, §2.2/0132 row). NOT a true advisory lock — a
-- defense-in-depth marker-row insert-with-conflict, honestly labeled as
-- such. The current operational model is single-instance deploys (stated
-- explicitly as an assumption in ASSUMPTIONS_C2E.md, not verified against
-- a deploy runbook this pass).
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS _c2_pipeline_backfill_lock (
  id            TEXT PRIMARY KEY NOT NULL,
  started_at    TEXT NOT NULL,
  host          TEXT NOT NULL,
  completed_at  TEXT
);

-- ═════════════════════════════════════════════════════════════════════════
-- KV-to-SQL backfill contract (implemented in TypeScript, NOT here — see
-- runWaveC2PipelineKvBackfill in applyWaveC2SoftCircleProvenanceSchema.ts's
-- sibling boot-step module). This block documents the exact SQL shape that
-- TS function must follow, so this migration file is self-contained
-- documentation of the full 0132 contract even though the data-mutation
-- step itself runs as a guarded boot step, per spec (§2.2/0132: "KV-to-SQL
-- backfill (guarded TypeScript boot step, runWaveC2PipelineKvBackfill,
-- mirrors the 0114 precedent for lazy-KV backfills — not raw SQL)").
--
-- 1. Open transaction. INSERT INTO _c2_pipeline_backfill_lock
--    (id, started_at, host) VALUES ('backfill_0132', :now, :hostname).
--    If this INSERT raises a PRIMARY KEY violation, another instance/run
--    already owns the backfill — log and return immediately (skip, do not
--    retry, do not error the boot).
-- 2. For each partnerPipelineStore (KV shim) row, in insertion order:
--    a. If companyId IS NULL: skip — do NOT backfill. Log to
--       c2_backfill_skip_log (missing_fk='company_id',
--       reason='pipeline_create_null_company'). Row stays in the KV shim
--       (§10.1 item 4, V32-N8 — no partner_deal_pipeline_unassigned table).
--    b. If row.legacyId already exists as partner_deal_pipeline.legacy_id
--       on a live row: skip — V19 wins. Log to c2_backfill_skip_log
--       (missing_fk='legacy_id',
--       reason='pipeline_legacy_id_conflict_v19_wins').
--    c. Else: compute tenant_id = 'tenant_partner_' || partnerId (§10.1
--       item 5, verified live convention). Map KV `stage` vocabulary to
--       V19 `stage` + `mapping_note`:
--         invited     -> sourced   (mapping_note='kv_stage:invited')
--         viewed      -> screening (mapping_note='kv_stage:viewed')
--         soft_circle -> diligence (mapping_note='kv_stage:soft_circle')
--         signed      -> term_sheet(mapping_note='kv_stage:signed')
--         funded      -> closed    (mapping_note='kv_stage:funded')
--         committed   -> closed    (mapping_note='kv_stage:committed')
--       Read the current chain tip for this tenant_id (MAX(created_at) or
--       an equivalent tip-tracking read), compute
--       curr_hash = computeHash(prev_hash_tip, payload) using the SAME
--       computeHash(prevHash, payload) function partnerWorkspaceV19Store.ts
--       already exports (sha256 over "prevHash|JSON(payload)"), chained
--       per-tenant, never NULL/placeholder (§10.1 item 7).
--       INSERT INTO partner_deal_pipeline (id, tenant_id, partner_id,
--         company_id, stage, assigned_user_ids, target_close_at, notes,
--         deal_name, currency, sector, geography, deal_size_usd, kv_notes,
--         kv_version, kv_updated_at, kv_updated_by, kv_is_seed,
--         kv_prev_revision_hash, kv_revision_hash, mapping_note, legacy_id,
--         prev_hash, curr_hash, created_at, updated_at, deleted_at)
--       VALUES (...) — field-complete per this file's mapping comments.
--       INSERT an initial mfc_stage_transitions row (from_stage_id NULL,
--       to_stage_id = the mapped stage's mfc_stages.id) so
--       last_stage_transition_at is never null (§10.5, §10.1 item 8).
-- 3. UPDATE _c2_pipeline_backfill_lock SET completed_at = :now
--    WHERE id = 'backfill_0132'.
-- 4. Commit transaction (or per-tenant sub-transactions, implementer's
--    choice, as long as the lock row's own insert is the first statement
--    and is never rolled back independently of the whole backfill).
