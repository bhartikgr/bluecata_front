-- Patch v12 Day 2 Wave 2 — captable_commits (append-only hash-chained ledger)
-- + funded_queue (crash-recoverable in-flight queue).
--
-- Sprint 25 precision: amount + shares are STORED as TEXT (Decimal-as-string
-- and BigInt-as-string respectively). JS floats CANNOT round-trip share
-- counts above 2^53 or money beyond 12 digits of precision; we never coerce.

CREATE TABLE IF NOT EXISTS captable_commits (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  invitation_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  investor_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  shares TEXT NOT NULL,
  state TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  reconcile_primary TEXT,
  reconcile_ref TEXT,
  reconcile_match INTEGER NOT NULL DEFAULT 1,
  compliance_hold INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS funded_queue (
  invitation_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  investor_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  shares TEXT NOT NULL,
  enqueued_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_captable_commits_tenant ON captable_commits(tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_captable_commits_company ON captable_commits(company_id, state);
