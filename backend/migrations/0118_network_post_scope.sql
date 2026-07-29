-- 0118_network_post_scope.sql
-- w-collective Wave 2 Stage A (2026-07-28) — re-scopable network posts.
--
-- WHY. network_posts carries only `tenant_id` and `audience`
-- (shared/schema.ts:230-243), and tenant_id is written as `tenant_co_<id>` /
-- `tenant_platform` by tenantForPost (server/networkPostsStore.ts:34-37) — it is
-- a tenancy label, not an audience. So a post that was created into a cap-table
-- or company-followers channel cannot be re-scoped after a restart: the scope
-- lived only in the in-memory channel. These three columns give a restored post
-- a durable scope. Stage A lands the columns and the one-time legacy backfill
-- ONLY; the read-side audience rules are a later stage.
--
-- ⚠️ NO DEFAULT ON `scope`, DELIBERATELY. The column is nullable with NO
-- DEFAULT, so a future post that does not explicitly set a scope gets NULL and
-- must be treated by the read side as the SAFE case (author-only). The
-- permissive 'network' value below is applied ONCE to identified legacy rows and
-- is never a default, a fallback or a helper's implicit value that later data
-- can drift into. Do not add `DEFAULT 'network'` to this column.
--
-- Additive + idempotent + mirrored (server/db/migrations/0118_*.sql) +
-- self-healed in server/db/connection.ts (columns in the network_posts CREATE
-- literal for fresh DBs AND guarded ADD COLUMN entries in
-- applyV12AdditiveAlters for already-deployed DBs — the drizzle table now
-- declares these columns, so hydrateNetworkPostsStore's select would raise
-- "no such column" on any deployed DB that had only the literal half).
--
-- The DATA backfill below is intentionally NOT replicated into the boot-time
-- self-heal in connection.ts: the self-heal runs on every process start
-- (including every :memory: test worker) and must stay schema-only. The
-- backfill belongs to the migration runner, which is invoked once per deploy by
-- the package.json script.

ALTER TABLE network_posts ADD COLUMN scope TEXT;
ALTER TABLE network_posts ADD COLUMN company_id TEXT;
ALTER TABLE network_posts ADD COLUMN chapter_id TEXT;

CREATE INDEX IF NOT EXISTS idx_network_posts_scope ON network_posts(scope, created_at);
CREATE INDEX IF NOT EXISTS idx_network_posts_company ON network_posts(company_id);
CREATE INDEX IF NOT EXISTS idx_network_posts_chapter ON network_posts(chapter_id);

-- ---------------------------------------------------------------------------
-- ONE-TIME, BOUNDED, REVERSIBLE LEGACY BACKFILL — explicit owner decision.
--
-- Justification (recorded as an owner decision, not an inference): every
-- network_posts row that exists at the time this migration ships is test data
-- (~31 rows on the production database), so promoting exactly those rows to
-- scope='network' cannot expose anyone's real content. Without it those rows
-- would sit at scope NULL and, under the safe default, become invisible to
-- everyone — a silent drop of the existing demo feed.
--
-- Three guards make it one-time and bounded:
--   (1) BOUNDED BY VALUE — only rows with `scope IS NULL`.
--   (2) BOUNDED BY TIME  — only rows created at or before the cutoff literal
--       below, which is the migration's authoring instant. It is a hardcoded
--       constant (SQL has no variables and the file must stay byte-identical
--       across both migration folders), so no row created after this migration
--       ships can ever be caught by it, on any database, at any future time.
--   (3) BOUNDED BY MARKER — a durable row in migration_backfill_markers. This
--       is the guard that matters after an UNDO: undoing restores scope to
--       NULL, which would otherwise let guards (1)+(2) re-apply the backfill on
--       the next run. With the marker present the re-run is a true no-op.
--
-- REVERSIBILITY. Prior values of all three columns are journalled per post id in
-- network_post_scope_backfill before the UPDATE. To undo:
--
--   UPDATE network_posts
--      SET scope      = (SELECT b.prior_scope      FROM network_post_scope_backfill b
--                         WHERE b.post_id = network_posts.id AND b.migration_id = '0118'),
--          company_id = (SELECT b.prior_company_id FROM network_post_scope_backfill b
--                         WHERE b.post_id = network_posts.id AND b.migration_id = '0118'),
--          chapter_id = (SELECT b.prior_chapter_id FROM network_post_scope_backfill b
--                         WHERE b.post_id = network_posts.id AND b.migration_id = '0118')
--    WHERE id IN (SELECT post_id FROM network_post_scope_backfill WHERE migration_id = '0118');
--
-- Leave the marker row in place when undoing; deleting it re-arms the backfill.
-- ---------------------------------------------------------------------------

-- Generic, reusable marker table for one-shot data backfills carried by
-- migrations. Keyed by an opaque marker string so future one-shots share it
-- rather than each inventing a bespoke flag.
CREATE TABLE IF NOT EXISTS migration_backfill_markers (
  marker        TEXT PRIMARY KEY NOT NULL,
  applied_at    TEXT NOT NULL,
  rows_affected INTEGER,
  notes         TEXT
);

-- Per-row undo journal. Composite key so a post can appear once per migration.
CREATE TABLE IF NOT EXISTS network_post_scope_backfill (
  post_id          TEXT NOT NULL,
  migration_id     TEXT NOT NULL,
  prior_scope      TEXT,
  prior_company_id TEXT,
  prior_chapter_id TEXT,
  new_scope        TEXT NOT NULL,
  backfilled_at    TEXT NOT NULL,
  PRIMARY KEY (post_id, migration_id)
);

-- Journal the prior values FIRST, so the UPDATE below is undoable.
INSERT OR IGNORE INTO network_post_scope_backfill
  (post_id, migration_id, prior_scope, prior_company_id, prior_chapter_id, new_scope, backfilled_at)
SELECT p.id, '0118', p.scope, p.company_id, p.chapter_id, 'network', '2026-07-28T00:00:00.000Z'
  FROM network_posts p
 WHERE p.scope IS NULL
   AND p.created_at <= '2026-07-28T00:00:00.000Z'
   AND NOT EXISTS (
     SELECT 1 FROM migration_backfill_markers
      WHERE marker = '0118_network_post_scope_legacy'
   );

UPDATE network_posts
   SET scope = 'network'
 WHERE scope IS NULL
   AND created_at <= '2026-07-28T00:00:00.000Z'
   AND id IN (
     SELECT post_id FROM network_post_scope_backfill WHERE migration_id = '0118'
   )
   AND NOT EXISTS (
     SELECT 1 FROM migration_backfill_markers
      WHERE marker = '0118_network_post_scope_legacy'
   );

INSERT OR IGNORE INTO migration_backfill_markers (marker, applied_at, rows_affected, notes)
SELECT '0118_network_post_scope_legacy',
       '2026-07-28T00:00:00.000Z',
       (SELECT COUNT(*) FROM network_post_scope_backfill WHERE migration_id = '0118'),
       'One-time owner decision: pre-0118 network_posts rows (all test data) promoted to scope=network. Undo recipe in migrations/0118_network_post_scope.sql.';
