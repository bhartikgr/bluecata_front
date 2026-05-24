/**
 * server/expertQAStore.ts — v18 Phase C.
 *
 * Ask-an-Expert: a per-chapter Q&A surface with denormalized reputation
 * scoring. Members ask questions, peers post answers, voters upvote/downvote
 * answers, and the asker can mark exactly one answer as "best". Every
 * mutation extends a per-row hash chain so a tamper of any row in
 * `expert_questions` or `expert_answers` is detectable.
 *
 * Hard contract (V19_BUILD_BRIEF.md §1-12 + v18 Phase C spec):
 *   - SYNC transactions only — better-sqlite3 rejects async callbacks.
 *     Hashes are computed BEFORE every `db.transaction((tx)=>{...})`.
 *   - `withTenant()` on every read/write; cross-tenant queries carry an
 *     inline justification comment.
 *   - Hash-chained writes in the same tx as the row update.
 *   - Feature flag: gated by `requireCollectiveEnabled` (COLLECTIVE_ENABLED=1).
 *   - Math is sacred — this module does not import cap-table-engine or
 *     captableCommitStore.
 *   - The vote endpoint relies on the UNIQUE(answer_id, voter_user_id)
 *     constraint for race safety. Toggle semantics (same vote_type twice →
 *     remove) are implemented as delete-then-recompute. Denormalized
 *     upvote_count on `expert_answers` is recomputed inside the same tx
 *     from a `COUNT(*) FILTER (vote_type='up') - COUNT(*) FILTER (vote_type='down')`
 *     query — never trusts stale in-memory state.
 *
 * Reputation scoring (per-chapter, recomputed inside every triggering tx):
 *    +1   per question asked
 *    +5   per answer posted
 *   +15   when own answer is marked best        (-15 reverts on the previously-best answer)
 *    +2   per upvote received on own answer     (-2 on downvote / toggle-off)
 *
 * Milestone notifications fire at thresholds 50 / 200 / 500. The
 * `last_milestone_notified` column tracks the highest milestone we've
 * already notified the user about so we never re-fire the same milestone.
 *
 * No mock data, no TODOs, no stubs. Every code path executes real Drizzle.
 */

import type { Express, Request, Response } from "express";
import { and, eq, isNull, desc, asc, like, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireCollectiveOrPartnerMember } from "./lib/requireCollectiveOrPartner";
import { resolvePartnerId } from "./lib/requirePartner";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { withTenant } from "./lib/withTenant";
import { getDb } from "./db/connection";
import {
  expertQuestions as questionsTable,
  expertAnswers as answersTable,
  expertVotes as votesTable,
  expertReputation as reputationTable,
  chapterMemberships as chapterMembershipsTable,
} from "@shared/schema";
import { appendAdminAudit } from "./adminPlatformStore";
import { tenantForChapter, DEFAULT_CHAPTER_ID } from "./lib/chapterDefaults";
import { emitNotification, type NotificationKind } from "./notificationsStore";
import { publish as ssePublish } from "./lib/sseHub";
import { log } from "./lib/logger";

/* --------------------------------------------------------------- */
/* Types                                                            */
/* --------------------------------------------------------------- */

export type QuestionStatus = "open" | "answered" | "closed" | "flagged";
export type AnswerStatus = "active" | "edited" | "deleted" | "flagged";
export type VoteType = "up" | "down";

export interface QuestionRow {
  id: string;
  tenantId: string;
  chapterId: string;
  askerUserId: string;
  title: string;
  body: string;
  tags: string[];
  status: QuestionStatus;
  bestAnswerId: string | null;
  flagReason: string | null;
  flaggedByUserId: string | null;
  flaggedAt: string | null;
  viewCount: number;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnswerRow {
  id: string;
  tenantId: string;
  chapterId: string;
  questionId: string;
  responderUserId: string;
  body: string;
  upvoteCount: number;
  isBestAnswer: boolean;
  status: AnswerStatus;
  flagReason: string | null;
  flaggedByUserId: string | null;
  flaggedAt: string | null;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReputationRow {
  id: string;
  tenantId: string;
  chapterId: string;
  userId: string;
  score: number;
  questionsAsked: number;
  answersGiven: number;
  bestAnswers: number;
  upvotesReceived: number;
  lastMilestoneNotified: number;
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------------------------------------- */
/* Constants / config                                               */
/* --------------------------------------------------------------- */

const TITLE_MAX = 200;
const BODY_MAX = 8000;
const TAG_MAX = 8;
const MILESTONES: readonly number[] = [50, 200, 500] as const;

const REP_DELTA = {
  QUESTION_ASKED: 1,
  ANSWER_POSTED: 5,
  BEST_ANSWER_MARKED: 15,
  UPVOTE_RECEIVED: 2,
} as const;

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

function genId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/** SHA-256 hash chain (parity with screeningEventsStore + collectiveBillingStore). */
function computeHash(
  prevHash: string | null,
  payload: Record<string, unknown>,
): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}

function questionRowFromDb(r: any): QuestionRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id),
    chapterId: String(r.chapterId ?? r.chapter_id),
    askerUserId: String(r.askerUserId ?? r.asker_user_id),
    title: String(r.title),
    body: String(r.body),
    tags: parseTags(r.tags),
    status: String(r.status) as QuestionStatus,
    bestAnswerId: r.bestAnswerId ?? r.best_answer_id ?? null,
    flagReason: r.flagReason ?? r.flag_reason ?? null,
    flaggedByUserId: r.flaggedByUserId ?? r.flagged_by_user_id ?? null,
    flaggedAt: r.flaggedAt ?? r.flagged_at ?? null,
    viewCount: Number(r.viewCount ?? r.view_count ?? 0),
    prevHash: r.prevHash ?? r.prev_hash ?? null,
    currHash: String(r.currHash ?? r.curr_hash),
    createdAt: String(r.createdAt ?? r.created_at),
    updatedAt: String(r.updatedAt ?? r.updated_at),
  };
}

function answerRowFromDb(r: any): AnswerRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id),
    chapterId: String(r.chapterId ?? r.chapter_id),
    questionId: String(r.questionId ?? r.question_id),
    responderUserId: String(r.responderUserId ?? r.responder_user_id),
    body: String(r.body),
    upvoteCount: Number(r.upvoteCount ?? r.upvote_count ?? 0),
    isBestAnswer: Number(r.isBestAnswer ?? r.is_best_answer ?? 0) === 1,
    status: String(r.status) as AnswerStatus,
    flagReason: r.flagReason ?? r.flag_reason ?? null,
    flaggedByUserId: r.flaggedByUserId ?? r.flagged_by_user_id ?? null,
    flaggedAt: r.flaggedAt ?? r.flagged_at ?? null,
    prevHash: r.prevHash ?? r.prev_hash ?? null,
    currHash: String(r.currHash ?? r.curr_hash),
    createdAt: String(r.createdAt ?? r.created_at),
    updatedAt: String(r.updatedAt ?? r.updated_at),
  };
}

/**
 * CP Phase C — derive a viewer-facing role tag for the author of a Q&A row.
 * Returns 'partner' if the user has an active partner team membership; null
 * otherwise. UI uses this to render the "Partner" badge (CP-022/CP-024).
 */
