/**
 * server/postEngagementStore.ts — w-collective Wave 2 Stage B (B4).
 *
 * THE DEFECT THIS FIXES. Likes, comments and shares lived ONLY on the
 * in-memory `Post` object inside commsStore. `restorePostFromDb` proved it: on
 * hydrate it set `likedByUserIds: []`, `commentCount: 0`, `comments: []`,
 * `shareCount: 0`, because there was nowhere durable to read them from. Every
 * restart of the LIVE server wiped every like, comment and share on every post.
 *
 * This module owns the durable side, against the Stage A tables created by
 * migration 0119 (`network_post_likes`, `network_post_comments`,
 * `network_post_shares`). No new migrations.
 *
 * TWO INVARIANTS THIS MODULE HOLDS:
 *   1. IDEMPOTENCE — a like is one row per (post_id, user_id). The write is
 *      `INSERT OR IGNORE`, so a double-tap or a client retry is a no-op rather
 *      than a UNIQUE-constraint 500.
 *   2. AGGREGATE CONSISTENCY — `network_posts.likes` / `.comments` are still
 *      read by the Collective feed (server/collectiveWaveAStore.ts:443-445), so
 *      they may not drift. After every mutation they are RECOMPUTED from the
 *      rows (not incremented), which makes them self-correcting and safe to
 *      re-run. Soft-deleted comments are excluded from the count.
 *
 * SCOPE NOTE. This module deliberately contains NO authorisation logic. Stage B
 * changes storage durability only; who may see or engage with a post is
 * unchanged and is Stage C's work.
 */
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

export interface DurableComment {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  parentCommentId?: string;
}

export interface PostEngagement {
  likedByUserIds: string[];
  comments: DurableComment[];
  shareCount: number;
}

export type EngagementWriteResult = { ok: true } | { ok: false; error: string };

function fail(where: string, err: unknown): { ok: false; error: string } {
  const msg = (err as Error).message ?? String(err);
  log.warn(`[postEngagementStore.${where}] durable write failed:`, msg);
  return { ok: false, error: msg };
}

/**
 * Recompute the aggregate columns on `network_posts` from the durable rows.
 *
 * Recompute rather than increment: an increment drifts permanently after any
 * single lost write, whereas a recompute converges. Posts with no
 * `network_posts` row (the in-memory demo seed) match zero rows and are left
 * completely untouched — this never writes a fabricated zero over seed data.
 */
export function syncPostAggregates(postId: string): EngagementWriteResult {
  try {
    const db: any = rawDb();
    const likes = (db.prepare(`SELECT COUNT(*) AS c FROM network_post_likes WHERE post_id = ?`).get(postId)?.c ?? 0) as number;
    const comments = (db
      .prepare(`SELECT COUNT(*) AS c FROM network_post_comments WHERE post_id = ? AND deleted_at IS NULL`)
      .get(postId)?.c ?? 0) as number;
    db.prepare(`UPDATE network_posts SET likes = ?, comments = ?, updated_at = ? WHERE id = ?`)
      .run(likes, comments, new Date().toISOString(), postId);
    return { ok: true };
  } catch (err) {
    return fail("syncPostAggregates", err);
  }
}

/** Idempotent per (post, user) — a repeat like is a no-op, never an error. */
export function recordPostLike(postId: string, userId: string, createdAt: string): EngagementWriteResult {
  try {
    rawDb()
      .prepare(`INSERT OR IGNORE INTO network_post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)`)
      .run(postId, userId, createdAt);
  } catch (err) {
    return fail("recordPostLike", err);
  }
  return syncPostAggregates(postId);
}

/** Unlike. Removing a like that is not there is a no-op, not an error. */
export function removePostLike(postId: string, userId: string): EngagementWriteResult {
  try {
    rawDb().prepare(`DELETE FROM network_post_likes WHERE post_id = ? AND user_id = ?`).run(postId, userId);
  } catch (err) {
    return fail("removePostLike", err);
  }
  return syncPostAggregates(postId);
}

