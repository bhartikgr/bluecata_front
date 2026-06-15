-- v17 Phase B — partnerWorkspace Collective slice (partner_deal_promotions, hash-chained). Idempotent.

CREATE TABLE IF NOT EXISTS partner_deal_promotions (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT NOT NULL,
  chapter_id        TEXT NOT NULL,
  partner_id        TEXT NOT NULL,
  pipeline_deal_id  TEXT NOT NULL,
  promotion_type    TEXT NOT NULL,
  company_id        TEXT,
  target_email      TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  promoted_by       TEXT NOT NULL,
  promoted_at       TEXT NOT NULL,
  approved_at       TEXT,
  approved_by       TEXT,
  rejected_at       TEXT,
  rejected_by       TEXT,
  rejected_reason   TEXT,
  withdrawn_at      TEXT,
  withdrawn_by      TEXT,
  notes             TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  prev_hash         TEXT,
  hash              TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT NOT NULL,
  is_seed           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  deleted_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_tenant   ON partner_deal_promotions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_chapter  ON partner_deal_promotions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_partner  ON partner_deal_promotions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_pipeline ON partner_deal_promotions(pipeline_deal_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_company  ON partner_deal_promotions(company_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_status   ON partner_deal_promotions(status);
