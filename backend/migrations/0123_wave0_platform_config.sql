-- 0123_wave0_platform_config.sql — Wave 0 deliverable 0-14
-- `platform_config` (current-state) + `platform_config_history` (append-only, hash-chained).
--
-- Per DECISION_LOG D7 ("admin-configurable knobs are DB-driven, hash-chain
-- audited on change"): every admin-editable platform setting lives here.
-- Genesis rows seeded into BOTH tables per Gemini v2 blocker 3 correction.
--
-- DEPLOYMENT STATUS: Wave 0 migrations 0121-0123 have NEVER been applied to
-- any live environment. Migration IDs have been edited in place across
-- review rounds, which is safe ONLY while the wave remains pre-code. If
-- Wave 0 ever ships to a live DB before this constraint is lifted, subsequent
-- schema changes MUST bump to fresh migration IDs and rewrite as re-shape
-- migrations. See v3 review Opus M5.
--
-- Wave 0 Increment 1 review corrections (Aug 2026):
--   Item 4: platform_config_history is now DB-enforced append-only via
--           BEFORE UPDATE + BEFORE DELETE unconditional-abort triggers, plus
--           UNIQUE(config_key, version) to prevent duplicate versions.
--   Item 5: value_json and snapshot_json carry json_valid() CHECKs, plus a
--           value_type/value_json type-agreement check.
--   Item 6: Seed pattern is insert-then-verify (see the inline apply function
--           in connection.ts). SQL seeds use INSERT OR IGNORE; the inline path
--           reads back and raises on hash drift.
--   Item 8: Hash preimage is canonical JSON of
--           {v: version, key, vt: value_type, val: value_json, prev: prev_hash}.
--           Includes version + value_type so a change to either breaks the chain.
--           Preimage is byte-unambiguous (JSON's own escaping is deterministic).
--
-- Three-place rule (ADR-6):
--   1. migrations/0123_wave0_platform_config.sql (this file)
--   2. server/db/migrations/0123_wave0_platform_config.sql (byte-identical mirror)
--   3. applyWave0PlatformConfigSchema() in server/db/connection.ts (idempotent inline)

CREATE TABLE IF NOT EXISTS platform_config (
  key                 TEXT PRIMARY KEY NOT NULL,
  value_json          TEXT NOT NULL
                        CHECK (json_valid(value_json)),
  value_type          TEXT NOT NULL CHECK (value_type IN ('string','number','boolean','json')),
  description         TEXT,
  is_secret           INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0,1)),
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  prev_revision_hash  TEXT NOT NULL,
  revision_hash       TEXT NOT NULL,
  created_at          TEXT NOT NULL
                        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at          TEXT NOT NULL
                        CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  created_by          TEXT,
  updated_by          TEXT,
  -- value_type / value_json agreement: 'string' must hold a JSON string,
  -- 'number' a JSON integer or real, 'boolean' a JSON boolean, 'json' anything valid.
  CHECK (
    (value_type = 'string'  AND json_type(value_json) = 'text')    OR
    (value_type = 'number'  AND json_type(value_json) IN ('integer','real')) OR
    (value_type = 'boolean' AND json_type(value_json) IN ('true','false'))   OR
    (value_type = 'json')
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_platform_config_updated_at ON platform_config(updated_at);

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

CREATE TRIGGER IF NOT EXISTS trg_pc_chain_guard
  BEFORE UPDATE ON platform_config
  WHEN NEW.version <> OLD.version + 1
    OR NEW.prev_revision_hash <> OLD.revision_hash
  BEGIN
    SELECT RAISE(ABORT, 'PLATFORM_CONFIG_CHAIN_BREAK');
  END;

CREATE TRIGGER IF NOT EXISTS trg_pc_atomic_audit
  BEFORE UPDATE ON platform_config
  WHEN NOT EXISTS (
    SELECT 1 FROM platform_config_history
    WHERE config_key = NEW.key
      AND version = NEW.version
      AND revision_hash = NEW.revision_hash
      AND prev_revision_hash = NEW.prev_revision_hash
      AND json_extract(snapshot_json, '$.val') = NEW.value_json
      AND json_extract(snapshot_json, '$.vt')  = NEW.value_type
      AND json_extract(snapshot_json, '$.key') = NEW.key
      AND json_extract(snapshot_json, '$.v')   = NEW.version
  )
  BEGIN
    SELECT RAISE(ABORT, 'PLATFORM_CONFIG_UNAUDITED_UPDATE');
  END;

-- v6 fix (all 3 v5 reviewers): trg_pc_no_direct_insert now enforces the SAME
-- content-linkage predicate as trg_pc_atomic_audit. A current-state INSERT is
-- accepted only if a matching genesis history row exists AND that row's
-- snapshot content (val/vt/key/v) and prev_hash match the inserted row.
CREATE TRIGGER IF NOT EXISTS trg_pc_no_direct_insert
  BEFORE INSERT ON platform_config
  WHEN NOT EXISTS (
    SELECT 1 FROM platform_config_history
    WHERE config_key = NEW.key
      AND version = NEW.version
      AND revision_hash = NEW.revision_hash
      AND prev_revision_hash = NEW.prev_revision_hash
      AND change_kind = 'genesis'
      AND json_extract(snapshot_json, '$.val') = NEW.value_json
      AND json_extract(snapshot_json, '$.vt')  = NEW.value_type
      AND json_extract(snapshot_json, '$.key') = NEW.key
      AND json_extract(snapshot_json, '$.v')   = NEW.version
  )
  BEGIN
    SELECT RAISE(ABORT, 'PLATFORM_CONFIG_UNAUDITED_INSERT');
  END;

-- v6 fix (GPT-5 v5): platform_config.key is part of audit identity.
-- Renaming an existing row is not an update; it is a new key that must go
-- through the genesis path. Without this, a fabricated equal-hash construction
-- across two key namespaces could hijack a chain.
CREATE TRIGGER IF NOT EXISTS trg_pc_no_key_change
  BEFORE UPDATE ON platform_config
  WHEN NEW.key <> OLD.key
  BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_KEY_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_pc_no_delete
  BEFORE DELETE ON platform_config
  BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_NO_DELETE'); END;

-- v5 fix GPT-5 B3: history-side integrity. Every history INSERT must be an
-- exact-next append or a valid genesis. See header block above.
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

-- Seed order changed in v5: platform_config_history FIRST, then platform_config.
-- trg_pc_no_direct_insert requires a matching genesis history row to exist
-- BEFORE the current-state INSERT succeeds. This mirrors what Wave F's write
-- path must do (BEGIN; history INSERT; current-state INSERT/UPDATE; COMMIT).
-- Genesis history rows first. snapshot_json is canonical JSON of {v, key, vt, val}.
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
INSERT OR IGNORE INTO platform_config
  (key, value_json, value_type, description, is_secret, version, prev_revision_hash, revision_hash, created_at, updated_at, created_by, updated_by)
VALUES
  -- Preimage: {"v":1,"key":"quota.default_period","vt":"string","val":"\"monthly\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('quota.default_period', '"monthly"', 'string',
   'Default quota period for partner tier plans. Editable in Wave F (F-QP1).', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'e99068df51f72853c7b31758d7b4009464e6fb2f73c202c5bc8432db1e12cc8d',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"billing_cycle.default","vt":"string","val":"\"annual\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('billing_cycle.default', '"annual"', 'string',
   'Default billing cycle for new partners. Owner decision 5.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"feeds.provider.default","vt":"string","val":"\"none\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('feeds.provider.default', '"none"', 'string',
   'Default market-data feeds provider. Wave F admin surface configures per-tenant.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   '952b9e62c6fd7ef2c44ab8564fb9a65191a30a14a607e962009a3d725eec841a',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"collective.partner_membership.review_window_days","vt":"number","val":"30","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('collective.partner_membership.review_window_days', '30', 'number',
   'Days admin has to review annual Collective-membership renewal. Owner decision 7.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a326ea08fc5a968ff83d51e594c4bcb3053402bcb1ac01b057e3f5765d935d80',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"collective.partner_membership.grace_days_after_expiry","vt":"number","val":"0","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('collective.partner_membership.grace_days_after_expiry', '0', 'number',
   'Grace days after Collective membership expiry before access is revoked. Owner decision 7.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'afe1b04a5296ff5c36ebd93aba71c9d143e834280d7d36faebc985b79058c815',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"kyc.capital_call.gate_mode","vt":"string","val":"\"warn\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('kyc.capital_call.gate_mode', '"warn"', 'string',
   'KYC gate behavior on capital calls: warn|block. Owner decision 9 (soft warn everywhere).', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   '22d5b402c900a307e5c14da41dac3713bbd64c3915b1b4e71a2b7664010a5834',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed');
