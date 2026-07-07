-- 0098_v25_52_crm_email_unique_index
-- v25.52.0 Track 3.5.1 — partial UNIQUE email index per CRM. Runs AFTER 0097's
-- dedup backfill (creating a unique index before dedup would fail on live dup
-- rows — the roadmap's explicit sequencing lynchpin). ADDITIVE + IDEMPOTENT.
--
-- Scope key per CRM: founder=company_id, investor=investor_id, partner=partner_id.
-- Index over (scope_id, lower(trim(email))), PARTIAL on:
--     deleted_at IS NULL AND email present AND (dedup_exempt IS NULL OR = 0).
--
-- The `dedup_exempt <> 1` predicate excludes the same-email/different-name
-- conflict rows that 0097 intentionally left live and flagged for manual admin
-- resolution (SQLite prohibits subqueries in partial-index WHERE clauses, so a
-- boolean column set by 0097 is the correct exclusion mechanism). Every OTHER
-- live row is covered, so NO new same-scope/same-email insert can succeed. Once
-- an admin resolves a conflict (collapse to one row + clear dedup_exempt on the
-- survivor), that survivor is naturally covered too.
--
-- IMPORTANT: 0097 MUST have removed every SAFE (same-person) duplicate before
-- this runs, otherwise index creation would collide. The migrate runner would
-- swallow a "UNIQUE constraint failed" as idempotent — so correctness relies on
-- 0097 being complete. The v25.52 test suite proves 0097+0098 produce a truly
-- enforcing index on seeded duplicate data (safe collapse + conflict exemption).
--
-- SQLite supports partial + expression UNIQUE indexes (verified on this engine).
-- Re-running is a no-op (IF NOT EXISTS). Tested against a COPY of live_copy.db.
--
-- FAIL-HARD PRE-ASSERTION (GPT-5.5 blocker #2): the migrate runner
-- (server/db/migrate.ts) swallows "UNIQUE constraint failed" as idempotent, so
-- if 0097 missed any real (non-exempt) duplicate, CREATE UNIQUE INDEX would fail
-- and be SILENTLY skipped — leaving the protective index absent while 0098 is
-- still recorded as applied. To make that impossible, we first ASSERT there are
-- zero non-exempt live duplicates using a temp table with a
-- CHECK (remaining = 0) constraint: inserting a non-zero count raises
-- "CHECK constraint failed", which is NOT in the runner's idempotent-swallow
-- list (duplicate column / already exists / UNIQUE constraint failed), so a
-- leftover duplicate aborts the whole 0098 migration loudly (0098 is NOT
-- recorded applied) instead of shipping a non-enforcing index. This uses ONLY
-- single statements (no BEGIN/END/trigger body) so it is fully compatible with
-- the runner's statement splitter. On a correctly-deduped DB the count is 0 and
-- the assertion passes silently.

DROP TABLE IF EXISTS _crm_dedup_assert_probe;
CREATE TEMP TABLE _crm_dedup_assert_probe (remaining INTEGER CHECK (remaining = 0));

-- Count non-exempt live duplicate (scope, email) groups across all three CRMs.
-- If > 0, the CHECK constraint fails and the migration aborts hard.
INSERT INTO _crm_dedup_assert_probe (remaining)
SELECT COALESCE(SUM(dupe_groups), 0) FROM (
  SELECT COUNT(*) AS dupe_groups FROM (
    SELECT company_id, lower(trim(email)) e
    FROM founder_crm_contacts
    WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
      AND (dedup_exempt IS NULL OR dedup_exempt <> 1)
    GROUP BY company_id, lower(trim(email)) HAVING COUNT(*) > 1
  )
  UNION ALL
  SELECT COUNT(*) FROM (
    SELECT investor_id, lower(trim(email)) e
    FROM investor_crm_contacts
    WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
      AND (dedup_exempt IS NULL OR dedup_exempt <> 1)
    GROUP BY investor_id, lower(trim(email)) HAVING COUNT(*) > 1
  )
  UNION ALL
  SELECT COUNT(*) FROM (
    SELECT partner_id, lower(trim(email)) e
    FROM partner_crm_contacts
    WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
      AND (dedup_exempt IS NULL OR dedup_exempt <> 1)
    GROUP BY partner_id, lower(trim(email)) HAVING COUNT(*) > 1
  )
);

DROP TABLE IF EXISTS _crm_dedup_assert_probe;

-- FOUNDER
CREATE UNIQUE INDEX IF NOT EXISTS uq_founder_crm_email_scope
  ON founder_crm_contacts (company_id, lower(trim(email)))
  WHERE deleted_at IS NULL
    AND email IS NOT NULL
    AND trim(email) <> ''
    AND (dedup_exempt IS NULL OR dedup_exempt <> 1);

-- INVESTOR (SACRED store code untouched; this is a schema-only additive index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_crm_email_scope
  ON investor_crm_contacts (investor_id, lower(trim(email)))
  WHERE deleted_at IS NULL
    AND email IS NOT NULL
    AND trim(email) <> ''
    AND (dedup_exempt IS NULL OR dedup_exempt <> 1);

-- PARTNER
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_scope
  ON partner_crm_contacts (partner_id, lower(trim(email)))
  WHERE deleted_at IS NULL
    AND email IS NOT NULL
    AND trim(email) <> ''
    AND (dedup_exempt IS NULL OR dedup_exempt <> 1);
