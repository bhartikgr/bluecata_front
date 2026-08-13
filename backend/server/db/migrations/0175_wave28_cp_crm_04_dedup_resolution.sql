-- 0175_wave28_cp_crm_04_dedup_resolution
-- WAVE 28 ITEM 2 / CP-CRM-04 — give `crm_dedup_review` a resolution outcome.
--
-- 0097 created crm_dedup_review as a manual-resolution queue and then nothing in
-- the tree ever read or wrote it (Wave 9's own inventory records it as
-- "migration DDL only" — 0159_wave9_reporting_audit.sql:360). 0097's header
-- states the intended contract in prose:
--
--     "When an admin later resolves the conflict, they clear dedup_exempt on the
--      surviving row; the index then naturally covers it."
--
-- The table as shipped cannot record HOW a conflict was resolved, only THAT it
-- was (`status`). That distinction is load-bearing, because the two outcomes are
-- opposites:
--
--   • 'merged'   — the rows really were one person. One survivor stays live, the
--                  losers are soft-deleted, and dedup_exempt is CLEARED on the
--                  survivor so 0098's partial UNIQUE index covers it again.
--   • 'distinct' — a genuine shared inbox (ops@, founders@). The rows are
--                  DIFFERENT people and must BOTH stay live and BOTH stay
--                  dedup_exempt=1 forever, or 0098's index would reject them.
--
-- Without `resolution` a re-scan cannot tell a settled shared inbox from a
-- conflict nobody has looked at yet, so it would re-queue every 'distinct' group
-- on every scan — an admin queue that can never reach zero. `resolution` is what
-- makes detection idempotent.
--
-- ADDITIVE + IDEMPOTENT. Three nullable columns and one index. No row is
-- rewritten, no existing column changes type or nullability, and rows written by
-- 0097 keep working: resolution IS NULL simply means "not yet resolved", which is
-- exactly what status='open' already says. Nothing in the money, cap-table or
-- hash-chain surface is touched.

-- Which outcome was chosen: 'merged' | 'distinct'. NULL while status='open'.
ALTER TABLE crm_dedup_review ADD COLUMN resolution TEXT;

-- For 'merged', the contact id that was kept live. NULL for 'distinct' (nothing
-- was kept in preference to anything else) and NULL while open.
ALTER TABLE crm_dedup_review ADD COLUMN survivor_id TEXT;

-- Free-text reason from the resolving admin. Optional. Rendered in the queue so a
-- later reader can see WHY 'distinct' was chosen rather than re-litigating it.
ALTER TABLE crm_dedup_review ADD COLUMN resolution_note TEXT;

-- The queue is read status-first, scope-second (the admin page filters that way,
-- and detection asks "is there already a settled 'distinct' verdict for this
-- key?"). uq_crm_dedup_review_key from 0097 only covers OPEN rows, so it cannot
-- serve the resolved-row lookup that detection depends on.
CREATE INDEX IF NOT EXISTS idx_crm_dedup_review_status_scope
  ON crm_dedup_review (status, crm_scope, scope_id, email_norm);
