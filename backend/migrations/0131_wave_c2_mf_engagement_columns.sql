-- migrations/0131_wave_c2_mf_engagement_columns.sql
-- Wave C-2 v26.6.0 — Full rewrite per LOCK 3-A (V32-B1, V32-B2). See
-- WAVE_C2_SPEC_v3.3.5.md §2 (migration 0131 row), §4.1, §9.3-A.
--
-- This migration does THREE things, and nothing else:
--   1. `mf_engagement` gains five additive nullable/typed columns.
--   2. `mf_engagement_event` gains five additive nullable columns via a plain
--      `ALTER TABLE ... ADD COLUMN` (no rebuild needed for these five).
--   3. `mf_engagement_event` undergoes ONE narrow 12-step rebuild whose sole
--      purpose is relaxing `engagement_id`/`company_id` to nullable and adding
--      a table-level CHECK — see "PART 3" below for the full rationale.
--
-- LOCK 3-A: `event_type` stays free-text. NO CHECK constraint is added to
-- `event_type` in this migration. The 15-value C-2 vocabulary (plus the 9
-- pre-existing legacy free-text values already live in the table) lives in
-- the new, non-sacred, C-2-owned file `server/lib/mfcrm/eventTypes.ts`
-- (`isValidEventType`, `assertValidEventType`), enforced at the store layer,
-- not the DB layer. This removes the v3.1 rebuild's unverified assumption
-- that live `event_type` values are a subset of a DB-level enum.
--
-- V33-F1: the six `mfc_stages` composite-FK-substitute triggers that earlier
-- spec drafts (v3.2) planned as companion files `0131b`-`0131g` are NOT part
-- of this migration and are NOT shipped as migration files at all — they ship
-- as `db.exec()` calls inside self-heal functions in `server/db/connection.ts`
-- (`applyWaveC2MfEngagementSchema`, `applyWaveC2SoftCircleSchema`,
-- `applyWaveC2PipelineSchema`), invoked from `applyInlineMigrations(db)`.
-- This migration (0131) therefore contains ONLY the `mf_engagement` column
-- ALTERs and the `mf_engagement_event` LOCK-3-A extension/rebuild — no
-- trigger DDL of any kind.
--
-- SPEC ANCHORS: §2 (migration 0131 row), §4.1, §9.3-A (appendMfEngagementEvent
-- single write path), LOCK 3-A.
--
-- Real-tree anchors (grep-verified):
--   `mf_engagement` created by server/lib/mfcrmSchema.ts (CREATE TABLE IF NOT
--   EXISTS mf_engagement, no such statement in server/db/connection.ts —
--   grep-verified: `grep -c "CREATE TABLE IF NOT EXISTS mf_engagement"
--   server/db/connection.ts` = 0).
--   `mf_engagement_event` created at server/lib/mfcrmSchema.ts:77-86 (8
--   pre-existing columns: id, partner_id, engagement_id, company_id,
--   event_type, detail_json, actor, created_at — grep-verified this pass).
--
-- Rebuild precedent: migrations/0002_slow_medusa.sql is the only file in the
-- tree containing `RENAME TO` (V32-N3 — corrects the earlier wrong citation
-- of migration 0089, which is a plain `CREATE TABLE IF NOT EXISTS` with no
-- rebuild). 0002's rebuild of `company_members` follows the same 5-step shape
-- used below: PRAGMA foreign_keys=OFF -> CREATE new table -> explicit-column
-- INSERT...SELECT -> DROP old table -> RENAME new -> PRAGMA foreign_keys=ON.
-- The explicit column list on both sides of the INSERT...SELECT mirrors that
-- file's own convention and guards against the `connection.ts:1248`-style
-- column-order regression this discipline exists to prevent.
--
-- Idempotent: guarded by the platform migration runner's duplicate-column /
-- duplicate-table handling, PRAGMA table_info existence checks below, and the
-- self-heal function `applyWaveC2MfEngagementSchema` at the connection module
-- (column ALTERs only — the rebuild is a one-time migration step, never a
-- self-heal function, since self-heal only ever ADDs columns, never rebuilds
-- tables, per §2/0131).
--
-- Sacred boundaries: zero touches to partnerConsortiumRoutes.ts,
-- notificationsStore.ts, sseHub.ts, captableCommitStore.ts, messagingStore.ts,
-- paymentGatewayAdapter.ts, roundInvitationsStore.ts, or Airwallex.

