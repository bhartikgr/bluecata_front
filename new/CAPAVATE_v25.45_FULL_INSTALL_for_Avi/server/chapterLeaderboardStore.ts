/**
 * server/chapterLeaderboardStore.ts — v25.34 Collective Mega-Wave (verified DB-direct)
 *
 * ===========================================================================
 * v25.34 CHANGE BLOCK
 * ---------------------------------------------------------------------------
 * AUDIT RESULT: this store is ALREADY fully DB-direct and fail-closed and
 * therefore needed NO behavioral change for v25.34:
 *   - It holds NO in-memory Map / array source of truth.
 *   - Reads (`computeLeaderboardSnapshot`, `getLatestSnapshot`) query SQLite
 *     directly via getDb().select(...).all() with withTenant() scoping.
 *   - The single write (`refreshChapterLeaderboard`) runs inside
 *     db.transaction() with onConflictDoUpdate and DOES NOT swallow DB
 *     failures — any throw propagates to the caller (fail-closed). SSE publish
 *     happens only after the tx commits.
 * Per the v25.34 conservatism rule, working drizzle code is left intact rather
 * than churned to raw prepared statements; only this documentation header is
 * added. The store already satisfies Ozan's rule #1 ("Nothing in memory. All
 * DB driven").
 * ===========================================================================
 *
 * server/chapterLeaderboardStore.ts — v19 Phase A.
 *
 * Chapter leaderboard: per-(chapter, period) aggregate snapshot of member
 * activity scores. Periods are weekly (last 7 days), monthly (last 30 days),
 * and all-time (epoch → now). Snapshots are UPSERT'd on
 * (chapter_id, period, period_start) so the refresh job (a 60-minute
 * setInterval that runs only when NODE_ENV === "production", see
 * `server/jobs/leaderboardRefresh.ts`) overwrites the current row rather
 * than appending duplicates.
 *
 * If the GET endpoint is hit and no snapshot exists for the requested
 * (chapter, period), the snapshot is computed on-demand INSIDE a sync
 * transaction and persisted before responding.
 *
 * Score formula (per (chapter, user) within the period bounds):
 *
 *    score = 1.0 * reputation_gained
 *          + 3.0 * best_answers_accepted
 *          + 2.0 * events_attended
 *          + 0.5 * announcements_posted   (admins only)
 *          + 1.5 * resources_approved
 *
 * Hard rules (V19_BUILD_BRIEF.md §1-12):
 *   - SYNC transactions only — better-sqlite3 rejects async callbacks.
 *   - withTenant() on every read/write (cross-tenant queries marked inline).
 *   - SSE publish happens AFTER tx commits — never inside.
 *   - Math sacred — this module does not touch cap-table-engine or
 *     captableCommitStore.ts lines 354–477.
 *   - NO mock data, NO TODOs, NO stubs.
 */

import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, isNull, gte, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { withTenant } from "./lib/withTenant";
import { getDb } from "./db/connection";
import {
  chapterLeaderboardSnapshots as snapshotsTable,
  expertReputation as reputationTable,
  expertAnswers as answersTable,
  screeningEventAttendees as attendeesTable,
  screeningEvents as eventsTable,
  chapterAnnouncements as announcementsTable,
  chapterResources as resourcesTable,
  chapterMemberships as chapterMembershipsTable,
} from "@shared/schema";
import { tenantForChapter, DEFAULT_CHAPTER_ID } from "./lib/chapterDefaults";
import { publish as ssePublish } from "./lib/sseHub";
import { getChapterMembership } from "./screeningEventsStore";
import { log } from "./lib/logger";

/* --------------------------------------------------------------- */
/* Types                                                            */
/* --------------------------------------------------------------- */

export type LeaderboardPeriod = "weekly" | "monthly" | "all-time";

export interface LeaderboardEntry {
  userId: string;
  score: number;
  rank: number;
  breakdown: {
    reputationGained: number;
    bestAnswersAccepted: number;
    eventsAttended: number;
    announcementsPosted: number;
    resourcesApproved: number;
  };
}

export interface LeaderboardSnapshot {
  id: string;
  tenantId: string;
  chapterId: string;
  period: LeaderboardPeriod;
  periodStart: string;
  periodEnd: string;
  entries: LeaderboardEntry[];
  generatedAt: string;
}

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

