/**
 * W-COLLECTIVE Wave 2 Stage C — RELATIONSHIP-SCOPED AUDIENCE for network posts.
 *
 * WHAT THIS IS. A pure, read-only predicate that answers exactly one question:
 *
 *     "Is `viewerUserId` in the relationship audience of network post `post`?"
 *
 * It is a *widening* term, OR-ed with the existing channel participant gate at
 * the two post READ sites in server/commsStore.ts (feed `GET /api/comms/posts`
 * and detail `GET /api/comms/posts/:id`). It is applied ONLY to channels of
 * kind `"network"`. `cap_table` and `company_followers` posts keep the existing
 * participant gate byte-for-byte — applying a relationship predicate to them
 * would leak round/ownership detail to followers and co-chapter members.
 *
 * ── WHY THIS DOES NOT CALL channelIsVisibleToViewer ─────────────────────────
 * `channelIsVisibleToViewer(ch, viewer, ctx)` BACKFILLS the viewer into
 * `channel.participantUserIds` (commsStore.ts:1295) when a derived membership
 * is found. That is the very array `canMutatePost` (commsStore.ts:1333) checks
 * to authorise likes, comments, reactions and shares. If this predicate reused
 * it, a single feed GET by a read-only relationship viewer would permanently
 * promote them to a WRITER on that channel. So:
 *
 *   - this module NEVER calls it, never takes a `CommsMembershipCtx`, and
 *   - this module NEVER mutates anything. It performs SELECTs only.
 *
 * READ MUST NEVER CONFER WRITE. Enforced by construction here, and asserted in
 * server/__tests__/w2c_network_audience.test.ts by capturing
 * `channel.participantUserIds` before and after both GETs.
 *
 * ── THE SIX ROWS (anything unlisted is FALSE) ───────────────────────────────
 *  1. Self                    — durable `network_posts.author_user_id` = viewer.
 *  2. Cap-table co-member     — SACRED `areCoMembersOnAnyCapTable` (unchanged
 *                               call), i.e. a shared `committed` cap table.
 *  3. Soft-circle counterparty— Wave 1's `areDmCoMembers` (single source; the
 *                               SQL is NOT duplicated here). Accepts
 *                               intent/confirmed/wired/committed; `declined`
 *                               is excluded there, by an exhaustive switch.
 *  4. Company follower        — a live `company_followers` row (Stage A
 *                               migration 0116) for (viewer, a company of the
 *                               post's author), `deleted_at IS NULL`.
 *  5. Shared ACTIVE chapter   — POST-ANCHORED: `network_posts.chapter_id` must
 *                               be set, and BOTH author and viewer must hold an
 *                               active, non-deleted `chapter_memberships` row
 *                               for THAT chapter.
 *  6. Anything else           — FALSE.
 *
 * ── FAIL-CLOSED CONTRACT ────────────────────────────────────────────────────
 *  - Malformed / empty ids                       → FALSE
 *  - No resolvable durable `network_posts` row   → FALSE
 *  - Soft-deleted post row                       → FALSE
 *  - Any DB error, missing table, bad JSON       → FALSE
 * Every row is proven by a DURABLE read. Nothing here consults the in-memory
 * comms maps, the channel object, or any cache. All SQL is parameterised.
 *
 * -- ROW 5 IS LIVE AS OF STAGE D (this header used to say it was inert) -------
 * OUTDATED CLAIM REMOVED. Stage D shipped the production writers:
 * `chapter_memberships` via server/lib/chapterMembershipWriter.ts +
 * server/chapterMembershipRoutes.ts, and `network_posts.chapter_id` via
 * `setPostChapterAnchor`, called from the create handler in
 * server/commsStore.ts. Row 5 DOES fire for any post carrying an anchor whose
 * chapter the viewer also actively belongs to. Because the anchor is REQUIRED,
 * the failure mode is still denial, not exposure.
 * `chapter_memberships` is ALSO the table that gates Airwallex payments and the
 * DSC vote quorum - read the header of chapterMembershipWriter.ts before you
 * write it. Without the post anchor
 * row 5 would degenerate into a platform-wide broadcast, since the platform has
 * a single default chapter that most members belong to.
 *
 * ── SCOPE COLUMN, DELIBERATELY NOT A GATE ───────────────────────────────────
 * `network_posts.scope` (migration 0118) is nullable with no default and is not
 * written by any current writer, so gating on `scope = 'network'` would make
 * this whole predicate vacuous for every post created from now on. The live
 * audience signal used instead is the CALLER's channel kind (`"network"` only).
 * Recorded as residual risk in the Stage C report.
 */
