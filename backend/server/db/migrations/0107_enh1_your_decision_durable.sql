-- 0107_enh1_your_decision_durable
-- ENH-1 (v26.1.x WAVE 1) — durable Your-Decision store.
--
-- Migrates the Your-Decision 10-state machine (server/yourDecisionStore.ts) from
-- a RAM-only Map to a durable SQLite/Drizzle table `your_decision_records`.
-- The table becomes the source of truth; the legacy kv_yourDecisionStore mirror
-- (storePersistenceShim) is KEPT this release as a secondary, non-authoritative
-- belt-and-suspenders mirror (retired in a later cleanup wave).
--
-- Columns mirror the DecisionRecord shape:
--   invitation_id   TEXT  — PK / UNIQUE key (one record per invitation)
--   round_id        TEXT  — indexed (per-round soft-circle aggregation)
--   company_id      TEXT
--   state           TEXT  — one of YOUR_DECISION_STATES (10-state machine)
--   amount          REAL  — soft-circle indicated amount (nullable)
--   currency        TEXT  — SUPPORTED_CURRENCIES (nullable)
--   soft_circle_type TEXT — SOFT_CIRCLE_TYPES (nullable)
--   viewed_at       TEXT  — Defect 19 first-view timestamp (nullable)
--   note            TEXT  — free-text note (nullable)
--   history_json    TEXT  — JSON Array<{ts,from,to,action,reason?}>
--   mim_json        TEXT  — JSON Array<{screenName,amountUsd,softCircleType}>
--   actor           TEXT  — last actor userId (nullable)
--   created_at      TEXT
--   updated_at      TEXT
--
-- ADDITIVE + IDEMPOTENT. CREATE TABLE / INDEX IF NOT EXISTS is non-destructive
-- and re-runnable. UNIQUE key on invitation_id (via PRIMARY KEY); INDEX on
-- round_id. Mirrored VERBATIM in both migrations/ and server/db/migrations/,
-- plus the inline applyInlineMigrations() bootstrap (server/db/connection.ts)
-- for :memory: test DBs. No FKs to Avi-owned/money-core tables, so this cannot
-- constrain existing data. NEVER touches Airwallex/payments or the cap-table
-- ledger (captableCommitStore).

CREATE TABLE IF NOT EXISTS your_decision_records (
  invitation_id    TEXT PRIMARY KEY NOT NULL,
  round_id         TEXT NOT NULL,
  company_id       TEXT NOT NULL DEFAULT '',
  state            TEXT NOT NULL,
  amount           REAL,
  currency         TEXT,
  soft_circle_type TEXT,
  viewed_at        TEXT,
  note             TEXT,
  history_json     TEXT NOT NULL DEFAULT '[]',
  mim_json         TEXT NOT NULL DEFAULT '[]',
  actor            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_your_decision_records_round
  ON your_decision_records (round_id);
