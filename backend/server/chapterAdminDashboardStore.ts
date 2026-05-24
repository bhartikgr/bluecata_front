/**
 * v18 Phase D — Chapter admin dashboard aggregation.
 *
 * GET /api/collective/chapter-admin/dashboard?chapter_id=X
 *
 *   - requireCollectiveEnabled + requireAuth + requireChapterAdmin
 *   - Returns the four-panel snapshot:
 *       1. Membership  (active count + by-tier + recent joiners + cancellations)
 *       2. Pipeline    (open apps, founder apps, DSC pipeline by status, week events)
 *       3. Engagement  (Q&A this week, unanswered count, top reputation gainers)
 *       4. Health      (recent comms, SSE subscriber count, audit chain status)
 *
 * Live updates are driven by the SSE stream (billing/questions topics) on
 * the same chapter id; the client invalidates this endpoint when it sees
 * a relevant event.
 *
 * Aggregations run a handful of COUNT/SELECT queries against the existing
 * tables. No new schema. All reads CROSS-TENANT-justified inline because
 * chapter_id is the scoping key for the dashboard request.
 */

import type { Express, Request, Response } from "express";
import { and, eq, isNull, desc, gte } from "drizzle-orm";
import { getDb } from "./db/connection";
import {
  chapterMemberships as chapterMembershipsTable,
  chapters as chaptersTable,
  collectiveMembershipsBilling as billingTable,
  collectiveApps as collectiveAppsTable,
  founderCollectiveApplications as founderAppsTable,
  founderCollectiveNominations as founderNominationsTable,
  dscPipeline as dscPipelineTable,
  screeningEvents as screeningEventsTable,
  expertQuestions as expertQuestionsTable,
  expertAnswers as expertAnswersTable,
  expertReputation as expertReputationTable,
  collectiveChannelPosts as collectiveChannelPostsTable,
  auditLog as auditLogTable,
} from "@shared/schema";
import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { requireChapterAdminFromRequest } from "./lib/requireChapterMember";
import { chapterSubscriberCount, hubStats } from "./lib/sseHub";
import { log } from "./lib/logger";

interface Row {
  [k: string]: unknown;
}

function loadChapter(chapterId: string): Row | null {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(chaptersTable)
      .where(
        and(
          eq(chaptersTable.id, chapterId),
          isNull(chaptersTable.deletedAt),
        ),
      )
      .all() as Row[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function weekAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function membershipPanel(chapterId: string): Record<string, unknown> {
  const db = getDb();
  // CROSS-TENANT (admin) — chapter_id is the scoping key.
  const billingRows = db
    .select()
    .from(billingTable)
    .where(
      and(
        eq(billingTable.chapterId, chapterId),
        isNull(billingTable.deletedAt),
      ),
    )
    .all() as Array<{
      tier: string;
      status: string;
      userId: string;
      createdAt: string;
      updatedAt: string;
    }>;
  const byTier: Record<string, number> = { basic: 0, standard: 0, premium: 0 };
  let totalActive = 0;
  let totalCancelled = 0;
  let totalPastDue = 0;
  for (const r of billingRows) {
    if (r.status === "active") {
      totalActive++;
      if (byTier[r.tier] === undefined) byTier[r.tier] = 0;
      byTier[r.tier]++;
    } else if (r.status === "cancelled") {
      totalCancelled++;
    } else if (r.status === "past_due") {
      totalPastDue++;
    }
  }
  const since = weekAgoIso();
  const recentJoiners = billingRows
    .filter((r) => r.status === "active" && r.createdAt >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map((r) => ({ userId: r.userId, tier: r.tier, joinedAt: r.createdAt }));
  const recentCancellations = billingRows
    .filter((r) => r.status === "cancelled" && r.updatedAt >= since)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10)
    .map((r) => ({
      userId: r.userId,
      tier: r.tier,
      cancelledAt: r.updatedAt,
    }));

  // Total chapter members (membership table; independent of billing).
  // CROSS-TENANT (admin).
  const memberCount = db
    .select({ id: chapterMembershipsTable.id })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq(chapterMembershipsTable.chapterId, chapterId),
        eq(chapterMembershipsTable.status, "active"),
        isNull(chapterMembershipsTable.deletedAt),
      ),
    )
    .all().length;

  return {
    chapterMembers: memberCount,
    activeBilling: totalActive,
    cancelledBilling: totalCancelled,
    pastDueBilling: totalPastDue,
    byTier,
    recentJoiners,
    recentCancellations,
  };
}