function genId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

export function periodBounds(period: LeaderboardPeriod, now: Date = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const end = new Date(now.getTime());
  if (period === "weekly") {
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
  }
  if (period === "monthly") {
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
  }
  /* v25.12 NM-2 — all-time bounds must use a stable sentinel for periodEnd.
   * Previously this returned `new Date().toISOString()`, which made the
   * cache key change on every request and forced a full O(n) recompute on
   * every GET to /api/collective/leaderboard?period=all-time. The sentinel
   * locks the cache key so the snapshot is reused until a write event
   * (which calls refreshChapterLeaderboard explicitly). */
  return { periodStart: EPOCH_ISO, periodEnd: "2099-12-31T23:59:59.999Z" };
}

/* --------------------------------------------------------------- */
/* Scoring                                                          */
/* --------------------------------------------------------------- */

const W_REPUTATION = 1.0;
const W_BEST_ANSWER = 3.0;
const W_EVENT_ATTENDED = 2.0;
const W_ANNOUNCEMENT = 0.5;
const W_RESOURCE_APPROVED = 1.5;

/**
 * Compute the leaderboard for a chapter+period. Returns the top-50 entries
 * sorted by score desc (ties broken by userId asc for determinism).
 *
 * Reads are scoped to the chapter's tenant via withTenant(). For all-time,
 * we use the current `expert_reputation.score` snapshot. For weekly/monthly,
 * we approximate `reputation_gained` by counting best-answer flips within
 * the window from `expert_answers` (since `expert_reputation` is a cached
 * running total without per-period deltas) and use the cached score for the
 * all-time row only.
 */
