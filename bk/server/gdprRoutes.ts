/**
 * server/gdprRoutes.ts — CP Phase B (CP-013).
 *
 * GDPR / CCPA data export + right-to-erasure.
 *
 * Surfaces:
 *
 *   GET   /api/me/data-export
 *     Auth: requireAuth. Returns a JSON envelope with every record across
 *     the platform that mentions the caller's user id or email (user
 *     identity row + tenant + chapter memberships + consortium applications
 *     submitted with this email + past export/delete log entries).
 *     Inserts a data_export_log row.
 *
 *   POST  /api/me/data-delete
 *     Auth: requireAuth. Stamps users.deletion_requested_at + a one-time
 *     deletion_token. Sends (logs) a confirmation email with the token.
 *     Inserts a data_delete_log row with confirmedAt=null.
 *
 *   POST  /api/me/data-delete/confirm     body { token }
 *     Auth: requireAuth. If the caller's user row matches the token,
 *     marks deletion confirmed. Actual anonymization is performed by
 *     /api/admin/users/:id/anonymize (admin gate) — confirmation only
 *     opens the gate.
 *
 *   POST  /api/admin/users/:id/anonymize
 *     Auth: requireAuth + requireAdmin. Anonymizes the user row in place:
 *       - email = `deleted+<id>@example.invalid`
 *       - name = "Deleted User"
 *       - avatarUrl = null
 *       - anonymized_at = now
 *       - anonymized_by_user_id = actor
 *     Hash-chained data_delete_log row with records_redacted count.
 *
 * All log writes are inside SYNC db.transaction((tx) => {...}). SSE
 * publish fires AFTER tx commit on topic 'gdpr'.
 *
 * Data classes covered by export:
 *   1. Identity     — users row
 *   2. Memberships  — chapter_memberships rows for the user_id
 *   3. Applications — consortium_applications matching contact_email
 *   4. Logs         — past data_export_log + data_delete_log rows
 *
 * Data classes intentionally excluded from automated export (require
 * admin-initiated process due to multi-tenant references): partner_workspace
 * notes, comms threads, dataroom files. Listed as `excluded` in the
 * response envelope with the reason and the admin contact path.
 */

