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

-- Wave A-1 v2.2 (per GPT-5 v2.1 B3): the migration does NOT clear
-- audit_chain_health.status. The boot-time verifier tick
-- (runAuditChainBootVerifier in server/lib/hydrateStores.ts) is the SOLE
-- authority for that column post-migration. Rationale: this migration
-- only pins the genesis anchor; it does not verify successor chains.
-- The boot tick runs authoritative verifyTenantAuditChain per tenant and
-- writes 'ok' or 'incident' based on the actual walk result.

-- Rollback (manual):
--   DELETE FROM audit_chain_genesis WHERE tenant_id = 'tenant_admin_capavate';
--   -- (The boot verifier tick will re-arm 'incident' on next boot if broken.)