function lookupAuthorRole(userId: string): "partner" | null {
  try {
    const pid = resolvePartnerId(userId);
    return pid ? "partner" : null;
  } catch {
    return null;
  }
}

function decorateQuestionWithRole<T extends { askerUserId: string }>(
  q: T,
): T & { askerUserRole: "partner" | null } {
  return { ...q, askerUserRole: lookupAuthorRole(q.askerUserId) };
}

function decorateAnswerWithRole<T extends { responderUserId: string }>(
  a: T,
): T & { responderUserRole: "partner" | null } {
  return { ...a, responderUserRole: lookupAuthorRole(a.responderUserId) };
}

function reputationRowFromDb(r: any): ReputationRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id),
    chapterId: String(r.chapterId ?? r.chapter_id),
    userId: String(r.userId ?? r.user_id),
    score: Number(r.score ?? 0),
    questionsAsked: Number(r.questionsAsked ?? r.questions_asked ?? 0),
    answersGiven: Number(r.answersGiven ?? r.answers_given ?? 0),
    bestAnswers: Number(r.bestAnswers ?? r.best_answers ?? 0),
    upvotesReceived: Number(r.upvotesReceived ?? r.upvotes_received ?? 0),
    lastMilestoneNotified: Number(
      r.lastMilestoneNotified ?? r.last_milestone_notified ?? 0,
    ),
    createdAt: String(r.createdAt ?? r.created_at),
    updatedAt: String(r.updatedAt ?? r.updated_at),
  };
}

/* --------------------------------------------------------------- */
/* Chapter membership inline check + admin lookup                   */
/* --------------------------------------------------------------- */

/**
 * Inline mirror of `requireChapterMember._internal.isActiveChapterMember`.
 * Returns `{ role, status }` or null. CROSS-TENANT — chapter_memberships
 * itself defines the tenant scope (same pattern as withTenant.getCurrentTenantId).
 */
function getChapterMembership(
  userId: string,
  chapterId: string,
): { role: string; status: string } | null {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — justified because chapter_memberships is the
    // table that establishes the active chapter scope.
    const rows = db
      .select({
        role: (chapterMembershipsTable as any).role,
        status: (chapterMembershipsTable as any).status,
      })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, userId),
          eq((chapterMembershipsTable as any).chapterId, chapterId),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    const row = rows[0];
    if (!row) return null;
    if (row.status !== "active") return null;
    return { role: String(row.role ?? "member"), status: String(row.status) };
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[expertQAStore.getChapterMembership] read failed:", msg);
    }
    return null;
  }
}

function isChapterMember(userId: string, chapterId: string): boolean {
  return getChapterMembership(userId, chapterId) !== null;
}

/**
 * CP Phase C (CP-022/023/024) — chapter scope access for partner team members.
 *
 * Returns true if the user is either a chapter member of the requested chapter
 * OR has an active partner team membership. Partners participate in Q&A across
 * chapters as consortium-level contributors; their per-chapter reputation row
 * is still chapter-scoped (see CP-026/027).
 */
function isChapterMemberOrPartner(userId: string, chapterId: string): boolean {
  if (isChapterMember(userId, chapterId)) return true;
  try {
    return resolvePartnerId(userId) !== null;
  } catch {
    return false;
  }
}

function isChapterAdmin(userId: string, chapterId: string): boolean {
  const m = getChapterMembership(userId, chapterId);
  return !!m && m.role === "admin";
}

/** Cross-tenant list of every active chapter admin in a chapter. */
function listChapterAdminUserIds(chapterId: string): string[] {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — chapter_memberships defines tenant scope.
    const rows = db
      .select({ userId: (chapterMembershipsTable as any).userId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).chapterId, chapterId),
          eq((chapterMembershipsTable as any).role, "admin"),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .all() as any[];
    return rows.map((r) => String(r.userId));
  } catch {
    return [];
  }
}

/* --------------------------------------------------------------- */
/* Reputation helpers                                               */
/* --------------------------------------------------------------- */

/**
 * Recompute the per-(user, chapter) reputation totals inside a tx.
 *
 * The denormalized columns on `expert_reputation` are recomputed from the
 * ground truth ledgers (`expert_questions`, `expert_answers`, `expert_votes`)
 * — we never increment a counter speculatively. This keeps reputation in
 * lockstep with the underlying writes even under concurrent updates.
 *
 * Returns the updated row so the caller can check for milestone crossings
 * AFTER the tx commits (notifications are emitted outside the tx).
 */
function recomputeReputationInTx(
  tx: any,
  args: { userId: string; chapterId: string; tenantId: string; ts: string },
): {
  before: ReputationRow | null;
  after: ReputationRow;
} {
  const { userId, chapterId, tenantId, ts } = args;

  // --- Read previous totals (may be null on first write). ---
  const prevRows = tx
    .select()
    .from(reputationTable)
    .where(
      withTenant(
        and(
          eq(reputationTable.userId, userId),
          eq(reputationTable.chapterId, chapterId),
        )!,
        { tenantId, table: reputationTable },
      ),
    )
    .all() as any[];
  const before: ReputationRow | null = prevRows[0]
    ? reputationRowFromDb(prevRows[0])
    : null;

  // --- Ground-truth counts from the ledgers (scoped to this chapter). ---
  const questionsAskedRows = tx
    .select({ c: sql<number>`count(*)` })
    .from(questionsTable)
    .where(
      withTenant(
        and(
          eq(questionsTable.askerUserId, userId),
          eq(questionsTable.chapterId, chapterId),
        )!,
        { tenantId, table: questionsTable },
      ),
    )
    .all() as any[];
  const questionsAsked = Number(questionsAskedRows[0]?.c ?? 0);

  const answersGivenRows = tx
    .select({ c: sql<number>`count(*)` })
    .from(answersTable)
    .where(
      withTenant(
        and(
          eq(answersTable.responderUserId, userId),
          eq(answersTable.chapterId, chapterId),
        )!,
        { tenantId, table: answersTable },
      ),
    )
    .all() as any[];
  const answersGiven = Number(answersGivenRows[0]?.c ?? 0);

  const bestAnswersRows = tx
    .select({ c: sql<number>`count(*)` })
    .from(answersTable)
    .where(
      withTenant(
        and(
          eq(answersTable.responderUserId, userId),
          eq(answersTable.chapterId, chapterId),
          eq(answersTable.isBestAnswer, 1),
        )!,
        { tenantId, table: answersTable },
      ),
    )
    .all() as any[];
  const bestAnswers = Number(bestAnswersRows[0]?.c ?? 0);

  // Net upvotes received = sum_of_answer.upvote_count where responder=user.
  // (upvote_count is itself denormalized inside the vote tx as ups - downs.)
  const upvoteSumRows = tx
    .select({ s: sql<number>`coalesce(sum(${answersTable.upvoteCount}), 0)` })
    .from(answersTable)
    .where(
      withTenant(
        and(
          eq(answersTable.responderUserId, userId),
          eq(answersTable.chapterId, chapterId),
        )!,
        { tenantId, table: answersTable },
      ),
    )
    .all() as any[];
  const upvotesReceived = Number(upvoteSumRows[0]?.s ?? 0);

  const score =
    REP_DELTA.QUESTION_ASKED * questionsAsked +
    REP_DELTA.ANSWER_POSTED * answersGiven +
    REP_DELTA.BEST_ANSWER_MARKED * bestAnswers +
    REP_DELTA.UPVOTE_RECEIVED * upvotesReceived;

  // --- UPSERT the reputation row. ---
  if (!before) {
    const id = genId("rep");
    tx.insert(reputationTable)
      .values({
        id,
        tenantId,
        chapterId,
        userId,
        score,
        questionsAsked,
        answersGiven,
        bestAnswers,
        upvotesReceived,
        lastMilestoneNotified: 0,
        createdAt: ts,
        updatedAt: ts,
      } as any)
      .run();
  } else {
    tx.update(reputationTable)
      .set({
        score,
        questionsAsked,
        answersGiven,
        bestAnswers,
        upvotesReceived,
        updatedAt: ts,
      } as any)
      .where(
        withTenant(
          and(
            eq(reputationTable.userId, userId),
            eq(reputationTable.chapterId, chapterId),
          )!,
          { tenantId, table: reputationTable },
        ),
      )
      .run();
  }

  // --- Re-read so the returned snapshot reflects the just-written row. ---
  const afterRows = tx
    .select()
    .from(reputationTable)
    .where(
      withTenant(
        and(
          eq(reputationTable.userId, userId),
          eq(reputationTable.chapterId, chapterId),
        )!,
        { tenantId, table: reputationTable },
      ),
    )
    .all() as any[];
  const after = reputationRowFromDb(afterRows[0]);

  return { before, after };
}

