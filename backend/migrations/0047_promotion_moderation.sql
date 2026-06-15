-- CP Phase B — partner_deal_promotions moderation columns (CP-015..CP-018).
-- Idempotent ALTERs are wrapped via try/catch in connection.ts applyV12AdditiveAlters().
ALTER TABLE partner_deal_promotions ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE partner_deal_promotions ADD COLUMN moderated_by_user_id TEXT;
ALTER TABLE partner_deal_promotions ADD COLUMN moderated_at TEXT;
ALTER TABLE partner_deal_promotions ADD COLUMN moderation_notes TEXT;

-- One-time backfill: rows that went live via legacy auto-approve path are
-- mapped to moderation_status='approved'. Marker key prevents re-runs.
-- (Executed in code by applyV12Backfill() in connection.ts.)
