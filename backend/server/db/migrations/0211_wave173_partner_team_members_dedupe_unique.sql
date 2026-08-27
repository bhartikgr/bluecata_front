-- migrations/0211_wave173_partner_team_members_dedupe_unique.sql
--
-- WAVE 173 · ITEM 1 — SIX DUPLICATE `partner_team_members` ROWS, AND THE
-- MISSING CONSTRAINT THAT LET THEM ACCUMULATE. (R135.8, deferred until now.)
--
-- ══ WHAT IS WRONG ═══════════════════════════════════════════════════════════
-- On live, ONE member — the partner themself — holds SIX active
-- `partner_team_members` rows. R135.8 accepted tolerating this inside batch 3
-- ("a data migration touching team membership while also changing the messaging
-- rule that reads it would confuse two failure modes") and filed it separately,
-- "with the missing uniqueness constraint noted as the underlying cause".
--
-- ══ THE UNDERLYING CAUSE, VERIFIED IN SOURCE ════════════════════════════════
-- `server/partnerWorkspaceStore.ts:557` upserts with `ON CONFLICT(id)`, and the
-- callers mint a FRESH `newId("ptm")` each time. The natural key
-- (partner_id, user_id) has NO unique index — `server/db/connection.ts:5090`
-- creates only `idx_ptm_partner`, `idx_ptm_user` and `idx_ptm_status`, all
-- non-unique. So every re-seed / re-bootstrap of the same membership inserts a
-- TWIN instead of updating the original. Six invocations, six rows.
--
-- ══ WHY THE DUPLICATES ARE ARCHIVED AND NOT SILENTLY DROPPED ════════════════
-- The owner's standing preference is "I'd rather add than delete". Six rows are
-- six copies of ONE fact, so retaining all six is not retained functionality —
-- but the bytes are still evidence of how this happened. The doomed rows are
-- therefore COPIED VERBATIM into a durable archive table FIRST, and only then
-- removed from the live table. Nothing is lost and the constraint becomes
-- installable.
--
-- ══ WHICH ROW SURVIVES, AND WHY IT IS DETERMINISTIC ═════════════════════════
-- The EARLIEST `joined_at`, tie-broken by the lowest `id`. Earliest wins because
-- the first row is the one that records when the membership actually began; a
-- later twin would restate a real join date as a later one. The `id` tie-break
-- means the outcome does not depend on row order, so a re-run or a different
-- SQLite build cannot pick a different survivor.
--
-- ══ WHAT THIS DELIBERATELY DOES NOT CHANGE ══════════════════════════════════
-- The DISTINCT set of (partner_id, user_id) active memberships is IDENTICAL
-- before and after: exactly one row per pair survives, still `status='active'`,
-- still `removed_at IS NULL`. Every reader filters on `status = 'active'` and
-- projects `user_id` or `partner_id`
-- (`server/lib/partnerDelegatedContext.ts:56` and `:192`,
-- `server/lib/delegatedAgency.ts:130` and `:204`,
-- `server/lib/requirePartnerAuth.ts`), so no audience, no permission and no
-- confidentiality decision moves. Wave 167's suite (groups C1-C4) reads exactly
-- those rows and must stay 37/37 with no assertion touched.
--
-- NO MONEY COLUMN EXISTS ON THIS TABLE. This migration cannot move a capital
-- figure, a committed total, a cap capacity or a fee band.
--
-- ══ THE CONSTRAINT IS PARTIAL, ON PURPOSE ═══════════════════════════════════
-- `WHERE status = 'active' AND removed_at IS NULL`. A member who is removed and
-- later re-added is a legitimate second row, and a FULL unique index would
-- refuse that real case. Only CONCURRENT active duplicates are forbidden.
--
-- ══ IDEMPOTENT ══════════════════════════════════════════════════════════════
-- Re-running is a no-op: `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE` on a
-- primary key, and a DELETE whose subquery finds nothing once one row per pair
-- remains. `CREATE UNIQUE INDEX IF NOT EXISTS`. Proven on a COPY of the live
-- database in `build_log/wave173/W173_DEDUPE_IDEMPOTENCE.txt`.

-- 1) Durable archive. Nothing is deleted before it is preserved.
CREATE TABLE IF NOT EXISTS partner_team_members_dedupe_archive_0211 (
  id          TEXT PRIMARY KEY NOT NULL,
  partner_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  sub_role    TEXT NOT NULL,
  status      TEXT NOT NULL,
  joined_at   TEXT NOT NULL,
  removed_at  TEXT,
  created_by  TEXT NOT NULL,
  is_seed     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  archived_by TEXT NOT NULL,
  survivor_id TEXT NOT NULL
);

-- 2) Preserve every row that is about to go, together with the id of the row
--    that survives in its place, so the collapse is fully reconstructable.
INSERT OR IGNORE INTO partner_team_members_dedupe_archive_0211
  (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by,
   is_seed, updated_at, archived_at, archived_by, survivor_id)
SELECT d.id, d.partner_id, d.user_id, d.sub_role, d.status, d.joined_at,
       d.removed_at, d.created_by, d.is_seed, d.updated_at,
       datetime('now'), 'migration:0211_wave173', s.survivor_id
FROM partner_team_members d
JOIN (
  SELECT partner_id, user_id, MIN(joined_at || '#' || id) AS k,
         (SELECT id FROM partner_team_members x
           WHERE x.partner_id = t.partner_id AND x.user_id = t.user_id
             AND x.status = 'active' AND x.removed_at IS NULL
           ORDER BY x.joined_at ASC, x.id ASC LIMIT 1) AS survivor_id
  FROM partner_team_members t
  WHERE t.status = 'active' AND t.removed_at IS NULL
  GROUP BY partner_id, user_id
  HAVING COUNT(*) > 1
) s ON s.partner_id = d.partner_id AND s.user_id = d.user_id
WHERE d.status = 'active' AND d.removed_at IS NULL
  AND d.id <> s.survivor_id;

-- 3) Collapse each duplicate group to its single deterministic survivor.
DELETE FROM partner_team_members
WHERE id IN (
  SELECT d.id
  FROM partner_team_members d
  WHERE d.status = 'active' AND d.removed_at IS NULL
    AND d.id <> (
      SELECT x.id FROM partner_team_members x
      WHERE x.partner_id = d.partner_id AND x.user_id = d.user_id
        AND x.status = 'active' AND x.removed_at IS NULL
      ORDER BY x.joined_at ASC, x.id ASC LIMIT 1
    )
);

-- 4) The constraint that makes recurrence impossible.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptm_partner_user_active
  ON partner_team_members(partner_id, user_id)
  WHERE status = 'active' AND removed_at IS NULL;
