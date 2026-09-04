-- 0231 · WAVE 314 · platform_config SHAPE CONVERGENCE (ADDITIVE ONLY)
--
-- THE DEFECT (reproduced empirically, build_log/wave314/probes/w314_premise_repro.mjs).
-- Two migrations create `platform_config` with two INCOMPATIBLE shapes:
--
--   migrations/0000_numerous_roxanne_simpson.sql:166  (OLD shape, non-STRICT)
--     key, value, version, prev_hash, hash, updated_at, updated_by
--
--   migrations/0123_wave0_platform_config.sql:34      (NEW shape, STRICT)
--     key, value_json, value_type, description, is_secret, version,
--     prev_revision_hash, revision_hash, created_at, updated_at,
--     created_by, updated_by
--
-- 0123 uses `CREATE TABLE IF NOT EXISTS`. When 0000 has already created the
-- table, 0123's CREATE is a no-op — the OLD shape survives and the NEW shape
-- never lands. 0123 then CONTINUES: it creates `platform_config_history` in the
-- NEW shape, both indexes, and all eight triggers, and finally ABORTS on its own
-- genesis seed with the exact string the live server printed:
--
--     table platform_config has no column named value_json
--
-- The observable end state on such a database is:
--   · platform_config     — OLD shape, ZERO rows (the genesis seed never landed)
--   · platform_config_history — NEW shape, 6 genesis rows, all 8 triggers present
--   · every `value_json` read throws  `no such column: value_json`
--   · every write throws              `no such column: NEW.revision_hash`
--     (raised from inside trg_pc_chain_guard, which 0123 DID install)
--
-- Both directions have live consumers, so neither column set may be abandoned:
--   · NEW columns are read/written by server/lib/platformConfigWriter.ts and its
--     eight importing stores (see W314_BUILD.md for the full enumeration).
--   · OLD columns are read/written by server/adminPlatformStore.ts through the
--     drizzle table `platformConfig` in shared/schema.ts:743.
--
-- THE REPAIR. Converge the COLUMN SET to the UNION of both shapes, on whichever
-- shape the database happens to have. Every statement below is an additive
-- `ALTER TABLE ... ADD COLUMN` or a guarded `UPDATE`. Nothing is dropped,
-- recreated, rewritten or deleted. Every ADD COLUMN is nullable or carries a
-- constant default, which is the only form SQLite permits and also the only form
-- that cannot fail against existing rows.
--
-- IDEMPOTENCE. On a database that already has a column, `ADD COLUMN` fails with
-- `duplicate column name`, which server/db/migrate.ts:296 isIdempotentSqliteError()
-- classifies as idempotent and skips. Re-running this file is therefore a no-op.
-- That is also precisely why this file is safe on BOTH shapes: each ALTER lands
-- on the shape that lacks the column and is skipped on the shape that has it.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO.
--   · It does NOT make the OLD-shape table STRICT and does NOT add the
--     table-level CHECK constraints from 0123. SQLite cannot add either with
--     ALTER TABLE; both would require a table rebuild, which is forbidden here.
--     `sqlite_master` therefore CANNOT be made byte-identical between a
--     0000-built and a 0123-built database without destructive SQL. The COLUMN
--     SET converges; the table's STRICT-ness and its table-level CHECKs do not.
--     This is stated plainly in W314_FOR_THE_OWNER.md rather than papered over.
--   · It does NOT fix server/adminPlatformStore.ts. On a NEW-shape database that
--     store's write path is blocked by trg_pc_no_direct_insert regardless of
--     which columns exist, because it does not write the audit history row that
--     trigger demands. That is a code defect, not a schema defect.

-- ---------------------------------------------------------------- NEW columns,
-- added when the database was built the 0000 way. Skipped as `duplicate column
-- name` when it was built the 0123 way.

ALTER TABLE platform_config ADD COLUMN value_json TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN value_type TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN description TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN prev_revision_hash TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN revision_hash TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN created_at TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN created_by TEXT;
--> statement-breakpoint

-- ---------------------------------------------------------------- OLD columns,
-- added when the database was built the 0123 way. Skipped as `duplicate column
-- name` when it was built the 0000 way. These exist so that the drizzle table in
-- shared/schema.ts:743 — which server/adminPlatformStore.ts selects through —
-- cannot throw a column-drift error on a NEW-shape database.

ALTER TABLE platform_config ADD COLUMN value TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN prev_hash TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN hash TEXT;
--> statement-breakpoint

