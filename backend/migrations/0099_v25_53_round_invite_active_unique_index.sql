-- 0099_v25_53_round_invite_active_unique_index
-- v25.53 REVISE B3 (6a) — race-safe duplicate-invite guard.
--
-- The application-level guard (roundInvitationsStore.hasActiveInvitation) is a
-- SELECT-before-INSERT with no transaction, so two concurrent invite requests
-- for the same (round_id, normalized email) can both pass the SELECT and both
-- insert an active invitation. This migration makes the constraint
-- DB-authoritative via a PARTIAL + EXPRESSION UNIQUE index on ACTIVE invites:
--   uniqueness over (round_id, lower(trim(investor_email)))
--   WHERE state IN ('pending','sent','viewed','accepted') AND deleted_at IS NULL
--
-- Revoked / expired / declined / soft-deleted invites are OUTSIDE the partial
-- predicate, so an investor whose prior invite lapsed is legitimately
-- re-invitable — matching the app-level ACTIVE_INVITE_STATES semantics.
--
-- ADDITIVE + IDEMPOTENT. SQLite supports partial + expression UNIQUE indexes
-- (lower()/trim() and a WHERE clause), verified on this engine. Re-running is a
-- no-op via IF NOT EXISTS. Tested against a COPY of preview/live_copy.db.
--
-- FAIL-HARD PRE-ASSERTION (mirrors 0098's pattern): the migrate runner
-- (server/db/migrate.ts) swallows "UNIQUE constraint failed" as idempotent, so
-- if live data already held an active duplicate, CREATE UNIQUE INDEX would fail
-- and be SILENTLY skipped — leaving the protective index absent while 0099 is
-- still recorded as applied. To make that impossible we first ASSERT there are
-- zero active-duplicate (round_id, email) groups using a TEMP table whose
-- CHECK (remaining = 0) constraint raises "CHECK constraint failed" on a
-- non-zero count. CHECK-constraint failures are NOT in the runner's
-- idempotent-swallow list (duplicate column / already exists / UNIQUE
-- constraint failed), so a leftover duplicate aborts 0099 loudly (0099 is NOT
-- recorded applied) instead of shipping a non-enforcing index. Uses ONLY single
-- statements (no BEGIN/END/trigger body) so it is compatible with the runner's
-- statement splitter. On a clean DB the count is 0 and the assertion is silent.

DROP TABLE IF EXISTS _round_invite_dup_assert_probe;
CREATE TEMP TABLE _round_invite_dup_assert_probe (remaining INTEGER CHECK (remaining = 0));

INSERT INTO _round_invite_dup_assert_probe (remaining)
SELECT COUNT(*) FROM (
  SELECT round_id, lower(trim(investor_email)) e
  FROM round_invitations
  WHERE state IN ('pending','sent','viewed','accepted')
    AND deleted_at IS NULL
    AND investor_email IS NOT NULL
    AND trim(investor_email) <> ''
  GROUP BY round_id, lower(trim(investor_email))
  HAVING COUNT(*) > 1
);

DROP TABLE IF EXISTS _round_invite_dup_assert_probe;

CREATE UNIQUE INDEX IF NOT EXISTS uq_round_invite_active_email
  ON round_invitations (round_id, lower(trim(investor_email)))
  WHERE state IN ('pending','sent','viewed','accepted')
    AND deleted_at IS NULL
    AND investor_email IS NOT NULL
    AND trim(investor_email) <> '';
