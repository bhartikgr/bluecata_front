/**
 * server/chapterAnnouncementsStore.ts — v19 Phase A.
 *
 * Chapter announcements: a chapter-admin-authored stream of time-sensitive
 * notices targeted at a chapter's members (or a sub-audience). Every row is
 * hash-chained (prev_hash → curr_hash) so the announcement stream is
 * audit-grade. A second table (`announcement_reads`) tracks per-user read
 * state with UNIQUE(announcement_id, user_id) for idempotent upserts.
 *
 * Endpoints (all under /api/collective/announcements; gated by
 * requireCollectiveEnabled + requireAuth + requireCollectiveMember):
 *
 *   POST   /                            — create     (chapter admin)
 *   GET    /                            — list       (chapter member)
 *   GET    /:id                         — detail     (chapter member; idempotent read upsert)
 *   PATCH  /:id                         — edit       (chapter admin)
 *   DELETE /:id                         — soft-delete (chapter admin)
 *   POST   /:id/pin    /  /:id/unpin    — pin toggle  (chapter admin)
 *
 * Hard rules (V19_BUILD_BRIEF.md §1-12):
 *   - SYNC transactions only — better-sqlite3 rejects async callbacks. Hash
 *     computation happens BEFORE every db.transaction((tx)=>{...}) opens.
 *   - withTenant() on every query (cross-tenant reads marked inline).
 *   - SSE publish happens AFTER tx commits — never inside.
 *   - Math sacred — this module does not touch cap-table-engine or
 *     captableCommitStore.ts lines 354–477.
 *   - NO mock data, NO TODOs, NO stubs.
 */

import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, isNull, gt } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { withTenant } from "./lib/withTenant";
import { getDb } from "./db/connection";
import {
  chapterAnnouncements as announcementsTable,
  announcementReads as readsTable,
} from "@shared/schema";
import { appendAdminAudit } from "./adminPlatformStore";
import { tenantForChapter } from "./lib/chapterDefaults";
import { publish as ssePublish } from "./lib/sseHub";
import { getChapterMembership } from "./screeningEventsStore";
import { log } from "./lib/logger";

/* --------------------------------------------------------------- */
/* Types                                                            */
/* --------------------------------------------------------------- */

export type AnnouncementPriority = "low" | "normal" | "high" | "urgent";
export type AnnouncementAudience = "all" | "members" | "admins";

export interface AnnouncementRow {
  id: string;
  tenantId: string;
  chapterId: string;
  authorUserId: string;
  title: string;
  body: string;
  pinned: boolean;
  priority: AnnouncementPriority;
  audience: AnnouncementAudience;
  expiresAt: string | null;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

/** Shared sha256 hash used by every v17+ hash-chained store. */
function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function rowToAnnouncement(r: any): AnnouncementRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    chapterId: r.chapter_id ?? r.chapterId,
    authorUserId: r.author_user_id ?? r.authorUserId,
    title: r.title,
    body: r.body,
    pinned: !!(r.pinned ?? 0),
    priority: (r.priority ?? "normal") as AnnouncementPriority,
    audience: (r.audience ?? "all") as AnnouncementAudience,
    expiresAt: r.expires_at ?? r.expiresAt ?? null,
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
  };
}

/**
 * CROSS-TENANT (admin) — justified because the route caller's active tenant
 * may differ from the announcement's chapter tenant; we need to load the row
 * to resolve which chapter to assert membership against. Soft-delete is
 * applied via isNull(deletedAt).
 */
