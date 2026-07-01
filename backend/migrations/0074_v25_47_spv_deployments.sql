-- 0074_v25_47_spv_deployments.sql
-- v25.47 APD-021 — Consortium SPV deployment ledger.
-- ADDITIVE ONLY: CREATE TABLE IF NOT EXISTS. Mirrors connection.ts
-- applyV2547Schema. spv_id is UNIQUE so recordSpvDeployment is idempotent.
CREATE TABLE IF NOT EXISTS spv_deployments (
  id                   TEXT PRIMARY KEY NOT NULL,
  spv_id               TEXT NOT NULL UNIQUE,
  fee_minor            INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  recorded_at          TEXT NOT NULL,
  recorded_by_user_id  TEXT,
  note                 TEXT
);
