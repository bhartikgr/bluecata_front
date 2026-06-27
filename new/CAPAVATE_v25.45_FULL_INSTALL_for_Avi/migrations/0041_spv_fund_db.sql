-- CP Phase A — Migration 0041: SPV / Fund DB migration (CP-028)
--
-- DB-backs SPVs, fund commitments, capital calls, distributions, and
-- positions. Previously held in module-level JS arrays in
-- partnerWorkspaceStore.ts (lines 365-370) — lost on every restart.
--
-- All five tables are hash-chained (prev_hash + curr_hash) — audit-grade
-- append-style writes. Idempotent (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS spvs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lead_company_id TEXT,
  structure_type TEXT NOT NULL DEFAULT 'spv',  -- 'spv' | 'fund' | 'syndicate'
  status TEXT NOT NULL DEFAULT 'forming',      -- 'forming' | 'fundraising' | 'active' | 'wound_down'
  target_minor INTEGER NOT NULL DEFAULT 0,
  committed_minor INTEGER NOT NULL DEFAULT 0,
  called_minor INTEGER NOT NULL DEFAULT 0,
  distributed_minor INTEGER NOT NULL DEFAULT 0,
  gp_user_id TEXT,
  formed_at TEXT,
  closes_at TEXT,
  terms TEXT NOT NULL DEFAULT '{}',           -- JSON (carry, mgmt fee, hurdle)
  prev_hash TEXT,
  curr_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_spvs_tenant     ON spvs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spvs_partner    ON spvs(partner_id);
CREATE INDEX IF NOT EXISTS idx_spvs_status     ON spvs(status);
CREATE INDEX IF NOT EXISTS idx_spvs_lead_co    ON spvs(lead_company_id);
CREATE INDEX IF NOT EXISTS idx_spvs_chain_walk ON spvs(partner_id, created_at, id);

CREATE TABLE IF NOT EXISTS spv_commitments (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  spv_id TEXT NOT NULL,
  lp_user_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'signed' | 'funded' | 'withdrawn'
  commitment_doc_url TEXT,
  signed_at TEXT,
  funded_at TEXT,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_commitments_tenant     ON spv_commitments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spv_commitments_spv        ON spv_commitments(spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_commitments_lp         ON spv_commitments(lp_user_id);
CREATE INDEX IF NOT EXISTS idx_spv_commitments_status     ON spv_commitments(status);
CREATE INDEX IF NOT EXISTS idx_spv_commitments_chain_walk ON spv_commitments(spv_id, created_at, id);

CREATE TABLE IF NOT EXISTS spv_capital_calls (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  spv_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  called_at TEXT NOT NULL,
  due_at TEXT,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_tenant     ON spv_capital_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_spv        ON spv_capital_calls(spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_seq        ON spv_capital_calls(spv_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_chain_walk ON spv_capital_calls(spv_id, created_at, id);

CREATE TABLE IF NOT EXISTS spv_distributions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  spv_id TEXT NOT NULL,
  distribution_type TEXT NOT NULL DEFAULT 'dividend',  -- 'dividend' | 'exit' | 'return_of_capital'
  total_minor INTEGER NOT NULL DEFAULT 0,
  distributed_at TEXT NOT NULL,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_distributions_tenant     ON spv_distributions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spv_distributions_spv        ON spv_distributions(spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_distributions_type       ON spv_distributions(distribution_type);
CREATE INDEX IF NOT EXISTS idx_spv_distributions_chain_walk ON spv_distributions(spv_id, created_at, id);

CREATE TABLE IF NOT EXISTS spv_positions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  spv_id TEXT NOT NULL,
  security_id TEXT NOT NULL,
  shares TEXT NOT NULL DEFAULT '0',           -- TEXT for arbitrary precision
  basis_minor INTEGER NOT NULL DEFAULT 0,
  acquired_at TEXT,
  status TEXT NOT NULL DEFAULT 'held',        -- 'held' | 'partially_sold' | 'exited'
  prev_hash TEXT,
  curr_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_positions_tenant     ON spv_positions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spv_positions_spv        ON spv_positions(spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_positions_security   ON spv_positions(security_id);
CREATE INDEX IF NOT EXISTS idx_spv_positions_status     ON spv_positions(status);
CREATE INDEX IF NOT EXISTS idx_spv_positions_chain_walk ON spv_positions(spv_id, created_at, id);
