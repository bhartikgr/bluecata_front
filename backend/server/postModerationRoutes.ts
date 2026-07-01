/**
 * v25.47 APD-023 — Network post moderation routes (admin-only).
 *
 *   GET  /api/admin/posts                      — moderation feed (incl. hidden)
 *   GET  /api/admin/posts/:id/moderation-log   — immutable audit trail
 *   POST /api/admin/posts/:id/moderate         { action: flag|hide|unhide, reason? }
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  listPostsForModeration,
  getModerationLog,
  getPostForModeration,
  moderatePost,
  type ModerationAction,
} from "./postModerationStore";

const VALID_ACTIONS: ReadonlySet<string> = new Set(["flag", "hide", "unhide"]);

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

export function registerPostModerationRoutes(app: Express): void {
  app.get("/api/admin/posts", requireAdmin, (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, posts: listPostsForModeration(true) });
    } catch (err) {
      log.error("[postModerationRoutes.list] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  app.get(
    "/api/admin/posts/:id/moderation-log",
    requireAdmin,
    (req: Request, res: Response) => {
      const postId = String(req.params.id);
      if (!getPostForModeration(postId)) {
        return res.status(404).json({ ok: false, error: "post_not_found" });
      }
      try {
        return res.json({ ok: true, log: getModerationLog(postId) });
      } catch (err) {
        log.error("[postModerationRoutes.log] failed:", (err as Error).message);
        return res
          .status(500)
          .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
      }
    },
  );

  app.post(
    "/api/admin/posts/:id/moderate",
    requireAdmin,
    (req: Request, res: Response) => {
      const postId = String(req.params.id);
      const b = req.body as { action?: unknown; reason?: unknown };
      const action = typeof b?.action === "string" ? b.action : "";
      if (!VALID_ACTIONS.has(action)) {
        return res
          .status(400)
          .json({ ok: false, error: "action must be one of flag|hide|unhide" });
      }
      const reason = typeof b?.reason === "string" ? b.reason : null;
      let result;
      try {
        result = moderatePost({
          postId,
          action: action as ModerationAction,
          actor: actorOf(req),
          reason,
        });
      } catch (err) {
        if ((err as Error).message === "post_not_found") {
          return res.status(404).json({ ok: false, error: "post_not_found" });
        }
        log.error("[postModerationRoutes.moderate] failed:", (err as Error).message);
        return res
          .status(500)
          .json({ ok: false, error: "moderate_failed", message: sanitizeErrorMessage(err) });
      }
      try {
        appendAdminAudit(actorOf(req), `network_post:${postId}`, `post_${action}`, {
          postId,
          reason,
          hidden: result.post.hidden,
        });
      } catch (auditErr) {
        log.warn(
          "[postModerationRoutes.moderate] audit append failed (non-fatal):",
          (auditErr as Error).message,
        );
      }
      return res.json({ ok: true, post: result.post, action: result.action });
    },
  );

  log.info("[v25.47 APD-023] registered post-moderation routes");
}

export default registerPostModerationRoutes;
