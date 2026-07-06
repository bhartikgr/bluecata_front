-- 0090_v25_50_partner_team_member_contact
-- v25.50.0 Phase 7 (spec 7c): editable contact info for Consortium Partner team
-- members (mobile, contact email override, title/position note). NEW, non-sacred,
-- CP-scoped wrapper table keyed by (partner_id, user_id). It NEVER edits the
-- sacred users / profile stores — the canonical name/email JOIN still reads
-- `users`; this table only holds partner-workspace-local overrides that a
-- managing_partner may edit. Additive + idempotent: CREATE TABLE IF NOT EXISTS
-- is a no-op once the table exists.
CREATE TABLE IF NOT EXISTS partner_team_member_contact (
  id             TEXT PRIMARY KEY,
  partner_id     TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  mobile         TEXT,
  contact_email  TEXT,
  position_note  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT
);

-- One contact row per (partner_id, user_id). Uniqueness is enforced in the store
-- on write (upsert); this index accelerates the canonical lookup path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_team_member_contact_key
  ON partner_team_member_contact (partner_id, user_id);