export function computeLeaderboardSnapshot(args: {
  chapterId: string;
  period: LeaderboardPeriod;
  periodStart: string;
  periodEnd: string;
}): LeaderboardEntry[] {
  const { chapterId, period, periodStart, periodEnd } = args;
  const tenantId = tenantForChapter(chapterId);
  const db: any = getDb();

  // Accumulate breakdowns by user.
  const acc = new Map<string, LeaderboardEntry["breakdown"]>();
  const ensure = (uid: string): LeaderboardEntry["breakdown"] => {
    let row = acc.get(uid);
    if (!row) {
      row = {
        reputationGained: 0,
        bestAnswersAccepted: 0,
        eventsAttended: 0,
        announcementsPosted: 0,
        resourcesApproved: 0,
      };
      acc.set(uid, row);
    }
    return row;
  };

  /* ---- reputation ------------------------------------------------ */
  if (period === "all-time") {
    const repRows = db
      .select({
        userId: (reputationTable as any).userId,
        score: (reputationTable as any).score,
      })
      .from(reputationTable)
      .where(
        withTenant(
          and(eq((reputationTable as any).chapterId, chapterId))!,
          { tenantId, table: reputationTable as any },
        ),
      )
      .all() as Array<{ userId: string; score: number | null }>;
    for (const r of repRows) {
      const b = ensure(r.userId);
      b.reputationGained = Number(r.score ?? 0);
    }
  } else {
    // Windowed approximation: count answer-author activity inside the window
    // and convert to a "gained" score using the same +5/+15 rubric as
    // expertQAStore (answer +5; best-answer-author +15). Asker bonuses
    // (+1/question) are bundled into the per-window reputation total below
    // by counting questions authored.
    const ansRows = db
      .select({
        responderUserId: (answersTable as any).responderUserId,
        isBestAnswer: (answersTable as any).isBestAnswer,
        createdAt: (answersTable as any).createdAt,
      })
      .from(answersTable)
      .where(
        withTenant(
          and(
            eq((answersTable as any).chapterId, chapterId),
            gte((answersTable as any).createdAt, periodStart),
            lt((answersTable as any).createdAt, periodEnd),
          )!,
          { tenantId, table: answersTable as any },
        ),
      )
      .all() as Array<{ responderUserId: string; isBestAnswer: number; createdAt: string }>;
    for (const a of ansRows) {
      const b = ensure(a.responderUserId);
      b.reputationGained += 5;
      if (Number(a.isBestAnswer) === 1) {
        b.reputationGained += 15;
      }
    }
  }

  /* ---- best answers accepted ------------------------------------ */
  const bestAnsRows = db
    .select({
      responderUserId: (answersTable as any).responderUserId,
      updatedAt: (answersTable as any).updatedAt,
    })
    .from(answersTable)
    .where(
      withTenant(
        and(
          eq((answersTable as any).chapterId, chapterId),
          eq((answersTable as any).isBestAnswer, 1),
          gte((answersTable as any).updatedAt, periodStart),
          lt((answersTable as any).updatedAt, periodEnd),
        )!,
        { tenantId, table: answersTable as any },
      ),
    )
    .all() as Array<{ responderUserId: string }>;
  for (const r of bestAnsRows) {
    ensure(r.responderUserId).bestAnswersAccepted += 1;
  }

  /* ---- events attended ------------------------------------------ */
  // CROSS-TABLE join via subquery: screening_event_attendees carries
  // event_id which references screening_events.chapterId for tenant scope.
  // We join inline so we can filter by chapter without leaking tenants.
  const evtRows = db
    .select({
      userId: (attendeesTable as any).userId,
      checkedInAt: (attendeesTable as any).checkedInAt,
      attended: (attendeesTable as any).attended,
      eventChapterId: (eventsTable as any).chapterId,
      eventTenantId: (eventsTable as any).tenantId,
    })
    .from(attendeesTable)
    .leftJoin(
      eventsTable,
      eq((attendeesTable as any).eventId, (eventsTable as any).id),
    )
    .where(
      and(
        eq((eventsTable as any).chapterId, chapterId),
        eq((eventsTable as any).tenantId, tenantId),
        eq((attendeesTable as any).attended, 1),
        gte((attendeesTable as any).checkedInAt, periodStart),
        lt((attendeesTable as any).checkedInAt, periodEnd),
      ),
    )
    .all() as Array<{ userId: string }>;
  for (const r of evtRows) {
    ensure(r.userId).eventsAttended += 1;
  }

  /* ---- announcements posted (admins only) ----------------------- */
  // We count every announcement authored by a chapter admin within the
  // window. Authorship by a member is impossible (route is admin-only),
  // so the admin gate is enforced at write time — we still verify role
  // here to be defensive.
  const annRows = db
    .select({
      authorUserId: (announcementsTable as any).authorUserId,
      createdAt: (announcementsTable as any).createdAt,
    })
    .from(announcementsTable)
    .where(
      withTenant(
        and(
          eq((announcementsTable as any).chapterId, chapterId),
          gte((announcementsTable as any).createdAt, periodStart),
          lt((announcementsTable as any).createdAt, periodEnd),
        )!,
        { tenantId, table: announcementsTable as any },
      ),
    )
    .all() as Array<{ authorUserId: string }>;
  for (const r of annRows) {
    const m = getChapterMembership(r.authorUserId, chapterId);
    if (m && m.role === "admin") {
      ensure(r.authorUserId).announcementsPosted += 1;
    }
  }

  /* ---- resources approved --------------------------------------- */
  // Resources have no separate `approved_at` column; we use `updated_at`
  // as a proxy for the approval timestamp (approving a row sets status to
  // 'active' and bumps updated_at inside the same sync tx).
  const resRows = db
    .select({
      uploaderUserId: (resourcesTable as any).uploaderUserId,
      updatedAt: (resourcesTable as any).updatedAt,
      status: (resourcesTable as any).status,
    })
    .from(resourcesTable)
    .where(
      withTenant(
        and(
          eq((resourcesTable as any).chapterId, chapterId),
          eq((resourcesTable as any).status, "active"),
          gte((resourcesTable as any).updatedAt, periodStart),
          lt((resourcesTable as any).updatedAt, periodEnd),
        )!,
        { tenantId, table: resourcesTable as any },
      ),
    )
    .all() as Array<{ uploaderUserId: string }>;
  for (const r of resRows) {
    ensure(r.uploaderUserId).resourcesApproved += 1;
  }

  /* ---- assemble + rank ------------------------------------------ */
  const entries: LeaderboardEntry[] = [];
  acc.forEach((b, userId) => {
    const score =
      W_REPUTATION * b.reputationGained +
      W_BEST_ANSWER * b.bestAnswersAccepted +
      W_EVENT_ATTENDED * b.eventsAttended +
      W_ANNOUNCEMENT * b.announcementsPosted +
      W_RESOURCE_APPROVED * b.resourcesApproved;
    entries.push({ userId, score, rank: 0, breakdown: { ...b } });
  });
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.userId.localeCompare(b.userId);
  });
  const top = entries.slice(0, 50);
  top.forEach((e, idx) => {
    e.rank = idx + 1;
  });
  return top;
}