/**
 * Persist a comment.
 *
 * `parentCommentId` has no column in the 0119 table and Stage B may not add a
 * migration, so a nested reply's parent link is journaled into the post's
 * existing `network_posts.content_json` under `commentParents`. Only nested
 * replies touch that path; a top-level comment does not read or write it.
 */
export function recordPostComment(c: {
  id: string;
  postId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  parentCommentId?: string;
}): EngagementWriteResult {
  try {
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO network_post_comments (id, post_id, author_user_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.postId, c.authorUserId, c.body, c.createdAt);
  } catch (err) {
    return fail("recordPostComment", err);
  }
  if (c.parentCommentId) recordCommentParent(c.postId, c.id, c.parentCommentId);
  return syncPostAggregates(c.postId);
}

/** Append-only: the same user may share the same post more than once. */
export function recordPostShare(s: {
  id: string;
  postId: string;
  userId: string;
  createdAt: string;
}): EngagementWriteResult {
  try {
    rawDb()
      .prepare(`INSERT OR IGNORE INTO network_post_shares (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)`)
      .run(s.id, s.postId, s.userId, s.createdAt);
    return { ok: true };
  } catch (err) {
    return fail("recordPostShare", err);
  }
}

/**
 * Journal a nested reply's parent link into `network_posts.content_json`.
 * Best-effort: losing it flattens one reply to top-level on the next restart,
 * which is strictly better than losing the comment, so it never fails the write.
 */
function recordCommentParent(postId: string, commentId: string, parentCommentId: string): void {
  try {
    const db: any = rawDb();
    const row: any = db.prepare(`SELECT content_json FROM network_posts WHERE id = ?`).get(postId);
    if (!row) return; // no durable post row (in-memory seed) — nothing to journal onto
    let cj: any = {};
    try { cj = JSON.parse(row.content_json ?? "{}"); } catch { cj = {}; }
    cj.commentParents = { ...(cj.commentParents ?? {}), [commentId]: parentCommentId };
    db.prepare(`UPDATE network_posts SET content_json = ? WHERE id = ?`).run(JSON.stringify(cj), postId);
  } catch (err) {
    log.warn("[postEngagementStore.recordCommentParent] parent link not journaled:", (err as Error).message);
  }
}

/**
 * Read a post's durable engagement back.
 *
 * Soft-deleted comments are excluded (`deleted_at IS NULL`) so a removed
 * comment stays auditable in the table without reappearing in the feed.
 * A missing table or an unavailable DB yields empty engagement rather than
 * throwing, because a hydrate must never abort a boot.
 */
export function loadPostEngagement(
  postId: string,
  commentParents?: Record<string, string>,
): PostEngagement {
  const empty: PostEngagement = { likedByUserIds: [], comments: [], shareCount: 0 };
  try {
    const db: any = rawDb();
    const likeRows: any[] = db
      .prepare(`SELECT user_id FROM network_post_likes WHERE post_id = ? ORDER BY created_at ASC, user_id ASC`)
      .all(postId);
    const commentRows: any[] = db
      .prepare(
        `SELECT id, author_user_id, body, created_at FROM network_post_comments
          WHERE post_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, rowid ASC`,
      )
      .all(postId);
    const shareCount = (db
      .prepare(`SELECT COUNT(*) AS c FROM network_post_shares WHERE post_id = ?`)
      .get(postId)?.c ?? 0) as number;
    return {
      likedByUserIds: likeRows.map((r) => r.user_id as string),
      comments: commentRows.map((r) => ({
        id: r.id as string,
        userId: r.author_user_id as string,
        body: r.body as string,
        createdAt: r.created_at as string,
        parentCommentId: commentParents?.[r.id as string],
      })),
      shareCount,
    };
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[postEngagementStore.loadPostEngagement] read failed:", msg);
    }
    return empty;
  }
}
