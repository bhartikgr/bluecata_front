-- 0111_collective_subscription_config.sql
-- W4 (2026-07-14) — Collective dynamic subscription-package admin CRUD.
--
-- Additive + idempotent + mirrored (server/db/migrations/0111_*.sql) + self-healed
-- in server/db/connection.ts. Does NOT seed live packages (empty DB falls back to
-- env/static COLLECTIVE_TIER_CATALOG via GET /api/collective/membership/tiers).
-- Independent of Capavate pricing + Consortium fee tables. Touches NO payment/Airwallex
-- code (rule #14). NOTE: spec text said 0110 — renumbered to 0111 (0110 = W2 captable_exempt,
-- 0112 = W-SAFE); this is the next free id.

CREATE TABLE IF NOT EXISTS collective_subscription_configs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  entitlements_json TEXT NOT NULL DEFAULT '[]',

  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  interval TEXT NOT NULL DEFAULT 'annual',

  airwallex_tier TEXT NOT NULL,
  airwallex_price_id TEXT NOT NULL,

  membership_role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'draft',

  sort_order INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT,
  effective_to TEXT,

  version INTEGER NOT NULL DEFAULT 1,
  prev_revision_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  revision_hash TEXT NOT NULL DEFAULT '',

  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_csc_status_sort ON collective_subscription_configs(status, sort_order, label);
CREATE INDEX IF NOT EXISTS idx_csc_slug ON collective_subscription_configs(slug);
CREATE INDEX IF NOT EXISTS idx_csc_airwallex_tier ON collective_subscription_configs(airwallex_tier);
CREATE INDEX IF NOT EXISTS idx_csc_price_id ON collective_subscription_configs(airwallex_price_id);
CREATE INDEX IF NOT EXISTS idx_csc_effective_window ON collective_subscription_configs(status, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS collective_subscription_config_history (
  history_id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  prev_revision_hash TEXT NOT NULL,
  revision_hash TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT,
  change_kind TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_csch_config_version ON collective_subscription_config_history(config_id, version);
CREATE INDEX IF NOT EXISTS idx_csch_changed_at ON collective_subscription_config_history(changed_at);
