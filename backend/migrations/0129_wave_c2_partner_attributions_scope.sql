-- migrations/0129_wave_c2_partner_attributions_scope.sql
-- Wave C-2 v26.6.0 — LOCK 2: folds client_engagements into partner_attributions.
--
-- Adds five additive columns to partner_attributions:
--   authority_artifact_id           TEXT  (BARE — no REFERENCES clause; V32-M8)
--   client_authority_scope_json     TEXT
--   engagement_letter_effective_at  TEXT
--   engagement_letter_expires_at    TEXT
--   engagement_letter_revoked_at    TEXT
--
-- CRITICAL (V32-M8, spec §2.2/0129): `authority_artifact_id` is added as a plain
-- `TEXT` column with NO `REFERENCES authority_artifacts(id)` clause. Reason:
-- authority_artifacts does not exist until 0130. SQLite's foreign_keys=ON
-- enforcement (the live default, connection.ts:125) rejects INSERT against a
-- column whose REFERENCES clause names a non-existent table. Since SQLite has no
-- `ALTER TABLE ... ADD CONSTRAINT`, the column never gains a DB-level FK — it is
-- permanently application-layer-enforced (spec §2.2/0130).
--
-- Also creates:
--   uq_partner_attributions_active  UNIQUE INDEX (partner_id, company_id)
--                                    WHERE revoked_at IS NULL     (V32-M2)
--
-- Pre-flight duplicate-grain check + tie-break rule are handled by the
-- TypeScript wrapper `applyWaveC2PartnerAttributionsScopeSchema` (self-heal +
-- data-fix); this SQL file assumes the pre-flight passed cleanly.
--
-- Additive: no existing row is modified, no existing column is dropped.
-- Idempotent: guarded by `migrate.ts::isIdempotentSqliteError` swallowing
-- "duplicate column name" on re-run (R2 fix / Opus MINOR m-b2 — the previous
-- header's claim that idempotency was "guarded by ADD COLUMN's PRAGMA check in
-- the self-heal wrapper" was misleading for THIS file's own execution path:
-- when run via `npm run db:migrate`, the TS self-heal wrapper never runs at
-- all; the real reason a second raw run of this .sql is safe is migrate.ts's
-- own duplicate-column swallow, not anything the TS wrapper does).
--
-- LOCK-2 provenance: partner_attributions rows now carry the operational
-- engagement-letter timestamps AND the client_authority_scope_json (§5.2).
-- No new `client_engagements` table is created — client_engagements has been
-- folded into partner_attributions per LOCK 2. Consumers previously reading
-- from a separate client_engagements table now read these five columns
-- directly off partner_attributions (the resolver at §7.2-D's canonical body
-- reads them all in one SELECT).

ALTER TABLE partner_attributions ADD COLUMN authority_artifact_id TEXT;
ALTER TABLE partner_attributions ADD COLUMN client_authority_scope_json TEXT;
ALTER TABLE partner_attributions ADD COLUMN engagement_letter_effective_at TEXT;
ALTER TABLE partner_attributions ADD COLUMN engagement_letter_expires_at TEXT;
ALTER TABLE partner_attributions ADD COLUMN engagement_letter_revoked_at TEXT;

-- R2 FIX (root fix 6, SHARED-M1 / Opus MAJOR M-b2): pre-flight, fail LOUDLY
-- (not silently) if duplicate active (partner_id, company_id) pairs are
-- present before creating the unique index below. Rationale: when this file
-- runs via `npm run db:migrate`, migrate.ts opens its own better-sqlite3
-- handle and never runs connection.ts's applyInlineMigrations — so the TS
-- self-heal's tie-break (which revokes all-but-the-latest active row per
-- pair) may never have executed on this path. Without this guard,
-- `CREATE UNIQUE INDEX ... WHERE revoked_at IS NULL` would raise exactly
-- `UNIQUE constraint failed: partner_attributions.partner_id,
-- partner_attributions.company_id` on any DB with pre-existing duplicates —
-- an error that `migrate.ts::isIdempotentSqliteError` SWALLOWS (it matches
-- `/UNIQUE constraint failed/i` unconditionally), so the migration would be
-- recorded as applied while the constraint silently never came into being.
--
-- NOTE: `SELECT RAISE(ABORT, ...)` is NOT usable here — SQLite restricts
-- `RAISE()` to trigger bodies only ("RAISE() may only be used within a
-- trigger-program", verified against SQLite 3.50.4 this pass). The actual
-- mechanism below uses a CHECK constraint on a throwaway table instead: the
-- INSERT...SELECT...GROUP BY...HAVING projects one row per duplicate pair
-- with n > 1, and the table's own `CHECK (n <= 1)` makes SQLite reject that
-- row with `CHECK constraint failed: n <= 1` — a message that does NOT match
-- any pattern in `migrate.ts::isIdempotentSqliteError` (verified: that
-- function only swallows `duplicate column name`, `already exists`,
-- `UNIQUE constraint failed`, and `no such table`), so the migration run
-- fails loudly and visibly instead of being silently recorded as applied.
--
-- Defense-in-depth: the TS self-heal wrapper's tie-break has typically
-- already resolved any duplicates by the time an operator runs this file
-- (self-heal runs on every boot, ahead of any manual `db:migrate` invocation
-- in the normal deploy sequence) — in that case this block inserts zero rows
-- and is a pure no-op, leaving `_preflight_check` permanently empty.
CREATE TABLE IF NOT EXISTS _preflight_check (
  check_name  TEXT NOT NULL,
  status      TEXT NOT NULL,
  dim1        TEXT,
  dim2        TEXT,
  n           INTEGER NOT NULL CHECK (n <= 1)
);

INSERT INTO _preflight_check (check_name, status, dim1, dim2, n)
  SELECT 'uq_partner_attributions_active_preflight',
         'DUPLICATE_ACTIVE_PAIRS_PRESENT',
         partner_id, company_id, COUNT(*) as n
    FROM partner_attributions
   WHERE revoked_at IS NULL
   GROUP BY partner_id, company_id
  HAVING COUNT(*) > 1;

-- V32-M2: partial unique index enforcing "one active attribution per (partner, company) pair".
-- The tie-break rule runs BEFORE this index is created (in the TS wrapper's data-fix step);
-- if the pre-flight found >1 active row for any pair, all but the latest attributed_at are
-- administratively revoked with revoked_by='system:c2_migration_0129' and logged to
-- c2_backfill_skip_log, so that this CREATE UNIQUE INDEX cannot itself abort. The RAISE(ABORT)
-- guard immediately above is defense-in-depth for the `npm run db:migrate` path, where the TS
-- wrapper never runs at all.
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_attributions_active
  ON partner_attributions(partner_id, company_id)
  WHERE revoked_at IS NULL;

-- All five columns land OUTSIDE partner_attributions' revision_hash / prev_revision_hash
-- payload — the hash-chain function does not read or write these columns. Plain UPDATEs
-- that mutate the five columns never recompute the hash. This is a documented, permanent
-- carve-out (spec §2.4: "hash-chain payload never includes LOCK-2 columns").
