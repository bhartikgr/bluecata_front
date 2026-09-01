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
/* WAVE 238 · FIX C — the CANONICAL audit-log verifier. Imported, called, and
   never edited. See shared/auditChainHistory.ts for why the two verifiers are
   not interchangeable. */
import { verifyTenantAuditChain, AUDIT_CHAIN_SELECT_SQL } from "./adminPlatformStore";
import { rawDb } from "./db/connection";
import { AUDIT_LOG_CHAIN_TABLE } from "../shared/auditChainHistory";
import type { ChainVerifyResult } from "./lib/auditChainVerifier";

const isActiveChapterAdmin = chapterAdminInternal.isActiveChapterAdmin;

/* ════════════════════════════════════════════════════════════════════════════
   WAVE 238 · FIX C — /api/admin/audit/verify-chain?table=audit_log now reaches
   the CANONICAL verifier.

   The route called verifyChainForTable for all 23 catalog tables. For 22 of
   them that is the only verifier there is and they keep it. For `audit_log` it
   was the WRONG one: the catalog walker does not consult audit_chain_genesis,
   so a ledger that had been legitimately re-anchored under R84 verified
   differently here than it does on the health panel, in the boot verifier and
   in the resolve-incident path — all three of which use verifyTenantAuditChain.

   Mapping rules, and the reason for each:

     • broken_at_row_id — a REAL id or null, never a placeholder. The canonical
       verifier returns an index, not an id, so the id is read back through
       AUDIT_CHAIN_SELECT_SQL: literally the same exported SQL string the
       verifier itself walks, so the ordering cannot drift out of agreement.
       For the -2 sentinel (anchor row missing) and -3 (anchor hash disagrees)
       the offending row IS the anchor, and its id comes from
       audit_chain_genesis.
       This field is load-bearing on the screen: AuditChainVerifyPage derives
       `ok: result.broken_at_row_id === null`. Returning null for a chain the
       verifier called BROKEN would paint a green verdict over a real break.
       So when the verifier says broken and no id can be established, this
       function does not answer at all — it throws, and the route's existing
       500 handler reports the failure. An error is honest; a green tick is not.

     • first_bad_field_hint — null. The canonical verifier does not report which
       field diverged. NULL means "not reported" and is left as NULL.

     • last_known_good_hash — the hash of the link before the break when there
       is one, or the pinned genesis hash when the break is at the first
       post-genesis link. Read from the same rows; never fabricated.

     • verified / total_rows — vr.brokenAt is a 0-based index into the
       post-genesis rows, so for a broken chain it is also the number of links
       that verified. total_rows counts the pre-genesis rows too, because they
       are rows in the table even though they are outside the provable range.
   ════════════════════════════════════════════════════════════════════════════ */
function canonicalAuditLogVerify(tenantId: string): ChainVerifyResult {
  const started = new Date();
  const t0 = Date.now();
  const db: any = rawDb();
  const vr = verifyTenantAuditChain(db, tenantId);

  let brokenRowId: string | null = null;
  let lastGoodHash: string | null = null;
  if (!vr.ok) {
    let rows: Array<{ id: string; hash: string }> = [];
    try {
      rows = db.prepare(AUDIT_CHAIN_SELECT_SQL).all(tenantId) as Array<{ id: string; hash: string }>;
    } catch {
      rows = [];
    }
    if (vr.brokenAt >= 0) {
      const absolute = vr.preGenesisRowCount + vr.brokenAt;
      brokenRowId = rows[absolute]?.id ?? null;
      lastGoodHash =
        absolute > 0 ? rows[absolute - 1]?.hash ?? null : vr.genesisHash;
    } else {
      // -2 / -3: the anchor itself is the problem.
      try {
        const g = db
          .prepare(`SELECT anchor_row_id AS anchorRowId FROM audit_chain_genesis WHERE tenant_id = ?`)
          .get(tenantId) as { anchorRowId: string | null } | undefined;
        brokenRowId = g?.anchorRowId ?? null;
      } catch {
        brokenRowId = null;
      }
      lastGoodHash = null;
    }
    if (brokenRowId === null) {
      throw new Error(
        `audit_log chain is BROKEN for tenant ${tenantId} (brokenAt=${vr.brokenAt} of ${vr.totalLinks}) ` +
          `but the offending row id could not be established. Refusing to return a result that would ` +
          `render as verified.`,
      );
    }
  }

  const finished = new Date();
  return {
    table: AUDIT_LOG_CHAIN_TABLE,
    total_rows: vr.preGenesisRowCount + vr.totalLinks,
    verified: vr.ok ? vr.totalLinks : vr.brokenAt >= 0 ? vr.brokenAt : 0,
    broken_at_row_id: brokenRowId,
    broken_at_index: vr.ok ? null : vr.brokenAt,
    first_bad_field_hint: null,
    last_known_good_hash: lastGoodHash,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: Date.now() - t0,
  };
}

