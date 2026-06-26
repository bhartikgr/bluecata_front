-- =============================================================================
-- v25.45 — migration 0062: Workspace archive + 8-year retention + revival (F20).
--
-- WHY THIS FILE EXISTS
-- F20 turns the founder "Delete" tab into a compliance-grade archive flow:
-- "Delete" archives (it does not destroy data); archived workspaces are
-- read-only; the founder can self-serve revive by resubscribing within an
-- 8-year regulatory retention window. These four additive NULLABLE columns
-- back that flow. The inline DDL in server/db/connection.ts (applyV12Additive
-- Alters) also adds them so existing servers converge; this is the canonical,
-- reversible migration.
--
-- COLUMNS
--   archived_at TIMESTAMP NULL          — when the founder requested archive
--   archive_retention_until DATE NULL   — archived_at + 8 years
--   archive_status TEXT NULL DEFAULT 'active'
--                                       — 'active' | 'archived'
--                                         | 'permanent_deletion_requested'
--   last_active_plan TEXT NULL          — plan captured on archive, used to
--                                         pre-select the tier on revival
--
-- IDEMPOTENCY
-- The migration runner treats "duplicate column name" as an idempotent skip,
-- so this runs cleanly on a DB that already received the inline-DDL columns.
--
-- ROLLBACK — see migrations/ROLLBACK_v25_45.md:
--   ALTER TABLE companies DROP COLUMN archived_at;
--   ALTER TABLE companies DROP COLUMN archive_retention_until;
--   ALTER TABLE companies DROP COLUMN archive_status;
--   ALTER TABLE companies DROP COLUMN last_active_plan;
-- =============================================================================

ALTER TABLE companies ADD COLUMN archived_at TEXT;
ALTER TABLE companies ADD COLUMN archive_retention_until TEXT;
ALTER TABLE companies ADD COLUMN archive_status TEXT DEFAULT 'active';
ALTER TABLE companies ADD COLUMN last_active_plan TEXT;
