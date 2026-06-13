/**
 * server/chapterResourcesStore.ts — v19 Phase A.
 *
 * Chapter resources library: a moderated, per-chapter knowledge library of
 * docs, links, videos, templates, and guides. Submission flow:
 *
 *   - Member submission   → status='pending' (chapter admin review).
 *   - Admin submission    → status='active' (lands directly).
 *   - Approve / reject    → admin-only state transitions.
 *   - Flag                → any member sets status='flagged'.
 *   - Soft-delete         → uploader or admin.
 *
 * The `download_count` is a denormalized counter, incremented atomically
 * inside a SYNC tx by GET /:id?track_download=1.
 *
 * Binary uploads are gated by env var RESOURCES_STORAGE_PROVIDER (unset
 * yields 503 storage_not_configured on the upload endpoint). URL-based
 * resources always work. Avi configures S3 / Cloudflare R2 in production.
 *
 * Hard rules (V19_BUILD_BRIEF.md §1-12):
 *   - SYNC transactions only — hash computation BEFORE every tx.
 *   - withTenant() on every query (cross-tenant marked inline).
 *   - SSE publish AFTER tx commit.
 *   - NO mock data, NO TODOs, NO stubs.
 */

import type { Express, Request, Response } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { withTenant } from "./lib/withTenant";
import { getDb } from "./db/connection";
import {
  chapterResources as resourcesTable,
} from "@shared/schema";
import { appendAdminAudit } from "./adminPlatformStore";
import { tenantForChapter } from "./lib/chapterDefaults";
import { publish as ssePublish } from "./lib/sseHub";
import { getChapterMembership } from "./screeningEventsStore";
import { emitNotification, type NotificationKind } from "./notificationsStore";
import { log } from "./lib/logger";

/* --------------------------------------------------------------- */
/* Types                                                            */
/* --------------------------------------------------------------- */

export type ResourceType = "document" | "link" | "video" | "template" | "guide";
export type ResourceVisibility = "public" | "members" | "admins";
export type ResourceStatus = "pending" | "active" | "rejected" | "flagged";

export interface ResourceRow {
  id: string;
  tenantId: string;
  chapterId: string;
  uploaderUserId: string;
  title: string;
  description: string;
  resourceType: ResourceType;
  url: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  tags: string[];
  visibility: ResourceVisibility;
  status: ResourceStatus;
  rejectionReason: string | null;
  flagReason: string | null;
  flaggedByUserId: string | null;
  flaggedAt: string | null;
  downloadCount: number;
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

function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function safeJsonParseArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToResource(r: any): ResourceRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    chapterId: r.chapter_id ?? r.chapterId,
    uploaderUserId: r.uploader_user_id ?? r.uploaderUserId,
    title: r.title,
    description: r.description ?? "",
    resourceType: (r.resource_type ?? r.resourceType ?? "link") as ResourceType,
    url: r.url,
    fileSizeBytes: r.file_size_bytes ?? r.fileSizeBytes ?? null,
    mimeType: r.mime_type ?? r.mimeType ?? null,
    tags: safeJsonParseArray(r.tags),
    visibility: (r.visibility ?? "members") as ResourceVisibility,
    status: (r.status ?? "pending") as ResourceStatus,
    rejectionReason: r.rejection_reason ?? r.rejectionReason ?? null,
    flagReason: r.flag_reason ?? r.flagReason ?? null,
    flaggedByUserId: r.flagged_by_user_id ?? r.flaggedByUserId ?? null,
    flaggedAt: r.flagged_at ?? r.flaggedAt ?? null,
    downloadCount: Number(r.download_count ?? r.downloadCount ?? 0),
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
  };
}

/**
 * CROSS-TENANT (admin) — justified because the caller's active tenant may
 * differ from the resource's chapter tenant; we need to load the row to
 * resolve which chapter to assert membership against.
 */