import { rawDb } from "../db/connection";
import { areCoMembersOnAnyCapTable } from "./capTableMembership";
import { areDmCoMembers } from "./dmCoMembership";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Roles on `company_members` that represent the company itself (not a holder). */
const FOUNDER_ROLES = ["founder", "co_founder"] as const;

/** The minimal shape this predicate needs from a caller: just the post id. */
export type NetworkPostAudienceSubject = {
  id?: string | null;
  /** Ignored for authorisation. Present only so callers can pass a Post. */
  authorUserId?: string | null;
};

type DurablePostRow = {
  id: string;
  author_user_id: string | null;
  chapter_id: string | null;
  company_id: string | null;
  content_json: string | null;
};

/**
 * The durable row for a post. Read DIRECTLY off `network_posts` — never from
 * the in-memory `posts` map, whose `authorUserId` is not canonical state.
 * Soft-deleted rows resolve to `undefined` (→ FALSE).
 */
function durablePostRow(postId: string): DurablePostRow | undefined {
  const db: any = rawDb();
  const row = db
    .prepare(
      `SELECT id, author_user_id, chapter_id, company_id, content_json
         FROM network_posts
        WHERE id = ?
          AND deleted_at IS NULL
        LIMIT 1`,
    )
    .get(postId) as DurablePostRow | undefined;
  return row;
}

/**
 * ROW 4 — company ids that count as "the author's company" for follow purposes.
 *
 * Three durable sources, all from rows (never from a cache):
 *   (a) `network_posts.company_id` (Stage A migration 0118 column);
 *   (b) `companyId` inside the same row's `content_json` — this is what the
 *       CURRENT writer (networkPostsStore.persistNetworkPost) actually
 *       populates, so ignoring it would make row 4 inert for every existing
 *       post. Same durable row, so it is not in-memory state;
 *   (c) companies where the author is an ACTIVE founder/co_founder
 *       (`company_members`), which is the plain reading of "the author's
 *       company" for a personal network post that carries no company id.
 * Bad JSON in (b) is swallowed → that source simply contributes nothing.
 */
