-- =============================================================================
-- v25.37 — migration 0055: v25.34 Collective Payment Model.
--
-- WHY THIS FILE EXISTS
-- The v25.34 Collective Payment Model tables (collective_payment_schedules,
-- collective_payment_entries, collective_invoices), their indexes, the
-- idempotency_key column + partial unique index on collective_payment_entries,
-- the re-asserted Collective read-path indexes, and the $0 default
-- payment-schedule seed rows have shipped to date ONLY via the bootstrap path
-- in server/db/connection.ts (applyV2534CollectiveSchema, ~lines 396-532).
-- A fresh DB initialized purely from migrations/0001..0054 would be MISSING
-- the payment-model tables. This file promotes those statements into a
-- numbered migration so a migration-only bootstrap is complete.
--
-- COMPLEMENTARY, NOT A REPLACEMENT
-- The bootstrap path in connection.ts is LEFT UNCHANGED. Both paths use
-- CREATE TABLE/INDEX IF NOT EXISTS and INSERT OR IGNORE, so they are fully
-- idempotent and can both run against the same DB without conflict.
--
-- IDEMPOTENCY_KEY ALTER NOTE
-- collective_payment_entries is CREATE-d (IF NOT EXISTS) in this file before
-- the idempotency_key ALTER, so the ALTER always has a table to attach to even
-- in a pure migration-only run. The migration runner swallows "duplicate
-- column name" on re-run.
--
-- RE-ASSERTED COLLECTIVE READ-PATH INDEXES
-- The 18 idx_v2534_* indexes below target the 7 pre-existing Collective store
-- tables (screening_events, soft_circles, messages, etc.) created by the
-- drizzle base schema / bootstrap. In a pure migration-only run those base
-- tables may not exist yet; the migration runner's isNonFatalIndexError() path
-- logs+skips a CREATE INDEX against a missing table (no such table / no such
-- column) and continues. So these statements are non-fatal hints, exactly as
-- in the bootstrap path which also tolerates the same errors.
--
-- SQL style matches migrations/0050..0053. Mirrors connection.ts EXACTLY.
-- =============================================================================

-- ---- (A) Re-assert Collective read-path indexes (non-fatal if base table
-- ----     absent; the runner skips "no such table/column" for CREATE INDEX) ----
CREATE INDEX IF NOT EXISTS idx_v2534_se_chapter ON screening_events(chapter_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_v2534_se_company ON screening_events(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_v2534_se_round ON screening_events(round_id);
CREATE INDEX IF NOT EXISTS idx_v2534_se_sched ON screening_events(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_v2534_sea_event ON screening_event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_v2534_sc_round ON soft_circles(round_id);
CREATE INDEX IF NOT EXISTS idx_v2534_sc_company ON soft_circles(company_id);
CREATE INDEX IF NOT EXISTS idx_v2534_sc_investor ON soft_circles(investor_user_id);
CREATE INDEX IF NOT EXISTS idx_v2534_msg_chapter ON messages(chapter_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_v2534_msg_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_v2534_msg_channel ON messages(channel_type);
CREATE INDEX IF NOT EXISTS idx_v2534_mt_chapter ON message_threads(chapter_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_v2534_mrr_msg ON message_read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_v2534_ca_chapter ON chapter_announcements(chapter_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_v2534_ar_ann ON announcement_reads(announcement_id);
CREATE INDEX IF NOT EXISTS idx_v2534_rep_company ON reports(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_v2534_rep_tenant ON reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_v2534_cls_lookup ON chapter_leaderboard_snapshots(chapter_id, period, period_start);

-- ---- (B) NEW Collective Payment Model tables (idempotent) ----
CREATE TABLE IF NOT EXISTS collective_payment_schedules (
  id              TEXT PRIMARY KEY NOT NULL,
  scope_kind      TEXT NOT NULL DEFAULT 'platform',
  member_id       TEXT,
  tier            TEXT,
  chapter_id      TEXT,
  fee_kind        TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  cadence         TEXT NOT NULL DEFAULT 'one_time',
  effective_from  TEXT NOT NULL,
  effective_to    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  created_by      TEXT,
  UNIQUE(scope_kind, member_id, tier, chapter_id, fee_kind, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cps_lookup ON collective_payment_schedules(scope_kind, fee_kind, effective_to);
CREATE INDEX IF NOT EXISTS idx_cps_member ON collective_payment_schedules(member_id);
CREATE INDEX IF NOT EXISTS idx_cps_tier ON collective_payment_schedules(tier);
CREATE INDEX IF NOT EXISTS idx_cps_kind ON collective_payment_schedules(fee_kind);

CREATE TABLE IF NOT EXISTS collective_payment_entries (
  id              TEXT PRIMARY KEY NOT NULL,
  tenant_id       TEXT NOT NULL DEFAULT 'tenant_platform',
  member_id       TEXT NOT NULL,
  chapter_id      TEXT,
  entry_kind      TEXT NOT NULL DEFAULT 'membership_dues',
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'pending',
  schedule_id     TEXT,
  invoice_id      TEXT,
  computed_via    TEXT,
  description     TEXT,
  period          TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  paid_at         TEXT,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_cpe_member ON collective_payment_entries(member_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_cpe_kind ON collective_payment_entries(entry_kind);
CREATE INDEX IF NOT EXISTS idx_cpe_status ON collective_payment_entries(status);
CREATE INDEX IF NOT EXISTS idx_cpe_invoice ON collective_payment_entries(invoice_id);

CREATE TABLE IF NOT EXISTS collective_invoices (
  id              TEXT PRIMARY KEY NOT NULL,
  tenant_id       TEXT NOT NULL DEFAULT 'tenant_platform',
  member_id       TEXT NOT NULL,
  chapter_id      TEXT,
  number          TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  total_minor     INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  issued_at       TEXT,
  due_at          TEXT,
  paid_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_cinv_member ON collective_invoices(member_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_cinv_status ON collective_invoices(status);

-- ---- (CONCERN 4) idempotency support for the Collective payment ledger ----
-- Guarded additive ALTER + PARTIAL UNIQUE index (only WHERE idempotency_key IS
-- NOT NULL) prevents duplicate cpe_* rows on retry / double-click while still
-- allowing many NULL-key (non-idempotent) entries. The runner swallows
-- "duplicate column name" on re-run.
ALTER TABLE collective_payment_entries ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpe_idem ON collective_payment_entries(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---- (B) Seed $0 platform-default payment schedules (idempotent) ----
INSERT OR IGNORE INTO collective_payment_schedules
  (id, scope_kind, member_id, tier, chapter_id, fee_kind, amount_minor, currency, cadence, effective_from, created_at, updated_at)
VALUES
  ('cps_def_dues',    'platform', NULL, NULL, NULL, 'membership_dues', 0, 'USD', 'annual',   '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('cps_def_event',   'platform', NULL, NULL, NULL, 'event_fee',       0, 'USD', 'one_time', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('cps_def_sponsor', 'platform', NULL, NULL, NULL, 'sponsorship_fee', 0, 'USD', 'one_time', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('cps_def_chapter', 'platform', NULL, NULL, NULL, 'chapter_dues',    0, 'USD', 'annual',   '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('cps_def_late',    'platform', NULL, NULL, NULL, 'late_fee',        0, 'USD', 'one_time', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z');