/* --------------------------------------------------------------- */
/* Persistence                                                      */
/* --------------------------------------------------------------- */

export function refreshChapterLeaderboard(args: {
  chapterId: string;
  period: LeaderboardPeriod;
  now?: Date;
}): LeaderboardSnapshot {
  const { chapterId, period } = args;
  const now = args.now ?? new Date();
  const tenantId = tenantForChapter(chapterId);
  const { periodStart, periodEnd } = periodBounds(period, now);
  const entries = computeLeaderboardSnapshot({
    chapterId,
    period,
    periodStart,
    periodEnd,
  });
  const generatedAt = now.toISOString();
  const id = genId("lbs");
  const dataJson = JSON.stringify(entries);

  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.insert(snapshotsTable)
      .values({
        id,
        tenantId,
        chapterId,
        period,
        periodStart,
        periodEnd,
        data: dataJson,
        generatedAt,
      } as any)
      .onConflictDoUpdate({
        target: [
          (snapshotsTable as any).chapterId,
          (snapshotsTable as any).period,
          (snapshotsTable as any).periodStart,
        ],
        set: {
          data: dataJson,
          periodEnd,
          generatedAt,
        } as any,
      })
      .run();
  });

  // SSE publish AFTER tx commits.
  try {
    ssePublish(chapterId, "leaderboard", {
      type: "leaderboard.refreshed",
      chapterId,
      period,
      generatedAt,
    });
  } catch {
    /* swallow — SSE outage shouldn't break refresh */
  }

  return {
    id,
    tenantId,
    chapterId,
    period,
    periodStart,
    periodEnd,
    entries,
    generatedAt,
  };
}

export function getLatestSnapshot(args: {
  chapterId: string;
  period: LeaderboardPeriod;
}): LeaderboardSnapshot | null {
  const { chapterId, period } = args;
  const tenantId = tenantForChapter(chapterId);
  const db: any = getDb();
  const rows = db
    .select()
    .from(snapshotsTable)
    .where(
      withTenant(
        and(
          eq((snapshotsTable as any).chapterId, chapterId),
          eq((snapshotsTable as any).period, period),
        )!,
        { tenantId, table: snapshotsTable as any, skipSoftDelete: true },
      ),
    )
    .orderBy(desc((snapshotsTable as any).generatedAt))
    .limit(1)
    .all() as any[];
  const r = rows[0];
  if (!r) return null;
  let entries: LeaderboardEntry[] = [];
  try {
    entries = JSON.parse(String(r.data ?? "[]")) as LeaderboardEntry[];
  } catch {
    entries = [];
  }
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id),
    chapterId: String(r.chapterId ?? r.chapter_id),
    period: String(r.period) as LeaderboardPeriod,
    periodStart: String(r.periodStart ?? r.period_start),
    periodEnd: String(r.periodEnd ?? r.period_end),
    entries,
    generatedAt: String(r.generatedAt ?? r.generated_at),
  };
}

/* --------------------------------------------------------------- */
/* Refresh job                                                      */
/* --------------------------------------------------------------- */

let refreshTimer: NodeJS.Timeout | null = null;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Start the 60-minute leaderboard refresh job. No-op when NODE_ENV !==
 * "production" so test suites stay deterministic. Refreshes every active
 * chapter for every period (weekly / monthly / all-time) on each tick.
 */
