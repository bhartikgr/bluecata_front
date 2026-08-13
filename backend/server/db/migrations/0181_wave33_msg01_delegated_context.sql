-- WAVE 33 · CP-MSG-01 — partner messaging with delegated context
--
-- TWO tables, for two different problems that were being conflated:
--
--   1. `comms_audience_rules` — WHO MAY BE OFFERED AS A RECIPIENT.
--      `GET /api/comms/users` builds its candidate pool from four hardcoded
--      peer sources (channel co-participants, cap-table peers, chapter peers,
--      follow peers). A Consortium Partner team member is in none of them, so
--      the picker is empty on the partner surface — and the IDENTICAL empty
--      state appears at investor/Messages.tsx and founder/Messages.tsx for any
--      user with no cap-table or chapter relationship yet. It is one SHARED
--      PLATFORM rule, not a partner bug.
--
--      The rules are seeded here EXACTLY as the code behaves today, so
--      installing this migration changes no outcome for anybody. The two
--      partner rules are seeded DISABLED with `requires_owner_decision = 1`,
--      because "who may message whom" for a delegated partner is a COMMERCIAL
--      decision that has not been made. The owner enables them through the
--      admin route with NO CODE CHANGE.
--
--   2. `comms_delegated_context` — ON WHOSE BEHALF a message was sent.
--      A partner team member acting under an ACTIVE `mf_engagement` writes as
--      themselves today, with nothing on the record naming the client company
--      or the engagement that authorised it. That is the plumbing this item
--      builds, and it is INDEPENDENT of decision (1): the stamp is written and
--      rendered whether or not the audience rules are ever enabled.
--
-- Additive only. No existing table is altered and no row is rewritten.

CREATE TABLE IF NOT EXISTS comms_audience_rules (
  rule_key                TEXT PRIMARY KEY NOT NULL,
  -- 'any' or one of founder | investor | partner | admin. The role the rule
  -- applies to as the VIEWER of the picker (never as the target).
  applies_to_viewer_role  TEXT NOT NULL DEFAULT 'any',
  enabled                 INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  -- 1 = the platform owner has not yet ruled on this rule. Surfaced to the UI
  -- so a gap is RENDERED rather than looking like an empty result set.
  requires_owner_decision INTEGER NOT NULL DEFAULT 0 CHECK (requires_owner_decision IN (0, 1)),
  -- Human-readable statement of the rule, rendered in the admin surface.
  description             TEXT NOT NULL DEFAULT '',
  -- The recommendation put to the owner. Advisory text only; it is never
  -- applied automatically, because a recommendation is not a decision.
  recommended_default     TEXT,
  decided_at              TEXT,
  decided_by              TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The FOUR rules that describe today's shipped behaviour, seeded ENABLED so
-- behaviour is unchanged by installing this table. `INSERT OR IGNORE` keeps a
-- re-run and a later owner edit safe.
INSERT OR IGNORE INTO comms_audience_rules
  (rule_key, applies_to_viewer_role, enabled, requires_owner_decision, description, recommended_default)
VALUES
  ('channel_participant', 'any', 1, 0,
   'Users who already share a comms channel with the viewer.', NULL),
  ('cap_table_peer', 'any', 1, 0,
   'Committed holders on a cap table the viewer also holds a committed position on (derived read-only from the sacred captable_commits ledger).', NULL),
  ('chapter_peer', 'any', 1, 0,
   'Users who share at least one ACTIVE Collective chapter with the viewer.', NULL),
  ('follow_peer', 'any', 1, 0,
   'Users connected to the viewer through a durable follow relationship.', NULL);

-- The TWO partner rules. DISABLED and flagged for an owner decision.
INSERT OR IGNORE INTO comms_audience_rules
  (rule_key, applies_to_viewer_role, enabled, requires_owner_decision, description, recommended_default)
VALUES
  ('partner_engaged_company_people', 'partner', 0, 1,
   'A Consortium Partner team member may be offered the active members of any company the partner holds an ACTIVE mf_engagement for.',
   'RECOMMENDED: enable. The engagement is the commercial relationship; a partner who cannot reach their own client company by name has to be given the user id out of band. Scope follows the ENGAGEMENT, so it lapses automatically when the engagement does.'),
  ('partner_team_peers', 'partner', 0, 1,
   'A Consortium Partner team member may be offered the other ACTIVE members of their own partner organisation.',
   'RECOMMENDED: enable. This is intra-organisation only and leaks nothing across tenants.');

-- The delegated-context stamp. One row per stamped channel or message.
CREATE TABLE IF NOT EXISTS comms_delegated_context (
  id             TEXT PRIMARY KEY NOT NULL,
  -- 'channel' | 'message'
  scope          TEXT NOT NULL CHECK (scope IN ('channel', 'message')),
  ref_id         TEXT NOT NULL,
  acting_user_id TEXT NOT NULL,
  partner_id     TEXT NOT NULL,
  company_id     TEXT NOT NULL,
  engagement_id  TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One stamp per (scope, ref). A message's delegated context is a fact about the
-- moment it was sent and is never overwritten by a later engagement change.
CREATE UNIQUE INDEX IF NOT EXISTS ux_comms_delegated_context_ref
  ON comms_delegated_context (scope, ref_id);

CREATE INDEX IF NOT EXISTS ix_comms_delegated_context_partner
  ON comms_delegated_context (partner_id, company_id);
