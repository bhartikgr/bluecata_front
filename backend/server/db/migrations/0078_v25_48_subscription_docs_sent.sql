-- 0078_v25_48_subscription_docs_sent.sql
-- v25.48 B3 — persisted per-round/per-investor "subscription docs sent" flag.
-- ADDITIVE ONLY: new table + indexes. Mirrors connection.ts applyV2548Schema.
-- Re-runnable: CREATE TABLE/INDEX IF NOT EXISTS are idempotent; the migration
-- runner's applied-tracker skips already-applied files. PARALLEL to the Sacred
-- cap-table ledger — this flag is founder-workflow metadata only and never
-- moves the cap table.
CREATE TABLE IF NOT EXISTS subscription_docs_sent (
  id              TEXT PRIMARY KEY NOT NULL,
  round_id        TEXT NOT NULL,
  investor_id     TEXT NOT NULL,
  company_id      TEXT,
  sent_at         TEXT NOT NULL,
  sent_by_user_id TEXT,
  note            TEXT,
  UNIQUE (round_id, investor_id)
);
CREATE INDEX IF NOT EXISTS idx_sub_docs_sent_round ON subscription_docs_sent (round_id);
CREATE INDEX IF NOT EXISTS idx_sub_docs_sent_investor ON subscription_docs_sent (investor_id);
