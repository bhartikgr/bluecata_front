-- v13 — Avi's Issue 3: Rounds DB-backed.
-- The canonical schema is applied at runtime by server/db/connection.ts via
-- buildProductionTableStatements() + applyV12AdditiveAlters(). This file
-- mirrors the canonical statements so drizzle-kit migrate sees them.
--
-- All DDL is additive and idempotent.

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  target_amount REAL NOT NULL,
  raised_amount REAL NOT NULL DEFAULT 0,
  pre_money REAL,
  post_money REAL,
  price_per_share REAL,
  min_ticket REAL,
  close_date TEXT,
  terms_summary TEXT,
  lead_investor TEXT,
  currency TEXT,
  region TEXT,
  open_date TEXT,
  instrument TEXT,
  extras_json TEXT,
  created_at TEXT,
  updated_at TEXT,
  created_by TEXT,
  deleted_at TEXT
);

-- Additive ALTERs for trees that already have a partial rounds table.
-- SQLite raises "duplicate column name" if the column already exists; the
-- connection.ts inline runner swallows that error. drizzle-kit's apply path
-- treats each statement independently so the failures here would block, but
-- this file is consumed only by the runtime applier which tolerates them.

CREATE INDEX IF NOT EXISTS idx_rounds_company ON rounds(company_id);
CREATE INDEX IF NOT EXISTS idx_rounds_tenant  ON rounds(tenant_id);