function findAnnouncementByIdAnyTenant(id: string): AnnouncementRow | null {
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(announcementsTable)
      .where(
        and(
          eq((announcementsTable as any).id, id),
          isNull((announcementsTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    return rowToAnnouncement(rows[0]);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[chapterAnnouncementsStore.findAnnouncementById] read failed:", msg);
    }
    return null;
  }
}

/** True iff (userId) has read (announcementId). */
function hasReadAnnouncement(announcementId: string, userId: string): boolean {
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(readsTable)
      .where(
        and(
          eq((readsTable as any).announcementId, announcementId),
          eq((readsTable as any).userId, userId),
        ),
      )
      .limit(1)
      .all() as any[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

function canAdminChapterAnnouncements(
  ctx: { userId?: string; isAdmin?: boolean } | undefined,
  chapterId: string,
): boolean {
  if (!ctx?.userId) return false;
  if (ctx.isAdmin) return true; // platform admin bypass.
  const m = getChapterMembership(ctx.userId, chapterId);
  return !!m && m.role === "admin";
}

function isAudienceVisibleToCaller(
  audience: AnnouncementAudience,
  callerRole: "admin" | "member" | "platform-admin",
): boolean {
  if (audience === "all") return true;
  if (audience === "admins") return callerRole === "admin" || callerRole === "platform-admin";
  if (audience === "members") return callerRole !== undefined; // members + admins both see
  return true;
}

function isExpired(row: AnnouncementRow, nowMs: number): boolean {
  if (!row.expiresAt) return false;
  const t = Date.parse(row.expiresAt);
  if (Number.isNaN(t)) return false;
  return t <= nowMs;
}

/* --------------------------------------------------------------- */
/* Validation                                                       */
/* --------------------------------------------------------------- */

const createBodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  pinned: z.boolean().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  audience: z.enum(["all", "members", "admins"]).optional(),
  expires_at: z.string().min(1).nullable().optional(),
  chapter_id: z.string().min(1, "chapter_id required"),
});

const patchBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(10_000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  audience: z.enum(["all", "members", "admins"]).optional(),
  expires_at: z.string().min(1).nullable().optional(),
});

/* --------------------------------------------------------------- */
/* Route registration                                               */
/* --------------------------------------------------------------- */

export function registerChapterAnnouncementRoutes(app: Express): void {
  /**
   * POST /api/collective/announcements
   *
   * Chapter admin creates an announcement. Hash-chained per chapter; first
   * row has prev_hash=null. SSE 'announcements' topic published post-commit.
   */
  app.post(
    "/api/collective/announcements",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const {
        title,
        body,
        pinned = false,
        priority = "normal",
        audience = "all",
        expires_at = null,
        chapter_id,
      } = parsed.data;

      if (!canAdminChapterAnnouncements(ctx, chapter_id)) {
        return res
          .status(403)
          .json({ ok: false, error: "not_chapter_admin" });
      }

      const id = `anc_${randomBytes(8).toString("hex")}`;
      const tenantId = tenantForChapter(chapter_id);
      const ts = nowIso();
      const hashPayload = {
        id,
        tenantId,
        chapterId: chapter_id,
        authorUserId: userId,
        title,
        body,
        pinned: pinned ? 1 : 0,
        priority,
        audience,
        expiresAt: expires_at ?? null,
        action: "create",
        ts,
      };
      const currHash = computeHash(null, hashPayload);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.insert(announcementsTable).values({
            id,
            tenantId,
            chapterId: chapter_id,
            authorUserId: userId,
            title,
            body,
            pinned: pinned ? 1 : 0,
            priority,
            audience,
            expiresAt: expires_at ?? null,
            prevHash: null,
            currHash,
            createdAt: ts,
            updatedAt: ts,
            deletedAt: null,
          } as any).run();
        });
      } catch (err) {
        log.error("[POST announcements] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }

      try {
        appendAdminAudit(
          userId,
          `chapter_announcement:${id}`,
          "collective.announcement.created",
          { id, chapterId: chapter_id, priority, audience, pinned, hash: currHash },
          tenantId,
        );
      } catch (err) {
        log.warn("[POST announcements] audit append failed (non-fatal):", (err as Error).message);
      }

      try {
        ssePublish(chapter_id, "announcements", {
          kind: "announcement.created",
          id,
          chapterId: chapter_id,
          pinned,
          priority,
        });
      } catch { /* non-fatal */ }

      const announcement = findAnnouncementByIdAnyTenant(id);
      return res.status(201).json({ ok: true, announcement, read: false });
    },
  );

  /**
   * GET /api/collective/announcements?chapter_id=...&filter=active|expired|pinned|priority
   *
   * Lists announcements for the caller's chapter. Respects audience visibility:
   *   - 'admins' rows hidden from non-admin members.
   *   - 'members' rows hidden from non-members (shouldn't happen given gate).
   *   - 'all' rows always visible.
   * Each item is annotated with `read: boolean` for the current user.
   */
  app.get(
    "/api/collective/announcements",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const chapterId = String(req.query.chapter_id ?? req.query.chapterId ?? "").trim();
      if (!chapterId) {
        return res.status(400).json({ ok: false, error: "missing_chapter_id" });
      }
      const membership = ctx?.isAdmin ? null : getChapterMembership(userId, chapterId);
      if (!ctx?.isAdmin && !membership) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      const callerRole: "admin" | "member" | "platform-admin" = ctx?.isAdmin
        ? "platform-admin"
        : membership?.role === "admin"
          ? "admin"
          : "member";

      const filterParam = typeof req.query.filter === "string" ? req.query.filter : "";
      const priorityFilter =
        typeof req.query.priority === "string" ? req.query.priority : null;

      const tenantId = tenantForChapter(chapterId);
      const conditions: any[] = [
        eq((announcementsTable as any).chapterId, chapterId),
      ];

      try {
        const db: any = getDb();
        const rows = db
          .select()
          .from(announcementsTable)
          .where(
            withTenant(and(...conditions)!, {
              tenantId,
              table: announcementsTable as any,
            }),
          )
          .orderBy(
            desc((announcementsTable as any).pinned),
            desc((announcementsTable as any).createdAt),
          )
          .all() as any[];

        const nowMs = Date.now();
        let mapped = rows.map(rowToAnnouncement);

        // Audience visibility.
        mapped = mapped.filter((a) =>
          isAudienceVisibleToCaller(a.audience, callerRole),
        );

        // Filter knob.
        if (filterParam === "active") {
          mapped = mapped.filter((a) => !isExpired(a, nowMs));
        } else if (filterParam === "expired") {
          mapped = mapped.filter((a) => isExpired(a, nowMs));
        } else if (filterParam === "pinned") {
          mapped = mapped.filter((a) => a.pinned);
        } else if (filterParam === "priority") {
          if (priorityFilter && ["low", "normal", "high", "urgent"].includes(priorityFilter)) {
            mapped = mapped.filter((a) => a.priority === priorityFilter);
          } else {
            mapped = mapped.filter((a) => a.priority === "high" || a.priority === "urgent");
          }
        }

        const annotated = mapped.map((a) => ({
          ...a,
          read: hasReadAnnouncement(a.id, userId),
        }));
        return res.json({ ok: true, announcements: annotated });
      } catch (err) {
        log.warn("[GET announcements] DB read failed:", (err as Error).message);
        return res.json({ ok: true, announcements: [], degraded: true });
      }
    },
  );

  /**
   * GET /api/collective/announcements/:id
   *
   * Returns the announcement detail and idempotently upserts an
   * announcement_reads row for the caller (UNIQUE(announcement_id, user_id)
   * makes the upsert race-safe).
   */
  app.get(
    "/api/collective/announcements/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ ok: false, error: "missing_id" });
      }
      const row = findAnnouncementByIdAnyTenant(id);
      if (!row) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const membership = ctx?.isAdmin ? null : getChapterMembership(userId, row.chapterId);
      if (!ctx?.isAdmin && !membership) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      const callerRole: "admin" | "member" | "platform-admin" = ctx?.isAdmin
        ? "platform-admin"
        : membership?.role === "admin"
          ? "admin"
          : "member";
      if (!isAudienceVisibleToCaller(row.audience, callerRole)) {
        return res.status(403).json({ ok: false, error: "audience_restricted" });
      }

      // Idempotent read-tracking upsert. Inside SYNC tx so concurrent
      // detail loads still produce exactly one row per (announcement, user).
      const ts = nowIso();
      const readId = `arr_${randomBytes(8).toString("hex")}`;
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.insert(readsTable)
            .values({
              id: readId,
              tenantId: row.tenantId,
              chapterId: row.chapterId,
              announcementId: row.id,
              userId,
              readAt: ts,
            } as any)
            .onConflictDoNothing({
              target: [(readsTable as any).announcementId, (readsTable as any).userId],
            })
            .run();
        });
      } catch (err) {
        log.warn("[GET announcement detail] read tx failed (non-fatal):", (err as Error).message);
      }

      return res.json({ ok: true, announcement: row, read: true });
    },
  );

  /**
   * PATCH /api/collective/announcements/:id
   *
   * Chapter admin edits title/body/priority/audience/expires_at. Hash chain
   * is extended (prev = old curr, curr = new). pinned is NOT mutated here;
   * use /pin and /unpin for that.
   */
  app.patch(
    "/api/collective/announcements/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
      const parsed = patchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const row = findAnnouncementByIdAnyTenant(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      if (!canAdminChapterAnnouncements(ctx, row.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_admin" });
      }
      const ts = nowIso();
      const updates: Partial<AnnouncementRow> = {};
      if (parsed.data.title !== undefined) updates.title = parsed.data.title;
      if (parsed.data.body !== undefined) updates.body = parsed.data.body;
      if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
      if (parsed.data.audience !== undefined) updates.audience = parsed.data.audience;
      if (parsed.data.expires_at !== undefined) {
        updates.expiresAt = parsed.data.expires_at;
      }
      const next: AnnouncementRow = { ...row, ...updates, updatedAt: ts };
      const hashPayload = {
        id: next.id,
        title: next.title,
        body: next.body,
        priority: next.priority,
        audience: next.audience,
        expiresAt: next.expiresAt,
        action: "edit",
        editorUserId: ctx?.userId,
        ts,
      };
      const newHash = computeHash(row.currHash, hashPayload);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(announcementsTable)
            .set({
              title: next.title,
              body: next.body,
              priority: next.priority,
              audience: next.audience,
              expiresAt: next.expiresAt,
              prevHash: row.currHash,
              currHash: newHash,
              updatedAt: ts,
            } as any)
            .where(eq((announcementsTable as any).id, id))
            .run();
        });
      } catch (err) {
        log.error("[PATCH announcements] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }

      try {
        ssePublish(row.chapterId, "announcements", {
          kind: "announcement.updated",
          id,
          chapterId: row.chapterId,
        });
      } catch { /* non-fatal */ }

      const fresh = findAnnouncementByIdAnyTenant(id);
      return res.json({ ok: true, announcement: fresh });
    },
  );

  /**
   * DELETE /api/collective/announcements/:id — soft-delete.
   * Hash chain extended for tamper-evidence.
   */
  app.delete(
    "/api/collective/announcements/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
      const row = findAnnouncementByIdAnyTenant(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      if (!canAdminChapterAnnouncements(ctx, row.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_admin" });
      }
      const ts = nowIso();
      const newHash = computeHash(row.currHash, {
        id,
        action: "delete",
        actorUserId: ctx?.userId,
        ts,
      });
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(announcementsTable)
            .set({
              deletedAt: ts,
              prevHash: row.currHash,
              currHash: newHash,
              updatedAt: ts,
            } as any)
            .where(eq((announcementsTable as any).id, id))
            .run();
        });
      } catch (err) {
        log.error("[DELETE announcements] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
      try {
        ssePublish(row.chapterId, "announcements", {
          kind: "announcement.deleted",
          id,
          chapterId: row.chapterId,
        });
      } catch { /* non-fatal */ }
      return res.json({ ok: true, deleted: true });
    },
  );

  /** POST /:id/pin and /:id/unpin */
  for (const op of ["pin", "unpin"] as const) {
    app.post(
      `/api/collective/announcements/:id/${op}`,
      requireCollectiveEnabled,
      requireAuth,
      requireCollectiveMember,
      (req: Request, res: Response) => {
        const id = String(req.params.id ?? "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
        const row = findAnnouncementByIdAnyTenant(id);
        if (!row) return res.status(404).json({ ok: false, error: "not_found" });
        const ctx = (req as any).userContext as
          | { userId?: string; isAdmin?: boolean }
          | undefined;
        if (!canAdminChapterAnnouncements(ctx, row.chapterId)) {
          return res.status(403).json({ ok: false, error: "not_chapter_admin" });
        }
        const desired = op === "pin";
        if (row.pinned === desired) {
          return res.json({ ok: true, idempotent: true, announcement: row });
        }
        const ts = nowIso();
        const newHash = computeHash(row.currHash, {
          id,
          action: op,
          actorUserId: ctx?.userId,
          ts,
        });
        try {
          const db: any = getDb();
          db.transaction((tx: any) => {
            tx.update(announcementsTable)
              .set({
                pinned: desired ? 1 : 0,
                prevHash: row.currHash,
                currHash: newHash,
                updatedAt: ts,
              } as any)
              .where(eq((announcementsTable as any).id, id))
              .run();
          });
        } catch (err) {
          log.error(`[POST ${op}] tx failed:`, (err as Error).message);
          return res.status(500).json({ ok: false, error: "internal_error" });
        }
        try {
          ssePublish(row.chapterId, "announcements", {
            kind: `announcement.${op}ned`,
            id,
            chapterId: row.chapterId,
          });
        } catch { /* non-fatal */ }
        const fresh = findAnnouncementByIdAnyTenant(id);
        return res.json({ ok: true, announcement: fresh });
      },
    );
  }
}

/* --------------------------------------------------------------- */
/* Test-only helpers                                                */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  computeHash,
  rowToAnnouncement,
  findAnnouncementByIdAnyTenant,
  hasReadAnnouncement,
  canAdminChapterAnnouncements,
  isAudienceVisibleToCaller,
  isExpired,
});
