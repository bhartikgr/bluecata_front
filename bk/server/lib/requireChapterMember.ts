/**
 * v17 Phase A — requireChapterMember middleware.
 *
 * Pairs with `requireCollectiveMember` to enforce chapter-scoped access.
 * The caller MUST already be a Collective member (so this middleware can be
 * chained: `requireAuth, requireCollectiveMember, requireChapterMember(...)`)
 * but the chapter check is the load-bearing isolation: a Toronto-chapter
 * member must not be able to read NYC-chapter rows.
 *
 * Pattern matches `requireCollectiveMember.ts` exactly:
 *   - identity comes from `req.userContext.userId`
 *   - admins (ctx.isAdmin) bypass for moderation purposes
 *   - the actual check is a single DB read against `chapter_memberships`
 *
 * Two factory shapes, both supported:
 *
 *   1) Factory form (chapter id is a closure):
 *      app.get("/api/collective/dealroom/toronto",
 *        requireAuth, requireCollectiveMember, requireChapterMember("chap_toronto"),
 *        handler);
 *
 *   2) Dynamic form (chapter id comes from req.params/query/body — explicit):
 *      app.get("/api/collective/dealroom/:chapterId",
 *        requireAuth, requireCollectiveMember,
 *        requireChapterMemberFromRequest((req) => String(req.params.chapterId)),
 *        handler);
 *
 * Failure modes:
 *   - No identity                                 → 401 { error: "missing_identity" }
 *   - Caller is not a member of the chapter       → 403 { error: "not_chapter_member" }
 *   - chapter_id missing/empty in dynamic form    → 400 { error: "missing_chapter_id" }
 *
 * Closes audit finding F-coll-X4 (chapter isolation) from the Phase-8
 * COLLECTIVE_AUDIT.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import { chapterMemberships } from "../../shared/schema";
import { log } from "./logger";

type V14Ctx = {
  userId?: string;
  isAdmin?: boolean;
  identity?: { email?: string };
};

/**
 * Internal — does the caller hold an active membership row in the given chapter?
 *
 * Note: this query is intentionally CROSS-TENANT — chapter membership is the
 * very thing that determines tenant scoping for the rest of the request.
 * (Same pattern as user_prefs lookup in withTenant.getCurrentTenantId.)
 */
function isActiveChapterMember(userId: string, chapterId: string): boolean {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — justified because chapter_memberships is the
    // table that establishes the active chapter scope; it cannot itself be
    // tenant-scoped without chicken-and-egg.
    const rows = db
      .select({ id: chapterMemberships.id, status: chapterMemberships.status })
      .from(chapterMemberships)
      .where(
        and(
          eq(chapterMemberships.userId, userId),
          eq(chapterMemberships.chapterId, chapterId),
          isNull(chapterMemberships.deletedAt),
        ),
      )
      .limit(1)
      .all();
    const row = rows[0];
    return !!row && row.status === "active";
  } catch (err) {
    // chapter_memberships not yet migrated, or DB issue. Don't crash —
    // fail closed (treat as non-member) so the route returns 403.
    log.warn(
      "[requireChapterMember] read failed:",
      (err as Error).message,
    );
    return false;
  }
}

/**
 * Factory form: chapter id is fixed at registration time.
 *
 * Returns an Express middleware that asserts the caller has an active
 * membership row for the given chapter.
 */
export function requireChapterMember(chapterId: string): RequestHandler {
  return function requireChapterMemberMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ctx = (req as Request & { userContext?: V14Ctx }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      res.status(401).json({ ok: false, error: "missing_identity" });
      return;
    }
    // Admins bypass — they need read access for moderation. Matches
    // requireCollectiveMember's admin bypass exactly.
    if (ctx?.isAdmin) {
      next();
      return;
    }
    if (!chapterId || chapterId.length === 0) {
      res.status(400).json({ ok: false, error: "missing_chapter_id" });
      return;
    }
    if (isActiveChapterMember(userId, chapterId)) {
      next();
      return;
    }
    res.status(403).json({ ok: false, error: "not_chapter_member" });
  };
}

/**
 * Dynamic form: chapter id is resolved per-request by a caller-supplied
 * function. Use this when the chapter id comes from a route param, query
 * string, or request body.
 *
 *   requireChapterMemberFromRequest((req) => String(req.params.chapterId))
 *
 * Returns an Express middleware with the same failure modes as the factory
 * form, plus a 400 if the resolver returns an empty string.
 */
