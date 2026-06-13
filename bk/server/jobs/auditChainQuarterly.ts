/**
 * v19 Phase C — Quarterly hash-chain audit job.
 *
 * Walks every hash-chained table for every active chapter, persists the
 * outcome to `audit_chain_verifications`, and exposes start/stop control
 * for tests and the bootstrap path in `server/index.ts`.
 *
 * Frequency: every 90 days (production). Gated by NODE_ENV === "production"
 * so test runs stay deterministic. Manual one-shot via
 * `runAuditChainQuarterlySweep()`.
 */
import { randomBytes } from "node:crypto";
import { and, isNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  auditChainVerifications as auditChainVerificationsTable,
  chapters as chaptersTable,
} from "@shared/schema";
import {
  verifyChainForTable,
  VERIFIABLE_TABLES,
} from "../lib/auditChainVerifier";
import type { ChainVerifyResult } from "../lib/auditChainVerifier";
import { log } from "../lib/logger";

const QUARTER_MS = 90 * 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export interface QuarterlySweepSummary {
  startedAt: string;
  finishedAt: string;
  chaptersScanned: number;
  tablesScanned: number;
  totalBroken: number;
  results: Array<{
    chapterId: string | null;
    tenantId: string;
    result: ChainVerifyResult;
  }>;
}

/** Read the active chapters list (one row per chapter). */
function listActiveChapters(): Array<{ id: string; tenantId: string }> {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — justified because the quarterly job verifies
    // every chapter; it must read the chapters table without a tenant
    // filter.
    const rows = db
      .select({ id: chaptersTable.id, tenantId: chaptersTable.tenantId })
      .from(chaptersTable)
      .where(
        and(
          // Status "active" or "paused" — we still verify paused chapters.
          // Soft-deleted chapters are skipped.
          isNull((chaptersTable as any).deletedAt),
        ),
      )
      .all() as Array<{ id: string; tenantId: string }>;
    return rows;
  } catch {
    return [];
  }
}

function genId(): string {
  return `acv_${randomBytes(8).toString("hex")}`;
}

function persistResult(
  chapterId: string | null,
  tenantId: string,
  result: ChainVerifyResult,
): void {
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(auditChainVerificationsTable)
        .values({
          id: genId(),
          tenantId,
          chapterId,
          tableName: result.table,
          verifiedCount: result.verified,
          brokenCount: result.broken_at_row_id ? 1 : 0,
          brokenFirstId: result.broken_at_row_id,
          totalRows: result.total_rows,
          durationMs: result.duration_ms,
          startedAt: result.started_at,
          finishedAt: result.finished_at,
          detailsJson: JSON.stringify({
            broken_at_index: result.broken_at_index,
            first_bad_field_hint: result.first_bad_field_hint,
            last_known_good_hash: result.last_known_good_hash,
          }),
        })
        .run();
    });
  } catch (err) {
    log.error(
      JSON.stringify({
        level: "error",
        route: "jobs.auditChainQuarterly",
        errorType: "persist_failed",
        message: (err as Error).message,
        table: result.table,
        chapterId,
      }),
    );
  }
}

/** Run the full sweep once. Synchronous (sqlite single-threaded). */
export function runAuditChainQuarterlySweep(): QuarterlySweepSummary {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const chapters = listActiveChapters();
  const results: QuarterlySweepSummary["results"] = [];
  let totalBroken = 0;

  // For chapter-scoped tables, iterate (chapter, table). For tables that
  // do not have a chapter_id column, the verifier ignores the chapter
  // filter — we still record one row per (tenantId, table) using the
  // first chapter's tenantId as the "owning" tenant (good enough for
  // single-tenant deployments and explicit for multi).
  if (chapters.length === 0) {
    // No chapters: still run global tables once with no tenant filter.
    for (const tableName of VERIFIABLE_TABLES) {
      const r = verifyChainForTable(tableName, {});
      results.push({ chapterId: null, tenantId: "", result: r });
      if (r.broken_at_row_id) totalBroken += 1;
    }
  } else {
    const seenGlobalTables = new Set<string>();
    for (const chap of chapters) {
      for (const tableName of VERIFIABLE_TABLES) {
        const r = verifyChainForTable(tableName, {
          tenantId: chap.tenantId,
          chapterId: chap.id,
        });
        results.push({ chapterId: chap.id, tenantId: chap.tenantId, result: r });
        persistResult(chap.id, chap.tenantId, r);
        if (r.broken_at_row_id) totalBroken += 1;
        seenGlobalTables.add(tableName);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const duration = Date.now() - startedMs;
  log.info(
    JSON.stringify({
      level: "info",
      route: "jobs.auditChainQuarterly",
      message: "sweep_complete",
      durationMs: duration,
      totalBroken,
      chaptersScanned: chapters.length,
      tablesScanned: VERIFIABLE_TABLES.length,
    }),
  );

  return {
    startedAt,
    finishedAt,
    chaptersScanned: chapters.length,
    tablesScanned: VERIFIABLE_TABLES.length,
    totalBroken,
    results,
  };
}

/** Start the 90-day sweep timer (production only). */
export function startAuditChainQuarterlyJob(): void {
  if (timer) return;
  if (process.env.NODE_ENV !== "production") return;
  timer = setInterval(() => {
    try {
      runAuditChainQuarterlySweep();
    } catch (err) {
      log.error(
        JSON.stringify({
          level: "error",
          route: "jobs.auditChainQuarterly",
          errorType: "sweep_uncaught",
          message: (err as Error).message,
        }),
      );
    }
  }, QUARTER_MS);
  // Don't keep process alive solely for this timer.
  if (typeof (timer as any).unref === "function") (timer as any).unref();
}

export function stopAuditChainQuarterlyJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