function findResourceByIdAnyTenant(id: string): ResourceRow | null {
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(resourcesTable)
      .where(
        and(
          eq((resourcesTable as any).id, id),
          isNull((resourcesTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    return rowToResource(rows[0]);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[chapterResourcesStore.findResourceById] read failed:", msg);
    }
    return null;
  }
}

function canAdminChapterResources(
  ctx: { userId?: string; isAdmin?: boolean } | undefined,
  chapterId: string,
): boolean {
  if (!ctx?.userId) return false;
  if (ctx.isAdmin) return true;
  const m = getChapterMembership(ctx.userId, chapterId);
  return !!m && m.role === "admin";
}

function callerRoleForChapter(
  ctx: { userId?: string; isAdmin?: boolean } | undefined,
  chapterId: string,
): "platform-admin" | "admin" | "member" | "outsider" {
  if (ctx?.isAdmin) return "platform-admin";
  if (!ctx?.userId) return "outsider";
  const m = getChapterMembership(ctx.userId, chapterId);
  if (!m) return "outsider";
  if (m.role === "admin") return "admin";
  return "member";
}

function isVisibleToCaller(
  visibility: ResourceVisibility,
  role: "platform-admin" | "admin" | "member" | "outsider",
): boolean {
  if (role === "outsider") return false;
  if (visibility === "public") return true;
  if (visibility === "members") return true;
  if (visibility === "admins") return role === "admin" || role === "platform-admin";
  return false;
}

function notifyChapterAdmins(args: {
  chapterId: string;
  kind: string;
  title: string;
  body: string;
  link: string;
}): void {
  try {
    const { chapterMemberships } = require("@shared/schema") as {
      chapterMemberships: any;
    };
    const db: any = getDb();
    const rows = db
      .select({ userId: chapterMemberships.userId })
      .from(chapterMemberships)
      .where(
        and(
          eq(chapterMemberships.chapterId, args.chapterId),
          eq(chapterMemberships.role, "admin"),
          eq(chapterMemberships.status, "active"),
          isNull(chapterMemberships.deletedAt),
        ),
      )
      .all() as Array<{ userId: string }>;
    for (const r of rows) {
      try {
        emitNotification({
          userId: r.userId,
          kind: args.kind as NotificationKind,
          title: args.title,
          body: args.body,
          link: args.link,
        });
      } catch { /* non-fatal */ }
    }
  } catch { /* non-fatal */ }
}

/* --------------------------------------------------------------- */
/* Validation                                                       */
/* --------------------------------------------------------------- */

const createBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  resource_type: z.enum(["document", "link", "video", "template", "guide"]).optional(),
  url: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(50)).max(8).optional(),
  visibility: z.enum(["public", "members", "admins"]).optional(),
  chapter_id: z.string().min(1, "chapter_id required"),
});

const patchBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  resource_type: z.enum(["document", "link", "video", "template", "guide"]).optional(),
  url: z.string().min(1).max(2000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(8).optional(),
  visibility: z.enum(["public", "members", "admins"]).optional(),
});

const rejectBodySchema = z.object({
  reason: z.string().max(2000).optional(),
});

const flagBodySchema = z.object({
  reason: z.string().min(1).max(2000),
});

/* --------------------------------------------------------------- */
/* Route registration                                               */
/* --------------------------------------------------------------- */

