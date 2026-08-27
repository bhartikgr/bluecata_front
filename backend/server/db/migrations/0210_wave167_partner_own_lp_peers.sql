-- migrations/0210_wave167_partner_own_lp_peers.sql
--
-- WAVE 167 · BATCH 3 ITEM E · R139.1 — `partner_own_lp_peers`, SHIPPING ENABLED.
--
-- WHY THIS ROW EXISTS
-- On live, every recipient search a partner runs returns "No eligible contacts".
-- The two partner audience rules seeded by 0181 are both DISABLED pending an
-- owner ruling, and R139 supplies that ruling for exactly ONE narrow case: a
-- partner may reach THEIR OWN LPs and THEIR OWN team. Nobody else's.
--
-- WHY IT IS A NEW ROW AND NOT A FLIP OF AN EXISTING ONE
-- R139.2 forbids relaxing what is already decided. `partner_engaged_company_people`
-- stays DISABLED (it opens another organisation's people — R108.1), and
-- `partner_team_peers` keeps its own pending-decision state. This rule is ADDITIVE:
-- it grants one audience and takes nothing away, so nothing already ruled on moves.
--
-- WHY `requires_owner_decision = 0`
-- Because the owner HAS decided (R139.1). A rule the owner has ruled on must not
-- render an "awaiting an owner decision" notice, which would misreport a decision
-- as a gap.
--
-- `INSERT OR IGNORE`: re-running this over a database whose owner has since
-- toggled the rule changes nothing. An owner's decision outlives a migration.
INSERT OR IGNORE INTO comms_audience_rules
  (rule_key, applies_to_viewer_role, enabled, requires_owner_decision,
   description, recommended_default, decided_at, decided_by)
VALUES
  ('partner_own_lp_peers', 'partner', 1, 0,
   'A partner may message the LPs of the SPVs their own organisation sponsors, and the other active members of their own partner organisation. It grants no access to another partner''s LPs, another partner''s team, a founder''s cap-table members, or any Collective member the partner has no relationship with.',
   'enabled — the partner cannot administer an SPV they cannot talk to its LPs about',
   datetime('now'), 'owner:R139.1');
