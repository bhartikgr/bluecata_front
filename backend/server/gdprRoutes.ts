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
import { collectiveMembershipsBilling as billingTable } from "@shared/schema";
import { publish as ssePublish } from "./lib/sseHub";
import { appendAdminAudit } from "./adminPlatformStore";
import {
  applyLocalCancelAtPeriodEnd,
  getBillingForUser,
} from "./collectiveBillingStore";
import { billingRowIsBillable } from "./lib/chapterGovernanceRules";
import { DEFAULT_CHAPTER_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/* ============================================================
 * GDPR ERASURE vs BILLING — CANCEL, THEN REVOKE. NEVER BLOCK.
 * ============================================================
 * `chapter_memberships` is a MONEY table: `collectiveBillingStore.isChapterMember()`
 * gates subscription CANCEL / RESUME / portal / payment-intent creation. Revoking
 * a paying member's memberships (which the anonymize transaction below does, for
 * every chapter at once) therefore used to leave the data subject BILLED and
 * 403'd out of their own cancel endpoint.
 *
 * The HTTP membership writer answers that by REFUSING the revoke
 * (`SUBSCRIPTION_ACTIVE_CANCEL_FIRST`, see server/lib/chapterGovernanceRules.ts).
 * ERASURE MUST NOT INHERIT THAT REFUSAL. Erasure is a legal obligation; an
 * un-erased data subject is a worse outcome than an unreconciled invoice. So the
 * erasure path instead:
 *   1. cancels every still-billable subscription FIRST, using the SAME local
 *      cancellation the self-service route uses
 *      (`collectiveBillingStore.applyLocalCancelAtPeriodEnd` — local DB write
 *      only, no Airwallex API call), while the user is still a chapter member
 *      and the cancellation is therefore permitted;
 *   2. then revokes the memberships exactly as before;
 *   3. NEVER aborts on a cancellation failure. Every failure mode below is
 *      caught, counted, and turned into an explicit follow-up marker in the
 *      `data_delete_log.reason` column and in the erasure audit trail, so
 *      finance can reconcile manually. There is no `throw` and no early
 *      `return res.status(...)` in this function.
 *
 * "Still billable" is `chapterGovernanceRules.billingRowIsBillable()` — the same
 * predicate the refusal guard uses, so the two cannot drift on what counts as
 * live billing.
 */
export interface ErasureCancellationReport {
  /** Billable rows we tried to cancel. */
  attempted: Array<{ billingId: string; chapterId: string; status: string }>;
  /** Rows now flagged cancelAtPeriodEnd = true by this erasure. */
  cancelled: Array<{ billingId: string; chapterId: string; accessThrough: number | null }>;
  /** Rows we could NOT cancel. Erasure still proceeded. */
  failed: Array<{ billingId: string | null; chapterId: string; reason: string }>;
  /** TRUE ⇒ manual finance reconciliation required. */
  followUpRequired: boolean;
}

const BILLING_FOLLOWUP_MARKER = "billing_cancel_followup_required" as const;

function cancelBillableSubscriptionsForErasure(
  targetUserId: string,
  actor: string,
): ErasureCancellationReport {
  const report: ErasureCancellationReport = {
    attempted: [],
    cancelled: [],
    failed: [],
    followUpRequired: false,
  };

  /* (a) enumerate the data subject's billing rows. A read failure must NOT stop
         the erasure — it becomes a follow-up marker. */
  let rows: any[] = [];
  try {
    const db: any = getDb();
    rows = db
      .select({
        id: (billingTable as any).id,
        chapterId: (billingTable as any).chapterId,
        status: (billingTable as any).status,
        cancelAtPeriodEnd: (billingTable as any).cancelAtPeriodEnd,
        deletedAt: (billingTable as any).deletedAt,
      })
      .from(billingTable)
      .where(eq((billingTable as any).userId, targetUserId))
      .all() as any[];
  } catch (err) {
    report.failed.push({
      billingId: null,
      chapterId: "*",
      reason: `billing_rows_unreadable: ${(err as Error).message}`,
    });
    report.followUpRequired = true;
    log.error("[gdpr.anonymize] billing rows unreadable; erasure PROCEEDS with follow-up marker:", err);
    return report;
  }

  for (const r of rows) {
    try {
      if (r?.deletedAt) continue;
      const chapterId = String(r?.chapterId ?? "");
      const status = String(r?.status ?? "");
      if (!billingRowIsBillable(status, !!r?.cancelAtPeriodEnd)) continue;
      const billingId = String(r?.id ?? "");
      report.attempted.push({ billingId, chapterId, status });

      /* Re-read through the sanctioned reader the payment routes themselves use,
         so the row handed to the cancellation is shaped exactly as the route
         would have shaped it. */
      const billing = getBillingForUser(targetUserId, chapterId);
      if (!billing) {
        report.failed.push({
          billingId,
          chapterId,
          reason: "billing_row_not_returned_by_getBillingForUser",
        });
        report.followUpRequired = true;
        continue;
      }
      const outcome = applyLocalCancelAtPeriodEnd(billing, actor);
      if (outcome.ok) {
        report.cancelled.push({
          billingId: outcome.billingId,
          chapterId,
          accessThrough: outcome.accessThrough,
        });
      } else {
        report.failed.push({ billingId, chapterId, reason: `${outcome.error}: ${outcome.message}` });
        report.followUpRequired = true;
        log.error(
          "[gdpr.anonymize] subscription cancellation FAILED; erasure PROCEEDS with follow-up marker:",
          outcome.message,
        );
      }
    } catch (err) {
      report.failed.push({
        billingId: r?.id ? String(r.id) : null,
        chapterId: String(r?.chapterId ?? ""),
        reason: `cancellation_threw: ${(err as Error).message}`,
      });
      report.followUpRequired = true;
      log.error("[gdpr.anonymize] cancellation threw; erasure PROCEEDS with follow-up marker:", err);
    }
  }
  return report;
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

        /* CANCEL, THEN REVOKE — and NEVER BLOCK. Runs BEFORE the erasure
           transaction, while the data subject is still a chapter member (so the
           cancellation is permitted) and OUTSIDE it (so a cancellation failure
           cannot roll the erasure back). Returns a report; it never throws. */
        const billingCancellation = cancelBillableSubscriptionsForErasure(targetId, actor);

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
              /* Unchanged for a clean erasure; carries an explicit, greppable
                 follow-up marker when a subscription could not be cancelled. */
              reason: billingCancellation.followUpRequired
                ? `admin_anonymization+${BILLING_FOLLOWUP_MARKER}`
                : "admin_anonymization",
              recordsRedacted,
              prevHash,
              currHash,
              createdAt: now,
            })
            .run();
        });

        /* Provable record of what was cancelled (or could not be). Audit writes
           are non-fatal on purpose: an unwritable audit row must not block a
           legally mandated erasure that has already committed. */
        try {
          appendAdminAudit(actor, `user:${targetId}`, "gdpr.anonymized", {
            logId,
            recordsRedacted,
            subscriptionsCancelled: billingCancellation.cancelled,
            subscriptionCancellationsAttempted: billingCancellation.attempted,
            subscriptionCancellationFailures: billingCancellation.failed,
            billingFollowUpRequired: billingCancellation.followUpRequired,
          });
        } catch {
          /* non-fatal */
        }
        try {
          appendAdminAudit(
            actor,
            `user:${targetId}`,
            billingCancellation.followUpRequired
              ? `gdpr.erasure.${BILLING_FOLLOWUP_MARKER}`
              : "gdpr.erasure.billing_cancelled",
            {
              logId,
              attempted: billingCancellation.attempted,
              cancelled: billingCancellation.cancelled,
              failed: billingCancellation.failed,
              followUpRequired: billingCancellation.followUpRequired,
              note: billingCancellation.followUpRequired
                ? "Erasure completed. One or more subscriptions could not be cancelled locally — MANUAL FINANCE RECONCILIATION REQUIRED."
                : "Erasure completed. Listed subscriptions were set to cancel at period end before memberships were revoked.",
            },
          );
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
          subscriptionsCancelled: billingCancellation.cancelled,
          subscriptionCancellationFailures: billingCancellation.failed,
          billingFollowUpRequired: billingCancellation.followUpRequired,
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