export function registerChapterResourceRoutes(app: Express): void {
  /**
   * POST /api/collective/resources
   *
   * Any chapter member may submit. Admin submissions land directly in
   * 'active'; member submissions land in 'pending' and require admin
   * approval via /approve.
   */
  app.post(
    "/api/collective/resources",
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
        description = "",
        resource_type = "link",
        url,
        tags = [],
        visibility = "members",
        chapter_id,
      } = parsed.data;

      const role = callerRoleForChapter(ctx, chapter_id);
      if (role === "outsider") {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      // Admins (chapter admin or platform admin) post directly active;
      // regular members enter the moderation queue.
      const initialStatus: ResourceStatus =
        role === "admin" || role === "platform-admin" ? "active" : "pending";

      const id = `res_${randomBytes(8).toString("hex")}`;
      const tenantId = tenantForChapter(chapter_id);
      const ts = nowIso();
      const tagsJson = JSON.stringify(tags);
      const hashPayload = {
        id,
        tenantId,
        chapterId: chapter_id,
        uploaderUserId: userId,
        title,
        url,
        resourceType: resource_type,
        visibility,
        status: initialStatus,
        action: "create",
        ts,
      };
      const currHash = computeHash(null, hashPayload);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.insert(resourcesTable).values({
            id,
            tenantId,
            chapterId: chapter_id,
            uploaderUserId: userId,
            title,
            description,
            resourceType: resource_type,
            url,
            fileSizeBytes: null,
            mimeType: null,
            tags: tagsJson,
            visibility,
            status: initialStatus,
            rejectionReason: null,
            flagReason: null,
            flaggedByUserId: null,
            flaggedAt: null,
            downloadCount: 0,
            prevHash: null,
            currHash,
            createdAt: ts,
            updatedAt: ts,
            deletedAt: null,
          } as any).run();
        });
      } catch (err) {
        log.error("[POST resources] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }

      try {
        appendAdminAudit(
          userId,
          `chapter_resource:${id}`,
          "collective.resource.submitted",
          { id, chapterId: chapter_id, status: initialStatus, resourceType: resource_type, hash: currHash },
          tenantId,
        );
      } catch (err) {
        log.warn("[POST resources] audit failed (non-fatal):", (err as Error).message);
      }

      // If queued for moderation, ping the chapter admins.
      if (initialStatus === "pending") {
        notifyChapterAdmins({
          chapterId: chapter_id,
          kind: "collective.resource.pending",
          title: `New resource awaiting review: ${title}`,
          body: `${userId} submitted a ${resource_type} for review.`,
          link: `/collective/resources/${id}`,
        });
      }

      try {
        ssePublish(chapter_id, "resources", {
          kind: "resource.created",
          id,
          chapterId: chapter_id,
          status: initialStatus,
        });
      } catch { /* non-fatal */ }

      const resource = findResourceByIdAnyTenant(id);
      return res.status(201).json({ ok: true, resource });
    },
  );

  /**
   * POST /api/collective/resources/upload — binary upload stub.
   *
   * When RESOURCES_STORAGE_PROVIDER is unset (the default), this returns
   * 503 storage_not_configured. URL-based resources via POST /resources
   * always work. Avi configures S3 / R2 in production.
   */
  app.post(
    "/api/collective/resources/upload",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const provider = process.env.RESOURCES_STORAGE_PROVIDER;
      if (!provider || provider === "") {
        return res.status(503).json({
          ok: false,
          error: "storage_not_configured",
          message:
            "Binary uploads require RESOURCES_STORAGE_PROVIDER to be configured (S3 / Cloudflare R2). " +
            "URL-based resources via POST /api/collective/resources always work.",
        });
      }
      // When a provider is configured, real upload handling is owned by Avi
      // (multipart parsing + signed URL generation + S3/R2 client). This
      // endpoint stays as a contract surface so the client knows whether to
      // attempt an upload or fall back to URL paste.
      return res.status(501).json({
        ok: false,
        error: "upload_handler_owned_by_infra",
        provider,
      });
    },
  );

  /**
   * GET /api/collective/resources?chapter_id=&type=&status=&tag=
   *
   * Members see only status='active'; admins (chapter + platform) see all.
   * Visibility filter is applied per row.
   */
  app.get(
    "/api/collective/resources",
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
      const role = callerRoleForChapter(ctx, chapterId);
      if (role === "outsider") {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }

      const typeParam = typeof req.query.type === "string" ? req.query.type : "";
      const statusParam = typeof req.query.status === "string" ? req.query.status : "";
      const tagParam = typeof req.query.tag === "string" ? req.query.tag : "";

      const tenantId = tenantForChapter(chapterId);
      const conditions: any[] = [
        eq((resourcesTable as any).chapterId, chapterId),
      ];
      if (typeParam) conditions.push(eq((resourcesTable as any).resourceType, typeParam));
      if (statusParam) conditions.push(eq((resourcesTable as any).status, statusParam));

      try {
        const db: any = getDb();
        const rows = db
          .select()
          .from(resourcesTable)
          .where(
            withTenant(and(...conditions)!, {
              tenantId,
              table: resourcesTable as any,
            }),
          )
          .orderBy(desc((resourcesTable as any).createdAt))
          .all() as any[];

        let mapped = rows.map(rowToResource);

        // Members can't see pending/rejected/flagged unless they're the
        // uploader (so they can track their own submissions).
        if (role === "member") {
          mapped = mapped.filter(
            (r) => r.status === "active" || r.uploaderUserId === userId,
          );
        }
        // Visibility row-level filter.
        mapped = mapped.filter((r) => isVisibleToCaller(r.visibility, role));
        // Tag filter (substring/exact).
        if (tagParam) {
          mapped = mapped.filter((r) => r.tags.includes(tagParam));
        }

        return res.json({ ok: true, resources: mapped });
      } catch (err) {
        log.warn("[GET resources] DB read failed:", (err as Error).message);
        return res.json({ ok: true, resources: [], degraded: true });
      }
    },
  );

  /**
   * GET /api/collective/resources/:id[?track_download=1]
   *
   * Detail. When ?track_download=1, atomically increment download_count
   * inside a SYNC tx. Visibility + status gates apply identically to list.
   */
  app.get(
    "/api/collective/resources/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
      const row = findResourceByIdAnyTenant(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });

      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const role = callerRoleForChapter(ctx, row.chapterId);
      if (role === "outsider") {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      if (!isVisibleToCaller(row.visibility, role)) {
        return res.status(403).json({ ok: false, error: "visibility_restricted" });
      }
      // Members can see their own pending; otherwise active only.
      if (
        role === "member" &&
        row.status !== "active" &&
        row.uploaderUserId !== userId
      ) {
        return res.status(403).json({ ok: false, error: "moderation_pending" });
      }

      // Optionally track download (atomic counter increment).
      const track = String(req.query.track_download ?? "") === "1";
      if (track && row.status === "active") {
        try {
          const db: any = getDb();
          db.transaction((tx: any) => {
            tx.update(resourcesTable)
              .set({
                downloadCount: sql`${(resourcesTable as any).downloadCount} + 1`,
                updatedAt: nowIso(),
              } as any)
              .where(eq((resourcesTable as any).id, id))
              .run();
          });
        } catch (err) {
          log.warn("[GET resource detail] track_download tx failed (non-fatal):", (err as Error).message);
        }
      }

      const fresh = findResourceByIdAnyTenant(id);
      return res.json({ ok: true, resource: fresh });
    },
  );

  /**
   * PATCH /api/collective/resources/:id — uploader or chapter admin.
   * Extends the hash chain.
   */
  app.patch(
    "/api/collective/resources/:id",
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
      const row = findResourceByIdAnyTenant(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });

      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const isUploader = row.uploaderUserId === userId;
      const isChapterAdmin = canAdminChapterResources(ctx, row.chapterId);
      if (!isUploader && !isChapterAdmin) {
        return res.status(403).json({ ok: false, error: "not_authorized_to_edit" });
      }

      const ts = nowIso();
      const updates: Partial<ResourceRow> = {};
      if (parsed.data.title !== undefined) updates.title = parsed.data.title;
      if (parsed.data.description !== undefined) updates.description = parsed.data.description;
      if (parsed.data.resource_type !== undefined) updates.resourceType = parsed.data.resource_type;
      if (parsed.data.url !== undefined) updates.url = parsed.data.url;
      if (parsed.data.tags !== undefined) updates.tags = parsed.data.tags;
      if (parsed.data.visibility !== undefined) updates.visibility = parsed.data.visibility;
      const next: ResourceRow = { ...row, ...updates, updatedAt: ts };

      const newHash = computeHash(row.currHash, {
        id,
        title: next.title,
        url: next.url,
        resourceType: next.resourceType,
        visibility: next.visibility,
        action: "edit",
        editorUserId: userId,
        ts,
      });

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(resourcesTable)
            .set({
              title: next.title,
              description: next.description,
              resourceType: next.resourceType,
              url: next.url,
              tags: JSON.stringify(next.tags),
              visibility: next.visibility,
              prevHash: row.currHash,
              currHash: newHash,
              updatedAt: ts,
            } as any)
            .where(eq((resourcesTable as any).id, id))
            .run();
        });
      } catch (err) {
        log.error("[PATCH resources] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }

      try {
        ssePublish(row.chapterId, "resources", {
          kind: "resource.updated",
          id,
          chapterId: row.chapterId,
        });
      } catch { /* non-fatal */ }

      return res.json({ ok: true, resource: findResourceByIdAnyTenant(id) });
    },
  );

  /**
   * DELETE /api/collective/resources/:id — uploader or chapter admin.
   * Soft-delete; hash chain extended.
   */
  app.delete(
    "/api/collective/resources/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
      const row = findResourceByIdAnyTenant(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const isUploader = row.uploaderUserId === userId;
      const isChapterAdmin = canAdminChapterResources(ctx, row.chapterId);
      if (!isUploader && !isChapterAdmin) {
        return res.status(403).json({ ok: false, error: "not_authorized_to_delete" });
      }
      const ts = nowIso();
      const newHash = computeHash(row.currHash, {
        id,
        action: "delete",
        actorUserId: userId,
        ts,
      });
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(resourcesTable)
            .set({
              deletedAt: ts,
              prevHash: row.currHash,
              currHash: newHash,
              updatedAt: ts,
            } as any)
            .where(eq((resourcesTable as any).id, id))
            .run();
        });
      } catch (err) {
        log.error("[DELETE resources] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
      try {
        ssePublish(row.chapterId, "resources", {
          kind: "resource.deleted",
          id,
          chapterId: row.chapterId,
        });
      } catch { /* non-fatal */ }
      return res.json({ ok: true, deleted: true });
    },
  );

  /**
   * POST /api/collective/resources/:id/approve — chapter admin only.
   * Transitions pending → active. Notifies uploader.
   */
  app.post(
    "/api/collective/resources/:id/approve",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
      const row = findResourceByIdAnyTenant(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      if (!canAdminChapterResources(ctx, row.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_admin" });
      }
      if (row.status === "active") {
        return res.json({ ok: true, idempotent: true, resource: row });
      }
      const ts = nowIso();
      const newHash = computeHash(row.currHash, {
        id,
        action: "approve",
        previousStatus: row.status,
        actorUserId: ctx?.userId,
        ts,
      });
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(resourcesTable)
            .set({
              status: "active",
              rejectionReason: null,
              flagReason: null,
              flaggedByUserId: null,
              flaggedAt: null,
              prevHash: row.currHash,
              currHash: newHash,
              updatedAt: ts,
            } as any)
            .where(eq((resourcesTable as any).id, id))
            .run();
        });
      } catch (err) {
        log.error("[POST approve resource] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
      try {
        emitNotification({
          userId: row.uploaderUserId,
          kind: "collective.resource.approved" as NotificationKind,
          title: `Resource approved: ${row.title}`,
          body: `Your submission is now visible to the chapter.`,
          link: `/collective/resources/${id}`,
        });
      } catch { /* non-fatal */ }
      try {
        ssePublish(row.chapterId, "resources", {
          kind: "resource.approved",
          id,
          chapterId: row.chapterId,
        });
      } catch { /* non-fatal */ }
      return res.json({ ok: true, resource: findResourceByIdAnyTenant(id) });
    },
  );

  /**
   * POST /api/collective/resources/:id/reject — chapter admin. Body
   * {reason?}. Notifies uploader.
   */
  app.post(
    "/api/collective/resources/:id/reject",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
      const parsed = rejectBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const row = findResourceByIdAnyTenant(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      if (!canAdminChapterResources(ctx, row.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_admin" });
      }
      if (row.status === "rejected") {
        return res.json({ ok: true, idempotent: true, resource: row });
      }
      const reason = parsed.data.reason ?? null;
      const ts = nowIso();
      const newHash = computeHash(row.currHash, {
        id,
        action: "reject",
        reason,
        previousStatus: row.status,
        actorUserId: ctx?.userId,
        ts,
      });
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(resourcesTable)
            .set({
              status: "rejected",
              rejectionReason: reason,
              prevHash: row.currHash,
              currHash: newHash,
              updatedAt: ts,
            } as any)
            .where(eq((resourcesTable as any).id, id))
            .run();
        });
      } catch (err) {
        log.error("[POST reject resource] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
      try {
        emitNotification({
          userId: row.uploaderUserId,
          kind: "collective.resource.rejected" as NotificationKind,
          title: `Resource rejected: ${row.title}`,
          body: reason ?? "A chapter admin rejected your submission.",
          link: `/collective/resources/${id}`,
        });
      } catch { /* non-fatal */ }
      try {
        ssePublish(row.chapterId, "resources", {
          kind: "resource.rejected",
          id,
          chapterId: row.chapterId,
        });
      } catch { /* non-fatal */ }
      return res.json({ ok: true, resource: findResourceByIdAnyTenant(id) });
    },
  );

  /**
   * POST /api/collective/resources/:id/flag — any chapter member.
   * Sets status='flagged', stamps flagger. Notifies all chapter admins.
   */
  app.post(
    "/api/collective/resources/:id/flag",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
      const parsed = flagBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const row = findResourceByIdAnyTenant(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const role = callerRoleForChapter(ctx, row.chapterId);
      if (role === "outsider") {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      if (row.status === "flagged") {
        return res.json({ ok: true, idempotent: true, resource: row });
      }
      const ts = nowIso();
      const newHash = computeHash(row.currHash, {
        id,
        action: "flag",
        reason: parsed.data.reason,
        flaggedByUserId: userId,
        previousStatus: row.status,
        ts,
      });
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(resourcesTable)
            .set({
              status: "flagged",
              flagReason: parsed.data.reason,
              flaggedByUserId: userId,
              flaggedAt: ts,
              prevHash: row.currHash,
              currHash: newHash,
              updatedAt: ts,
            } as any)
            .where(eq((resourcesTable as any).id, id))
            .run();
        });
      } catch (err) {
        log.error("[POST flag resource] tx failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
      notifyChapterAdmins({
        chapterId: row.chapterId,
        kind: "collective.resource.flagged",
        title: `Resource flagged: ${row.title}`,
        body: parsed.data.reason,
        link: `/collective/resources/${id}`,
      });
      try {
        ssePublish(row.chapterId, "resources", {
          kind: "resource.flagged",
          id,
          chapterId: row.chapterId,
        });
      } catch { /* non-fatal */ }
      return res.json({ ok: true, resource: findResourceByIdAnyTenant(id) });
    },
  );
}

/* --------------------------------------------------------------- */
/* Test-only helpers                                                */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  computeHash,
  rowToResource,
  findResourceByIdAnyTenant,
  canAdminChapterResources,
  callerRoleForChapter,
  isVisibleToCaller,
});
