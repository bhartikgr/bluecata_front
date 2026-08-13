-- 0176 — WAVE 29 ITEM 2
-- Give `uq_partner_crm_email_parity` the `dedup_exempt` predicate its two
-- sibling indexes have had since 0098.
--
-- THE DEFECT, stated exactly.
--   `partner_crm_contacts` carries TWO partial UNIQUE indexes over the same
--   (partner_id, lower(trim(email))) key:
--
--     uq_partner_crm_email_scope   (0098) WHERE deleted_at IS NULL
--                                    AND email IS NOT NULL AND trim(email) <> ''
--                                    AND (dedup_exempt IS NULL OR dedup_exempt <> 1)
--
--     uq_partner_crm_email_parity  (0106) WHERE email IS NOT NULL
--                                    AND trim(email) <> '' AND deleted_at IS NULL
--                                    -- no dedup_exempt predicate at all
--
--   0097's whole design is that a same-email / different-person conflict is NOT
--   auto-merged. Both rows stay live, both are flagged `dedup_exempt = 1`, and
--   the pair waits in `crm_dedup_review` for an admin. 0098 implements exactly
--   that by excluding exempt rows from its uniqueness constraint (SQLite forbids
--   subqueries in a partial-index WHERE clause, so a boolean column is the
--   correct mechanism — 0097's header says so).
--
--   0106's parity index does not exclude them, and a row must satisfy EVERY
--   index on the table. So the parity index unilaterally vetoes the exemption
--   and partner duplicates are impossible, directly contradicting 0097. Founder
--   and investor CRMs behave as designed; partner alone does not. Wave 28 proved
--   this by execution in case (15) of `wave28_item2_crm_dedup_review.test.ts`
--   and reported it in its section 2.5 without closing it.
--
-- WHY DROP-AND-RECREATE. SQLite has no ALTER INDEX. `CREATE UNIQUE INDEX IF NOT
-- EXISTS` with the corrected predicate is a silent NO-OP wherever the old index
-- already exists — i.e. on every database that has the bug — which is precisely
-- the "check that passes while checking nothing" shape this codebase has now
-- shipped seventeen times. The DROP is mandatory, not stylistic.
--
-- WHY THIS DOES NOT WEAKEN UNIQUENESS. The parity index does not become
-- permissive; it becomes IDENTICAL to `uq_partner_crm_email_scope`. Non-exempt
-- partner duplicates are still refused, by both indexes. The only rows that gain
-- permission are ones an admin has explicitly been asked to adjudicate, which is
-- the 0097 contract. Both poles are asserted in
-- `server/__tests__/wave29_item2_partner_parity_dedup_exempt.test.ts`.
--
-- SAFETY. The DROP cannot lose data (an index is derived). Recreation can only
-- fail if live non-exempt duplicates already exist, and those were impossible to
-- create while the old index stood — so on any database reaching this migration
-- the set is empty by construction. Additive and idempotent: re-running drops
-- and rebuilds an index that is already correct.
--
-- `server/db/connection.ts` is SACRED and its inline baseline at :2161 still
-- creates the OLD definition, so a freshly-baselined database that never runs
-- migrations would reintroduce the defect. That path is covered by the self-heal
-- installer in `server/crmDedupReviewStore.ts`
-- (`ensureCrmDedupReviewSchema`), exactly as Wave 24 handled the mark-override
-- default. This file and that installer emit character-identical DDL.

DROP INDEX IF EXISTS uq_partner_crm_email_parity;

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_parity
  ON partner_crm_contacts (partner_id, lower(trim(email)))
  WHERE email IS NOT NULL
    AND trim(email) <> ''
    AND deleted_at IS NULL
    AND (dedup_exempt IS NULL OR dedup_exempt <> 1);