/** Tenants that have audit_log rows, in the same stable order the boot
 *  verifier uses. Used only when a platform admin asks for `audit_log` without
 *  naming a chapter: every tenant is verified canonically and the first break
 *  found is the one reported, rather than silently falling back to the twin. */
function auditLogTenantIds(): string[] {
  try {
    const db: any = rawDb();
    return (
      db
        .prepare(`SELECT DISTINCT tenant_id FROM audit_log ORDER BY tenant_id ASC`)
        .all() as Array<{ tenant_id: string }>
    ).map((r) => r.tenant_id);
  } catch {
    return [];
  }
}

function canonicalAuditLogVerifyAllTenants(): ChainVerifyResult {
  const started = new Date();
  const t0 = Date.now();
  const ids = auditLogTenantIds();
  let total = 0;
  let verified = 0;
  let firstBroken: ChainVerifyResult | null = null;
  for (const id of ids) {
    const r = canonicalAuditLogVerify(id);
    total += r.total_rows;
    verified += r.verified;
    if (r.broken_at_row_id !== null && firstBroken === null) firstBroken = r;
  }
  const finished = new Date();
  return {
    table: AUDIT_LOG_CHAIN_TABLE,
    total_rows: total,
    verified,
    broken_at_row_id: firstBroken?.broken_at_row_id ?? null,
    broken_at_index: firstBroken?.broken_at_index ?? null,
    first_bad_field_hint: null,
    last_known_good_hash: firstBroken?.last_known_good_hash ?? null,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: Date.now() - t0,
  };
}


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
        /* WAVE 238 · FIX C — `audit_log` ONLY. Every other table keeps
           verifyChainForTable: it is the only verifier that knows their hash
           conventions, and routing all 23 through the canonical audit-log
           verifier would break 22 of them. */
        const scopedTenantId = ctx?.isAdmin && !chapterId ? undefined : tenantId;
        const result =
          table === AUDIT_LOG_CHAIN_TABLE
            ? scopedTenantId
              ? canonicalAuditLogVerify(scopedTenantId)
              : canonicalAuditLogVerifyAllTenants()
            : verifyChainForTable(table, {
                tenantId: scopedTenantId,
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
        /* WAVE 230B · FIX 1 — `audit_log` ONLY, and it is the same correction wave
           238 applied to /verify-chain and did not carry here. verifyAllChains
           walks audit_log as ONE GLOBAL chain (see the CATALOG note at
           auditChainVerifier.ts:249, which already says "Treat a verify-all
           audit_log verdict as UNRE-BASED"). The WRITER chains PER TENANT
           (adminPlatformStore.ts:1618). So an unscoped sweep compares each row
           against the previous row of a DIFFERENT tenant and reds at the first
           tenant boundary — measured: index 1 of 1452 on data.db, with 754
           boundaries present. Every tenant verifies clean canonically.

           This is a FALSE RED being removed, never a green being painted:
           canonicalAuditLogVerify THROWS rather than return a null
           broken_at_row_id for a chain it called broken, because
           AuditChainVerifyPage derives ok from `broken_at_row_id === null`
           (R224.1). A genuine break therefore surfaces as a 500, not a tick.
           The other 22 tables keep verifyChainForTable: it is the only verifier
           that knows their hash conventions. */
        const scopedTenantId = ctx?.isAdmin && !chapterId ? undefined : tenantId;
        const results = verifyAllChains({
          tenantId: scopedTenantId,
          chapterId,
        }).map((r) =>
          r.table === AUDIT_LOG_CHAIN_TABLE
            ? scopedTenantId
              ? canonicalAuditLogVerify(scopedTenantId)
              : canonicalAuditLogVerifyAllTenants()
            : r,
        );
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
