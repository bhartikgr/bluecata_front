-- 0096_v25_52_collective_member_access_backfill
-- v25.52.0 Track 3.0 — Collective member-access HOTFIX (C-1 + C-2) backfill.
--
-- Context (see server/adminCollectiveRoutes.ts approve handler + build map):
--   C-1: NO route ever called joinChapter, so members approved BEFORE v25.52
--        have ZERO chapter_memberships rows. Every chapter-scoped Collective
--        read (getListedCompanyIdsForChapters) fail-closes on an empty chapter
--        set, so those members see the whole Collective as empty / locked.
--   C-2: the directory-enrollment write stamped chapter=NULL, and the directory
--        read filters `WHERE chapter IN (member's chapters)`, so already-approved
--        companies with a NULL chapter are invisible to every member.
--
-- This migration is ADDITIVE + IDEMPOTENT and NEVER edits sacred cap-table /
-- money / hash-chain data. It only:
--   (1) places existing ACTIVE collective members into a chapter membership row
--       (using their collective_memberships.chapter_id when present, else the
--        platform default chapter), and
--   (2) backfills any NULL-chapter directory listing to the default chapter.
--
-- Re-running is a no-op: INSERT OR IGNORE respects the unique
-- (chapter_id, user_id) index; the UPDATE only touches rows still NULL/'' .
-- Tested against a COPY of live_copy.db (never the original).

-- (1) C-1 backfill — one active chapter membership per active collective member.
--     Prefer the member's own collective_memberships.chapter_id; fall back to the
--     platform default chapter (chap_keiretsu_canada) when it is missing/blank.
INSERT OR IGNORE INTO chapter_memberships
  (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at)
SELECT
  -- v25.52 (Opus review fix): the PK id MUST be collision-free. An earlier
  -- draft truncated user_id/chapter_id to 24 chars each, which collided for
  -- distinct members whose ids shared a 24-char prefix (e.g. same-millisecond
  -- signup ids), silently dropping the loser under INSERT OR IGNORE and leaving
  -- that member chapter-less — the exact C-1 lockout this migration cures. We
  -- now build the id from the FULL user_id + FULL chapter_id (the column is
  -- unbounded TEXT). Meaningful uniqueness is still enforced by
  -- uq_chapter_memberships_chapter_user (chapter_id, user_id).
  'chmem_bf_' || cm.user_id || '_' ||
    COALESCE(NULLIF(cm.chapter_id, ''), 'chap_keiretsu_canada'),
  COALESCE(
    (SELECT c.tenant_id FROM chapters c
       WHERE c.id = COALESCE(NULLIF(cm.chapter_id, ''), 'chap_keiretsu_canada')
       LIMIT 1),
    'tenant_chap_chap_keiretsu_canada'
  ),
  COALESCE(NULLIF(cm.chapter_id, ''), 'chap_keiretsu_canada'),
  cm.user_id,
  'member',
  'active',
  COALESCE(cm.activated_at, datetime('now')),
  datetime('now'),
  datetime('now')
FROM collective_memberships cm
WHERE cm.status = 'active'
  AND (cm.deleted_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM chapter_memberships cmem
     WHERE cmem.user_id = cm.user_id
       AND cmem.deleted_at IS NULL
  );

-- (2) C-2 backfill — stamp the default chapter on any directory listing whose
--     chapter is NULL or blank so it becomes visible to that chapter's members.
--     (Listings that already carry a real chapter are left untouched.)
UPDATE collective_directory_listings
   SET chapter = 'chap_keiretsu_canada'
 WHERE (chapter IS NULL OR chapter = '')
   AND status = 'listed';
