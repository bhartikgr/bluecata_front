-- 0101_w2h_spv_lp_invite
-- W2-H — Consortium Partner SPV: limited-partner (LP) email invites.
--
-- The SPV Engine had no way for a GP to invite an LP by email; LPs could only
-- appear via existing subscriptions. This introduces a durable, hash-chained
-- side table so a partner-gated LP invitation (email + first/last name)
-- survives restart and can be surfaced next to the live subscription roster on
-- the SPV detail page.
--
-- Rule #13: last_name is MANDATORY (regulatory name capture) → NOT NULL.
--
-- ADDITIVE + IDEMPOTENT. CREATE TABLE / INDEX IF NOT EXISTS is non-destructive
-- and re-runnable. Mirrored VERBATIM in both migrations/ and
-- server/db/migrations/, plus the inline applyInlineMigrations() bootstrap
-- (connection.ts) for :memory: test DBs.

CREATE TABLE IF NOT EXISTS spv_lp_invite (
  id          TEXT PRIMARY KEY NOT NULL,
  tenant_id   TEXT,
  partner_id  TEXT NOT NULL,
  spv_id      TEXT NOT NULL,
  email       TEXT NOT NULL,
  first_name  TEXT,
  last_name   TEXT NOT NULL,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'invited',
  prev_hash   TEXT,
  curr_hash   TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_spv_lp_invite_lookup ON spv_lp_invite(partner_id, spv_id, deleted_at);