-- ------------------------------------------------- GENESIS SEED REPLAY (DATA).
-- WHY THE DATA REPAIR IS *THIS* AND NOT AN `UPDATE`.
-- The audit chain is a sha256 over a canonical string, computed in TypeScript
-- (computeRevisionHash, server/lib/platformConfigWriter.ts:59). SQLite has no
-- sha256, so a .sql file CANNOT compute a valid revision_hash. Any hash a
-- migration invented would be rejected by trg_pch_chain_integrity, or worse,
-- accepted and then fail every later chain verification. A pure-SQL data
-- backfill of this table is therefore not merely awkward, it is impossible to
-- do correctly. Proven empirically: seeding a forged genesis row aborts with
-- PLATFORM_CONFIG_HISTORY_CHAIN_BREAK (build_log/wave314/probes/).
--
-- What CAN be done correctly is to replay 0123's OWN genesis seed, whose hashes
-- were computed by that same TypeScript function and are literals in the file.
-- Above, the ALTERs have just made `value_json` exist, so the INSERT that
-- aborted on the live server can now land. `INSERT OR IGNORE` makes it a no-op
-- where the rows are already present, which is the 0123-built case.
--
-- This is also why no `UPDATE` appears anywhere in this file: on a 0000-built
-- database `platform_config` is EMPTY (0123's seed aborted before inserting a
-- single row, and trg_pc_chain_guard makes any subsequent OLD-shape INSERT
-- raise `no such column: NEW.revision_hash`), so there is nothing to update and
-- nothing that can be lost. Both facts are asserted by the probe harness.
--
-- The rows below are byte-identical to migrations/0123_wave0_platform_config.sql.

