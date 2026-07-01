-- 0070_v25_47_audit_chain_health.sql
-- v25.47 APD-029 (BLOCKER-6) — audit-chain health flag table.
-- ADDITIVE ONLY: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE seed of the
-- single P0 incident row. Mirrors connection.ts applyV2547Schema.
CREATE TABLE IF NOT EXISTS audit_chain_health (
  key         TEXT PRIMARY KEY NOT NULL,
  status      TEXT NOT NULL,
  detail      TEXT,
  updated_at  TEXT NOT NULL
);
INSERT OR IGNORE INTO audit_chain_health (key, status, detail, updated_at)
  VALUES ('tenant_admin_capavate', 'incident',
          'P0 audit-chain continuity investigation (see blocker6_audit_chain_investigation.md)',
          '2026-06-30T00:00:00.000Z');