function authorCompanyIds(row: DurablePostRow, authorUserId: string): string[] {
  const ids = new Set<string>();
  if (isValidId(row.company_id)) ids.add(row.company_id.trim());
  try {
    const parsed = JSON.parse(row.content_json ?? "{}");
    const cid = parsed?.companyId;
    if (isValidId(cid)) ids.add(cid.trim());
  } catch {
    /* unparseable content_json contributes no company — fail closed. */
  }
  const db: any = rawDb();
  const marks = FOUNDER_ROLES.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT DISTINCT company_id
         FROM company_members
        WHERE user_id = ?
          AND role IN (${marks})
          AND is_active = 1
          AND deleted_at IS NULL`,
    )
    .all(authorUserId, ...FOUNDER_ROLES) as Array<{ company_id?: string | null }>;
  for (const r of rows) if (isValidId(r?.company_id)) ids.add(r.company_id.trim());
  return Array.from(ids);
}

/**
 * ROW 4 — TRUE iff `viewerUserId` has a LIVE `company_followers` row for any of
 * the author's companies. An unfollow sets `deleted_at` (migration 0116 keeps
 * one row per (user, company) forever), so `deleted_at IS NULL` is the liveness
 * test and an unfollowed row correctly stops conferring visibility.
 */
function viewerFollowsAuthorCompany(
  row: DurablePostRow,
  authorUserId: string,
  viewerUserId: string,
): boolean {
  const companyIds = authorCompanyIds(row, authorUserId);
  if (companyIds.length === 0) return false;
  const db: any = rawDb();
  const marks = companyIds.map(() => "?").join(",");
  const hit = db
    .prepare(
      `SELECT 1 AS hit
         FROM company_followers
        WHERE user_id = ?
          AND company_id IN (${marks})
          AND deleted_at IS NULL
        LIMIT 1`,
    )
    .get(viewerUserId, ...companyIds) as { hit?: number } | undefined;
  return !!hit?.hit;
}

/**
 * ROW 5 — POST-ANCHORED shared active chapter.
 *
 * FALSE unless the post itself names a chapter. Then BOTH sides must hold an
 * active, non-deleted membership row for exactly that chapter. `status` is
 * `'active' | 'pending' | 'revoked'` (migration 0020) — only `'active'` counts,
 * on both sides.
 */
function sharesActiveChapterAnchoredOnPost(
  row: DurablePostRow,
  authorUserId: string,
  viewerUserId: string,
): boolean {
  const chapterId = row.chapter_id;
  // POST ANCHOR. NULL chapter_id → row 5 is FALSE, never a broadcast.
  if (!isValidId(chapterId)) return false;
  const db: any = rawDb();
  const hit = db
    .prepare(
      `SELECT 1 AS hit
         FROM chapter_memberships a
         JOIN chapter_memberships v
           ON v.chapter_id = a.chapter_id
        WHERE a.chapter_id = ?
          AND a.user_id = ?
          AND a.status = 'active'
          AND a.deleted_at IS NULL
          AND v.user_id = ?
          AND v.status = 'active'
          AND v.deleted_at IS NULL
        LIMIT 1`,
    )
    .get(chapterId.trim(), authorUserId, viewerUserId) as { hit?: number } | undefined;
  return !!hit?.hit;
}

/**
 * Relationship audience predicate for a NETWORK post. Read-only, side-effect
 * free, fail-closed. See the six rows in the module header.
 *
 * This is a WIDENING term only: callers OR it with the existing participant
 * gate, so it can add visible posts but can never remove one.
 */
export function viewerCanSeeNetworkPost(
  post: NetworkPostAudienceSubject | null | undefined,
  viewerUserId: string,
): boolean {
  try {
    const postId = post?.id;
    if (!isValidId(postId) || !isValidId(viewerUserId)) return false;
    const viewer = viewerUserId.trim();

    const row = durablePostRow(postId.trim());
    // No durable row (never persisted, or soft-deleted) → cannot authorise.
    if (!row) return false;

    const author = isValidId(row.author_user_id) ? row.author_user_id.trim() : "";
    // ROW 1 — self, proven by the durable author column.
    if (author && author === viewer) return true;
    if (!author) return false;

    // ROW 2 — SACRED cap-table co-membership, called UNCHANGED.
    if (areCoMembersOnAnyCapTable(author, viewer)) return true;

    // ROW 3 — Wave 1 soft-circle / founder↔holder counterparty predicate.
    // Single source of truth; `declined` is excluded inside it.
    if (areDmCoMembers(author, viewer)) return true;

    // ROW 4 — viewer follows one of the author's companies.
    if (viewerFollowsAuthorCompany(row, author, viewer)) return true;

    // ROW 5 — shared ACTIVE chapter, anchored on the post.
    if (sharesActiveChapterAnchoredOnPost(row, author, viewer)) return true;

    // ROW 6 — anything else.
    return false;
  } catch {
    // Any DB error, missing table or unexpected shape → FALSE (fail closed).
    return false;
  }
}