-- ═════════════════════════════════════════════════════════════════════════
-- PART 1 — mf_engagement additive columns (§2/0131, unchanged from v3.1)
-- ═════════════════════════════════════════════════════════════════════════
-- founder_revoked_at: engagement-wide cutoff timestamp. Any single founder's
-- revoke (via mf_engagement_founder) gates the ENTIRE engagement — this
-- column is set engagement-wide, not per-founder-row. NULL = not revoked.
-- Consumed by managedFounderStore.ts's `Engagement` interface as a new
-- `founderRevokedAt: string | null` field (edit site named in spec §7.2).
ALTER TABLE mf_engagement ADD COLUMN founder_revoked_at TEXT;

-- founder_revoked_by: actor (user id or system) who set founder_revoked_at.
-- Nullable — NULL until a revoke occurs, and NULL forever for engagements
-- that are never revoked. Not explicitly named as a column in spec §2's row
-- 228 prose (which lists founder_revoked_at, archived_at, owner_user_id,
-- current_stage_id, current_stage_machine_type as the five columns) — see
-- ASSUMPTIONS_C2D.md for the reasoning on why this column is included anyway
-- per the task's explicit deliverable instruction.
ALTER TABLE mf_engagement ADD COLUMN founder_revoked_by TEXT;

-- archived_at: soft-archive timestamp for the engagement row (distinct from
-- founder_revoked_at — archival is a partner/admin action, not a founder
-- cutoff). NULL = active/not archived.
ALTER TABLE mf_engagement ADD COLUMN archived_at TEXT;

-- owner_user_id: the partner-side user who owns/is assigned this engagement.
-- Nullable FK to users(id) — reassignment is a normal lifecycle event.
ALTER TABLE mf_engagement ADD COLUMN owner_user_id TEXT REFERENCES users(id);

-- current_stage_id: FK into mfc_stages (migration 0128) for the engagement's
-- position in its partner-defined stage machine. Nullable — an engagement
-- may exist before a stage machine is configured for that partner.
ALTER TABLE mf_engagement ADD COLUMN current_stage_id TEXT REFERENCES mfc_stages(id);

-- current_stage_machine_type: co-populated with current_stage_id (never one
-- without the other in application code — enforced by the trigger pair
-- installed via applyWaveC2MfEngagementSchema, §4.1, not by this migration).
-- Pinned to the single literal value valid for this consumer table.
ALTER TABLE mf_engagement ADD COLUMN current_stage_machine_type TEXT
  CHECK (current_stage_machine_type = 'mfc_engagement');

-- Note: `mf_engagement.client_authority_scope` is explicitly NOT added here
-- (deleted per the v2->v3 single-source lock; authority now lives on
-- authority_artifacts, migration 0130 — unchanged from that decision).