/**
 * Crossed milestones since the previous score, capped to the highest
 * already-notified milestone. Returns the milestones to notify on AND the
 * new high-water mark to persist.
 */
function milestonesCrossed(args: {
  oldScore: number;
  newScore: number;
  lastNotified: number;
}): { toNotify: number[]; newHighWater: number } {
  const { newScore, lastNotified } = args;
  const toNotify: number[] = [];
  let newHighWater = lastNotified;
  for (const m of MILESTONES) {
    if (newScore >= m && m > lastNotified) {
      toNotify.push(m);
      newHighWater = m;
    }
  }
  return { toNotify, newHighWater };
}

/**
 * Bump `last_milestone_notified` in a fresh tx (the caller has already
 * committed the triggering write). Idempotent — safe to call repeatedly.
 */
function recordMilestoneNotified(args: {
  userId: string;
  chapterId: string;
  tenantId: string;
  newHighWater: number;
}): void {
  const { userId, chapterId, tenantId, newHighWater } = args;
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(reputationTable)
        .set({ lastMilestoneNotified: newHighWater, updatedAt: nowIso() } as any)
        .where(
          withTenant(
            and(
              eq(reputationTable.userId, userId),
              eq(reputationTable.chapterId, chapterId),
            )!,
            { tenantId, table: reputationTable },
          ),
        )
        .run();
    });
  } catch (err) {
    log.warn(
      "[expertQAStore.recordMilestoneNotified] update failed:",
      (err as Error).message,
    );
  }
}

/* --------------------------------------------------------------- */
/* Read helpers (used by route handlers AND tests)                  */
/* --------------------------------------------------------------- */

export function getQuestionById(id: string): QuestionRow | null {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — questions are looked up by id then re-checked
    // against the chapter scope at the route boundary.
    const rows = db
      .select()
      .from(questionsTable)
      .where(
        and(eq(questionsTable.id, id), isNull(questionsTable.deletedAt)),
      )
      .limit(1)
      .all() as any[];
    return rows[0] ? questionRowFromDb(rows[0]) : null;
  } catch {
    return null;
  }
}

export function getAnswerById(id: string): AnswerRow | null {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — same pattern as getQuestionById.
    const rows = db
      .select()
      .from(answersTable)
      .where(
        and(eq(answersTable.id, id), isNull(answersTable.deletedAt)),
      )
      .limit(1)
      .all() as any[];
    return rows[0] ? answerRowFromDb(rows[0]) : null;
  } catch {
    return null;
  }
}

export function getReputationFor(
  userId: string,
  chapterId: string,
): ReputationRow | null {
  try {
    const db: any = getDb();
    const tenantId = tenantForChapter(chapterId);
    const rows = db
      .select()
      .from(reputationTable)
      .where(
        withTenant(
          and(
            eq(reputationTable.userId, userId),
            eq(reputationTable.chapterId, chapterId),
          )!,
          { tenantId, table: reputationTable },
        ),
      )
      .limit(1)
      .all() as any[];
    return rows[0] ? reputationRowFromDb(rows[0]) : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- */
/* Validation schemas                                               */
/* --------------------------------------------------------------- */

const createQuestionBody = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  body: z.string().min(1).max(BODY_MAX),
  tags: z
    .array(z.string().min(1).max(40))
    .max(TAG_MAX)
    .optional()
    .default([]),
  chapter_id: z.string().min(1).optional(),
});

const editQuestionBody = z.object({
  title: z.string().min(1).max(TITLE_MAX).optional(),
  body: z.string().min(1).max(BODY_MAX).optional(),
  tags: z.array(z.string().min(1).max(40)).max(TAG_MAX).optional(),
});

const createAnswerBody = z.object({
  body: z.string().min(1).max(BODY_MAX),
});

const editAnswerBody = z.object({
  body: z.string().min(1).max(BODY_MAX),
});

const voteBody = z.object({
  vote_type: z.enum(["up", "down"]),
});

const flagBody = z.object({
  reason: z.string().min(1).max(500),
});

