-- 0063_v25_45_bugC_round_chain_head_freezes.sql
--
-- v25.45 Bug C (Ozan founder QA wave) — Round Management DB persistence audit.
--
-- ADDITIVE ONLY. Persists the per-round snapshot of the company carry-forward
-- hash-chain head captured at round-close time (server/roundCarryForwardRoutes.ts
-- freezeRoundChainHead). Previously this lived ONLY in an in-memory Map
-- (frozenRoundChainHead), so every closed round lost its frozen audit baseline
-- on a server restart, and a post-restart re-freeze could re-snapshot against a
-- DIFFERENT chain head — corrupting the round-close audit baseline.
--
-- round_id is the PRIMARY KEY: a round can freeze exactly once (the freeze is
-- idempotent). This table does NOT touch the sacred per-company carry-forward
-- hash chain itself, nor the captable_commits ledger — it only durably records
-- the read-only tip snapshot the in-memory Map used to hold.
--
-- No DROP, no destructive ALTER. CREATE TABLE IF NOT EXISTS is safe to re-run.

CREATE TABLE IF NOT EXISTS round_chain_head_freezes (
  round_id   TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  chain_head TEXT NOT NULL,
  frozen_at  TEXT NOT NULL
);
