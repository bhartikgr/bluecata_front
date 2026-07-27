-- 0114_partner_attributions.sql
-- w-partner (2026-07-25) — promote partner attributions from the schemaless
-- kv_partnerAttributions blob to a typed, hash-chained table.
--
-- Additive + idempotent + mirrored (server/db/migrations/0114_*.sql) + self-healed
-- in server/db/connection.ts. Touches NO sacred store, NO money core, NO Airwallex.
--
-- DDL-ONLY BY DESIGN. The kv->typed backfill is a guarded TypeScript boot step
-- (backfillPartnerAttributionsFromKv, partnerWorkspaceStore.ts) — NOT SQL here.
-- Reasons: (a) kv_partnerAttributions is created lazily on first write
--   (storePersistenceShim.ts:60-81) so it is ABSENT on fresh DBs and in CI; an
--   INSERT...SELECT against it raises "no such table", which migrate.ts does NOT
--   swallow (isIdempotentSqliteError, :203-210 — only CREATE INDEX gets the
--   no-such-table pass at :218-227) and boot would fail.
-- (b) json_extract (SQLite) vs ::jsonb->> (Postgres) cannot both live in one
--   byte-identical mirrored file.
--
-- attribution_source CHECK: safe here because the table is NEW (no pre-existing
-- row can violate it) and every writer is in-union — the admin route validates
-- `source` against the union before create() (partnerRoutes.ts), and the
-- TypeScript backfill COERCES any unrecognised historical value to
-- 'admin_manual' (logging the row id) rather than inserting it. A SQL backfill
-- would have risked aborting the migration on revenue-bearing data; this one
-- cannot, because no off-union value ever reaches the INSERT.

CREATE TABLE IF NOT EXISTS partner_attributions (
  id                 TEXT PRIMARY KEY NOT NULL,
  partner_id         TEXT NOT NULL,
  company_id         TEXT NOT NULL,
  attributed_at      TEXT NOT NULL,
  attributed_by      TEXT,
  attribution_source TEXT NOT NULL
    CHECK (attribution_source IN ('admin_manual', 'referral_code', 'partner_claim', 'partner_portfolio')),
  revoked_at         TEXT,
  revoked_by         TEXT,
  notes              TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  prev_revision_hash TEXT,
  revision_hash      TEXT,
  updated_at         TEXT NOT NULL,
  updated_by         TEXT,
  is_seed            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pattr_partner ON partner_attributions(partner_id);
CREATE INDEX IF NOT EXISTS idx_pattr_partner_company ON partner_attributions(partner_id, company_id);

-- Companion history table, symmetric with contact_revisions. pushHistory writes
-- partnerAttributionsHistory to kv with NO hydrator reading it back, so
-- verifyChain is vacuous after restart. Since this wave already promotes
-- attributions to a typed hash-chained table, promote the chain too.
CREATE TABLE IF NOT EXISTS partner_attribution_revisions (
  id                 TEXT PRIMARY KEY NOT NULL,   -- `${attributionId}::v${version}`
  attribution_id     TEXT NOT NULL,
  partner_id         TEXT NOT NULL,
  company_id         TEXT NOT NULL,
  version            INTEGER NOT NULL,
  prev_revision_hash TEXT,
  revision_hash      TEXT NOT NULL,
  payload_json       TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  recorded_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_pattr_rev_attribution ON partner_attribution_revisions(attribution_id, version);
CREATE INDEX IF NOT EXISTS idx_pattr_rev_partner ON partner_attribution_revisions(partner_id);