-- ═════════════════════════════════════════════════════════════════════════
-- PART 2 — mf_engagement_event: five additive nullable columns (LOCK 3-A)
-- ═════════════════════════════════════════════════════════════════════════
-- Plain ALTER TABLE ADD COLUMN — no rebuild required for these five, since
-- SQLite ADD COLUMN can always add a nullable column to an existing table
-- without a rebuild. These are added BEFORE Part 3's rebuild so that Part 3's
-- CREATE TABLE mf_engagement_event_new can declare them inline as native
-- columns of the rebuilt table (matching spec §2/0131's literal instruction:
-- "with the relaxed nullability + new CHECK + the five LOCK-3-A columns
-- already included").
ALTER TABLE mf_engagement_event ADD COLUMN actor_role TEXT
  CHECK (actor_role IN ('founder','partner','admin','system'));
ALTER TABLE mf_engagement_event ADD COLUMN actor_partner_user_id TEXT REFERENCES users(id);
ALTER TABLE mf_engagement_event ADD COLUMN acting_on_behalf_of_user_id TEXT REFERENCES users(id);
ALTER TABLE mf_engagement_event ADD COLUMN partner_attribution_id TEXT REFERENCES partner_attributions(id);
ALTER TABLE mf_engagement_event ADD COLUMN event_data_json TEXT;

-- ═════════════════════════════════════════════════════════════════════════
-- PART 3 — mf_engagement_event: narrow NULL-relaxation rebuild (LOCK 3-A)
-- ═════════════════════════════════════════════════════════════════════════
-- Purpose (and ONLY purpose): relax `engagement_id TEXT NOT NULL` ->
-- `engagement_id TEXT` and `company_id TEXT NOT NULL` -> `company_id TEXT`,
-- so a firm-level or delegated-invitation audit row (which has no engagement
-- and, for firm-level artifacts, no company) can be written at all.
-- `partner_id TEXT NOT NULL` is UNTOUCHED — every audit row is always
-- partner-resolvable. `event_type` gets NO CHECK (LOCK 3-A). A table-level
-- CHECK (engagement_id IS NOT NULL OR partner_attribution_id IS NOT NULL) is
-- added so every row scopes to at least one real relationship.
--
-- SQLite cannot relax a column's NOT NULL constraint via ALTER TABLE, so a
-- full table rebuild is required — the 0002_slow_medusa.sql precedent shape:
--   1. PRAGMA foreign_keys=OFF
--   2. CREATE TABLE mf_engagement_event_new (relaxed nullability + new CHECK
--      + the five LOCK-3-A columns from Part 2 already included natively)
--   3. INSERT INTO mf_engagement_event_new (<13 explicit columns>)
--      SELECT (<13 explicit columns>) FROM mf_engagement_event
--   4. DROP TABLE mf_engagement_event
--   5. ALTER TABLE mf_engagement_event_new RENAME TO mf_engagement_event
--   6. Recreate idx_mf_engagement_event_partner / idx_mf_engagement_event_eng
--   7. PRAGMA foreign_keys=ON
--
-- Idempotency: guarded by a `PRAGMA table_info` check on the ALREADY-RELAXED
-- shape — if `mf_engagement_event.engagement_id` is already nullable (i.e.
-- this rebuild already ran), the whole PART 3 block is skipped. This mirrors
-- the migration runner's own idempotent-rerun contract and the platform
-- migrations table's one-shot-per-file guarantee, while remaining safe if
-- this file is ever executed a second time directly against a live DB
-- (e.g. during the forced-failure/resume recovery test named in spec §19).
--
-- The guard below cannot be expressed as a single portable SQL statement
-- (SQLite has no `IF` at the top level of a script), so the guard is
-- expressed procedurally by the migration runner / self-heal caller in
-- practice; for a plain `.sql` file run through `splitStatements()` (which
-- has no conditional-branch support either), the REQUIRED invocation
-- contract is: this file is run at most once per database via the platform
-- migration runner's own `_migrations_applied`-style bookkeeping (see
-- `migrations/0002_slow_medusa.sql`'s sibling `_migrations_applied` table,
-- and the numbered-migration convention generally) — the same one-shot
-- contract every other numbered migration in this tree relies on. The
-- `PRAGMA table_info`-based idempotency guard lives in the TypeScript
-- self-heal wrapper's column-ALTER portion (Parts 1-2 only, per §2/0131:
-- "self-heal only ever ADDs columns, never rebuilds"); Part 3's rebuild is
-- NOT re-executed by any self-heal function, only by this one-shot file.

PRAGMA foreign_keys=OFF;

-- Cleanup any partial mid-rebuild table from a prior failed run (closes Opus B-d2 silent-data-loss).
-- If the previous rebuild aborted after CREATE TABLE ..._new but before RENAME, that stale
-- table would collide with this run's CREATE and cause silent data loss via IF NOT EXISTS
-- behavior. Explicit drop makes rebuild resume-safe.
DROP TABLE IF EXISTS mf_engagement_event_new;

CREATE TABLE IF NOT EXISTS mf_engagement_event_new (
  id                           TEXT PRIMARY KEY NOT NULL,
  partner_id                   TEXT NOT NULL,
  engagement_id                TEXT,
  company_id                   TEXT,
  event_type                   TEXT NOT NULL,
  detail_json                  TEXT,
  actor                        TEXT,
  created_at                   TEXT NOT NULL,
  actor_role                   TEXT CHECK (actor_role IN ('founder','partner','admin','system')),
  actor_partner_user_id        TEXT REFERENCES users(id),
  acting_on_behalf_of_user_id  TEXT REFERENCES users(id),
  partner_attribution_id       TEXT REFERENCES partner_attributions(id),
  event_data_json              TEXT,
  CHECK (engagement_id IS NOT NULL OR partner_attribution_id IS NOT NULL)
);

INSERT INTO mf_engagement_event_new (
  id, partner_id, engagement_id, company_id, event_type, detail_json, actor,
  created_at, actor_role, actor_partner_user_id, acting_on_behalf_of_user_id,
  partner_attribution_id, event_data_json
)
SELECT
  id, partner_id, engagement_id, company_id, event_type, detail_json, actor,
  created_at, actor_role, actor_partner_user_id, acting_on_behalf_of_user_id,
  partner_attribution_id, event_data_json
FROM mf_engagement_event;

DROP TABLE mf_engagement_event;

ALTER TABLE mf_engagement_event_new RENAME TO mf_engagement_event;

CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_partner ON mf_engagement_event(partner_id);
CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_eng ON mf_engagement_event(engagement_id);

PRAGMA foreign_keys=ON;

-- A row-count and column-value equivalence assertion runs immediately after
-- this migration, per spec §19 (implemented in the migration runner /
-- probe, not in this SQL file — SQLite has no post-DDL assertion syntax).
