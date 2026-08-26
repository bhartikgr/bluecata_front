-- 0199_wave143_partner_team_peers_enable.sql
-- WAVE 143 · BATCH 1 · ITEM 4. Forward-only (R103).
--
-- WHAT THIS DOES, AND THE ONE THING IT DELIBERATELY DOES NOT DO.
--
-- Migration 0181 seeded SIX rows into `comms_audience_rules`. Four `any`-role
-- rules shipped ENABLED (pre-0181 behaviour, preserved). TWO partner rules
-- shipped `enabled = 0, requires_owner_decision = 1`, awaiting a ruling on who a
-- Consortium Partner may message. The live symptom of that undecided question is
-- a partner with 2/2 active team seats reading "No eligible contacts." in their
-- own DM picker: `partnerTeamPeerIds` is wired, tested and one UPDATE away, and
-- the code is not the thing that is missing.
--
-- THIS MIGRATION ENABLES `partner_team_peers` ONLY.
--
--   `partner_team_peers`  → server/lib/partnerDelegatedContext.ts
--        SELECT user_id FROM partner_team_members
--         WHERE partner_id = ? AND status = 'active' AND removed_at IS NULL
--           AND user_id <> ?
--     The other ACTIVE members of the viewer's OWN partner organisation, on seats
--     that firm already pays for. One tenant, no counterparty, no third-party
--     identity. A removed colleague is excluded by two independent columns.
--
-- `partner_engaged_company_people` (delegatedCompanyPeopleIds) IS LEFT DISABLED,
-- DELIBERATELY, AND THIS IS A CONFIDENTIALITY DECISION — NOT AN OVERSIGHT.
--
--   R107.2 originally enabled BOTH rules, resting entirely on the pre-flight's
--   finding of "no investor identity exposure". R108.1 WITHDREW that: the finding
--   is false. The messaging directory payload returns, for every newly-messageable
--   person, the subject's committed cap-table positions (`capTables`,
--   commsUserDirectory.ts:23), their `location`, and an UNRESOLVED
--   `capavateAngelNetwork` (commsStore.ts:3472-3475). Privacy resolution at
--   commsStore.ts:3450-3478 covers `legalName` and `visibility` ONLY — it does not
--   touch those three fields. `company_members.role` is free TEXT and already
--   holds `co_founder` and `partner_member` in data.db, so a member of a client
--   company may themselves be an investor. Enabling that rule would therefore let
--   a Consortium Partner read a client-company member's private cap-table
--   positions. That is the worst outcome available in this batch and it is
--   FORBIDDEN in this wave.
--
--   Per R108.1 item 2 the rule stays OFF until the directory payload is SCOPED so
--   it cannot carry `capTables`, `location` or an unresolved `capavateAngelNetwork`
--   to a partner. That scoping is its own wave with its own pre-flight, and it is
--   a PREREQUISITE, not a follow-up. Consequence, recorded for the owner (R108.1
--   item 4): partner-to-founder messaging remains UNAVAILABLE after this batch.
--   That is a deliberate choice of a missing feature over a confidentiality
--   breach, and it is reversible the moment the payload is scoped — through the
--   admin panel this wave ships, with no developer and no deploy.
--
-- GUARDS, and why each one is there.
--   · `rule_key = 'partner_team_peers'` — one row, named. The second partner rule
--     cannot be reached by this statement even by accident.
--   · `enabled = 0 AND requires_owner_decision = 1 AND decided_at IS NULL` — this
--     only ever flips a row that is STILL UNDECIDED. If a human has already ruled
--     (in EITHER direction) `decided_at` is set and this migration is a no-op: a
--     migration records a decision, it must never overrule one. That also makes it
--     idempotent — after the first apply `decided_at` is non-NULL, so a second and
--     third run report 0 changes.
--   · Migrations are applied AT BOOT, so a migration cannot be "committed but not
--     applied". Only what is intended to take effect is in this file.
--
-- No money column is touched, so no unit conversion exists here to get wrong.
-- `decided_by` names the owner, not "system": this row is the record that a human
-- ruled, which is why `setAudienceRuleEnabled` writes an actor at all.
UPDATE comms_audience_rules
   SET enabled                 = 1,
       requires_owner_decision = 0,
       decided_at              = '2026-08-25T00:00:00.000Z',
       decided_by              = 'owner:ozan.isinak@gmail.com (R108.1 WAVE 143)',
       updated_at              = '2026-08-25T00:00:00.000Z'
 WHERE rule_key = 'partner_team_peers'
   AND enabled = 0
   AND requires_owner_decision = 1
   AND decided_at IS NULL;
