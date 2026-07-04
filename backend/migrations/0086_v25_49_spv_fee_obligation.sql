-- 0086_v25_49_spv_fee_obligation.sql
-- v25.49 Phase-4C / Blocker 3 — money-movement-safe SPV fee timing.
--
-- ADDITIVE ONLY, idempotent (CREATE TABLE / INDEX IF NOT EXISTS). A fee
-- OBLIGATION is a concrete money-movement row, distinct from the fee CONFIG in
-- `spv_fee`. FIXED portions of fixed/hybrid management & platform fees are
-- accrued AT FUNDING and MUST be paid (via the existing payment ledger) or
-- explicitly admin-waived before an SPV can commit a subscription or open a
-- deployment money path. CARRY portions of carry/hybrid fees are accrued AT
-- DISTRIBUTION and collected with a recorded payment ref (fail-closed on a
-- collection failure). Mirrors connection.ts buildProductionTableStatements.
CREATE TABLE IF NOT EXISTS spv_fee_obligation (
  id              TEXT PRIMARY KEY NOT NULL,
  spv_id          TEXT NOT NULL,
  layer           TEXT NOT NULL,                 -- management | platform
  portion         TEXT NOT NULL,                 -- fixed | carry
  timing          TEXT NOT NULL,                 -- funding | distribution
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  state           TEXT NOT NULL DEFAULT 'pending', -- pending | paid | waived | failed
  payment_ref     TEXT,
  distribution_id TEXT,
  waived_by       TEXT,
  waived_reason   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  prev_hash       TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_fee_obligation_spv ON spv_fee_obligation(spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_fee_obligation_spv_timing ON spv_fee_obligation(spv_id, timing, state);
