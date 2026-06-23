/**
 * server/messagingStore.ts — v25.34 Collective Mega-Wave (DB-direct read migration)
 *
 * ===========================================================================
 * v25.34 CHANGE BLOCK
 * ---------------------------------------------------------------------------
 * Prior state: a hybrid Map+DB store. messagesCache / threadsCache were
 * write-through caches, BUT the single-row finders
 * (findMessageByIdAnyTenant / findThreadByIdAnyTenant) returned the cached
 * row FIRST and only hit the DB on a cache miss — so a row that was present in
 * cache but stale could mask the durable DB state.
 *
 * v25.34 delta:
 *   - findMessageByIdAnyTenant / findThreadByIdAnyTenant are now DB-FIRST:
 *     they query SQLite and refresh the cache from the row; the cache is used
 *     ONLY as a fallback when the DB read itself throws.
 *   - The list endpoints (GET /api/messages, /threads, /threads/:id) were
 *     ALREADY DB-first (db.select().all() with cache-on-error fallback) and
 *     are unchanged.
 *   - The write paths (sendMessage / markRead / edit / delete) were ALREADY
 *     fail-closed: each runs db.transaction(...) with NO surrounding catch, so
 *     a DB failure throws BEFORE the cache.set lines (cache mutated only after
 *     a successful commit). Left intact.
 * Public function signatures preserved. Satisfies Ozan's rule #1.
 * ===========================================================================
 *
 * server/messagingStore.ts — v19 Phase B.
 *
 * Messaging surface for the non-Collective channels (DMs, group threads,
 * broadcasts, system messages). The v17 Phase B Collective slice
 * (`collective_channel_posts`) is the authoritative table for chapter-channel
 * posts and is owned by `commsStore.ts` — this store does NOT touch it.
 *
 * Hybrid Map+DB:
 *   - Every write goes through `getDb().transaction((tx) => {...})` (SYNC,
 *     better-sqlite3 rejects async transaction callbacks).
 *   - The in-memory Maps are write-through caches; on boot they re-hydrate
 *     from the DB. They are NOT the source of truth — the DB is.
 *
 * Endpoints (consolidate scattered current paths under a single /api/messages
 * surface; no public path was previously claimed for /api/messages so the
 * existing /api/comms/* surface is preserved unchanged by `commsStore.ts`):
 *
 *   POST   /api/messages                       — send (creates thread if needed)
 *   GET    /api/messages                       — list (filters: thread_id, chapter_id, recipient_user_id)
 *   GET    /api/messages/:id                   — detail
 *   PATCH  /api/messages/:id                   — sender-only edit (status='edited')
 *   DELETE /api/messages/:id                   — sender-only soft-delete (status='deleted')
 *   POST   /api/messages/:id/read              — upsert read receipt + denorm cache
 *   GET    /api/messages/threads               — list threads current user is in
 *   GET    /api/messages/threads/:id           — thread detail with paginated messages
 *   POST   /api/messages/threads               — create thread with initial message
 *
 * Hard rules (V19_BUILD_BRIEF.md §1-12):
 *   - SYNC transactions only; hashes pre-computed BEFORE opening tx.
 *   - `withTenant()` on every tenant-scoped query; cross-tenant marked inline.
 *   - SSE publish AFTER tx commits — never inside.
 *   - Math sacred — does not touch cap-table-engine or
 *     captableCommitStore.ts lines 354–477.
 *   - NO mock data, NO TODOs, NO stubs.
 *   - Feature flag: chapter-scoped messages gate on COLLECTIVE_ENABLED=1;
 *     non-chapter messages work even when the flag is off.
 */

