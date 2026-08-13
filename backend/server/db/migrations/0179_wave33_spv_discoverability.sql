-- ===========================================================================
-- 0179 — WAVE 33 · CP-SPV-53 — SPV private / invite-only / discoverable
--
-- WHY THIS EXISTS
-- ---------------
-- `spec/PARTNER_BUILT_VS_PROMISED.md` SPV-53 is PARTIAL/P1: "3 scopes live and
-- the publish toggle is wired, but the Collective discovery endpoint is
-- orphaned -> 'discoverable across the Collective network' cannot actually
-- happen."
--
-- Reading the tree confirms that and finds a SECOND, sharper defect the row
-- does not name:
--
--   server/spvEngineStore.ts:478
--       if (scope === "private" || scope === "invite_only") return false;
--
-- `invite_only` is filtered out of EVERY discovery context, for EVERY viewer,
-- including the people who were actually invited. There is a real invite store
-- (`spv_lp_invite`, server/spvLpInviteStore.ts) and a real GP invite route, but
-- nothing anywhere joins an invitation to visibility. So `invite_only` is not a
-- third scope at all: it is a synonym for `private` with a misleading label. A
-- GP who selects it believes they have invited someone to a vehicle that the
-- invitee can never reach.
--
-- WHAT THIS MIGRATION ADDS
-- ------------------------
-- 1. `idx_spv_lp_invite_email` — the lookup this feature performs (an invitee
--    arrives with an email, not a partner_id/spv_id pair, so the existing
--    `idx_spv_lp_invite_lookup` cannot serve it).
--
-- 2. `spv_discovery_event` — a durable, append-only record of every discovery
--    resolution: who asked, in which context, how many vehicles the predicate
--    returned, and whether an invitation was the reason. This is what makes the
--    GP-facing answer to "is my vehicle actually discoverable, and has anyone
--    actually reached it?" DERIVED FROM ROWS rather than asserted from the
--    scope column. The whole point of SPV-53 is that setting a scope was not
--    the same thing as being discoverable; a claim in the UI would repeat that
--    mistake.
--
-- WHAT IS DELIBERATELY NOT HERE
-- -----------------------------
-- No `is_invited` flag on a user, no per-account visibility role, and no copy
-- of the scope enum. Scope follows the POSITION and the INVITATION, both of
-- which are already rows. There is no seed and no default row: an empty
-- `spv_discovery_event` means nobody has reached the vehicle, which is a true
-- and useful statement, and the read path renders it as such rather than
-- inventing reach.
--
-- ADDITIVE ONLY: no DROP, no DELETE, no UPDATE, no column removed.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS spv_discovery_event (
  id            TEXT PRIMARY KEY NOT NULL,
  -- The vehicle that was surfaced. One row per (viewer, vehicle, resolution).
  spv_id        TEXT NOT NULL,
  -- The identity the discovery predicate ran for. NEVER an email: emails are
  -- matched inside the predicate, and persisting one here would place an
  -- invitee's address on a row a GP can read.
  viewer_user_id TEXT NOT NULL,
  -- collective | capavate | network | invited
  context       TEXT NOT NULL,
  -- The vehicle's distribution_scope AT THE MOMENT OF RESOLUTION. Stored
  -- because the scope column is mutable: a vehicle that is private today may
  -- have been discoverable when it was reached, and re-deriving reach from the
  -- current scope would silently rewrite history.
  scope_at_time TEXT NOT NULL,
  -- 1 when the ONLY reason this viewer could see this vehicle was an
  -- invitation. This is the column that distinguishes genuine broadcast reach
  -- from a GP's own invite list, which are commercially different facts.
  via_invitation INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  CHECK (context IN ('collective', 'capavate', 'network', 'invited')),
  CHECK (via_invitation IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_spv_discovery_event_spv
  ON spv_discovery_event(spv_id, created_at);

CREATE INDEX IF NOT EXISTS idx_spv_discovery_event_viewer
  ON spv_discovery_event(viewer_user_id, spv_id);

-- Added LAST, deliberately. This index is the only object in 0179 that touches
-- a table this migration does not own (`spv_lp_invite`, created by 0101 /
-- connection.ts). On a database predating that table the statement fails; by
-- placing it after everything 0179 DOES own, such a failure cannot leave the
-- discovery table half-installed.
CREATE INDEX IF NOT EXISTS idx_spv_lp_invite_email
  ON spv_lp_invite(email, deleted_at);