function pipelinePanel(chapterId: string): Record<string, unknown> {
  const db = getDb();
  // Open Collective applications.
  const openApps = db
    .select({ id: collectiveAppsTable.id })
    .from(collectiveAppsTable)
    .where(
      and(
        eq(collectiveAppsTable.chapterId, chapterId),
        eq(collectiveAppsTable.status, "submitted"),
        isNull(collectiveAppsTable.deletedAt),
      ),
    )
    .all().length;
  // Founder applications (path B + nominations).
  const openFounderApps = db
    .select({ id: founderAppsTable.id })
    .from(founderAppsTable)
    .where(
      and(
        eq(founderAppsTable.chapterId, chapterId),
        eq(founderAppsTable.status, "submitted"),
        isNull(founderAppsTable.deletedAt),
      ),
    )
    .all().length;
  const openNominations = db
    .select({ id: founderNominationsTable.id, status: founderNominationsTable.status })
    .from(founderNominationsTable)
    .where(
      and(
        eq(founderNominationsTable.chapterId, chapterId),
        isNull(founderNominationsTable.deletedAt),
      ),
    )
    .all() as Array<{ status: string }>;
  const nominationsByStatus: Record<string, number> = {};
  for (const n of openNominations) {
    nominationsByStatus[n.status] = (nominationsByStatus[n.status] ?? 0) + 1;
  }
  // DSC pipeline by stage.
  const dscRows = db
    .select({ status: dscPipelineTable.status })
    .from(dscPipelineTable)
    .where(
      and(
        eq(dscPipelineTable.chapterId, chapterId),
        isNull(dscPipelineTable.deletedAt),
      ),
    )
    .all() as Array<{ status: string }>;
  const dscByStage: Record<string, number> = {};
  for (const r of dscRows) {
    dscByStage[r.status] = (dscByStage[r.status] ?? 0) + 1;
  }
  // This week's screening events.
  const nowSec = Math.floor(Date.now() / 1000);
  const weekFromNowSec = nowSec + 7 * 24 * 60 * 60;
  const screeningRows = db
    .select()
    .from(screeningEventsTable)
    .where(
      and(
        eq(screeningEventsTable.chapterId, chapterId),
        gte(screeningEventsTable.scheduledFor, nowSec),
        isNull(screeningEventsTable.deletedAt),
      ),
    )
    .all() as Array<{
      id: string;
      title: string;
      scheduledFor: number;
      status: string;
      eventType: string;
    }>;
  const upcomingThisWeek = screeningRows
    .filter((r) => r.scheduledFor <= weekFromNowSec && r.status !== "cancelled")
    .map((r) => ({
      id: r.id,
      title: r.title,
      scheduledFor: r.scheduledFor,
      eventType: r.eventType,
    }));
  return {
    openCollectiveApps: openApps,
    openFounderApps,
    nominationsByStatus,
    dscByStage,
    upcomingScreeningsThisWeek: upcomingThisWeek,
  };
}

function engagementPanel(chapterId: string): Record<string, unknown> {
  const db = getDb();
  const since = weekAgoIso();
  const recentQuestions = db
    .select({
      id: expertQuestionsTable.id,
      status: expertQuestionsTable.status,
      createdAt: expertQuestionsTable.createdAt,
    })
    .from(expertQuestionsTable)
    .where(
      and(
        eq(expertQuestionsTable.chapterId, chapterId),
        gte(expertQuestionsTable.createdAt, since),
        isNull(expertQuestionsTable.deletedAt),
      ),
    )
    .all() as Array<{ id: string; status: string; createdAt: string }>;
  const newQuestions = recentQuestions.length;
  const allQuestions = db
    .select({
      id: expertQuestionsTable.id,
      status: expertQuestionsTable.status,
    })
    .from(expertQuestionsTable)
    .where(
      and(
        eq(expertQuestionsTable.chapterId, chapterId),
        isNull(expertQuestionsTable.deletedAt),
      ),
    )
    .all() as Array<{ id: string; status: string }>;
  const unanswered = allQuestions.filter((q) => q.status === "open").length;
  const recentAnswers = db
    .select({ id: expertAnswersTable.id, isBestAnswer: expertAnswersTable.isBestAnswer })
    .from(expertAnswersTable)
    .where(
      and(
        eq(expertAnswersTable.chapterId, chapterId),
        gte(expertAnswersTable.createdAt, since),
        isNull(expertAnswersTable.deletedAt),
      ),
    )
    .all() as Array<{ id: string; isBestAnswer: number }>;
  const newAnswers = recentAnswers.length;
  const bestAccepts = recentAnswers.filter((r) => r.isBestAnswer === 1).length;
  // Top reputation gainers — surrogate: top score in chapter (this-week
  // gainers would require diffing snapshots; we expose the live top-5
  // which is what the panel actually displays).
  const topReputation = db
    .select({
      userId: expertReputationTable.userId,
      score: expertReputationTable.score,
      questionsAsked: expertReputationTable.questionsAsked,
      answersGiven: expertReputationTable.answersGiven,
      bestAnswers: expertReputationTable.bestAnswers,
    })
    .from(expertReputationTable)
    .where(
      and(
        eq(expertReputationTable.chapterId, chapterId),
        isNull(expertReputationTable.deletedAt),
      ),
    )
    .orderBy(desc(expertReputationTable.score))
    .limit(5)
    .all() as Array<Row>;
  return {
    newQuestionsThisWeek: newQuestions,
    newAnswersThisWeek: newAnswers,
    bestAcceptsThisWeek: bestAccepts,
    unansweredCount: unanswered,
    topReputation,
  };
}