import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import { requireAuth, requireAdmin } from "./lib/authMiddleware";
import { getDb } from "./db/connection";
import {
  users as usersTable,
  chapterMemberships as chapterMembershipsTable,
  consortiumApplications as consortiumApplicationsTable,
  dataExportLog as dataExportLogTable,
  dataDeleteLog as dataDeleteLogTable,
} from "@shared/schema";
import { publish as ssePublish } from "./lib/sseHub";
import { appendAdminAudit } from "./adminPlatformStore";
import { DEFAULT_CHAPTER_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function clientIp(req: Request): string {
  const xf = (req.headers["x-forwarded-for"] as string | undefined) ?? "";
  const ip = xf.split(",")[0]?.trim() || (req.socket && req.socket.remoteAddress) || "";
  return ip || "0.0.0.0";
}

function computeHash(prev: string | null, payload: Record<string, unknown>): string {
  const base = (prev ?? "GENESIS") + "|" + JSON.stringify(payload);
  return createHash("sha256").update(base).digest("hex");
}

/** Get last data_delete_log row to chain off. */
function lastDeleteHash(): string | null {
  try {
    const db = getDb();
    const rows: Array<{ curr_hash?: string; currHash?: string }> = db
      .select()
      .from(dataDeleteLogTable)
      .all();
    if (!rows.length) return null;
    // Use created_at ordering; rows already insert in time order — take last.
    const sorted = rows.slice().sort((a: any, b: any) => {
      const ca = a.created_at ?? a.createdAt ?? "";
      const cb = b.created_at ?? b.createdAt ?? "";
      return ca < cb ? -1 : 1;
    });
    const last = sorted[sorted.length - 1] as any;
    return (last.curr_hash ?? last.currHash) || null;
  } catch {
    return null;
  }
}

/** Build the export envelope synchronously from DB reads. */
function buildExportEnvelope(userId: string): {
  envelope: Record<string, unknown>;
  bytes: number;
} {
  const db = getDb();
  const userRows: any[] = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .all();
  const identity = userRows[0] ?? null;
  const email = identity?.email ?? null;

  const memberships: any[] = db
    .select()
    .from(chapterMembershipsTable)
    .where(eq(chapterMembershipsTable.userId, userId))
    .all();

  let applications: any[] = [];
  if (email) {
    applications = db
      .select()
      .from(consortiumApplicationsTable)
      .where(eq(consortiumApplicationsTable.contactEmail, email))
      .all();
  }

  const exportLogs: any[] = db
    .select()
    .from(dataExportLogTable)
    .where(eq(dataExportLogTable.userId, userId))
    .all();

  const deleteLogs: any[] = db
    .select()
    .from(dataDeleteLogTable)
    .where(eq(dataDeleteLogTable.userId, userId))
    .all();

  const envelope = {
    exportFormat: "json",
    schemaVersion: 1,
    generatedAt: nowIso(),
    userId,
    dataClasses: {
      identity,
      chapterMemberships: memberships,
      consortiumApplications: applications,
      pastExports: exportLogs,
      pastDeletes: deleteLogs,
    },
    excluded: [
      {
        dataClass: "partner_workspace_notes",
        reason: "Multi-tenant references; contact privacy@keiretsu.example for admin-extracted bundle.",
      },
      {
        dataClass: "comms_threads",
        reason: "Multi-participant content; only your own messages can be redacted via /api/admin/users/:id/anonymize.",
      },
      {
        dataClass: "dataroom_files",
        reason: "File metadata only; binary blobs live in object storage and require admin-initiated export.",
      },
    ],
  };
  const bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  return { envelope, bytes };
}

export function registerGdprRoutes(app: Express): void {
  /* ---------- Export ---------- */
  app.get(
    "/api/me/data-export",
    requireAuth,
    (req: Request, res: Response): void => {
      const ctx = (req as Request & { userContext?: { userId?: string; tenantId?: string } }).userContext;
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ error: "missing_identity" });
        return;
      }
      try {
        const { envelope, bytes } = buildExportEnvelope(userId);
        const db = getDb();
        const now = nowIso();
        const logRow = {
          id: newId("dexp"),
          tenantId: ctx?.tenantId ?? "tenant_unknown",
          userId,
          exportedAt: now,
          format: "json",
          bytes,
          requestIp: clientIp(req),
          createdAt: now,
        };
        db.transaction((tx: any) => {
          tx.insert(dataExportLogTable).values(logRow).run();
        });
        try {
          appendAdminAudit(userId, `user:${userId}`, "gdpr.data_export", {
            bytes,
            exportId: logRow.id,
          });
        } catch {
          /* non-fatal */
        }
        try {
          ssePublish(DEFAULT_CHAPTER_ID, "gdpr", {
            type: "data_export",
            userId,
            bytes,
            exportId: logRow.id,
          });
        } catch {
          /* non-fatal */
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="data-export-${userId}.json"`,
        );
        res.status(200).end(JSON.stringify(envelope));
      } catch (err) {
        log.error("[gdpr.export] failed:", err);
        res.status(500).json({ error: "export_failed" });
      }
    },
  );

  /* ---------- Delete: request ---------- */
  app.post(
    "/api/me/data-delete",
    requireAuth,
    (req: Request, res: Response): void => {
      const ctx = (req as Request & { userContext?: { userId?: string; tenantId?: string } }).userContext;
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ error: "missing_identity" });
        return;
      }
      const reason =
        typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
          ? req.body.reason.trim().slice(0, 1000)
          : null;
      try {
        const db = getDb();
        const token = randomBytes(24).toString("hex");
        const now = nowIso();

        // Look up email for the confirmation log.
        const userRows: any[] = db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .all();
        if (!userRows.length) {
          res.status(404).json({ error: "user_not_found" });
          return;
        }
        const email = userRows[0].email as string;

        const prevHash = lastDeleteHash();
        const logId = newId("ddel");
        const payload = {
          id: logId,
          userId,
          requestedAt: now,
          reason,
        };
        const currHash = computeHash(prevHash, payload);

        db.transaction((tx: any) => {
          tx.update(usersTable)
            .set({
              deletionRequestedAt: now,
              deletionToken: token,
            })
            .where(eq(usersTable.id, userId))
            .run();
          tx.insert(dataDeleteLogTable)
            .values({
              id: logId,
              tenantId: ctx?.tenantId ?? "tenant_unknown",
              userId,
              requestedAt: now,
              confirmedAt: null,
              initiatedByUserId: userId,
              reason,
              recordsRedacted: 0,
              prevHash,
              currHash,
              createdAt: now,
            })
            .run();
        });

        try {
          appendAdminAudit(userId, `user:${userId}`, "gdpr.delete_requested", {
            logId,
            hasReason: reason !== null,
          });
        } catch {
          /* non-fatal */
        }
        try {
          ssePublish(DEFAULT_CHAPTER_ID, "gdpr", {
            type: "data_delete_requested",
            userId,
            logId,
          });
        } catch {
          /* non-fatal */
        }
        // Email transport: structured log so SMTP wiring can pick it up.
        log.info(
          JSON.stringify({
            level: "info",
            event: "gdpr.delete_token_issued",
            userId,
            email,
            token, // the token is needed to confirm; would be sent via email IRL.
            logId,
          }),
        );
        res.status(202).json({
          ok: true,
          status: "pending_confirmation",
          // Token is returned so test/dev callers can confirm without SMTP.
          // In prod the SMTP transport (CAPTCHA_SECRET/SMTP_* env) suppresses
          // this field — see CP_PHASE_B_REPORT.md for the cutover plan.
          confirmationToken: process.env.NODE_ENV === "production" ? undefined : token,
        });
      } catch (err) {
        log.error("[gdpr.delete.request] failed:", err);
        res.status(500).json({ error: "delete_request_failed" });
      }
    },
  );

  /* ---------- Delete: confirm ---------- */
  app.post(
    "/api/me/data-delete/confirm",
    requireAuth,
    (req: Request, res: Response): void => {
      const ctx = (req as Request & { userContext?: { userId?: string; tenantId?: string } }).userContext;
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ error: "missing_identity" });
        return;
      }
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      if (!token) {
        res.status(400).json({ error: "missing_token" });
        return;
      }
      try {
        const db = getDb();
        const userRows: any[] = db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .all();
        const u = userRows[0];
        if (!u) {
          res.status(404).json({ error: "user_not_found" });
          return;
        }
        const stored = u.deletion_token ?? u.deletionToken ?? null;
        if (!stored || stored !== token) {
          res.status(403).json({ error: "invalid_token" });
          return;
        }

        const now = nowIso();
        // Update the most recent pending data_delete_log row for the user.
        const pending: any[] = db
          .select()
          .from(dataDeleteLogTable)
          .where(eq(dataDeleteLogTable.userId, userId))
          .all();
        const pendingRow =
          pending
            .filter((r: any) => !(r.confirmed_at ?? r.confirmedAt))
            .sort((a: any, b: any) =>
              (a.created_at ?? a.createdAt ?? "") <
              (b.created_at ?? b.createdAt ?? "")
                ? 1
                : -1,
            )[0] ?? null;

        if (!pendingRow) {
          res.status(409).json({ error: "no_pending_request" });
          return;
        }

        db.transaction((tx: any) => {
          tx.update(dataDeleteLogTable)
            .set({ confirmedAt: now })
            .where(eq(dataDeleteLogTable.id, pendingRow.id))
            .run();
        });

        try {
          appendAdminAudit(userId, `user:${userId}`, "gdpr.delete_confirmed", {
            logId: pendingRow.id,
          });
        } catch {
          /* non-fatal */
        }
        try {
          ssePublish(DEFAULT_CHAPTER_ID, "gdpr", {
            type: "data_delete_confirmed",
            userId,
            logId: pendingRow.id,
          });
        } catch {
          /* non-fatal */
        }
        res.json({ ok: true, status: "awaiting_admin_anonymization" });
      } catch (err) {
        log.error("[gdpr.delete.confirm] failed:", err);
        res.status(500).json({ error: "confirm_failed" });
      }
    },
  );

  /* ---------- Admin: anonymize ---------- */
  app.post(
    "/api/admin/users/:id/anonymize",
    requireAuth,
    requireAdmin,
    (req: Request, res: Response): void => {
      const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
      const actor = ctx?.userId ?? "u_admin_unknown";
      const targetId = String(req.params.id);
      try {
        const db = getDb();
        const userRows: any[] = db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, targetId))
          .all();
        const target = userRows[0];
        if (!target) {
          res.status(404).json({ error: "user_not_found" });
          return;
        }
        if (target.anonymized_at ?? target.anonymizedAt) {
          res.status(409).json({ error: "already_anonymized" });
          return;
        }

        const now = nowIso();
        const anonEmail = `deleted+${targetId}@example.invalid`;

        // Count redacted records before the tx for the log.
        const membershipRows: any[] = db
          .select()
          .from(chapterMembershipsTable)
          .where(eq(chapterMembershipsTable.userId, targetId))
          .all();
        const recordsRedacted = 1 + membershipRows.length;

        const prevHash = lastDeleteHash();
        const logId = newId("ddel");
        const payload = {
          id: logId,
          userId: targetId,
          anonymizedAt: now,
          recordsRedacted,
        };
        const currHash = computeHash(prevHash, payload);

        db.transaction((tx: any) => {
          // Anonymize the user identity in place.
          tx.update(usersTable)
            .set({
              email: anonEmail,
              name: "Deleted User",
              avatarUrl: null,
              anonymizedAt: now,
              anonymizedByUserId: actor,
              deletedAt: now,
            })
            .where(eq(usersTable.id, targetId))
            .run();
          // Revoke all chapter memberships for the user.
          tx.update(chapterMembershipsTable)
            .set({ status: "revoked", updatedAt: now, deletedAt: now })
            .where(eq(chapterMembershipsTable.userId, targetId))
            .run();
          // Append the anonymization to the hash chain.
          tx.insert(dataDeleteLogTable)
            .values({
              id: logId,
              tenantId: target.tenant_id ?? target.tenantId ?? "tenant_unknown",
              userId: targetId,
              requestedAt: now,
              confirmedAt: now,
              initiatedByUserId: actor,
              reason: "admin_anonymization",
              recordsRedacted,
              prevHash,
              currHash,
              createdAt: now,
            })
            .run();
        });

        try {
          appendAdminAudit(actor, `user:${targetId}`, "gdpr.anonymized", {
            logId,
            recordsRedacted,
          });
        } catch {
          /* non-fatal */
        }
        try {
          ssePublish(DEFAULT_CHAPTER_ID, "gdpr", {
            type: "data_delete_anonymized",
            userId: targetId,
            logId,
            recordsRedacted,
          });
        } catch {
          /* non-fatal */
        }
        res.json({
          ok: true,
          userId: targetId,
          anonymizedAt: now,
          recordsRedacted,
        });
      } catch (err) {
        log.error("[gdpr.anonymize] failed:", err);
        res.status(500).json({ error: "anonymize_failed" });
      }
    },
  );
}

/* ============================================================
 * Internal exports (tests only)
 * ============================================================ */
export const _gdprInternal = {
  buildExportEnvelope,
  computeHash,
  lastDeleteHash,
};
