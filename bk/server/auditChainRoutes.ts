/**
 * v19 Phase C — Hash-chain audit verification HTTP routes.
 *
 *   GET /api/admin/audit/verify-chain
 *     Query: table=X, chapter_id=Y (optional), from=ts, to=ts, with_details=1
 *     Auth: platform admin OR chapter admin (for the requested chapter_id).
 *     Returns ChainVerifyResult JSON. Synchronous (the verifier is fast
 *     enough on the row counts we see; SSE streaming is reserved for the
 *     "verify all 19 tables" sweep in the quarterly job).
 *
 *   GET /api/admin/audit/verify-all
 *     Query: chapter_id=Y (optional)
 *     Same auth. Returns ChainVerifyResult[] across every table.
 *
 *   GET /api/admin/audit/verification-history
 *     Query: table=X (optional), chapter_id=Y (optional), limit=100
 *     Same auth. Returns past quarterly-job results from
 *     `audit_chain_verifications` (migration 0039).
 *
 *   GET /api/admin/audit/verifiable-tables
 *     No query. Same auth. Returns the catalog of supported table names
 *     plus their hash column conventions.
 */
import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db/connection";
import {
  auditChainVerifications as auditChainVerificationsTable,
  chapters as chaptersTable,
} from "@shared/schema";
import { requireAuth } from "./lib/authMiddleware";
import { _internal as chapterAdminInternal } from "./lib/requireChapterMember";
import {
  VERIFIABLE_TABLES,
  isVerifiableTable,
  verifyChainForTable,
  verifyAllChains,
  _catalogMetaForTests,
} from "./lib/auditChainVerifier";
import type { UserContext } from "./lib/userContext";

const isActiveChapterAdmin = chapterAdminInternal.isActiveChapterAdmin;

type CallerCtx = UserContext & { isAdmin?: boolean };

function callerCtx(req: Request): CallerCtx | undefined {
  return (req as Request & { userContext?: CallerCtx }).userContext;
}

/** Resolve a chapter's tenant_id. Returns null if not found. */
function tenantForChapterId(chapterId: string): string | null {
  try {
    const db: any = getDb();
    const rows = db
      .select({ tenantId: chaptersTable.tenantId })
      .from(chaptersTable)
      .where(eq(chaptersTable.id, chapterId))
      .limit(1)
      .all() as Array<{ tenantId: string }>;
    return rows[0]?.tenantId ?? null;
  } catch {
    return null;
  }
}

/**
 * Authz: platform admin OR chapter admin for the requested chapter.
 * If chapter_id absent + not platform admin → 403.
 */
function authzVerify(
  req: Request,
  res: Response,
  chapterId: string | undefined,
): { ok: true } | { ok: false } {
  const ctx = callerCtx(req);
  const userId = ctx?.userId;
  if (!userId) {
    res.status(401).json({ ok: false, error: "missing_identity" });
    return { ok: false };
  }
  if (ctx?.isAdmin) return { ok: true };
  if (!chapterId) {
    res
      .status(403)
      .json({ ok: false, error: "chapter_admin_must_supply_chapter_id" });
    return { ok: false };
  }
  if (isActiveChapterAdmin(userId, chapterId)) return { ok: true };
  res.status(403).json({ ok: false, error: "not_chapter_admin" });
  return { ok: false };
}