export function requireChapterMemberFromRequest(
  resolveChapterId: (req: Request) => string | undefined,
): RequestHandler {
  return function requireChapterMemberDynamicMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ctx = (req as Request & { userContext?: V14Ctx }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      res.status(401).json({ ok: false, error: "missing_identity" });
      return;
    }
    if (ctx?.isAdmin) {
      next();
      return;
    }
    const chapterId = resolveChapterId(req);
    if (!chapterId || chapterId.length === 0) {
      res.status(400).json({ ok: false, error: "missing_chapter_id" });
      return;
    }
    if (isActiveChapterMember(userId, chapterId)) {
      next();
      return;
    }
    res.status(403).json({ ok: false, error: "not_chapter_member" });
  };
}

/**
 * v18 Phase D — chapter-admin check.
 *
 * A user is a chapter admin if their `chapter_memberships` row for the
 * chapter has `role='admin'` AND `status='active'` (i.e. the same active
 * predicate as `isActiveChapterMember`). Platform admins (ctx.isAdmin)
 * also pass this gate — they need write access for global moderation.
 *
 * Note: CROSS-TENANT read — chapter_memberships is the row that scopes
 * tenant access for the rest of the request, so it cannot itself be
 * tenant-scoped without chicken-and-egg.
 */
function isActiveChapterAdmin(userId: string, chapterId: string): boolean {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — see comment on isActiveChapterMember.
    const rows = db
      .select({
        id: chapterMemberships.id,
        status: chapterMemberships.status,
        role: chapterMemberships.role,
      })
      .from(chapterMemberships)
      .where(
        and(
          eq(chapterMemberships.userId, userId),
          eq(chapterMemberships.chapterId, chapterId),
          isNull(chapterMemberships.deletedAt),
        ),
      )
      .limit(1)
      .all();
    const row = rows[0];
    return !!row && row.status === "active" && row.role === "admin";
  } catch (err) {
    log.warn(
      "[requireChapterAdmin] read failed:",
      (err as Error).message,
    );
    return false;
  }
}

/**
 * Factory form: chapter id is fixed at registration time.
 *
 * Returns an Express middleware that asserts the caller is either a
 * platform admin (`ctx.isAdmin`) OR has a chapter membership row with
 * `role='admin'` and `status='active'` for the given chapter.
 */
export function requireChapterAdmin(chapterId: string): RequestHandler {
  return function requireChapterAdminMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ctx = (req as Request & { userContext?: V14Ctx }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      res.status(401).json({ ok: false, error: "missing_identity" });
      return;
    }
    // Platform admin bypass — same pattern as requireChapterMember.
    if (ctx?.isAdmin) {
      next();
      return;
    }
    if (!chapterId || chapterId.length === 0) {
      res.status(400).json({ ok: false, error: "missing_chapter_id" });
      return;
    }
    if (isActiveChapterAdmin(userId, chapterId)) {
      next();
      return;
    }
    res.status(403).json({ ok: false, error: "not_chapter_admin" });
  };
}

/**
 * Dynamic form for chapter-admin: chapter id resolved per-request.
 */
export function requireChapterAdminFromRequest(
  resolveChapterId: (req: Request) => string | undefined,
): RequestHandler {
  return function requireChapterAdminDynamicMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ctx = (req as Request & { userContext?: V14Ctx }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      res.status(401).json({ ok: false, error: "missing_identity" });
      return;
    }
    if (ctx?.isAdmin) {
      next();
      return;
    }
    const chapterId = resolveChapterId(req);
    if (!chapterId || chapterId.length === 0) {
      res.status(400).json({ ok: false, error: "missing_chapter_id" });
      return;
    }
    if (isActiveChapterAdmin(userId, chapterId)) {
      next();
      return;
    }
    res.status(403).json({ ok: false, error: "not_chapter_admin" });
  };
}

/**
 * Test-only export so unit tests can probe the underlying check without
 * spinning up an Express request. Not part of the public API.
 */
export const _internal = Object.freeze({
  isActiveChapterMember,
  isActiveChapterAdmin,
});

export default requireChapterMember;
