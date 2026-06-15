-- CP Phase A — Migration 0043: partner_deal_pipeline.legacy_id (CP-019)
--
-- For forensic backfill of legacy in-memory pipeline rows migrated on
-- startup. NULL for all DB-native rows.

ALTER TABLE partner_deal_pipeline ADD COLUMN legacy_id TEXT;

CREATE INDEX IF NOT EXISTS idx_partner_deal_legacy ON partner_deal_pipeline(legacy_id);
