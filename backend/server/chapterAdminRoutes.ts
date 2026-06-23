/**
 * v18 Phase D — Chapter-admin management endpoints (platform admin only).
 *
 *   POST   /api/admin/chapters/:chapterId/admins         — promote {user_id}
 *   DELETE /api/admin/chapters/:chapterId/admins/:userId — demote (409 if last)
 *   GET    /api/admin/chapters/:chapterId/admins         — list current admins
 *
 * All three are guarded by `requireAdmin` (platform-admin only). Only the
 * platform admin can move users in and out of the chapter_admin role; a
 * chapter admin cannot promote peers themselves (that would lock the
 * platform out of controlling chapter-admin count).
 *
 * Last-admin safeguard: demoting the only remaining admin of a chapter
 * returns 409 to prevent locking a chapter out of admin-only flows.
 */

import type { Express, Request, Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/connection";
import { chapterMemberships, chapters as chaptersTable } from "@shared/schema";
import { requireAdmin } from "./lib/authMiddleware";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";
import { publish as ssePublish } from "./lib/sseHub"; /* v25.13 NM5 */
import { emitBridgeEvent } from "./bridgeStore"; /* v25.13 NM5 */

const promoteSchema = z.object({
  user_id: z.string().min(1, "user_id required"),
});

interface ChapterMembershipRow {
  id: string;
  tenantId: string;
  chapterId: string;
  userId: string;
  role: string;
  status: string;
}

function loadChapter(chapterId: string): { tenantId: string } | null {
  try {
    const db = getDb();
    const rows = db
      .select({ tenantId: chaptersTable.tenantId })
      .from(chaptersTable)
      .where(
        and(eq(chaptersTable.id, chapterId), isNull(chaptersTable.deletedAt)),
      )
      .all();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function listChapterAdmins(chapterId: string): ChapterMembershipRow[] {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — chapter_memberships is the scoping table.
    return db
      .select({
        id: chapterMemberships.id,
        tenantId: chapterMemberships.tenantId,
        chapterId: chapterMemberships.chapterId,
        userId: chapterMemberships.userId,
        role: chapterMemberships.role,
        status: chapterMemberships.status,
      })
      .from(chapterMemberships)
      .where(
        and(
          eq(chapterMemberships.chapterId, chapterId),
          eq(chapterMemberships.role, "admin"),
          eq(chapterMemberships.status, "active"),
          isNull(chapterMemberships.deletedAt),
        ),
      )
      .all() as ChapterMembershipRow[];
  } catch {
    return [];
  }
}

function findMembership(
  userId: string,
  chapterId: string,
): ChapterMembershipRow | null {
  try {
    const db = getDb();
    const rows = db
      .select({
        id: chapterMemberships.id,
        tenantId: chapterMemberships.tenantId,
        chapterId: chapterMemberships.chapterId,
        userId: chapterMemberships.userId,
        role: chapterMemberships.role,
        status: chapterMemberships.status,
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
      .all() as ChapterMembershipRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export function registerChapterAdminRoutes(app: Express): void {
  // ─────────────────────────────────────────────────────────────
  // GET — list current chapter admins.
  // ─────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/chapters/:chapterId/admins",
    requireCollectiveEnabled,
    requireAdmin,
    (req: Request, res: Response): void => {
      const chapterId = String(req.params.chapterId ?? "").trim();
      if (!chapterId) {
        res.status(400).json({ ok: false, error: "missing_chapter_id" });
        return;
      }
      const chapter = loadChapter(chapterId);
      if (!chapter) {
        res.status(404).json({ ok: false, error: "chapter_not_found" });
        return;
      }
      const admins = listChapterAdmins(chapterId).map((a) => ({
        id: a.id,
        userId: a.userId,
        chapterId: a.chapterId,
        role: a.role,
        status: a.status,
      }));
      res.json({ ok: true, chapterId, admins });
    },
  );

  // ─────────────────────────────────────────────────────────────
  // POST — promote a chapter member to chapter_admin.
  // The user must already have an active chapter membership row.
  // Idempotent: promoting an existing admin returns 200 with idempotent=true.
  // ─────────────────────────────────────────────────────────────
  app.post(
    "/api/admin/chapters/:chapterId/admins",
    requireCollectiveEnabled,
    requireAdmin,
    (req: Request, res: Response): void => {
      const chapterId = String(req.params.chapterId ?? "").trim();
      if (!chapterId) {
        res.status(400).json({ ok: false, error: "missing_chapter_id" });
        return;
      }
      const parsed = promoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
        return;
      }
      const targetUserId = parsed.data.user_id;
      const chapter = loadChapter(chapterId);
      if (!chapter) {
        res.status(404).json({ ok: false, error: "chapter_not_found" });
        return;
      }
      const existing = findMembership(targetUserId, chapterId);
      if (!existing) {
        res.status(404).json({
          ok: false,
          error: "membership_not_found",
          message: "User must be an active chapter member before promotion.",
        });
        return;
      }
      if (existing.status !== "active") {
        res.status(409).json({
          ok: false,
          error: "membership_not_active",
          currentStatus: existing.status,
        });
        return;
      }
      if (existing.role === "admin") {
        res.json({ ok: true, idempotent: true, membership: existing });
        return;
      }
      const now = new Date().toISOString();
      try {
        const db = getDb();
        db.transaction((tx: any) => {
          tx.update(chapterMemberships)
            .set({ role: "admin", updatedAt: now })
            .where(eq(chapterMemberships.id, existing.id))
            .run();
        });
      } catch (err) {
        log.error(
          "[POST chapter admins] update tx failed:",
          (err as Error).message,
        );
        res.status(500).json({ ok: false, error: "internal_error" });
        return;
      }
      try {
        const actor =
          (req as Request & { userContext?: { userId?: string } }).userContext
            ?.userId ?? "system:admin";
        appendAdminAudit(
          actor,
          `chapter_membership:${existing.id}`,
          "collective.chapter_admin.promoted",
          {
            chapterId,
            targetUserId,
            previousRole: existing.role,
            newRole: "admin",
          },
          chapter.tenantId,
        );
      } catch { /* non-fatal */ }
      // v25.13 NM5 — publish SSE + bridge event so clients refresh role
      // displays immediately instead of reading stale data until reload.
      try {
        ssePublish(chapterId, "admins", {
          kind: "admin.promoted",
          userId: targetUserId,
          chapterId,
          at: new Date().toISOString(),
        });
      } catch { /* non-fatal */ }
      try {
        emitBridgeEvent({
          eventType: "collective.chapter_admin.promoted",
          aggregateId: existing.id,
          // v25.13 NM5 — aggregateKind union does not include "chapter_membership";
          // use "platform" since chapter admin changes are platform-scoped.
          aggregateKind: "platform",
          payload: { chapterId, targetUserId, previousRole: existing.role, newRole: "admin" },
        });
      } catch { /* non-fatal */ }
      const fresh = findMembership(targetUserId, chapterId);
      res.status(200).json({ ok: true, membership: fresh });
    },
  );

  // ─────────────────────────────────────────────────────────────
  // DELETE — demote a chapter admin back to plain member.
  // Last-admin safeguard returns 409.
  // ─────────────────────────────────────────────────────────────
  app.delete(
    "/api/admin/chapters/:chapterId/admins/:userId",
    requireCollectiveEnabled,
    requireAdmin,
    (req: Request, res: Response): void => {
      const chapterId = String(req.params.chapterId ?? "").trim();
      const userId = String(req.params.userId ?? "").trim();
      if (!chapterId || !userId) {
        res.status(400).json({
          ok: false,
          error: !chapterId ? "missing_chapter_id" : "missing_user_id",
        });
        return;
      }
      const chapter = loadChapter(chapterId);
      if (!chapter) {
        res.status(404).json({ ok: false, error: "chapter_not_found" });
        return;
      }
      const existing = findMembership(userId, chapterId);
      if (!existing) {
        res.status(404).json({ ok: false, error: "membership_not_found" });
        return;
      }
      if (existing.role !== "admin") {
        res.json({ ok: true, idempotent: true, membership: existing });
        return;
      }
      // Last-admin safeguard — count the active admins of this chapter
      // and refuse to demote the only remaining one.
      const admins = listChapterAdmins(chapterId);
      if (admins.length <= 1) {
        res.status(409).json({
          ok: false,
          error: "last_admin",
          message: "Cannot demote the last chapter admin.",
          remaining: admins.length,
        });
        return;
      }
      const now = new Date().toISOString();
      try {
        const db = getDb();
        db.transaction((tx: any) => {
          tx.update(chapterMemberships)
            .set({ role: "member", updatedAt: now })
            .where(eq(chapterMemberships.id, existing.id))
            .run();
        });
      } catch (err) {
        log.error(
          "[DELETE chapter admins] update tx failed:",
          (err as Error).message,
        );
        res.status(500).json({ ok: false, error: "internal_error" });
        return;
      }
      try {
        const actor =
          (req as Request & { userContext?: { userId?: string } }).userContext
            ?.userId ?? "system:admin";
        appendAdminAudit(
          actor,
          `chapter_membership:${existing.id}`,
          "collective.chapter_admin.demoted",
          {
            chapterId,
            targetUserId: userId,
            previousRole: "admin",
            newRole: "member",
          },
          chapter.tenantId,
        );
      } catch { /* non-fatal */ }
      // v25.13 NM5 — publish SSE + bridge event for the demote path too.
      try {
        ssePublish(chapterId, "admins", {
          kind: "admin.demoted",
          userId,
          chapterId,
          at: new Date().toISOString(),
        });
      } catch { /* non-fatal */ }
      try {
        emitBridgeEvent({
          eventType: "collective.chapter_admin.demoted",
          aggregateId: existing.id,
          // v25.13 NM5 — aggregateKind: "platform" (chapter-membership not in union).
          aggregateKind: "platform",
          payload: { chapterId, targetUserId: userId, previousRole: "admin", newRole: "member" },
        });
      } catch { /* non-fatal */ }
      const fresh = findMembership(userId, chapterId);
      res.status(200).json({ ok: true, membership: fresh });
    },
  );

  // Tree-shaker barrier so sql is kept (used elsewhere in this module
  // pattern; vouchers for index audits).
  void sql;
}

export default registerChapterAdminRoutes;
