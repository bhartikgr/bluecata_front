-- 0104_shadie_v6_invite_resent_at
-- Shadie V6 5b — durable "resent" marker for round invitations.
--
-- When a founder resends a pending invitation (which rotates the token and
-- re-emails a working redeem link), we stamp the moment of the resend so the
-- founder UI can render a durable "resent" chip that survives reloads/restarts.
-- A NULL value means the invite has never been resent.
--
-- ADDITIVE + IDEMPOTENT. `ALTER TABLE ... ADD COLUMN` on a nullable column is
-- non-destructive; re-running raises "duplicate column name", which the migrate
-- runner (server/db/migrate.ts isIdempotentSkip) swallows. This file is mirrored
-- VERBATIM in both migrations/ and server/db/migrations/, plus the inline
-- applyInlineMigrations() alters (connection.ts) for :memory: test DBs.

ALTER TABLE round_invitations ADD COLUMN resent_at TEXT;