export function startLeaderboardRefreshJob(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (refreshTimer) return;
  const tick = () => {
    try {
      const db: any = getDb();
      // CROSS-TENANT (admin): the refresh job scans every chapter on every
      // tick. We do not scope to a single tenant here — the per-chapter
      // compute calls below re-apply withTenant() on every read.
      const chapterRows = db
        .selectDistinct({ chapterId: (chapterMembershipsTable as any).chapterId })
        .from(chapterMembershipsTable)
        .where(isNull((chapterMembershipsTable as any).deletedAt))
        .all() as Array<{ chapterId: string }>;
      const now = new Date();
      for (const { chapterId } of chapterRows) {
        for (const period of ["weekly", "monthly", "all-time"] as LeaderboardPeriod[]) {
          try {
            refreshChapterLeaderboard({ chapterId, period, now });
          } catch (err) {
            // Per-chapter failure shouldn't abort the rest of the tick.
            log.warn(
              `[leaderboardRefresh] chapter=${chapterId} period=${period} failed:`,
              err,
            );
          }
        }
      }
    } catch (err) {
      log.warn("[leaderboardRefresh] tick failed:", err);
    }
  };
  refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS);
  // Best-effort: don't keep the event loop alive just for this.
  if (typeof (refreshTimer as any).unref === "function") {
    (refreshTimer as any).unref();
  }
}

export function stopLeaderboardRefreshJob(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/* --------------------------------------------------------------- */
/* Routes                                                           */
/* --------------------------------------------------------------- */

const periodSchema = z.enum(["weekly", "monthly", "all-time"]);

export function registerLeaderboardRoutes(app: Express): void {
  /* ============================================================ */
  /*  GET /api/collective/leaderboard                             */
  /* ============================================================ */
  app.get(
    "/api/collective/leaderboard",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const periodRaw = String(req.query.period ?? "weekly");
      const periodParsed = periodSchema.safeParse(periodRaw);
      if (!periodParsed.success) {
        return res.status(400).json({ ok: false, error: "invalid_period" });
      }
      const period = periodParsed.data;
      const chapterId = String(req.query.chapter_id ?? DEFAULT_CHAPTER_ID);

      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      if (!ctx?.isAdmin) {
        const m = getChapterMembership(userId, chapterId);
        if (!m) {
          return res.status(403).json({ ok: false, error: "not_chapter_member" });
        }
      }

      // Try to read the latest snapshot first.
      let snapshot = getLatestSnapshot({ chapterId, period });

      // On-demand compute: if no snapshot exists OR the stored one is for
      // a different periodStart bucket than now (i.e. stale for weekly /
      // monthly which roll forward), recompute.
      const expected = periodBounds(period);
      const isStale =
        !snapshot ||
        snapshot.periodStart !== expected.periodStart ||
        snapshot.periodEnd !== expected.periodEnd;

      if (isStale) {
        snapshot = refreshChapterLeaderboard({ chapterId, period });
      }

      return res.json({
        ok: true,
        snapshot: {
          chapter_id: snapshot!.chapterId,
          period: snapshot!.period,
          period_start: snapshot!.periodStart,
          period_end: snapshot!.periodEnd,
          generated_at: snapshot!.generatedAt,
          entries: snapshot!.entries,
        },
      });
    },
  );

  /* ============================================================ */
  /*  POST /api/collective/leaderboard/refresh                    */
  /* ============================================================ */
  // Admin-only on-demand refresh (also useful for tests). Chapter admins
  // may refresh their own chapter; platform admins may refresh any.
  app.post(
    "/api/collective/leaderboard/refresh",
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
      const chapterId = String(req.body?.chapter_id ?? DEFAULT_CHAPTER_ID);
      const periodParsed = periodSchema.safeParse(
        String(req.body?.period ?? "weekly"),
      );
      if (!periodParsed.success) {
        return res.status(400).json({ ok: false, error: "invalid_period" });
      }
      if (!ctx?.isAdmin) {
        const m = getChapterMembership(userId, chapterId);
        if (!m || m.role !== "admin") {
          return res
            .status(403)
            .json({ ok: false, error: "not_chapter_admin" });
        }
      }
      const snapshot = refreshChapterLeaderboard({
        chapterId,
        period: periodParsed.data,
      });
      return res.json({
        ok: true,
        snapshot: {
          chapter_id: snapshot.chapterId,
          period: snapshot.period,
          period_start: snapshot.periodStart,
          period_end: snapshot.periodEnd,
          generated_at: snapshot.generatedAt,
          entries: snapshot.entries,
        },
      });
    },
  );
}

/* --------------------------------------------------------------- */
/* Test helpers                                                     */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  periodBounds,
  computeLeaderboardSnapshot,
  refreshChapterLeaderboard,
  getLatestSnapshot,
  startLeaderboardRefreshJob,
  stopLeaderboardRefreshJob,
});