function healthPanel(chapterId: string, tenantId: string): Record<string, unknown> {
  const db = getDb();
  const since = weekAgoIso();
  const recentComms = db
    .select({ id: collectiveChannelPostsTable.id })
    .from(collectiveChannelPostsTable)
    .where(
      and(
        eq(collectiveChannelPostsTable.chapterId, chapterId),
        gte(collectiveChannelPostsTable.createdAt, since),
        isNull((collectiveChannelPostsTable as unknown as { deletedAt: any }).deletedAt),
      ),
    )
    .all().length;
  // Audit chain integrity — walk the last 100 audit rows for this tenant
  // and confirm prev_hash linkage is intact.
  const rows = db
    .select({
      id: auditLogTable.id,
      prevHash: auditLogTable.prevHash,
      hash: auditLogTable.hash,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .where(eq(auditLogTable.tenantId, tenantId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(100)
    .all() as Array<{ id: string; prevHash: string | null; hash: string }>;
  // Sort ascending by createdAt for a linear chain walk.
  rows.reverse();
  let chainOk = true;
  let brokenAt: string | null = null;
  let lastHash: string | null = null;
  for (const r of rows) {
    if (lastHash !== null && r.prevHash !== lastHash) {
      chainOk = false;
      brokenAt = r.id;
      break;
    }
    lastHash = r.hash;
  }
  const subscribers = chapterSubscriberCount(chapterId);
  const stats = hubStats();
  return {
    recentCommsCount: recentComms,
    sseSubscribers: subscribers,
    sseChaptersTotal: stats.chapters,
    sseTotalSubscribers: stats.totalSubscribers,
    auditChain: {
      ok: chainOk,
      rowsScanned: rows.length,
      brokenAt,
    },
  };
}

export function registerChapterAdminDashboardRoutes(app: Express): void {
  app.get(
    "/api/collective/chapter-admin/dashboard",
    requireCollectiveEnabled,
    requireAuth,
    requireChapterAdminFromRequest((req) =>
      String((req.query.chapter_id ?? req.query.chapterId ?? "") as string).trim(),
    ),
    (req: Request, res: Response): void => {
      const chapterId = String(
        (req.query.chapter_id ?? req.query.chapterId ?? "") as string,
      ).trim();
      if (!chapterId) {
        res.status(400).json({ ok: false, error: "missing_chapter_id" });
        return;
      }
      const chapter = loadChapter(chapterId);
      if (!chapter) {
        res.status(404).json({ ok: false, error: "chapter_not_found" });
        return;
      }
      const tenantId = String((chapter.tenantId as string) ?? "");
      try {
        const membership = membershipPanel(chapterId);
        const pipeline = pipelinePanel(chapterId);
        const engagement = engagementPanel(chapterId);
        const health = healthPanel(chapterId, tenantId);
        res.json({
          ok: true,
          chapter: {
            id: chapter.id as string,
            name: (chapter.name as string) ?? null,
            region: (chapter.region as string) ?? null,
            city: (chapter.city as string) ?? null,
          },
          generatedAt: new Date().toISOString(),
          panels: {
            membership,
            pipeline,
            engagement,
            health,
          },
        });
      } catch (err) {
        log.error(
          "[GET chapter-admin/dashboard] aggregation failed:",
          (err as Error).message,
        );
        res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );
}

export default registerChapterAdminDashboardRoutes;
