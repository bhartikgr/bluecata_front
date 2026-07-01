-- 0071_v25_47_collective_admin_settings.sql
-- v25.47 APD-031 (HIGH-3) — DB-driven collective admin settings.
-- ADDITIVE ONLY: CREATE TABLE IF NOT EXISTS. Mirrors connection.ts
-- applyV2547Schema. Key/value-json single-table config (Tier 3 #27).
CREATE TABLE IF NOT EXISTS collective_admin_settings (
  key         TEXT PRIMARY KEY NOT NULL,
  value_json  TEXT,
  updated_at  TEXT NOT NULL
);
