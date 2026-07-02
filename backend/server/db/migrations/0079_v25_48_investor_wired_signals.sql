-- 0079_v25_48_investor_wired_signals.sql
-- v25.48 B4 — optional investor-initiated "I wired" advisory signal.
-- ADDITIVE ONLY: new table + indexes. Mirrors connection.ts applyV2548Schema.
-- ADVISORY ONLY: this signal is non-binding and does NOT move the cap table.
-- The founder's funds-in-bank confirmation remains the authoritative commit
-- trigger. PARALLEL to the Sacred cap-table ledger.
CREATE TABLE IF NOT EXISTS investor_wired_signals (
  id            TEXT PRIMARY KEY NOT NULL,
  round_id      TEXT NOT NULL,
  investor_id   TEXT NOT NULL,
  company_id    TEXT,
  wired_at      TEXT NOT NULL,
  amount_hint   TEXT,
  currency      TEXT,
  note          TEXT,
  UNIQUE (round_id, investor_id)
);
CREATE INDEX IF NOT EXISTS idx_investor_wired_round ON investor_wired_signals (round_id);
CREATE INDEX IF NOT EXISTS idx_investor_wired_investor ON investor_wired_signals (investor_id);
