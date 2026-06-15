-- v17 Phase A — Backfill chapter_id on existing Collective slice rows.
--
-- The brief specifies that all existing v16 demo rows backfill to
-- `chap_keiretsu_canada` (since the v16 seed used `tenant_cp_keiretsu_ca`).
-- This is the chapter Maya/Aisha/Daniel default-belong-to for continuity.
--
-- Each UPDATE is guarded with `WHERE chapter_id IS NULL` so re-runs are
-- safe no-ops. The chapter row itself is seeded by server/lib/seedDemoData.ts
-- on ENABLE_DEMO_SEED=1 — but we also INSERT OR IGNORE it here so the
-- backfill is self-contained for non-demo deployments that nonetheless
-- have legacy Collective rows.

INSERT OR IGNORE INTO tenants (id, kind, name, billing_email, status, is_demo, created_at, updated_at, deleted_at)
VALUES (
  'tenant_chap_chap_keiretsu_canada',
  'consortium_partner',
  'Capavate Collective — Keiretsu Forum Canada',
  NULL,
  'active',
  0,
  datetime('now'),
  NULL,
  NULL
);

INSERT OR IGNORE INTO chapters (
  id, tenant_id, name, region, city, status,
  admin_user_id, partner_org_id, membership_fee_annual_minor,
  founded, created_at, updated_at, deleted_at
) VALUES (
  'chap_keiretsu_canada',
  'tenant_chap_chap_keiretsu_canada',
  'Capavate Collective — Keiretsu Forum Canada',
  'NA-East',
  'Toronto',
  'active',
  NULL,
  'tenant_cp_keiretsu_ca',
  0,
  NULL,
  datetime('now'),
  NULL,
  NULL
);

UPDATE collective_waitlist SET chapter_id = 'chap_keiretsu_canada' WHERE chapter_id IS NULL;
UPDATE dsc_feedback        SET chapter_id = 'chap_keiretsu_canada' WHERE chapter_id IS NULL;
UPDATE dsc_votes           SET chapter_id = 'chap_keiretsu_canada' WHERE chapter_id IS NULL;
UPDATE soft_circles        SET chapter_id = 'chap_keiretsu_canada' WHERE chapter_id IS NULL;