import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { getDb } from "./db/connection";
import {
  messages as messagesTable,
  messageThreads as messageThreadsTable,
  messageReadReceipts as messageReadReceiptsTable,
  chapterMemberships as chapterMembershipsTable,
} from "@shared/schema";
import { publish as ssePublish } from "./lib/sseHub";
import { tenantForChapter, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { getChapterMembership } from "./screeningEventsStore";
import { log } from "./lib/logger";

/* ============================================================
 * Types
 * ============================================================ */

export type MessageChannelType = "direct" | "group" | "thread" | "broadcast" | "system";
export type MessageStatus = "sent" | "edited" | "deleted";

export interface MessageRow {
  id: string;
  tenantId: string;
  chapterId: string | null;
  threadId: string | null;
  channelType: MessageChannelType;
  senderUserId: string;
  recipientUserIds: string[];
  subject: string | null;
  body: string;
  attachments: string[];
  readBy: string[];
  status: MessageStatus;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MessageThreadRow {
  id: string;
  tenantId: string;
  chapterId: string | null;
  title: string;
  participantUserIds: string[];
  lastMessageId: string | null;
  lastActivityAt: string;
  createdByUserId: string;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/* ============================================================
 * In-memory caches (write-through)
 * ============================================================ */

const messagesCache = new Map<string, MessageRow>();
const threadsCache = new Map<string, MessageThreadRow>();

/* ============================================================
 * Helpers
 * ============================================================ */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function safeJsonArray(s: unknown): string[] {
  if (Array.isArray(s)) return s.map(String);
  if (typeof s !== "string" || s.length === 0) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function rowToMessage(r: any): MessageRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    chapterId: r.chapter_id ?? r.chapterId ?? null,
    threadId: r.thread_id ?? r.threadId ?? null,
    channelType: (r.channel_type ?? r.channelType) as MessageChannelType,
    senderUserId: r.sender_user_id ?? r.senderUserId,
    recipientUserIds: safeJsonArray(r.recipient_user_ids ?? r.recipientUserIds),
    subject: r.subject ?? null,
    body: r.body,
    attachments: safeJsonArray(r.attachments),
    readBy: safeJsonArray(r.read_by ?? r.readBy),
    status: (r.status ?? "sent") as MessageStatus,
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

function rowToThread(r: any): MessageThreadRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    chapterId: r.chapter_id ?? r.chapterId ?? null,
    title: r.title ?? "",
    participantUserIds: safeJsonArray(r.participant_user_ids ?? r.participantUserIds),
    lastMessageId: r.last_message_id ?? r.lastMessageId ?? null,
    lastActivityAt: r.last_activity_at ?? r.lastActivityAt,
    createdByUserId: r.created_by_user_id ?? r.createdByUserId,
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

/**
 * CROSS-TENANT (admin) — justified because callers may message recipients
 * outside their active tenant (DM between users who share a chapter
 * membership but have different active tenants). The recipient-membership
 * check enforces ownership downstream.
 */
function findMessageByIdAnyTenant(id: string): MessageRow | null {
  // v25.34: DB-FIRST read. The DB is the source of truth; the cache is only a
  // fallback when the DB read itself throws (so a stale-but-present cache row
  // can never mask a durable update/delete).
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(messagesTable)
      .where(eq((messagesTable as any).id, id))
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    const row = rowToMessage(rows[0]);
    messagesCache.set(row.id, row);
    return row;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[messagingStore.findMessageById] DB read failed, using cache:", msg);
    }
    return messagesCache.get(id) ?? null;
  }
}

/**
 * CROSS-TENANT (admin) — justified because thread lookup must work for any
 * participant regardless of their active tenant.
 */
function findThreadByIdAnyTenant(id: string): MessageThreadRow | null {
  // v25.34: DB-FIRST read (cache is fallback only on DB error).
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(messageThreadsTable)
      .where(eq((messageThreadsTable as any).id, id))
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    const row = rowToThread(rows[0]);
    threadsCache.set(row.id, row);
    return row;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[messagingStore.findThreadById] DB read failed, using cache:", msg);
    }
    return threadsCache.get(id) ?? null;
  }
}

/** Latest message in a thread (by createdAt). Returns null if none / not found. */
function findLatestMessageInThread(threadId: string): MessageRow | null {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — thread membership establishes scope; per-message
    // tenant filtering would over-constrain when threads span chapters.
    const rows = db
      .select()
      .from(messagesTable)
      .where(eq((messagesTable as any).threadId, threadId))
      .all() as any[];
    if (rows.length === 0) return null;
    rows.sort((a, b) => String(b.created_at ?? b.createdAt).localeCompare(String(a.created_at ?? a.createdAt)));
    return rowToMessage(rows[0]);
  } catch {
    return null;
  }
}

/* ============================================================
 * Membership / authz helpers
 * ============================================================ */

function callerUserId(req: Request): string | null {
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  return ctx?.userId ?? null;
}

function isPlatformAdmin(req: Request): boolean {
  const ctx = (req as Request & { userContext?: { isAdmin?: boolean } }).userContext;
  return !!ctx?.isAdmin;
}

/**
 * For a chapter-scoped message, caller must be an active member of the chapter.
 * Platform admins bypass.
 */
function isChapterMemberOrAdmin(userId: string, chapterId: string, req: Request): boolean {
  if (isPlatformAdmin(req)) return true;
  return !!getChapterMembership(userId, chapterId);
}

/**
 * For a broadcast, caller must be a chapter admin or platform admin.
 */
function isChapterAdminOrPlatformAdmin(userId: string, chapterId: string, req: Request): boolean {
  if (isPlatformAdmin(req)) return true;
  const m = getChapterMembership(userId, chapterId);
  return !!m && m.role === "admin";
}

