-- CP Phase A — Migration 0042: partner_crm_contacts hash columns (CP-008)
--
-- The audit-chain verifier registers partner_crm_contacts but the schema
-- (added in 0038) deliberately omitted prev_hash/curr_hash. This migration
-- adds them so the verifier can verify the chain cleanly.
--
-- Default '' so existing rows backfill safely; the one-time chain stitcher
-- in server/lib/partnerCrmChainStitch.ts replaces those with valid hashes
-- on first boot.

ALTER TABLE partner_crm_contacts ADD COLUMN prev_hash TEXT;
ALTER TABLE partner_crm_contacts ADD COLUMN curr_hash TEXT NOT NULL DEFAULT '';

-- Migration tracker. Used by the chain stitcher and any future one-shot
-- backfills. Keys: 'cp_a_crm_chain_stitch_v1', etc.
CREATE TABLE IF NOT EXISTS _migrations_applied (
  key TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_partner_crm_chain_walk ON partner_crm_contacts(partner_id, created_at, id);
