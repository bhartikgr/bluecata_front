-- Patch v12 Day 2 Wave 2 — per-round term-sheet revision chain.
-- DB-only store: revisions are written on every save and read on demand
-- by roundId. No in-memory Map.

CREATE TABLE IF NOT EXISTS term_sheet_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  saved_at TEXT NOT NULL,
  saved_by TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  prev_revision_hash TEXT NOT NULL,
  revision_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_term_sheet_revisions_round ON term_sheet_revisions(round_id, revision);
