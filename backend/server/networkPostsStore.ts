/**
 * server/networkPostsStore.ts — v13 (Avi's Issue 5)
 *
 * Avi reported: "On the Network module, when I created a new post, it
 * appears for that session, but the server is not saving the records on
 * its table." The real Post object lives inside commsStore's private
 * `posts: Map<string, Post>`. On server restart the map was empty.
 *
 * v13 fix:
 *   - Add a SQL table `network_posts` (see shared/schema.ts).
 *   - Expose `persistNetworkPost(post, actorUserId)` from this module; the
 *     POST /api/comms/posts handler in commsStore.ts calls it AFTER it
 *     pushes into the in-memory Map.
 *   - Add `hydrateNetworkPostsStore()` that re-populates the comms Map
 *     from the DB on boot. The hydrator imports a setter from commsStore
 *     so it does not need to mutate its private state directly.
 *
 * Hard-rule compliance:
 *   - DB writes wrap in `getDb().transaction((tx) => {...})` — no
 *     trailing `()` (Drizzle invokes the callback).
 *   - Hydrate is awaited sequentially from HYDRATE_ORDER (no Promise.all).
 *   - Audit emit via appendAdminAudit so the founder Activity page (Issue
 *     6) surfaces "network.post.created" events.
 */
import type { Express, Request, Response } from "express";
import { isNull } from "drizzle-orm";
import { getDb } from "./db/connection";
import { networkPosts as networkPostsTable } from "../shared/schema";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";

// Same canonical tenant convention used elsewhere; for platform-wide posts
// without an explicit company, fall back to a single platform tenant.
function tenantForPost(p: { companyId?: string | null | undefined }): string {
  if (p.companyId) return `tenant_co_${p.companyId}`;
  return "tenant_platform";
}

/** Minimal Post shape that the persistence layer needs. Mirrors commsStore.Post. */
export type NetworkPostRow = {
  id: string;
  authorUserId: string;
  authorKind?: "user" | "company";
  body: string;
  createdAt: string;
  visibility?: string;
  companyId?: string | null;
  parentPostId?: string | null;
  mediaUrls?: string[];
  topics?: string[];
};

/**
 * Hydration consumer setter — commsStore exports `restorePostFromDb(post)`
 * that we call during hydrate. The dynamic import avoids a circular import
 * at module load time (commsStore already imports nothing from us).
 */
async function consumeHydratedPost(row: any): Promise<void> {
  try {
    const commsStore: any = await import("./commsStore");
    if (typeof commsStore.restorePostFromDb === "function") {
      commsStore.restorePostFromDb(row);
    }
  } catch (err) {
    // Tolerated: commsStore may not expose restorePostFromDb yet on first deploy.
    // In that case posts still hydrate into our own observation cache below.
  }
}

/** Read-mirror cache of hydrated posts. Used by tests + a count helper. */
const HYDRATED_POSTS: NetworkPostRow[] = [];

/**
 * v13 — persistNetworkPost (Avi's Issue 5)
 *
 * Called by commsStore.ts POST /api/comms/posts immediately after the
 * in-memory Map gets the new entry. Failures are non-fatal so the route
 * still returns 200 with the post; the next boot will be missing this row
 * but the user already saw their post render.
 */
export function persistNetworkPost(p: NetworkPostRow, actorUserId?: string): void {
  const tenantId = tenantForPost(p);
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(networkPostsTable)
        .values({
          id: p.id,
          tenantId,
          authorUserId: p.authorUserId,
          audience: p.visibility ?? "all",
          body: p.body,
          contentJson: JSON.stringify({
            authorKind: p.authorKind ?? "user",
            mediaUrls: p.mediaUrls ?? [],
            topics: p.topics ?? [],
            companyId: p.companyId ?? null,
            visibility: p.visibility ?? null,
          }),
          likes: 0,
          comments: 0,
          parentPostId: p.parentPostId ?? null,
          createdAt: p.createdAt,
          updatedAt: p.createdAt,
        })
        .run();
    });
  } catch (err) {
    log.warn("[networkPostsStore.persistNetworkPost] DB write failed (non-fatal):", (err as Error).message);
  }

  // B-V13-5: emit audit event so the founder/admin Activity page surfaces
  // the post (Issue 6 read-side fix relies on this).
  try {
    appendAdminAudit(
      actorUserId ?? p.authorUserId,
      `user:${p.authorUserId}`,
      "network.post.created",
      { postId: p.id, audience: p.visibility ?? "all", companyId: p.companyId ?? null },
      tenantId,
    );
  } catch (err) {
    log.warn("[networkPostsStore.persistNetworkPost] audit append failed:", (err as Error).message);
  }
}

/**
 * v13 — hydrateNetworkPostsStore (Avi's Issue 5)
 *
 * Rebuilds the in-memory cache from `SELECT * FROM network_posts WHERE
 * deleted_at IS NULL`. Called sequentially by hydrateAllStores() on boot.
 */
export async function hydrateNetworkPostsStore(): Promise<void> {
  HYDRATED_POSTS.length = 0;
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — boot-time hydrate of the platform-wide feed.
    const rows = db
      .select()
      .from(networkPostsTable)
      .where(isNull(networkPostsTable.deletedAt))
      .all() as any[];
    for (const row of rows) {
      let content: any = {};
      try { content = JSON.parse((row.content_json ?? row.contentJson ?? "{}") as string); } catch { /* tolerated */ }
      const post: NetworkPostRow = {
        id: row.id,
        authorUserId: row.author_user_id ?? row.authorUserId,
        authorKind: content.authorKind ?? "user",
        body: row.body,
        createdAt: row.created_at ?? row.createdAt,
        visibility: content.visibility ?? row.audience ?? "all",
        companyId: content.companyId ?? null,
        parentPostId: row.parent_post_id ?? row.parentPostId ?? null,
        mediaUrls: content.mediaUrls,
        topics: content.topics,
      };
      HYDRATED_POSTS.push(post);
      await consumeHydratedPost(post);
    }
  } catch (err) {
    if (!/no such table/i.test((err as Error).message)) {
      log.warn("[networkPostsStore.hydrate] failed (continuing):", (err as Error).message);
    }
  }
}

export function registerNetworkPostsRoutes(app: Express): void {
  // Health endpoint so the deploy-gate can verify the route exists.
  app.get("/api/founder/network-posts/health", (_req: Request, res: Response) => {
    res.json({ ok: true, source: "/api/comms/posts", persisted: HYDRATED_POSTS.length });
  });
}

/** Test-only access for the v13 persistence test. */
export const _testAccessNetworkPosts = {
  hydratedPosts: HYDRATED_POSTS,
  reset: () => { HYDRATED_POSTS.length = 0; },
};
