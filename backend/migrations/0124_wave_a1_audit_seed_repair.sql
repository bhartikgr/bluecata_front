-- 0124_wave_a1_audit_seed_repair.sql
-- Wave A-1 v2 (ADR-3 actions 3 + 4) — chain_genesis re-base + seed flip.
-- ADDITIVE + IDEMPOTENT. Preserves all historical rows (append-only).
--
-- Genesis contract (v2.1):
--   anchor_row_id = the LAST pre-genesis row per tenant (max by created_at,id
--                   among rows with prev_hash IS NULL).
--   anchor_hash   = that row's hash.
--   Verifier walks EVERY row AFTER anchor_row_id, seeding prior=anchor_hash.
--   Works for both scenarios:
--     (a) Tenant has only malformed rows → 0 post-genesis rows, ok=true.
--     (b) Tenant has malformed + valid successors → successors chain from
--         anchor_hash by construction (writer tip-read returned anchor).

CREATE TABLE IF NOT EXISTS audit_chain_genesis (
  tenant_id      TEXT PRIMARY KEY NOT NULL,
  anchor_row_id  TEXT NOT NULL,
  anchor_hash    TEXT NOT NULL,
  effective_at   TEXT NOT NULL
                   CHECK (effective_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  reason         TEXT NOT NULL,
  created_at     TEXT NOT NULL
                   CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

-- Install a genesis for every tenant that has at least one malformed row.
-- Uses a correlated subquery to pick the LAST malformed row per tenant.
-- Idempotent: INSERT OR IGNORE.
INSERT OR IGNORE INTO audit_chain_genesis (tenant_id, anchor_row_id, anchor_hash, effective_at, reason, created_at)
SELECT DISTINCT
  outer_al.tenant_id,
  (SELECT r.id FROM audit_log r
    WHERE r.tenant_id = outer_al.tenant_id
      AND r.prev_hash IS NULL
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 1) AS anchor_row_id,
  (SELECT r.hash FROM audit_log r
    WHERE r.tenant_id = outer_al.tenant_id
      AND r.prev_hash IS NULL
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 1) AS anchor_hash,
  '2026-08-02T00:00:00.000Z' AS effective_at,
  'Wave A-1 v2.1 (ADR-3 action 3): re-base after scripts/create_admin.ts malformed pre-genesis rows.' AS reason,
  '2026-08-02T00:00:00.000Z' AS created_at
FROM audit_log outer_al
WHERE outer_al.prev_hash IS NULL;

-- Flip incident → ok for tenant_admin_capavate ONLY when a genesis exists.
-- Boot verifier tick handles other tenants and edge cases.
UPDATE audit_chain_health
   SET status = 'ok',
       detail = 'chain_genesis re-base applied per Wave A-1 v2.1 (ADR-3 action 4). Boot verifier tick will re-check.',
       updated_at = '2026-08-02T00:00:00.000Z'
 WHERE key = 'tenant_admin_capavate'
   AND status = 'incident'
   AND EXISTS (
     SELECT 1 FROM audit_chain_genesis g WHERE g.tenant_id = 'tenant_admin_capavate'
   );

-- Rollback (manual):
--   UPDATE audit_chain_health SET status = 'incident' WHERE key = 'tenant_admin_capavate';
--   DELETE FROM audit_chain_genesis WHERE tenant_id = 'tenant_admin_capavate';