export function registerAuditChainRoutes(app: Express): void {
  /* ----- list supported tables (UI dropdown source) ----- */
  app.get(
    "/api/admin/audit/verifiable-tables",
    requireAuth,
    (req: Request, res: Response): void => {
      const az = authzVerify(req, res, undefined);
      // For this read-only metadata endpoint, allow any chapter admin
      // even without a chapter_id query (so the UI can populate the
      // dropdown before the user picks a chapter).
      const ctx = callerCtx(req);
      if (!ctx?.isAdmin && !az.ok) {
        // authzVerify already sent the 403 response; nothing more.
        return;
      }
      if (!ctx?.isAdmin) {
        // Re-clear the response (authzVerify wrote 403) — actually if we
        // are here, az.ok was false and response was already sent. Just
        // return.
        if (res.headersSent) return;
      }
      res.json({
        ok: true,
        tables: VERIFIABLE_TABLES,
        catalog: _catalogMetaForTests(),
      });
    },
  );

  /* ----- single-table verify ----- */
  app.get(
    "/api/admin/audit/verify-chain",
    requireAuth,
    (req: Request, res: Response): void => {
      const table = String(req.query.table ?? "").trim();
      const chapterId =
        String(req.query.chapter_id ?? req.query.chapterId ?? "").trim() ||
        undefined;
      const fromTs = String(req.query.from ?? "").trim() || undefined;
      const toTs = String(req.query.to ?? "").trim() || undefined;
      const withDetails =
        String(req.query.with_details ?? req.query.withDetails ?? "")
          .trim()
          .toLowerCase() === "1" ||
        String(req.query.with_details ?? req.query.withDetails ?? "")
          .trim()
          .toLowerCase() === "true";

      if (!table) {
        res.status(400).json({ ok: false, error: "missing_table" });
        return;
      }
      if (!isVerifiableTable(table)) {
        res.status(404).json({ ok: false, error: "unknown_table" });
        return;
      }
      const az = authzVerify(req, res, chapterId);
      if (!az.ok) return;

      const ctx = callerCtx(req);
      const tenantId = chapterId ? tenantForChapterId(chapterId) ?? undefined : undefined;

      try {
        const result = verifyChainForTable(table, {
          tenantId: ctx?.isAdmin && !chapterId ? undefined : tenantId,
          chapterId,
          fromCreatedAt: fromTs,
          toCreatedAt: toTs,
          withDetails,
        });
        res.json({ ok: true, result });
      } catch (err) {
        res
          .status(500)
          .json({ ok: false, error: "verify_failed", message: (err as Error).message });
      }
    },
  );

  /* ----- verify ALL tables for a chapter ----- */
  app.get(
    "/api/admin/audit/verify-all",
    requireAuth,
    (req: Request, res: Response): void => {
      const chapterId =
        String(req.query.chapter_id ?? req.query.chapterId ?? "").trim() ||
        undefined;
      const az = authzVerify(req, res, chapterId);
      if (!az.ok) return;
      const ctx = callerCtx(req);
      const tenantId = chapterId ? tenantForChapterId(chapterId) ?? undefined : undefined;
      try {
        const results = verifyAllChains({
          tenantId: ctx?.isAdmin && !chapterId ? undefined : tenantId,
          chapterId,
        });
        const summary = {
          total_tables: results.length,
          all_verified: results.every((r) => r.broken_at_row_id === null),
          broken_tables: results
            .filter((r) => r.broken_at_row_id !== null)
            .map((r) => r.table),
        };
        res.json({ ok: true, summary, results });
      } catch (err) {
        res
          .status(500)
          .json({ ok: false, error: "verify_failed", message: (err as Error).message });
      }
    },
  );

  /* ----- history of quarterly verifications ----- */
  app.get(
    "/api/admin/audit/verification-history",
    requireAuth,
    (req: Request, res: Response): void => {
      const table = String(req.query.table ?? "").trim() || undefined;
      const chapterId =
        String(req.query.chapter_id ?? req.query.chapterId ?? "").trim() ||
        undefined;
      const limit = Math.min(
        500,
        Math.max(1, Number(req.query.limit ?? 100) | 0 || 100),
      );

      const az = authzVerify(req, res, chapterId);
      if (!az.ok) return;
      const ctx = callerCtx(req);
      const tenantId = chapterId ? tenantForChapterId(chapterId) ?? undefined : undefined;

      try {
        const db: any = getDb();
        // Chapter admin scopes by chapter's tenant; platform admin sees all
        // unless they passed a chapter_id explicitly.
        const whereParts: any[] = [];
        if (!ctx?.isAdmin && tenantId) {
          whereParts.push(
            eq(auditChainVerificationsTable.tenantId, tenantId),
          );
        }
        if (table) {
          whereParts.push(eq(auditChainVerificationsTable.tableName, table));
        }
        if (chapterId) {
          whereParts.push(
            eq(auditChainVerificationsTable.chapterId, chapterId),
          );
        }

        let q = db.select().from(auditChainVerificationsTable);
        if (whereParts.length > 0) {
          q =
            whereParts.length === 1 ? q.where(whereParts[0]) : q.where(and(...whereParts));
        }
        const rows = q
          .orderBy(desc(auditChainVerificationsTable.startedAt))
          .limit(limit)
          .all() as any[];
        res.json({ ok: true, rows });
      } catch (err) {
        res
          .status(500)
          .json({ ok: false, error: "history_read_failed", message: (err as Error).message });
      }
    },
  );
}
