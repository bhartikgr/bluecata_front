-- migrations/0212_wave171_partner_crm_contact_links.sql
--
-- WAVE 171 — A CONTACT CAN NOW BE LINKED TO A VEHICLE OR A PORTFOLIO COMPANY.
--
-- ══ THE DEFECT ══════════════════════════════════════════════════════════════
-- `client/src/pages/partner/PartnerContacts.tsx` has no control to associate a
-- contact with an SPV or a portfolio company. Linkage only ever flowed the other
-- way (the "Add to CRM" action on an LP row). A partner could build a contact
-- list and an SPV and had no way to connect the two.
--
-- ══ WHAT WAS ALREADY THERE, VERIFIED BEFORE BUILDING ════════════════════════
-- The read-only CONNECTIONS panel (`PartnerContacts.tsx:99-105, 530-580`) is
-- real, and `resolveContactConnections`
-- (`server/partnerWorkspaceV19Store.ts:524`) derives it. But every group it
-- shows is derived from a POSITION, not from a relationship:
--   · `spvLpMemberships`  ← `spv_commitments.lp_user_id` — an actual COMMITMENT;
--   · `capTableHoldings`  ← `listMembersForCompany` — an actual HOLDING;
--   · `portfolio`         ← `partner_portfolio` rows matched on the contact's
--                            own `company_id`;
--   · `collectiveMembership`, `client` ← memberships elsewhere.
-- So the panel can only ever show a contact who ALREADY has capital or a seat.
-- There is no representation anywhere for "I know this person in connection
-- with this vehicle". That is the missing thing, and it is a NEW record type,
-- not a missing control over an existing one.
--
-- ══ WHY THIS TABLE HAS NO MONEY COLUMN, AND CANNOT ACQUIRE ONE BY ACCIDENT ══
-- A link is a RELATIONSHIP RECORD. It is not an LP position and it is not
-- capital. The table therefore has NO amount, NO minor unit, NO currency, NO
-- status ladder and NO hash chain. It is structurally incapable of moving a
-- capital figure, a committed total, a cap capacity or a fee band, because there
-- is no column any of those could be read from. That is a stronger guarantee
-- than a rule saying "do not read it as capital", and it is asserted by test.
--
-- ══ KEEPING THREE THINGS DISTINCT (a previous spec conflated them) ══════════
-- This table is a FOURTH, separate concept and it deliberately does not overlap:
--   1. INVITATION state       — `spv_subscription` / the invite ladder;
--   2. COMMITMENT state       — `spv_commitments.status`, `soft_circled` →
--                               `committed` (R131, R135.1/.2);
--   3. SHAREHOLDER ORIGIN     — `shareholder_register.origin`
--                               (`incorporation|existing_captable|direct`, wave 130);
--   4. RELATIONSHIP LINK      — this table.
-- `relationship` here is a free label ABOUT THE PARTNER'S OWN RECORD-KEEPING
-- ('prospective_lp', 'introducer', 'adviser', 'other'). `prospective_lp`
-- deliberately does NOT name any state in ladder 1 or 2, so it can never be
-- mistaken for, or joined to, an invitation or a commitment.
--
-- ══ THE FENCE ═══════════════════════════════════════════════════════════════
-- Enforced in the store, not here: an SPV link requires
-- `spv.sponsor_partner_id = <viewing partner>` (the same fence wave 167's
-- confidentiality suite already proves moves with the SPV, R140.1), and a
-- company link requires the company to be attributed to that partner via
-- `partnerAttributionStore.listByPartner`. `partner_id` is denormalised onto the
-- row so every read is bounded without a join.
--
-- Idempotent: `CREATE TABLE / INDEX IF NOT EXISTS` only. Purely additive — no
-- existing table, column, row or index is touched.

CREATE TABLE IF NOT EXISTS partner_crm_contact_links (
  id            TEXT PRIMARY KEY NOT NULL,
  tenant_id     TEXT NOT NULL,
  -- The owning partner. Denormalised so every read is fenced without a join.
  partner_id    TEXT NOT NULL,
  contact_id    TEXT NOT NULL,
  -- 'spv' | 'company'. What kind of thing the contact is linked to.
  target_kind   TEXT NOT NULL,
  -- `spv.id` when target_kind='spv'; `companies.id` when target_kind='company'.
  target_id     TEXT NOT NULL,
  -- The partner's own note on WHY. Never a subscription or commitment state.
  relationship  TEXT NOT NULL DEFAULT 'other',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  deleted_at    TEXT
);

-- One live link per (contact, kind, target). Partial, so an unlinked-then-
-- relinked contact is a legitimate second row and is not refused.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pccl_contact_target_live
  ON partner_crm_contact_links(contact_id, target_kind, target_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pccl_partner ON partner_crm_contact_links(partner_id);
CREATE INDEX IF NOT EXISTS idx_pccl_contact ON partner_crm_contact_links(contact_id);
CREATE INDEX IF NOT EXISTS idx_pccl_target  ON partner_crm_contact_links(target_kind, target_id);
