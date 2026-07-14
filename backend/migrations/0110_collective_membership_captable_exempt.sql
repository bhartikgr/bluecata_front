-- 0110_collective_membership_captable_exempt
-- Wave 2 (v26.2.0-w2) A3/A4 — durable explanation for admin-pushed ("bootstrapped")
-- Collective members who bypass cap-table vetting. Additive + idempotent.
-- NOTE: renumbered from the spec's 0109 to 0110 because Wave 1 (H6) already
-- consumed 0109 (collective_membership_deactivation_queue). MIRRORED byte-for-byte
-- in server/db/migrations/0110_collective_membership_captable_exempt.sql.
-- SQLite ALTER TABLE ADD COLUMN has no IF NOT EXISTS; idempotency relies on the
-- runner/self-heal swallowing duplicate-column errors (see connection.ts).
ALTER TABLE collective_memberships
  ADD COLUMN cap_table_exempt INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_collective_memberships_cap_table_exempt
  ON collective_memberships(cap_table_exempt);
