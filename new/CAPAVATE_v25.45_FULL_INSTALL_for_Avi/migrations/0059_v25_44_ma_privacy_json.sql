-- =============================================================================
-- v25.44 — migration 0059: M&A Intelligence privacy gate column.
--
-- WHY THIS FILE EXISTS
-- Surface 13 (M&A Intelligence) adds a per-company sharing-consent posture.
-- v25.44 round 1 added this column ONLY via inline DDL in
-- server/db/connection.ts (applyV12AdditiveAlters). GPT-5.5's round-1 review
-- (P5) flagged the absence of a real migration file + rollback path as a
-- blocker. This file is the canonical, reversible migration.
--
-- IDEMPOTENCY
-- The migration runner (server/db/migrate.ts) treats "duplicate column name"
-- (SQLite) / "column already exists" (Postgres) as an idempotent skip, so this
-- ALTER is safe to run on a DB that already received the inline-DDL column.
-- `npm run db:migrate` therefore runs cleanly twice.
--
-- BACKWARDS COMPAT
-- The inline DDL in server/db/connection.ts is intentionally KEPT — some
-- servers may have already applied the column via that path. Both routes are
-- additive and converge on the same column + default.
--
-- DEFAULT — opt-OUT of Collective-wide aggregation:
--   {"shareWithCollective":false,"shareWithChapter":true,
--    "shareWithAdvisors":true,"redactNarrativeFromAggregates":true}
--
-- ROLLBACK
-- See migrations/ROLLBACK_v25_44.md — `ALTER TABLE companies DROP COLUMN
-- ma_privacy_json;`
-- =============================================================================

ALTER TABLE companies
  ADD COLUMN ma_privacy_json TEXT
  DEFAULT '{"shareWithCollective":false,"shareWithChapter":true,"shareWithAdvisors":true,"redactNarrativeFromAggregates":true}';