const listQuery = z.object({
  chapter_id: z.string().min(1).optional(),
  status: z.enum(["open", "answered", "closed", "flagged"]).optional(),
  tag: z.string().optional(),
  sort: z.enum(["recent", "most_voted", "unanswered"]).optional().default("recent"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/* --------------------------------------------------------------- */
/* Notification helpers                                             */
/* --------------------------------------------------------------- */

function notify(args: {
  userId: string;
  kind: string;
  title: string;
  body: string;
  link: string;
}): void {
  try {
    emitNotification({
      userId: args.userId,
      kind: args.kind as NotificationKind,
      title: args.title,
      body: args.body,
      link: args.link,
    });
  } catch {
    /* non-fatal — notifications are best-effort. */
  }
}

/* --------------------------------------------------------------- */
/* Route registration                                               */
/* --------------------------------------------------------------- */

export function registerExpertQARoutes(app: Express): void {
  /* ============================================================ */
  /*  POST /api/collective/questions                              */
  /* ============================================================ */
  app.post(
    "/api/collective/questions",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const parsed = createQuestionBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }

      const chapterId = parsed.data.chapter_id ?? DEFAULT_CHAPTER_ID;
      if (!ctx?.isAdmin && !isChapterMemberOrPartner(userId, chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }

      const tenantId = tenantForChapter(chapterId);
      const ts = nowIso();
      const id = genId("eq");
      const tagsArr = parsed.data.tags ?? [];
      const tagsJson = JSON.stringify(tagsArr);
      const payloadForHash = {
        id,
        tenantId,
        chapterId,
        askerUserId: userId,
        title: parsed.data.title,
        body: parsed.data.body,
        tags: tagsArr,
        action: "create_question",
        ts,
      };
      const currHash = computeHash(null, payloadForHash);

      let createdQuestion: QuestionRow | null = null;
      // Holder object so TS doesn't narrow the field to `never` after the
      // sync tx callback executes (better-sqlite3's callback type is
      // `() => void`, which TS can't relate back to the outer scope).
      const milestone: {
        info: { toNotify: number[]; newHighWater: number } | null;
      } = { info: null };
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.insert(questionsTable)
            .values({
              id,
              tenantId,
              chapterId,
              askerUserId: userId,
              title: parsed.data.title,
              body: parsed.data.body,
              tags: tagsJson,
              status: "open",
              bestAnswerId: null,
              flagReason: null,
              flaggedByUserId: null,
              flaggedAt: null,
              viewCount: 0,
              prevHash: null,
              currHash,
              createdAt: ts,
              updatedAt: ts,
            } as any)
            .run();

          const repResult = recomputeReputationInTx(tx, {
            userId,
            chapterId,
            tenantId,
            ts,
          });
          milestone.info = milestonesCrossed({
            oldScore: repResult.before?.score ?? 0,
            newScore: repResult.after.score,
            lastNotified: repResult.before?.lastMilestoneNotified ?? 0,
          });
        });
        createdQuestion = getQuestionById(id);
      } catch (err) {
        const msg = (err as Error).message ?? "";
        log.error("[POST /api/collective/questions] tx failed:", msg);
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      // --- Audit append (outside the tx). ---
      try {
        appendAdminAudit(
          userId,
          `expert_question:${id}`,
          "collective.expert.question_created",
          {
            questionId: id,
            chapterId,
            askerUserId: userId,
            title: parsed.data.title,
            tags: tagsArr,
            hash: currHash,
          },
          tenantId,
        );
      } catch {
        /* non-fatal */
      }

      // --- Notify chapter admins (digest-style, one per question). ---
      const adminIds = listChapterAdminUserIds(chapterId).filter(
        (uid) => uid !== userId,
      );
      for (const adminId of adminIds) {
        notify({
          userId: adminId,
          kind: "collective.expert.question_created",
          title: `New question in your chapter`,
          body: parsed.data.title.slice(0, 120),
          link: `/collective/ask/${id}`,
        });
      }

      // --- Milestone notifications. ---
      if (milestone.info && milestone.info.toNotify.length > 0) {
        for (const m of milestone.info.toNotify) {
          notify({
            userId,
            kind: "collective.expert.reputation_milestone",
            title: `You reached ${m} reputation`,
            body: `Your contributions in the Collective have earned you ${m} reputation.`,
            link: `/collective/ask`,
          });
        }
        recordMilestoneNotified({
          userId,
          chapterId,
          tenantId,
          newHighWater: milestone.info.newHighWater,
        });
      }

      // v18 Phase D — SSE fan-out (post-commit).
      try {
        ssePublish(chapterId, "questions", {
          kind: "question.created",
          questionId: createdQuestion?.id,
          askerUserId: userId,
          title: createdQuestion?.title,
        });
        if (milestone.info && milestone.info.toNotify.length > 0) {
          ssePublish(chapterId, "questions", {
            kind: "reputation.milestone",
            userId,
            milestones: milestone.info.toNotify,
          });
        }
      } catch { /* non-fatal */ }

      return res.status(201).json({ ok: true, question: createdQuestion });
    },
  );

  /* ============================================================ */
  /*  GET /api/collective/questions                               */
  /* ============================================================ */
  app.get(
    "/api/collective/questions",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }

      const chapterId = parsed.data.chapter_id ?? DEFAULT_CHAPTER_ID;
      if (!ctx?.isAdmin && !isChapterMemberOrPartner(userId, chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }

      try {
        const db: any = getDb();
        const tenantId = tenantForChapter(chapterId);
        const conditions: any[] = [eq(questionsTable.chapterId, chapterId)];
        if (parsed.data.status) {
          conditions.push(eq(questionsTable.status, parsed.data.status));
        }
        if (parsed.data.tag) {
          // SQLite JSON-as-text — substring match on the canonical JSON encoding.
          conditions.push(like(questionsTable.tags, `%"${parsed.data.tag}"%`));
        }

        let rows: any[];
        if (parsed.data.sort === "unanswered") {
          // status='open' AND best_answer_id IS NULL — sort by most recent.
          conditions.push(eq(questionsTable.status, "open"));
          rows = db
            .select()
            .from(questionsTable)
            .where(
              withTenant(and(...conditions)!, {
                tenantId,
                table: questionsTable,
              }),
            )
            .orderBy(desc(questionsTable.createdAt))
            .limit(parsed.data.limit)
            .all() as any[];
        } else if (parsed.data.sort === "most_voted") {
          // Join-less sort: rank by the max upvote_count of any answer for
          // each question via a correlated subquery. SQLite supports this.
          rows = db
            .select()
            .from(questionsTable)
            .where(
              withTenant(and(...conditions)!, {
                tenantId,
                table: questionsTable,
              }),
            )
            .orderBy(
              desc(
                sql<number>`(SELECT COALESCE(MAX(${answersTable.upvoteCount}), 0) FROM ${answersTable} WHERE ${answersTable.questionId} = ${questionsTable.id} AND ${answersTable.deletedAt} IS NULL)`,
              ),
              desc(questionsTable.createdAt),
            )
            .limit(parsed.data.limit)
            .all() as any[];
        } else {
          rows = db
            .select()
            .from(questionsTable)
            .where(
              withTenant(and(...conditions)!, {
                tenantId,
                table: questionsTable,
              }),
            )
            .orderBy(desc(questionsTable.createdAt))
            .limit(parsed.data.limit)
            .all() as any[];
        }

        const questions = rows.map(questionRowFromDb).map(decorateQuestionWithRole);
        return res.json({ ok: true, questions });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        log.error("[GET /api/collective/questions] read failed:", msg);
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }
    },
  );

  /* ============================================================ */
  /*  GET /api/collective/questions/:id                           */
  /* ============================================================ */
  app.get(
    "/api/collective/questions/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const id = String(req.params.id ?? "");
      if (!id) {
        return res
          .status(400)
          .json({ ok: false, error: "missing_question_id" });
      }
      const question = getQuestionById(id);
      if (!question) {
        return res.status(404).json({ ok: false, error: "question_not_found" });
      }
      if (!ctx?.isAdmin && !isChapterMemberOrPartner(userId, question.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }

      // --- Atomically increment view_count (skip when viewer is the asker). ---
      let viewedQuestion = question;
      if (question.askerUserId !== userId) {
        try {
          const db: any = getDb();
          db.transaction((tx: any) => {
            tx.update(questionsTable)
              .set({
                viewCount: sql`${questionsTable.viewCount} + 1`,
                updatedAt: nowIso(),
              } as any)
              .where(
                withTenant(eq(questionsTable.id, id), {
                  tenantId: question.tenantId,
                  table: questionsTable,
                }),
              )
              .run();
          });
          viewedQuestion = getQuestionById(id) ?? question;
        } catch (err) {
          log.warn(
            "[GET /api/collective/questions/:id] view_count bump failed:",
            (err as Error).message,
          );
        }
      }

      // --- Fetch answers sorted: best first, then upvotes desc, then ctime asc. ---
      try {
        const db: any = getDb();
        const answerRows = db
          .select()
          .from(answersTable)
          .where(
            withTenant(eq(answersTable.questionId, id), {
              tenantId: question.tenantId,
              table: answersTable,
            }),
          )
          .orderBy(
            desc(answersTable.isBestAnswer),
            desc(answersTable.upvoteCount),
            asc(answersTable.createdAt),
          )
          .all() as any[];
        const answers = answerRows.map(answerRowFromDb).map(decorateAnswerWithRole);
        const askerReputation = getReputationFor(
          question.askerUserId,
          question.chapterId,
        );
        return res.json({
          ok: true,
          question: decorateQuestionWithRole(viewedQuestion),
          answers,
          askerReputation,
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }
    },
  );

  /* ============================================================ */
  /*  PATCH /api/collective/questions/:id                         */
  /* ============================================================ */
  app.patch(
    "/api/collective/questions/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const parsed = editQuestionBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const id = String(req.params.id ?? "");
      const question = getQuestionById(id);
      if (!question) {
        return res.status(404).json({ ok: false, error: "question_not_found" });
      }
      if (question.askerUserId !== userId && !ctx?.isAdmin) {
        return res.status(403).json({ ok: false, error: "not_question_asker" });
      }
      if (question.status === "flagged" && !ctx?.isAdmin) {
        return res.status(403).json({ ok: false, error: "question_flagged" });
      }
      if (question.status === "closed" && !ctx?.isAdmin) {
        return res.status(409).json({ ok: false, error: "question_closed" });
      }

      const newTitle = parsed.data.title ?? question.title;
      const newBody = parsed.data.body ?? question.body;
      const newTags = parsed.data.tags ?? question.tags;
      const ts = nowIso();
      const payloadForHash = {
        id: question.id,
        action: "edit_question",
        title: newTitle,
        body: newBody,
        tags: newTags,
        editorUserId: userId,
        ts,
      };
      const currHash = computeHash(question.currHash, payloadForHash);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(questionsTable)
            .set({
              title: newTitle,
              body: newBody,
              tags: JSON.stringify(newTags),
              prevHash: question.currHash,
              currHash,
              updatedAt: ts,
            } as any)
            .where(
              withTenant(eq(questionsTable.id, id), {
                tenantId: question.tenantId,
                table: questionsTable,
              }),
            )
            .run();
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      try {
        appendAdminAudit(
          userId,
          `expert_question:${id}`,
          "collective.expert.question_edited",
          { questionId: id, hash: currHash, prevHash: question.currHash },
          question.tenantId,
        );
      } catch {
        /* non-fatal */
      }

      return res.json({ ok: true, question: getQuestionById(id) });
    },
  );

  /* ============================================================ */
  /*  POST /api/collective/questions/:id/close                    */
  /* ============================================================ */
  app.post(
    "/api/collective/questions/:id/close",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const id = String(req.params.id ?? "");
      const question = getQuestionById(id);
      if (!question) {
        return res.status(404).json({ ok: false, error: "question_not_found" });
      }
      const allowed =
        ctx?.isAdmin ||
        question.askerUserId === userId ||
        isChapterAdmin(userId, question.chapterId);
      if (!allowed) {
        return res
          .status(403)
          .json({ ok: false, error: "not_asker_or_chapter_admin" });
      }
      if (question.status === "closed") {
        return res.json({ ok: true, question, idempotent: true });
      }

      const ts = nowIso();
      const payloadForHash = {
        id,
        action: "close_question",
        closedByUserId: userId,
        ts,
      };
      const currHash = computeHash(question.currHash, payloadForHash);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(questionsTable)
            .set({
              status: "closed",
              prevHash: question.currHash,
              currHash,
              updatedAt: ts,
            } as any)
            .where(
              withTenant(eq(questionsTable.id, id), {
                tenantId: question.tenantId,
                table: questionsTable,
              }),
            )
            .run();
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      try {
        appendAdminAudit(
          userId,
          `expert_question:${id}`,
          "collective.expert.question_closed",
          { questionId: id, hash: currHash },
          question.tenantId,
        );
      } catch {
        /* non-fatal */
      }

      return res.json({ ok: true, question: getQuestionById(id) });
    },
  );

  /* ============================================================ */
  /*  POST /api/collective/questions/:id/answers                  */
  /* ============================================================ */
  app.post(
    "/api/collective/questions/:id/answers",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const parsed = createAnswerBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const qid = String(req.params.id ?? "");
      const question = getQuestionById(qid);
      if (!question) {
        return res.status(404).json({ ok: false, error: "question_not_found" });
      }
      if (!ctx?.isAdmin && !isChapterMemberOrPartner(userId, question.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      if (question.askerUserId === userId) {
        return res
          .status(403)
          .json({ ok: false, error: "cannot_answer_own_question" });
      }
      if (question.status === "closed" || question.status === "flagged") {
        return res
          .status(409)
          .json({ ok: false, error: `question_${question.status}` });
      }

      const ts = nowIso();
      const id = genId("ea");
      const payloadForHash = {
        id,
        tenantId: question.tenantId,
        chapterId: question.chapterId,
        questionId: qid,
        responderUserId: userId,
        body: parsed.data.body,
        action: "create_answer",
        ts,
      };
      const currHash = computeHash(null, payloadForHash);

      // Compute next-question hash for status='answered' flip.
      const questionPayload = {
        id: qid,
        action: "first_answer_received",
        answerId: id,
        ts,
      };
      const questionCurrHash = computeHash(question.currHash, questionPayload);

      let createdAnswer: AnswerRow | null = null;
      const milestone: {
        info: { toNotify: number[]; newHighWater: number } | null;
      } = { info: null };

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.insert(answersTable)
            .values({
              id,
              tenantId: question.tenantId,
              chapterId: question.chapterId,
              questionId: qid,
              responderUserId: userId,
              body: parsed.data.body,
              upvoteCount: 0,
              isBestAnswer: 0,
              status: "active",
              flagReason: null,
              flaggedByUserId: null,
              flaggedAt: null,
              prevHash: null,
              currHash,
              createdAt: ts,
              updatedAt: ts,
            } as any)
            .run();

          // Bump question status to 'answered' when this is the first answer.
          if (question.status === "open") {
            tx.update(questionsTable)
              .set({
                status: "answered",
                prevHash: question.currHash,
                currHash: questionCurrHash,
                updatedAt: ts,
              } as any)
              .where(
                withTenant(eq(questionsTable.id, qid), {
                  tenantId: question.tenantId,
                  table: questionsTable,
                }),
              )
              .run();
          }

          const repResult = recomputeReputationInTx(tx, {
            userId,
            chapterId: question.chapterId,
            tenantId: question.tenantId,
            ts,
          });
          milestone.info = milestonesCrossed({
            oldScore: repResult.before?.score ?? 0,
            newScore: repResult.after.score,
            lastNotified: repResult.before?.lastMilestoneNotified ?? 0,
          });
        });
        createdAnswer = getAnswerById(id);
      } catch (err) {
        const msg = (err as Error).message ?? "";
        log.error(
          "[POST /api/collective/questions/:id/answers] tx failed:",
          msg,
        );
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      try {
        appendAdminAudit(
          userId,
          `expert_answer:${id}`,
          "collective.expert.answer_created",
          {
            answerId: id,
            questionId: qid,
            chapterId: question.chapterId,
            responderUserId: userId,
            hash: currHash,
          },
          question.tenantId,
        );
      } catch {
        /* non-fatal */
      }

      // --- Notify the asker. ---
      notify({
        userId: question.askerUserId,
        kind: "collective.expert.answer_received",
        title: `New answer to your question`,
        body: question.title.slice(0, 120),
        link: `/collective/ask/${qid}`,
      });

      if (milestone.info && milestone.info.toNotify.length > 0) {
        for (const m of milestone.info.toNotify) {
          notify({
            userId,
            kind: "collective.expert.reputation_milestone",
            title: `You reached ${m} reputation`,
            body: `Your contributions in the Collective have earned you ${m} reputation.`,
            link: `/collective/ask`,
          });
        }
        recordMilestoneNotified({
          userId,
          chapterId: question.chapterId,
          tenantId: question.tenantId,
          newHighWater: milestone.info.newHighWater,
        });
      }

      // v18 Phase D — SSE fan-out (post-commit).
      try {
        ssePublish(question.chapterId, "questions", {
          kind: "answer.created",
          answerId: createdAnswer?.id,
          questionId: question.id,
          responderUserId: userId,
        });
        if (milestone.info && milestone.info.toNotify.length > 0) {
          ssePublish(question.chapterId, "questions", {
            kind: "reputation.milestone",
            userId,
            milestones: milestone.info.toNotify,
          });
        }
      } catch { /* non-fatal */ }

      return res.status(201).json({ ok: true, answer: createdAnswer });
    },
  );

  /* ============================================================ */
  /*  PATCH /api/collective/answers/:id                           */
  /* ============================================================ */
  app.patch(
    "/api/collective/answers/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const parsed = editAnswerBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const id = String(req.params.id ?? "");
      const answer = getAnswerById(id);
      if (!answer) {
        return res.status(404).json({ ok: false, error: "answer_not_found" });
      }
      if (answer.responderUserId !== userId && !ctx?.isAdmin) {
        return res.status(403).json({ ok: false, error: "not_answer_responder" });
      }
      if (answer.status === "flagged" && !ctx?.isAdmin) {
        return res.status(403).json({ ok: false, error: "answer_flagged" });
      }
      if (answer.status === "deleted") {
        return res.status(409).json({ ok: false, error: "answer_deleted" });
      }

      const ts = nowIso();
      const payloadForHash = {
        id,
        action: "edit_answer",
        body: parsed.data.body,
        editorUserId: userId,
        ts,
      };
      const currHash = computeHash(answer.currHash, payloadForHash);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(answersTable)
            .set({
              body: parsed.data.body,
              status: "edited",
              prevHash: answer.currHash,
              currHash,
              updatedAt: ts,
            } as any)
            .where(
              withTenant(eq(answersTable.id, id), {
                tenantId: answer.tenantId,
                table: answersTable,
              }),
            )
            .run();
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      try {
        appendAdminAudit(
          userId,
          `expert_answer:${id}`,
          "collective.expert.answer_edited",
          { answerId: id, hash: currHash, prevHash: answer.currHash },
          answer.tenantId,
        );
      } catch {
        /* non-fatal */
      }

      return res.json({ ok: true, answer: getAnswerById(id) });
    },
  );

  /* ============================================================ */
  /*  POST /api/collective/answers/:id/vote                       */
  /* ============================================================ */
  app.post(
    "/api/collective/answers/:id/vote",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const parsed = voteBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const aid = String(req.params.id ?? "");
      const answer = getAnswerById(aid);
      if (!answer) {
        return res.status(404).json({ ok: false, error: "answer_not_found" });
      }
      if (!ctx?.isAdmin && !isChapterMemberOrPartner(userId, answer.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      if (answer.responderUserId === userId) {
        return res
          .status(403)
          .json({ ok: false, error: "cannot_vote_on_own_answer" });
      }
      if (answer.status === "deleted" || answer.status === "flagged") {
        return res
          .status(409)
          .json({ ok: false, error: `answer_${answer.status}` });
      }

      const voteType = parsed.data.vote_type;
      const ts = nowIso();

      type VoteOutcome = "created" | "replaced" | "removed";
      const voteState: {
        outcome: VoteOutcome;
        newUpvoteCount: number;
        newAnswerHash: string;
        milestoneInfo: { toNotify: number[]; newHighWater: number } | null;
      } = {
        outcome: "created",
        newUpvoteCount: 0,
        newAnswerHash: answer.currHash,
        milestoneInfo: null,
      };

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          // --- Look up existing vote row. ---
          const existingRows = tx
            .select()
            .from(votesTable)
            .where(
              withTenant(
                and(
                  eq(votesTable.answerId, aid),
                  eq(votesTable.voterUserId, userId),
                )!,
                { tenantId: answer.tenantId, table: votesTable, skipSoftDelete: true },
              ),
            )
            .all() as any[];
          const existing = existingRows[0];

          if (existing && String(existing.voteType ?? existing.vote_type) === voteType) {
            // Same vote_type as before → toggle off (remove).
            tx.delete(votesTable)
              .where(
                withTenant(eq(votesTable.id, existing.id), {
                  tenantId: answer.tenantId,
                  table: votesTable,
                  skipSoftDelete: true,
                }),
              )
              .run();
            voteState.outcome = "removed";
          } else if (existing) {
            // Different vote_type → replace (update).
            tx.update(votesTable)
              .set({ voteType, createdAt: ts } as any)
              .where(
                withTenant(eq(votesTable.id, existing.id), {
                  tenantId: answer.tenantId,
                  table: votesTable,
                  skipSoftDelete: true,
                }),
              )
              .run();
            voteState.outcome = "replaced";
          } else {
            // Fresh vote. UNIQUE(answer_id, voter_user_id) makes any concurrent
            // duplicate insert fail loudly — better-sqlite3 throws SQLITE_CONSTRAINT
            // which we catch outside the tx (so the user sees a 409).
            tx.insert(votesTable)
              .values({
                id: genId("ev"),
                tenantId: answer.tenantId,
                chapterId: answer.chapterId,
                answerId: aid,
                voterUserId: userId,
                voteType,
                createdAt: ts,
              } as any)
              .run();
            voteState.outcome = "created";
          }

          // --- Recompute denormalized upvote_count from the ledger. ---
          const tallyRows = tx
            .select({
              ups: sql<number>`SUM(CASE WHEN ${votesTable.voteType} = 'up' THEN 1 ELSE 0 END)`,
              downs: sql<number>`SUM(CASE WHEN ${votesTable.voteType} = 'down' THEN 1 ELSE 0 END)`,
            })
            .from(votesTable)
            .where(
              withTenant(eq(votesTable.answerId, aid), {
                tenantId: answer.tenantId,
                table: votesTable,
                skipSoftDelete: true,
              }),
            )
            .all() as any[];
          const ups = Number(tallyRows[0]?.ups ?? 0);
          const downs = Number(tallyRows[0]?.downs ?? 0);
          const localUpvoteCount = ups - downs;
          voteState.newUpvoteCount = localUpvoteCount;

          const answerPayload = {
            id: aid,
            action: "vote_applied",
            voterUserId: userId,
            voteType,
            outcome: voteState.outcome,
            ups,
            downs,
            ts,
          };
          const localHash = computeHash(answer.currHash, answerPayload);
          voteState.newAnswerHash = localHash;

          tx.update(answersTable)
            .set({
              upvoteCount: localUpvoteCount,
              prevHash: answer.currHash,
              currHash: localHash,
              updatedAt: ts,
            } as any)
            .where(
              withTenant(eq(answersTable.id, aid), {
                tenantId: answer.tenantId,
                table: answersTable,
              }),
            )
            .run();

          // --- Reputation for the responder may change (their upvote_count
          //     just shifted). Voter's reputation is NOT impacted. ---
          const repResult = recomputeReputationInTx(tx, {
            userId: answer.responderUserId,
            chapterId: answer.chapterId,
            tenantId: answer.tenantId,
            ts,
          });
          voteState.milestoneInfo = milestonesCrossed({
            oldScore: repResult.before?.score ?? 0,
            newScore: repResult.after.score,
            lastNotified: repResult.before?.lastMilestoneNotified ?? 0,
          });
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        // Surface the UNIQUE-constraint race as a 409 rather than a 500.
        if (/UNIQUE constraint failed/i.test(msg)) {
          return res
            .status(409)
            .json({ ok: false, error: "duplicate_vote" });
        }
        log.error(
          "[POST /api/collective/answers/:id/vote] tx failed:",
          msg,
        );
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      try {
        appendAdminAudit(
          userId,
          `expert_answer:${aid}`,
          "collective.expert.vote_applied",
          {
            answerId: aid,
            voterUserId: userId,
            voteType,
            outcome: voteState.outcome,
            upvoteCount: voteState.newUpvoteCount,
            hash: voteState.newAnswerHash,
          },
          answer.tenantId,
        );
      } catch {
        /* non-fatal */
      }

      if (voteState.milestoneInfo && voteState.milestoneInfo.toNotify.length > 0) {
        for (const m of voteState.milestoneInfo.toNotify) {
          notify({
            userId: answer.responderUserId,
            kind: "collective.expert.reputation_milestone",
            title: `You reached ${m} reputation`,
            body: `Your contributions in the Collective have earned you ${m} reputation.`,
            link: `/collective/ask`,
          });
        }
        recordMilestoneNotified({
          userId: answer.responderUserId,
          chapterId: answer.chapterId,
          tenantId: answer.tenantId,
          newHighWater: voteState.milestoneInfo.newHighWater,
        });
      }

      return res.json({
        ok: true,
        outcome: voteState.outcome,
        answer: getAnswerById(aid),
      });
    },
  );

  /* ============================================================ */
  /*  POST /api/collective/answers/:id/accept-best                */
  /* ============================================================ */
  app.post(
    "/api/collective/answers/:id/accept-best",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const aid = String(req.params.id ?? "");
      const answer = getAnswerById(aid);
      if (!answer) {
        return res.status(404).json({ ok: false, error: "answer_not_found" });
      }
      const question = getQuestionById(answer.questionId);
      if (!question) {
        return res.status(404).json({ ok: false, error: "question_not_found" });
      }
      if (question.askerUserId !== userId && !ctx?.isAdmin) {
        return res.status(403).json({ ok: false, error: "not_question_asker" });
      }
      if (question.status === "flagged" || answer.status === "flagged") {
        return res.status(409).json({ ok: false, error: "flagged" });
      }
      // No-op when this answer is ALREADY best — idempotent.
      if (answer.isBestAnswer && question.bestAnswerId === aid) {
        return res.json({
          ok: true,
          idempotent: true,
          question,
          answer,
        });
      }

      const ts = nowIso();
      const previousBest =
        question.bestAnswerId && question.bestAnswerId !== aid
          ? getAnswerById(question.bestAnswerId)
          : null;

      const newAnswerPayload = {
        id: aid,
        action: "marked_best",
        markedByUserId: userId,
        previousBestAnswerId: previousBest?.id ?? null,
        ts,
      };
      const newAnswerHash = computeHash(answer.currHash, newAnswerPayload);

      const revertPayload = previousBest
        ? {
            id: previousBest.id,
            action: "best_revoked",
            revokedByUserId: userId,
            newBestAnswerId: aid,
            ts,
          }
        : null;
      const revertHash = previousBest && revertPayload
        ? computeHash(previousBest.currHash, revertPayload)
        : null;

      const questionPayload = {
        id: question.id,
        action: "accept_best_answer",
        bestAnswerId: aid,
        previousBestAnswerId: previousBest?.id ?? null,
        ts,
      };
      const questionHash = computeHash(question.currHash, questionPayload);

      const affectedResponderIds: string[] = [answer.responderUserId];
      if (previousBest && previousBest.responderUserId !== answer.responderUserId) {
        affectedResponderIds.push(previousBest.responderUserId);
      }

      const repInfo: Record<
        string,
        { toNotify: number[]; newHighWater: number }
      > = {};

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          // 1) Mark the new best.
          tx.update(answersTable)
            .set({
              isBestAnswer: 1,
              prevHash: answer.currHash,
              currHash: newAnswerHash,
              updatedAt: ts,
            } as any)
            .where(
              withTenant(eq(answersTable.id, aid), {
                tenantId: answer.tenantId,
                table: answersTable,
              }),
            )
            .run();

          // 2) Revert the previous best (if any).
          if (previousBest && revertHash) {
            tx.update(answersTable)
              .set({
                isBestAnswer: 0,
                prevHash: previousBest.currHash,
                currHash: revertHash,
                updatedAt: ts,
              } as any)
              .where(
                withTenant(eq(answersTable.id, previousBest.id), {
                  tenantId: previousBest.tenantId,
                  table: answersTable,
                }),
              )
              .run();
          }

          // 3) Update the question with the new best_answer_id.
          tx.update(questionsTable)
            .set({
              bestAnswerId: aid,
              prevHash: question.currHash,
              currHash: questionHash,
              updatedAt: ts,
            } as any)
            .where(
              withTenant(eq(questionsTable.id, question.id), {
                tenantId: question.tenantId,
                table: questionsTable,
              }),
            )
            .run();

          // 4) Recompute reputation for everyone affected.
          for (const responderUid of affectedResponderIds) {
            const r = recomputeReputationInTx(tx, {
              userId: responderUid,
              chapterId: question.chapterId,
              tenantId: question.tenantId,
              ts,
            });
            repInfo[responderUid] = milestonesCrossed({
              oldScore: r.before?.score ?? 0,
              newScore: r.after.score,
              lastNotified: r.before?.lastMilestoneNotified ?? 0,
            });
          }
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        log.error(
          "[POST /api/collective/answers/:id/accept-best] tx failed:",
          msg,
        );
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      try {
        appendAdminAudit(
          userId,
          `expert_answer:${aid}`,
          "collective.expert.best_answer_accepted",
          {
            answerId: aid,
            questionId: question.id,
            previousBestAnswerId: previousBest?.id ?? null,
            hash: newAnswerHash,
          },
          question.tenantId,
        );
      } catch {
        /* non-fatal */
      }

      // Notify the new best responder.
      notify({
        userId: answer.responderUserId,
        kind: "collective.expert.best_answer_accepted",
        title: `Your answer was accepted as best`,
        body: question.title.slice(0, 120),
        link: `/collective/ask/${question.id}`,
      });

      for (const [uid, info] of Object.entries(repInfo)) {
        if (info.toNotify.length === 0) continue;
        for (const m of info.toNotify) {
          notify({
            userId: uid,
            kind: "collective.expert.reputation_milestone",
            title: `You reached ${m} reputation`,
            body: `Your contributions in the Collective have earned you ${m} reputation.`,
            link: `/collective/ask`,
          });
        }
        recordMilestoneNotified({
          userId: uid,
          chapterId: question.chapterId,
          tenantId: question.tenantId,
          newHighWater: info.newHighWater,
        });
      }

      // v18 Phase D — SSE fan-out (post-commit).
      try {
        ssePublish(question.chapterId, "questions", {
          kind: "answer.accepted_best",
          answerId: aid,
          questionId: question.id,
          previousBestId: previousBest?.id ?? null,
        });
      } catch { /* non-fatal */ }

      return res.json({
        ok: true,
        question: getQuestionById(question.id),
        answer: getAnswerById(aid),
        previousBest: previousBest ? getAnswerById(previousBest.id) : null,
      });
    },
  );

  /* ============================================================ */
  /*  POST /api/collective/questions/:id/flag                     */
  /* ============================================================ */
  app.post(
    "/api/collective/questions/:id/flag",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const parsed = flagBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const id = String(req.params.id ?? "");
      const question = getQuestionById(id);
      if (!question) {
        return res.status(404).json({ ok: false, error: "question_not_found" });
      }
      if (!ctx?.isAdmin && !isChapterMemberOrPartner(userId, question.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      const ts = nowIso();
      const payloadForHash = {
        id,
        action: "flag_question",
        flaggedByUserId: userId,
        reason: parsed.data.reason,
        ts,
      };
      const currHash = computeHash(question.currHash, payloadForHash);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(questionsTable)
            .set({
              status: "flagged",
              flagReason: parsed.data.reason,
              flaggedByUserId: userId,
              flaggedAt: ts,
              prevHash: question.currHash,
              currHash,
              updatedAt: ts,
            } as any)
            .where(
              withTenant(eq(questionsTable.id, id), {
                tenantId: question.tenantId,
                table: questionsTable,
              }),
            )
            .run();
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      try {
        appendAdminAudit(
          userId,
          `expert_question:${id}`,
          "collective.expert.question_flagged",
          {
            questionId: id,
            flaggedByUserId: userId,
            reason: parsed.data.reason,
            hash: currHash,
          },
          question.tenantId,
        );
      } catch {
        /* non-fatal */
      }

      // Notify chapter admins of the moderation event.
      const adminIds = listChapterAdminUserIds(question.chapterId);
      for (const adminId of adminIds) {
        notify({
          userId: adminId,
          kind: "collective.expert.moderation_flag",
          title: `Question flagged in your chapter`,
          body: parsed.data.reason.slice(0, 200),
          link: `/collective/ask/${id}`,
        });
      }

      return res.json({ ok: true, question: getQuestionById(id) });
    },
  );

  /* ============================================================ */
  /*  POST /api/collective/answers/:id/flag                       */
  /* ============================================================ */
  app.post(
    "/api/collective/answers/:id/flag",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    (req: Request, res: Response) => {
      const parsed = flagBody.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const id = String(req.params.id ?? "");
      const answer = getAnswerById(id);
      if (!answer) {
        return res.status(404).json({ ok: false, error: "answer_not_found" });
      }
      if (!ctx?.isAdmin && !isChapterMemberOrPartner(userId, answer.chapterId)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      const ts = nowIso();
      const payloadForHash = {
        id,
        action: "flag_answer",
        flaggedByUserId: userId,
        reason: parsed.data.reason,
        ts,
      };
      const currHash = computeHash(answer.currHash, payloadForHash);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(answersTable)
            .set({
              status: "flagged",
              flagReason: parsed.data.reason,
              flaggedByUserId: userId,
              flaggedAt: ts,
              prevHash: answer.currHash,
              currHash,
              updatedAt: ts,
            } as any)
            .where(
              withTenant(eq(answersTable.id, id), {
                tenantId: answer.tenantId,
                table: answersTable,
              }),
            )
            .run();
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      try {
        appendAdminAudit(
          userId,
          `expert_answer:${id}`,
          "collective.expert.answer_flagged",
          {
            answerId: id,
            flaggedByUserId: userId,
            reason: parsed.data.reason,
            hash: currHash,
          },
          answer.tenantId,
        );
      } catch {
        /* non-fatal */
      }

      const adminIds = listChapterAdminUserIds(answer.chapterId);
      for (const adminId of adminIds) {
        notify({
          userId: adminId,
          kind: "collective.expert.moderation_flag",
          title: `Answer flagged in your chapter`,
          body: parsed.data.reason.slice(0, 200),
          link: `/collective/ask/${answer.questionId}`,
        });
      }

      return res.json({ ok: true, answer: getAnswerById(id) });
    },
  );

  /* ============================================================ */
  /*  GET /api/collective/reputation/:userId? (self when omitted) */
  /* ============================================================ */
  // Express 5 / path-to-regexp v6+ dropped support for the `:param?`
  // optional-segment shorthand. We register two routes that delegate
  // to a single shared handler.
  const reputationHandler = (req: Request, res: Response) => {
    const ctx = (req as any).userContext as
      | { userId?: string; isAdmin?: boolean }
      | undefined;
    const userId = ctx?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "missing_identity" });
    }
    const targetUserId = String(req.params.userId ?? userId);
    const chapterId =
      typeof req.query.chapter_id === "string" && req.query.chapter_id
        ? String(req.query.chapter_id)
        : DEFAULT_CHAPTER_ID;
    // Caller must be a member of the chapter they're reading (or admin).
    if (!ctx?.isAdmin && !isChapterMemberOrPartner(userId, chapterId)) {
      return res.status(403).json({ ok: false, error: "not_chapter_member" });
    }
    const rep = getReputationFor(targetUserId, chapterId);
    // Return a zeroed-out row when no contributions yet — the FE expects
    // a stable shape it can render a "0 reputation" badge from.
    const out: ReputationRow = rep ?? {
      id: "",
      tenantId: tenantForChapter(chapterId),
      chapterId,
      userId: targetUserId,
      score: 0,
      questionsAsked: 0,
      answersGiven: 0,
      bestAnswers: 0,
      upvotesReceived: 0,
      lastMilestoneNotified: 0,
      createdAt: "",
      updatedAt: "",
    };
    return res.json({ ok: true, reputation: out });
  };
  app.get(
    "/api/collective/reputation",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    reputationHandler,
  );
  app.get(
    "/api/collective/reputation/:userId",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveOrPartnerMember,
    reputationHandler,
  );
}

/* --------------------------------------------------------------- */
/* Test-only exports                                                */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  computeHash,
  recomputeReputationInTx,
  milestonesCrossed,
  getChapterMembership,
  isChapterMember,
  isChapterAdmin,
  listChapterAdminUserIds,
  REP_DELTA,
  MILESTONES,
});
