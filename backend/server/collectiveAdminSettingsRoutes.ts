/**
 * v25.47 APD-031 (HIGH-3) — Collective admin settings routes.
 *
 *   GET  /api/admin/collective-settings   (admin)  — full settings object
 *   PUT  /api/admin/collective-settings   (admin)  — merge-patch + persist
 *   GET  /api/collective/public-settings  (public) — public-safe subset
 *
 * Persistence lives in server/collectiveAdminSettingsStore.ts (DB-backed).
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  getCollectiveSettings,
  getPublicCollectiveSettings,
  updateCollectiveSettings,
  type CollectiveSettings,
} from "./collectiveAdminSettingsStore";

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

export function registerCollectiveAdminSettingsRoutes(app: Express): void {
  app.get("/api/admin/collective-settings", requireAdmin, (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, settings: getCollectiveSettings() });
    } catch (err) {
      log.error("[collectiveAdminSettingsRoutes.get] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  app.put("/api/admin/collective-settings", requireAdmin, (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<CollectiveSettings> = {};
    if ("applicationsOpen" in b) {
      if (typeof b.applicationsOpen !== "boolean") {
        return res.status(400).json({ ok: false, error: "applicationsOpen must be a boolean" });
      }
      patch.applicationsOpen = b.applicationsOpen;
    }
    for (const key of ["membershipHeadline", "membershipBlurb", "supportEmail", "internalNote"] as const) {
      if (key in b) {
        if (typeof b[key] !== "string") {
          return res.status(400).json({ ok: false, error: `${key} must be a string` });
        }
        patch[key] = b[key] as string;
      }
    }
    let saved: CollectiveSettings;
    try {
      saved = updateCollectiveSettings(patch);
    } catch (err) {
      log.error("[collectiveAdminSettingsRoutes.put] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
    }
    try {
      appendAdminAudit(actorOf(req), "collective_admin_settings:collective", "collective_settings_updated", {
        keys: Object.keys(patch),
      });
    } catch (auditErr) {
      log.warn(
        "[collectiveAdminSettingsRoutes.put] audit append failed (non-fatal):",
        (auditErr as Error).message,
      );
    }
    return res.json({ ok: true, settings: saved });
  });

  app.get("/api/collective/public-settings", (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, settings: getPublicCollectiveSettings() });
    } catch (err) {
      log.error("[collectiveAdminSettingsRoutes.public] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  log.info("[v25.47 APD-031] registered collective-admin-settings routes");
}

export default registerCollectiveAdminSettingsRoutes;