-- ---------------------------------------------------------------------------
-- v26.42.0 REPAIR (live install 2026-09-04). 0231 previously assumed
-- `platform_config_history` already existed, because 0123 creates it. On the
-- LIVE database it does NOT exist: the inline bootstrap runs the identical DDL
-- inside sqliteTransaction(), the seed INSERT into platform_config raises, and
-- THE WHOLE TRANSACTION ROLLS BACK — taking the CREATE TABLE with it, every
-- boot. The failure was invisible because the boot log says "continuing".
-- Reproduced from the operator's own migrate output:
--   ERROR Migration 0231 failed: no such table: platform_config_history
-- This block makes 0231 SELF-SUFFICIENT. Every statement is IF NOT EXISTS, so
-- it is a no-op on any database where 0123 did land. Byte-identical DDL to
-- migrations/0123_wave0_platform_config.sql — copied, not retyped.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_config_history (
  history_id          TEXT PRIMARY KEY NOT NULL,
  config_key          TEXT NOT NULL,
  version             INTEGER NOT NULL CHECK (version > 0),
  snapshot_json       TEXT NOT NULL
                        CHECK (json_valid(snapshot_json)),
  prev_revision_hash  TEXT NOT NULL,
  revision_hash       TEXT NOT NULL,
  changed_at          TEXT NOT NULL
                        CHECK (changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  changed_by          TEXT,
  change_kind         TEXT NOT NULL CHECK (change_kind IN ('genesis','update','revert')),
  UNIQUE (config_key, version)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_pch_key_version ON platform_config_history(config_key, version);
CREATE INDEX IF NOT EXISTS idx_pch_changed_at ON platform_config_history(changed_at);

-- Wave 0 Increment 1 review item 4: history is append-only, DB-enforced.
-- Any UPDATE or DELETE against history is a chain-break; abort loudly.
CREATE TRIGGER IF NOT EXISTS trg_pch_no_update
  BEFORE UPDATE ON platform_config_history
  BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_HISTORY_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_pch_no_delete
  BEFORE DELETE ON platform_config_history
  BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_HISTORY_IMMUTABLE'); END;

-- Wave 0 Increment 1 v3+v4+v5+v6 review — chain-guard triggers on current state
-- + audit-content integrity + history-side integrity + key immutability.
--
-- v3 fix: trg_pc_chain_guard — UPDATE must advance version and link prev_hash.
-- v4 fix (GPT-5 B1): trg_pc_atomic_audit — matching history row must exist.
-- v5 fix (GPT-5 B1 + Opus C2): trg_pc_atomic_audit checks snapshot CONTENT too
--       (prev_hash + snapshot_json.val + .vt + .key + .v). "Audited" now means
--       "the history row records what actually changed," not just "any row
--       with the right hash exists."
-- v5 fix (GPT-5 B2): trg_pc_no_direct_insert — INSERT into platform_config
--       requires a matching genesis history row. New keys are added via
--       Wave F's audited genesis path only.
-- v5 fix (GPT-5 B3): trg_pch_chain_integrity — platform_config_history
--       INSERT must be an exact-next append (version = prior+1 and
--       prev_hash = prior.revision_hash), or a genesis row (version=1,
--       prev=64 zeros).
-- v6 fix (Opus v5 B1): boot-time drift check split into always-invariant vs
--       version=1-only assertions. Prevents boot-brick after first legitimate
--       Wave F audited update (which moves version to 2, 3, ...).
-- v6 fix (Opus v5 B2): pre-existing divergent history rows converted from
--       fail-open (schema rolled away with log.warn) to fail-loud
--       (Wave0SeedDriftError → runWave0Apply re-throws → boot aborts).
-- v6 fix (all 3 v5 reviewers): trg_pc_no_direct_insert now enforces the FULL
--       content-linkage predicate (prev_hash + snapshot val/vt/key/v),
--       symmetric with trg_pc_atomic_audit.
-- v6 fix (GPT-5 v5): trg_pc_no_key_change — platform_config.key is part of
--       audit identity. Renaming is a new key (must use genesis path), not
--       an update. Closes the cross-key hijack path GPT-5 flagged.
--
-- ENCODING CONVENTION (v7, Opus v5 C6 + v6 C3):
--   snapshot_json.val is the DOUBLY-encoded JSON string of value_json, not the
--   inner value. Examples:
--     value_json = '30'         →  snapshot_json.val = "30"       (JSON string of "30")
--     value_json = '"monthly"'  →  snapshot_json.val = ""monthly""
--     value_json = 'true'       →  snapshot_json.val = "true"
--   The canonical hash preimage requires this so hashes are stable across
--   value types. json_extract(snapshot_json, '$.val') returns a TEXT storage
--   class, and the trigger predicates compare it to NEW.value_json (also TEXT),
--   so the encoding must match. Wave F writers MUST use JSON.stringify on the
--   inner value_json when building snapshot_json, not the raw value_json string.
--   A common mistake is to write {val: 30} instead of {val: "30"} — the trigger
--   will reject the resulting current-state INSERT/UPDATE with
--   PLATFORM_CONFIG_UNAUDITED_INSERT or PLATFORM_CONFIG_UNAUDITED_UPDATE.
--   See wave0/regen_0123.mjs canonicalPreimage() for the reference implementation.
--
-- Out-of-Wave-0 (deferred with named IDs; see 0123 tail & DECISION_LOG):
--   WAVE0-DEF-HASH-RECOMPUTE-VERIFIER: SQLite has no sha256(); hash-authenticity
--       verification (recomputing revision_hash from canonical preimage) belongs
--       to the app-layer writer/verifier in Wave F. Triggers verify CHAIN
--       integrity, not chain AUTHENTICITY.
--   WAVE0-DEF-TX-OWNED-WRITER: the transaction-owned write pattern (history +
--       current in one atomic tx with rollback proof) belongs to Wave F's
--       write path, not Wave 0's schema.
--   WAVE0-DEF-SQL-PATH-DRIFT-CHECK: byte-for-byte drift check on the raw SQL
--       migration path (used only by external migration tooling, not by server
--       boot). Server boot always uses the inline path where drift IS checked.
--       Belongs to Wave K when migration tooling is chosen.

CREATE TRIGGER IF NOT EXISTS trg_pch_chain_integrity
  BEFORE INSERT ON platform_config_history
  WHEN
    (NEW.change_kind = 'genesis' AND (
       NEW.version <> 1
       OR NEW.prev_revision_hash <> '0000000000000000000000000000000000000000000000000000000000000000'
    ))
    OR
    (NEW.change_kind <> 'genesis' AND NOT EXISTS (
       SELECT 1 FROM platform_config_history h
       WHERE h.config_key = NEW.config_key
         AND h.version = NEW.version - 1
         AND h.revision_hash = NEW.prev_revision_hash
    ))
  BEGIN
    SELECT RAISE(ABORT, 'PLATFORM_CONFIG_HISTORY_CHAIN_BREAK');
  END;

INSERT OR IGNORE INTO platform_config_history
  (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, changed_by, change_kind)
VALUES
  ('pch_gen_quota_default_period', 'quota.default_period', 1,
   '{"v":1,"key":"quota.default_period","vt":"string","val":"\"monthly\""}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'e99068df51f72853c7b31758d7b4009464e6fb2f73c202c5bc8432db1e12cc8d',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_billing_cycle_default', 'billing_cycle.default', 1,
   '{"v":1,"key":"billing_cycle.default","vt":"string","val":"\"annual\""}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_feeds_provider_default', 'feeds.provider.default', 1,
   '{"v":1,"key":"feeds.provider.default","vt":"string","val":"\"none\""}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   '952b9e62c6fd7ef2c44ab8564fb9a65191a30a14a607e962009a3d725eec841a',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_review_window', 'collective.partner_membership.review_window_days', 1,
   '{"v":1,"key":"collective.partner_membership.review_window_days","vt":"number","val":"30"}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a326ea08fc5a968ff83d51e594c4bcb3053402bcb1ac01b057e3f5765d935d80',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_grace_days', 'collective.partner_membership.grace_days_after_expiry', 1,
   '{"v":1,"key":"collective.partner_membership.grace_days_after_expiry","vt":"number","val":"0"}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'afe1b04a5296ff5c36ebd93aba71c9d143e834280d7d36faebc985b79058c815',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_kyc_gate_mode', 'kyc.capital_call.gate_mode', 1,
   '{"v":1,"key":"kyc.capital_call.gate_mode","vt":"string","val":"\"warn\""}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   '22d5b402c900a307e5c14da41dac3713bbd64c3915b1b4e71a2b7664010a5834',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis');

-- Now the current-state rows, which trg_pc_no_direct_insert lets through only
-- because the matching history genesis rows now exist.
-- Hashes are canonical-JSON-preimage deterministic (see file header). Formula:
--   sha256hex(JSON.stringify({v: 1, key, vt: value_type, val: value_json,
--                             prev: '0'*64}))
-- Preimage examples in the header comment of each row below.
-- ONE DELIBERATE DIFFERENCE FROM 0123's SEED, AND WHY.
-- 0123's seed does not list `value`. On the OLD shape `value` is `TEXT NOT NULL`
-- with no default, so that seed aborts with `NOT NULL constraint failed:
-- platform_config.value` — and because the statement is `INSERT OR IGNORE`, the
-- abort is SWALLOWED and the statement inserts NOTHING while reporting success.
-- The first draft of this migration shipped exactly that silent no-op and the
-- probe harness caught it (0 rows seeded, 0 errors reported). `value` is
-- therefore listed here and set to the SAME JSON text as `value_json`, which
-- both satisfies the OLD shape's NOT NULL and gives the OLD-shape reader in
-- server/adminPlatformStore.ts a real value instead of NULL. Every
-- revision_hash below is unchanged from 0123, so the audit chain still verifies.

INSERT OR IGNORE INTO platform_config
  (key, value, value_json, value_type, description, is_secret, version, prev_revision_hash, revision_hash, created_at, updated_at, created_by, updated_by)
VALUES
  -- Preimage: {"v":1,"key":"quota.default_period","vt":"string","val":"\"monthly\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('quota.default_period', '"monthly"', '"monthly"', 'string',
   'Default quota period for partner tier plans. Editable in Wave F (F-QP1).', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'e99068df51f72853c7b31758d7b4009464e6fb2f73c202c5bc8432db1e12cc8d',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"billing_cycle.default","vt":"string","val":"\"annual\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('billing_cycle.default', '"annual"', '"annual"', 'string',
   'Default billing cycle for new partners. Owner decision 5.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"feeds.provider.default","vt":"string","val":"\"none\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('feeds.provider.default', '"none"', '"none"', 'string',
   'Default market-data feeds provider. Wave F admin surface configures per-tenant.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   '952b9e62c6fd7ef2c44ab8564fb9a65191a30a14a607e962009a3d725eec841a',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"collective.partner_membership.review_window_days","vt":"number","val":"30","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('collective.partner_membership.review_window_days', '30', '30', 'number',
   'Days admin has to review annual Collective-membership renewal. Owner decision 7.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a326ea08fc5a968ff83d51e594c4bcb3053402bcb1ac01b057e3f5765d935d80',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"collective.partner_membership.grace_days_after_expiry","vt":"number","val":"0","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('collective.partner_membership.grace_days_after_expiry', '0', '0', 'number',
   'Grace days after Collective membership expiry before access is revoked. Owner decision 7.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'afe1b04a5296ff5c36ebd93aba71c9d143e834280d7d36faebc985b79058c815',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"kyc.capital_call.gate_mode","vt":"string","val":"\"warn\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('kyc.capital_call.gate_mode', '"warn"', '"warn"', 'string',
   'KYC gate behavior on capital calls: warn|block. Owner decision 9 (soft warn everywhere).', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   '22d5b402c900a307e5c14da41dac3713bbd64c3915b1b4e71a2b7664010a5834',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed');

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_platform_config_updated_at ON platform_config(updated_at);