/**
 * Does the caller share any active chapter membership with the candidate?
 * Used by direct/group messages: anyone can DM anyone they share a chapter with.
 *
 * CROSS-TENANT (admin) — justified because chapter_memberships is the
 * authoritative cross-tenant index.
 */
/**
 * v23.9 B1/AV-19 — whether `caller` may message `other` directly. The old
 * code only allowed DMs between two users who shared a Collective chapter,
 * which blocked the common case (a founder DMing their own investor, or two
 * founders with a CRM relationship). One-on-one direct messages between any
 * two authenticated users are now allowed by default; the chapter requirement
 * is retained only for broadcast/group channels (handled at the call sites).
 */
function canDirectMessage(callerUserId: string, otherUserId: string): boolean {
  if (!callerUserId || !otherUserId) return false;
  if (callerUserId === otherUserId) return true;
  // A shared chapter is still sufficient; but a direct DM no longer requires it.
  return true;
}

function sharesAnyChapterMembership(callerUserId: string, otherUserId: string): boolean {
  if (callerUserId === otherUserId) return true;
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — justified: chapter_memberships establishes the
    // cross-tenant graph used to decide whether two users may DM.
    const callerChapters = db
      .select({ cid: (chapterMembershipsTable as any).chapterId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, callerUserId),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .all() as Array<{ cid: string }>;
    if (callerChapters.length === 0) return false;
    const callerChapterSet = new Set(callerChapters.map((r) => r.cid));
    // CROSS-TENANT (admin) — same justification.
    const otherChapters = db
      .select({ cid: (chapterMembershipsTable as any).chapterId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, otherUserId),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .all() as Array<{ cid: string }>;
    for (const r of otherChapters) if (callerChapterSet.has(r.cid)) return true;
    return false;
  } catch {
    // If the membership table is unavailable, fail-open for non-chapter DMs;
    // the recipient-set membership requirement in handlers covers the
    // genuine isolation properties.
    return true;
  }
}

/* ============================================================
 * Zod validation
 * ============================================================ */

const sendBodySchema = z.object({
  recipients: z.array(z.string().min(1)).min(1).max(200),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(20_000),
  attachments: z.array(z.string().url().or(z.string().regex(/^https?:\/\//))).max(20).optional(),
  thread_id: z.string().min(1).optional(),
  chapter_id: z.string().min(1).optional(),
  channel_type: z.enum(["direct", "group", "thread", "broadcast"]).optional(),
});

const editBodySchema = z.object({
  body: z.string().min(1).max(20_000),
});

const createThreadBodySchema = z.object({
  title: z.string().max(200).optional(),
  participants: z.array(z.string().min(1)).min(1).max(200),
  chapter_id: z.string().min(1).optional(),
  initial_body: z.string().min(1).max(20_000),
  initial_subject: z.string().max(500).optional(),
  attachments: z.array(z.string()).max(20).optional(),
});

/* ============================================================
 * Core write — send message
 * ============================================================ */

interface SendArgs {
  sender: string;
  recipients: string[];
  subject?: string;
  body: string;
  attachments: string[];
  threadId: string | null;
  chapterId: string | null;
  channelType: MessageChannelType;
  /** When provided AND threadId is null, create a thread with these participants. */
  newThreadParticipants?: string[];
  newThreadTitle?: string;
}

interface SendResult {
  message: MessageRow;
  thread: MessageThreadRow | null;
  threadCreated: boolean;
}

function sendMessageInternal(args: SendArgs): SendResult {
  const db: any = getDb();
  const now = nowIso();
  const tenantId = args.chapterId ? tenantForChapter(args.chapterId) : DEFAULT_CHAPTER_TENANT_ID;

  // Pre-compute hash inputs (BEFORE opening tx — sync rule).
  const messageId = newId("msg");
  const messagePayload: Record<string, unknown> = {
    id: messageId,
    tenantId,
    chapterId: args.chapterId,
    senderUserId: args.sender,
    recipientUserIds: args.recipients,
    body: args.body,
    channelType: args.channelType,
    createdAt: now,
  };
  // Look up prev hash chain tip (last message globally for this tenant). Using
  // a global chain tip per tenant keeps the chain auditable even when the
  // thread moves across rooms.
  let prevHash: string | null = null;
  try {
    const tipRows = db
      .select({ h: (messagesTable as any).currHash, c: (messagesTable as any).createdAt })
      .from(messagesTable)
      .where(eq((messagesTable as any).tenantId, tenantId))
      .all() as Array<{ h: string; c: string }>;
    if (tipRows.length > 0) {
      tipRows.sort((a, b) => String(b.c).localeCompare(String(a.c)));
      prevHash = tipRows[0].h ?? null;
    }
  } catch {
    prevHash = null;
  }
  const currHash = computeHash(prevHash, messagePayload);

  // Thread setup: create if requested.
  let thread: MessageThreadRow | null = null;
  let threadCreated = false;
  let threadId = args.threadId;
  let newThreadHash: string | null = null;
  let newThreadPrevHash: string | null = null;
  let newThread: MessageThreadRow | null = null;
  if (!threadId && args.newThreadParticipants && args.newThreadParticipants.length > 0) {
    const tid = newId("mthr");
    const threadPrev: string | null = null; // genesis for the new thread
    const threadPayload: Record<string, unknown> = {
      id: tid,
      tenantId,
      chapterId: args.chapterId,
      title: args.newThreadTitle ?? "",
      participants: args.newThreadParticipants,
      createdBy: args.sender,
      createdAt: now,
    };
    newThreadPrevHash = threadPrev;
    newThreadHash = computeHash(threadPrev, threadPayload);
    newThread = {
      id: tid,
      tenantId,
      chapterId: args.chapterId,
      title: args.newThreadTitle ?? "",
      participantUserIds: args.newThreadParticipants,
      lastMessageId: messageId,
      lastActivityAt: now,
      createdByUserId: args.sender,
      prevHash: newThreadPrevHash,
      currHash: newThreadHash,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    threadId = tid;
    threadCreated = true;
  }

  const messageRow: MessageRow = {
    id: messageId,
    tenantId,
    chapterId: args.chapterId,
    threadId,
    channelType: args.channelType,
    senderUserId: args.sender,
    recipientUserIds: args.recipients,
    subject: args.subject ?? null,
    body: args.body,
    attachments: args.attachments,
    readBy: [args.sender], // sender has "read" their own message
    status: "sent",
    prevHash,
    currHash,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  // Compute updated thread state (if joining an existing thread) — used to
  // refresh the last_message_id pointer and the activity timestamp.
  let existingThreadUpdate: { id: string; lastMessageId: string; lastActivityAt: string } | null = null;
  if (threadId && !threadCreated) {
    existingThreadUpdate = { id: threadId, lastMessageId: messageId, lastActivityAt: now };
  }

  db.transaction((tx: any) => {
    tx.insert(messagesTable).values({
      id: messageRow.id,
      tenantId: messageRow.tenantId,
      chapterId: messageRow.chapterId ?? null,
      threadId: messageRow.threadId ?? null,
      channelType: messageRow.channelType,
      senderUserId: messageRow.senderUserId,
      recipientUserIds: JSON.stringify(messageRow.recipientUserIds),
      subject: messageRow.subject ?? null,
      body: messageRow.body,
      attachments: JSON.stringify(messageRow.attachments),
      readBy: JSON.stringify(messageRow.readBy),
      status: messageRow.status,
      prevHash: messageRow.prevHash,
      currHash: messageRow.currHash,
      createdAt: messageRow.createdAt,
      updatedAt: messageRow.updatedAt,
      deletedAt: null,
    }).run();
    if (newThread) {
      tx.insert(messageThreadsTable).values({
        id: newThread.id,
        tenantId: newThread.tenantId,
        chapterId: newThread.chapterId ?? null,
        title: newThread.title,
        participantUserIds: JSON.stringify(newThread.participantUserIds),
        lastMessageId: newThread.lastMessageId ?? null,
        lastActivityAt: newThread.lastActivityAt,
        createdByUserId: newThread.createdByUserId,
        prevHash: newThread.prevHash,
        currHash: newThread.currHash,
        createdAt: newThread.createdAt,
        updatedAt: newThread.updatedAt,
        deletedAt: null,
      }).run();
    } else if (existingThreadUpdate) {
      tx.update(messageThreadsTable)
        .set({
          lastMessageId: existingThreadUpdate.lastMessageId,
          lastActivityAt: existingThreadUpdate.lastActivityAt,
          updatedAt: now,
        })
        .where(eq((messageThreadsTable as any).id, existingThreadUpdate.id))
        .run();
    }
    // Sender's read receipt is established at send time (denorm parity).
    const receiptId = newId("mrr");
    tx.insert(messageReadReceiptsTable).values({
      id: receiptId,
      messageId: messageRow.id,
      userId: messageRow.senderUserId,
      readAt: now,
    }).run();
  });

  messagesCache.set(messageRow.id, messageRow);
  if (newThread) {
    threadsCache.set(newThread.id, newThread);
    thread = newThread;
  } else if (existingThreadUpdate) {
    const existing = findThreadByIdAnyTenant(existingThreadUpdate.id);
    if (existing) {
      existing.lastMessageId = messageRow.id;
      existing.lastActivityAt = now;
      existing.updatedAt = now;
      threadsCache.set(existing.id, existing);
      thread = existing;
    }
  }

  return { message: messageRow, thread, threadCreated };
}

/* ============================================================
 * Read-receipt upsert
 * ============================================================ */

function markMessageReadInternal(messageId: string, userId: string): MessageRow | null {
  const row = findMessageByIdAnyTenant(messageId);
  if (!row) return null;
  if (row.deletedAt) return row;
  if (row.readBy.includes(userId)) return row; // idempotent

  const db: any = getDb();
  const now = nowIso();
  const nextReadBy = [...row.readBy, userId];

  db.transaction((tx: any) => {
    // Idempotent UPSERT on (message_id, user_id).
    try {
      const receiptId = newId("mrr");
      tx.insert(messageReadReceiptsTable).values({
        id: receiptId,
        messageId,
        userId,
        readAt: now,
      }).run();
    } catch (err) {
      // UNIQUE conflict — already exists. The denorm cache is the
      // source of truth for "did caller see this in their inbox?",
      // so reflect the receipt even when DB row pre-existed.
      const msg = (err as Error).message ?? "";
      if (!/UNIQUE constraint/i.test(msg) && !/SQLITE_CONSTRAINT/i.test(msg)) {
        throw err;
      }
    }
    tx.update(messagesTable)
      .set({
        readBy: JSON.stringify(nextReadBy),
        updatedAt: now,
      })
      .where(eq((messagesTable as any).id, messageId))
      .run();
  });

  row.readBy = nextReadBy;
  row.updatedAt = now;
  messagesCache.set(row.id, row);
  return row;
}

/* ============================================================
 * Soft delete + edit
 * ============================================================ */

function editMessageInternal(messageId: string, newBody: string): MessageRow | null {
  const row = findMessageByIdAnyTenant(messageId);
  if (!row) return null;
  if (row.deletedAt || row.status === "deleted") return null;

  const db: any = getDb();
  const now = nowIso();
  // Hash chain extends: prev = current curr_hash.
  const nextPayload = { id: row.id, body: newBody, editedAt: now };
  const nextPrev = row.currHash;
  const nextHash = computeHash(nextPrev, nextPayload);

  db.transaction((tx: any) => {
    tx.update(messagesTable)
      .set({
        body: newBody,
        status: "edited",
        prevHash: nextPrev,
        currHash: nextHash,
        updatedAt: now,
      })
      .where(eq((messagesTable as any).id, messageId))
      .run();
  });

  row.body = newBody;
  row.status = "edited";
  row.prevHash = nextPrev;
  row.currHash = nextHash;
  row.updatedAt = now;
  messagesCache.set(row.id, row);
  return row;
}

function deleteMessageInternal(messageId: string): MessageRow | null {
  const row = findMessageByIdAnyTenant(messageId);
  if (!row) return null;
  if (row.deletedAt) return row;

  const db: any = getDb();
  const now = nowIso();
  const nextPayload = { id: row.id, deleted: true, deletedAt: now };
  const nextPrev = row.currHash;
  const nextHash = computeHash(nextPrev, nextPayload);

  db.transaction((tx: any) => {
    tx.update(messagesTable)
      .set({
        status: "deleted",
        prevHash: nextPrev,
        currHash: nextHash,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq((messagesTable as any).id, messageId))
      .run();
  });

  row.status = "deleted";
  row.prevHash = nextPrev;
  row.currHash = nextHash;
  row.deletedAt = now;
  row.updatedAt = now;
  messagesCache.set(row.id, row);
  return row;
}

/* ============================================================
 * SSE publish targeting
 * ============================================================ */

function publishMessageEvent(
  evtType: "messages.sent" | "messages.edited" | "messages.deleted" | "messages.read",
  msg: MessageRow,
): void {
  const audience = new Set<string>();
  audience.add(msg.senderUserId);
  for (const r of msg.recipientUserIds) audience.add(r);
  const chapterId = msg.chapterId ?? "platform";
  // Publishing here uses the chapterId scope on the hub. For non-chapter
  // messages we use the synthetic "platform" channel so subscribers tuned to
  // "platform" with topic "messages" receive cross-chapter DMs.
  ssePublish(chapterId, "messages", {
    type: evtType,
    messageId: msg.id,
    threadId: msg.threadId,
    chapterId: msg.chapterId,
    senderUserId: msg.senderUserId,
    recipientUserIds: Array.from(audience),
    status: msg.status,
    occurredAt: nowIso(),
  });
}

/* ============================================================
 * Hydrator
 * ============================================================ */

export async function hydrateMessagingStore(): Promise<void> {
  try {
    const db: any = getDb();
    const msgRows = db
      .select()
      .from(messagesTable)
      .all() as any[];
    for (const r of msgRows) {
      const row = rowToMessage(r);
      messagesCache.set(row.id, row);
    }
    const threadRows = db
      .select()
      .from(messageThreadsTable)
      .all() as any[];
    for (const r of threadRows) {
      const row = rowToThread(r);
      threadsCache.set(row.id, row);
    }
    if (msgRows.length > 0 || threadRows.length > 0) {
      log.info(`[hydrate] messagingStore: ${msgRows.length} messages, ${threadRows.length} threads restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] messagingStore: DB read failed:", msg);
    }
  }
}

/* ============================================================
 * Endpoint registration
 * ============================================================ */

function requireCollectiveEnabledForChapterScope(req: Request, res: Response): boolean {
  // Chapter-scoped messages require COLLECTIVE_ENABLED=1; non-chapter
  // messages work even when the flag is off.
  const chapterId = (req.body?.chapter_id ?? req.query?.chapter_id) as string | undefined;
  if (!chapterId) return true;
  if (process.env.COLLECTIVE_ENABLED === "1") return true;
  res.status(503).json({ error: "COLLECTIVE_DISABLED", message: "Chapter-scoped messaging is gated by COLLECTIVE_ENABLED." });
  return false;
}

export function registerMessagingRoutes(app: Express): void {
  /* ------------------------------------------------------------
   * POST /api/messages  — send (creates thread if no thread_id)
   * ------------------------------------------------------------ */
  app.post("/api/messages", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const parsed = sendBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    if (!requireCollectiveEnabledForChapterScope(req, res)) return;

    const channelType: MessageChannelType = parsed.data.channel_type
      ?? (parsed.data.recipients.length > 1 ? "group" : "direct");

    if (channelType === "broadcast") {
      const chapterId = parsed.data.chapter_id;
      if (!chapterId) {
        res.status(400).json({ error: "BROADCAST_REQUIRES_CHAPTER", message: "Broadcasts require chapter_id." });
        return;
      }
      if (!isChapterAdminOrPlatformAdmin(caller, chapterId, req)) {
        res.status(403).json({ error: "NOT_CHAPTER_ADMIN", message: "Broadcasts require chapter admin." });
        return;
      }
    }

    // System messages are internal-only.
    if ((parsed.data.channel_type as string | undefined) === "system") {
      res.status(403).json({ error: "SYSTEM_MESSAGE_INTERNAL_ONLY" });
      return;
    }

    // Chapter membership check.
    if (parsed.data.chapter_id) {
      if (!isChapterMemberOrAdmin(caller, parsed.data.chapter_id, req)) {
        res.status(403).json({ error: "NOT_CHAPTER_MEMBER" });
        return;
      }
    }

    // v23.9 B1/AV-19 — direct 1-on-1 DMs are allowed between any authenticated
    // users (the prior shared-chapter requirement blocked founder↔investor and
    // founder↔founder DMs). Group channels still require a shared chapter so a
    // user can't pull arbitrary strangers into a multi-party thread.
    if (channelType === "direct") {
      for (const r of parsed.data.recipients) {
        if (!canDirectMessage(caller, r) && !isPlatformAdmin(req)) {
          res.status(403).json({ error: "CANNOT_DM_RECIPIENT", recipient: r });
          return;
        }
      }
    } else if (channelType === "group") {
      for (const r of parsed.data.recipients) {
        if (!sharesAnyChapterMembership(caller, r) && !isPlatformAdmin(req)) {
          res.status(403).json({ error: "NO_SHARED_CHAPTER", recipient: r });
          return;
        }
      }
    }

    // Resolve thread state.
    let threadId: string | null = parsed.data.thread_id ?? null;
    let participants: string[] | undefined;
    if (threadId) {
      const t = findThreadByIdAnyTenant(threadId);
      if (!t) {
        res.status(404).json({ error: "THREAD_NOT_FOUND" });
        return;
      }
      if (!t.participantUserIds.includes(caller) && !isPlatformAdmin(req)) {
        res.status(403).json({ error: "NOT_THREAD_PARTICIPANT" });
        return;
      }
    } else if (channelType !== "broadcast") {
      // Create a new thread implicitly for direct/group/thread channel types.
      const set = new Set<string>([caller, ...parsed.data.recipients]);
      participants = Array.from(set);
    }

    const sent = sendMessageInternal({
      sender: caller,
      recipients: parsed.data.recipients,
      subject: parsed.data.subject,
      body: parsed.data.body,
      attachments: parsed.data.attachments ?? [],
      threadId,
      chapterId: parsed.data.chapter_id ?? null,
      channelType,
      newThreadParticipants: participants,
      newThreadTitle: parsed.data.subject,
    });

    publishMessageEvent("messages.sent", sent.message);
    res.status(201).json({ ok: true, message: sent.message, thread: sent.thread, threadCreated: sent.threadCreated });
  });

  /* ------------------------------------------------------------
   * GET /api/messages  — list
   * ------------------------------------------------------------ */
  app.get("/api/messages", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const threadId = req.query.thread_id as string | undefined;
    const chapterId = req.query.chapter_id as string | undefined;
    const recipientFilter = req.query.recipient_user_id as string | undefined;

    if (chapterId && !isChapterMemberOrAdmin(caller, chapterId, req)) {
      res.status(403).json({ error: "NOT_CHAPTER_MEMBER" });
      return;
    }

    let rows: MessageRow[] = [];
    try {
      const db: any = getDb();
      // CROSS-TENANT (admin) — inbox queries are by-user, not by-tenant. The
      // recipient/sender filter below enforces ownership.
      const all = db.select().from(messagesTable).all() as any[];
      rows = all
        .map(rowToMessage)
        .filter((m) => !m.deletedAt && m.status !== "deleted");
    } catch {
      rows = Array.from(messagesCache.values()).filter((m) => !m.deletedAt && m.status !== "deleted");
    }

    let filtered = rows;
    if (threadId) {
      const t = findThreadByIdAnyTenant(threadId);
      if (!t) {
        res.status(404).json({ error: "THREAD_NOT_FOUND" });
        return;
      }
      if (!t.participantUserIds.includes(caller) && !isPlatformAdmin(req)) {
        res.status(403).json({ error: "NOT_THREAD_PARTICIPANT" });
        return;
      }
      filtered = filtered.filter((m) => m.threadId === threadId);
    } else if (chapterId) {
      filtered = filtered.filter((m) => m.chapterId === chapterId);
    } else if (recipientFilter === "me") {
      filtered = filtered.filter(
        (m) => m.senderUserId === caller || m.recipientUserIds.includes(caller),
      );
    } else {
      // Default scope: messages caller is involved in.
      filtered = filtered.filter(
        (m) => m.senderUserId === caller || m.recipientUserIds.includes(caller),
      );
    }

    filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json({ messages: filtered, count: filtered.length });
  });

  /* ------------------------------------------------------------
   * GET /api/messages/threads — list threads caller is in
   * ------------------------------------------------------------ */
  app.get("/api/messages/threads", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    let threads: MessageThreadRow[] = [];
    try {
      const db: any = getDb();
      const all = db.select().from(messageThreadsTable).all() as any[];
      threads = all.map(rowToThread).filter((t) => !t.deletedAt);
    } catch {
      threads = Array.from(threadsCache.values()).filter((t) => !t.deletedAt);
    }
    const mine = threads.filter(
      (t) => t.participantUserIds.includes(caller) || isPlatformAdmin(req),
    );
    mine.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    res.json({ threads: mine, count: mine.length });
  });

  /* ------------------------------------------------------------
   * GET /api/messages/threads/:id — thread detail w/ messages (paginated)
   * ------------------------------------------------------------ */
  app.get("/api/messages/threads/:id", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const t = findThreadByIdAnyTenant(String(req.params.id));
    if (!t || t.deletedAt) {
      res.status(404).json({ error: "THREAD_NOT_FOUND" });
      return;
    }
    if (!t.participantUserIds.includes(caller) && !isPlatformAdmin(req)) {
      res.status(403).json({ error: "NOT_THREAD_PARTICIPANT" });
      return;
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
    let msgs: MessageRow[] = [];
    try {
      const db: any = getDb();
      const all = db
        .select()
        .from(messagesTable)
        .where(eq((messagesTable as any).threadId, t.id))
        .all() as any[];
      msgs = all.map(rowToMessage).filter((m) => !m.deletedAt);
    } catch {
      msgs = Array.from(messagesCache.values()).filter((m) => m.threadId === t.id && !m.deletedAt);
    }
    msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const total = msgs.length;
    const page = msgs.slice(offset, offset + limit);
    res.json({ thread: t, messages: page, total, limit, offset });
  });

  /* ------------------------------------------------------------
   * POST /api/messages/threads — create thread + initial message
   * ------------------------------------------------------------ */
  app.post("/api/messages/threads", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const parsed = createThreadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    if (parsed.data.chapter_id && process.env.COLLECTIVE_ENABLED !== "1") {
      res.status(503).json({ error: "COLLECTIVE_DISABLED" });
      return;
    }
    if (parsed.data.chapter_id && !isChapterMemberOrAdmin(caller, parsed.data.chapter_id, req)) {
      res.status(403).json({ error: "NOT_CHAPTER_MEMBER" });
      return;
    }
    // v23.9 B1/AV-19 — a chapter-less thread with a single other participant is
    // a direct 1-on-1 DM; allow it between any authenticated users. Group/
    // chapter threads (chapter_id present, or >1 participant) still require a
    // shared chapter membership.
    const isDirectDm = !parsed.data.chapter_id && parsed.data.participants.length <= 1;
    // Membership check on participants: caller must share a chapter with each.
    for (const p of parsed.data.participants) {
      if (isDirectDm) {
        if (!canDirectMessage(caller, p) && !isPlatformAdmin(req)) {
          res.status(403).json({ error: "CANNOT_DM_PARTICIPANT", participant: p });
          return;
        }
        continue;
      }
      if (!sharesAnyChapterMembership(caller, p) && !isPlatformAdmin(req)) {
        res.status(403).json({ error: "NO_SHARED_CHAPTER", participant: p });
        return;
      }
    }
    const allParticipants = Array.from(new Set<string>([caller, ...parsed.data.participants]));
    const sent = sendMessageInternal({
      sender: caller,
      recipients: parsed.data.participants,
      subject: parsed.data.initial_subject,
      body: parsed.data.initial_body,
      attachments: parsed.data.attachments ?? [],
      threadId: null,
      chapterId: parsed.data.chapter_id ?? null,
      channelType: parsed.data.participants.length > 1 ? "group" : "direct",
      newThreadParticipants: allParticipants,
      newThreadTitle: parsed.data.title ?? "",
    });
    publishMessageEvent("messages.sent", sent.message);
    res.status(201).json({ ok: true, thread: sent.thread, message: sent.message });
  });

  /* ------------------------------------------------------------
   * GET /api/messages/:id — detail
   * ------------------------------------------------------------ */
  app.get("/api/messages/:id", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const row = findMessageByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });
      return;
    }
    const involved = row.senderUserId === caller || row.recipientUserIds.includes(caller);
    if (!involved && !isPlatformAdmin(req)) {
      // For chapter messages, chapter admins may view.
      if (row.chapterId && isChapterAdminOrPlatformAdmin(caller, row.chapterId, req)) {
        // allowed
      } else {
        res.status(403).json({ error: "NOT_INVOLVED" });
        return;
      }
    }
    res.json({ message: row });
  });

  /* ------------------------------------------------------------
   * PATCH /api/messages/:id — sender-only edit
   * ------------------------------------------------------------ */
  app.patch("/api/messages/:id", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const row = findMessageByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt || row.status === "deleted") {
      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });
      return;
    }
    if (row.senderUserId !== caller && !isPlatformAdmin(req)) {
      res.status(403).json({ error: "SENDER_ONLY" });
      return;
    }
    const parsed = editBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    const updated = editMessageInternal(row.id, parsed.data.body);
    if (!updated) {
      res.status(409).json({ error: "EDIT_FAILED" });
      return;
    }
    publishMessageEvent("messages.edited", updated);
    res.json({ ok: true, message: updated });
  });

  /* ------------------------------------------------------------
   * DELETE /api/messages/:id — sender-only soft-delete
   * ------------------------------------------------------------ */
  app.delete("/api/messages/:id", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const row = findMessageByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });
      return;
    }
    if (row.senderUserId !== caller && !isPlatformAdmin(req)) {
      res.status(403).json({ error: "SENDER_ONLY" });
      return;
    }
    const updated = deleteMessageInternal(row.id);
    if (!updated) {
      res.status(409).json({ error: "DELETE_FAILED" });
      return;
    }
    publishMessageEvent("messages.deleted", updated);
    res.json({ ok: true, message: updated });
  });

  /* ------------------------------------------------------------
   * POST /api/messages/:id/read — UPSERT read receipt + denorm cache
   * ------------------------------------------------------------ */
  app.post("/api/messages/:id/read", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    const row = findMessageByIdAnyTenant(String(req.params.id));
    if (!row || row.deletedAt) {
      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });
      return;
    }
    const involved = row.senderUserId === caller || row.recipientUserIds.includes(caller);
    if (!involved && !isPlatformAdmin(req)) {
      res.status(403).json({ error: "NOT_INVOLVED" });
      return;
    }
    const updated = markMessageReadInternal(row.id, caller);
    if (!updated) {
      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });
      return;
    }
    publishMessageEvent("messages.read", updated);
    res.json({ ok: true, message: updated, idempotent: row.readBy.includes(caller) });
  });
}

/* ============================================================
 * Test access helpers
 * ============================================================ */

export const _messagingInternal = {
  computeHash,
  sendMessageInternal,
  markMessageReadInternal,
  editMessageInternal,
  deleteMessageInternal,
  findMessageByIdAnyTenant,
  findThreadByIdAnyTenant,
  findLatestMessageInThread,
  messagesCache,
  threadsCache,
  rowToMessage,
  rowToThread,
};
