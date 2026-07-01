/**
 * v25.47 APD-023 — Network post moderation (DB-backed, no in-memory state).
 *
 * Admin moderation acts on the EXISTING network_posts table via its soft-delete
 * column (deleted_at) and writes an immutable audit trail to moderation_log:
 *   - flag   → record-only (post stays visible; flagged for review)
 *   - hide   → sets network_posts.deleted_at (removes from feeds)
 *   - unhide → clears network_posts.deleted_at (restores)
 *
 * No row is ever physically dropped (reversible; no silent drops — Tier 5).
 * Storage: network_posts (existing) + moderation_log (migration 0076 +
 * connection.ts bootstrap).
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";

export type ModerationAction = "flag" | "hide" | "unhide";

export interface ModeratedPost {
  id: string;
  authorUserId: string | null;
  body: string;
  createdAt: string;
  hidden: boolean;
  deletedAt: string | null;
}

export interface ModerationLogEntry {
  id: string;
  postId: string;
  action: string;
  actor: string | null;
  reason: string | null;
  createdAt: string;
}

function rowToPost(r: any): ModeratedPost {
  const deletedAt = r.deleted_at ?? null;
  return {
    id: r.id,
    authorUserId: r.author_user_id ?? null,
    body: r.body ?? "",
    createdAt: r.created_at ?? "",
    hidden: Boolean(deletedAt),
    deletedAt,
  };
}

/** List posts for the admin moderation surface (newest first). includeHidden
 *  defaults true so admins see hidden posts to unhide them. */
export function listPostsForModeration(includeHidden = true): ModeratedPost[] {
  try {
    const where = includeHidden ? "" : "WHERE deleted_at IS NULL";
    const rows: any[] = rawDb()
      .prepare(`SELECT * FROM network_posts ${where} ORDER BY created_at DESC, id DESC`)
      .all();
    return rows.map(rowToPost);
  } catch {
    return [];
  }
}

/** Read one post (any state). Null if absent. */
export function getPostForModeration(postId: string): ModeratedPost | null {
  try {
    const row: any = rawDb()
      .prepare(`SELECT * FROM network_posts WHERE id = ?`)
      .get(postId);
    return row ? rowToPost(row) : null;
  } catch {
    return null;
  }
}

/** Read the moderation log for one post (oldest first). */
export function getModerationLog(postId: string): ModerationLogEntry[] {
  try {
    const rows: any[] = rawDb()
      .prepare(`SELECT * FROM moderation_log WHERE post_id = ? ORDER BY created_at, id`)
      .all(postId);
    return rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      action: r.action,
      actor: r.actor ?? null,
      reason: r.reason ?? null,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export interface ModerateResult {
  post: ModeratedPost;
  action: ModerationAction;
  logEntry: ModerationLogEntry;
}

/**
 * Apply a moderation action to a post. flag is record-only; hide/unhide flip
 * the soft-delete column. Every action appends one moderation_log row. Throws
 * "post_not_found" if the post does not exist.
 */
export function moderatePost(args: {
  postId: string;
  action: ModerationAction;
  actor: string | null;
  reason?: string | null;
}): ModerateResult {
  const post = getPostForModeration(args.postId);
  if (!post) throw new Error("post_not_found");

  const now = new Date().toISOString();
  const db = rawDb();
  if (args.action === "hide") {
    db.prepare(
      `UPDATE network_posts SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, args.postId);
  } else if (args.action === "unhide") {
    db.prepare(
      `UPDATE network_posts SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
    ).run(now, args.postId);
  }
  // flag → no state change.

  const logId = `modlog_${randomUUID()}`;
  const reason =
    typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : null;
  db.prepare(
    `INSERT INTO moderation_log (id, post_id, action, actor, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(logId, args.postId, args.action, args.actor, reason, now);

  const updated = getPostForModeration(args.postId)!;
  return {
    post: updated,
    action: args.action,
    logEntry: {
      id: logId,
      postId: args.postId,
      action: args.action,
      actor: args.actor,
      reason,
      createdAt: now,
    },
  };
}
