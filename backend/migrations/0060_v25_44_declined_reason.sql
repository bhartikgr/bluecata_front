-- =============================================================================
-- v25.44 — migration 0060: Surface 11 decline-with-reason column.
--
-- WHY THIS FILE EXISTS
-- Surface 11 (/admin/deal-approvals decline-with-reason) records an optional
-- free-text reason when an admin declines a collective application. v25.44
-- round 1 added this column ONLY via inline DDL in server/db/connection.ts.
-- This file is the canonical, reversible migration (round-2 fix for GPT-5.5 P5).
--
-- TABLE — the canonical collective applications table is `collective_apps`.
--
-- IDEMPOTENCY
-- The migration runner treats "duplicate column name" / "column already exists"
-- as an idempotent skip, so this is safe to run on a DB that already received
-- the inline-DDL column. `npm run db:migrate` runs cleanly twice.
--
-- BACKWARDS COMPAT
-- The inline DDL in server/db/connection.ts is KEPT for servers that already
-- applied the column via that path. Both routes are additive + converge.
--
-- ROLLBACK
-- See migrations/ROLLBACK_v25_44.md — `ALTER TABLE collective_apps DROP COLUMN
-- declined_reason;`
-- =============================================================================

ALTER TABLE collective_apps
  ADD COLUMN declined_reason TEXT;
