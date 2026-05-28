/**
 * v18 Phase D — /api/collective/stream  (CP Phase C — topic-aware auth)
 *
 * Per-(chapter, topic) SSE stream endpoint. Wraps `sseHub.subscribe()` in
 * an HTTP handler with:
 *
 *   - requireCollectiveEnabled → 503 when feature flag off
 *   - requireAuth              → 401 if not signed in
 *   - per-topic auth (CP-034)  → see PARTNER_TOPICS / CHAPTER_TOPICS below
 *
 * Query string contract:
 *   /api/collective/stream?chapter_id=chap_keiretsu_canada&topics=comms,events
 *
 *   - `chapter_id`        OPTIONAL but REQUIRED for any chapter-scoped topic.
 *                          Partner-only topics (partner-workspace, crm, spv)
 *                          resolve to the caller's partnerId at subscribe
 *                          time.
 *   - `topics`            comma-separated subset of SSE_TOPICS. If omitted,
 *                          defaults to topics the caller can access.
 *   - `partner_id`        OPTIONAL — if supplied alongside partner topics,
 *                          must match the caller's resolved partnerId.
 *
 * Per-topic access matrix (CP-034):
 *
 *   CHAPTER_TOPICS (require chapter membership of the requested chapter):
 *     comms, events, announcements, resources, dsc-votes, offers,
 *     questions, billing, leaderboard, audit-verify, promotion-moderation
 *
 *   PARTNER_TOPICS (require active partner team membership):
 *     partner-workspace, crm, spv
 *
 *   ANY_OF_TOPICS (require chapter member OR partner member):
 *     collective-portfolio, messages, consortium-apply, gdpr
 *
 *   The caller's subscription is built as the INTERSECTION of (requested
 *   topics) ∩ (topics the caller can access). If the intersection is empty,
 *   the request 403s with `no_authorized_topics`.
 *
 * Back-compat: `/api/collective/stream` remains the canonical path; an
 * alias `/api/stream` is also registered. Front-end clients hard-code the
 * Collective path today, so the canonical path is preserved.
 *
 * Wire format (compatible with browser EventSource):
 *
 *   :connected cid=<correlationId>\n\n
 *   event: <topic>\ndata: <json>\n\n        (per-event)
 *   :hb cid=<correlationId>\n\n             (every 30s heartbeat)
 *
 * The 'lag' synthetic topic delivered by the hub when a subscriber's
 * bounded queue overflows is forwarded verbatim as `event: lag`.
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { _internal as chapterMemberInternal } from "./lib/requireChapterMember";
import { resolvePartnerId } from "./lib/requirePartner";
import { hasActiveCollectiveMembership } from "./lib/requireCollectiveOrPartner";
import {
  SSE_TOPICS,
  isValidTopic,
  subscribe,
  type SseTopic,
} from "./lib/sseHub";

const HEARTBEAT_INTERVAL_MS = 30_000;

// CP-034: per-topic access matrix.
const PARTNER_TOPICS: ReadonlySet<SseTopic> = new Set<SseTopic>([
  "partner-workspace",
  "crm",
  "spv",
]);

const ANY_OF_TOPICS: ReadonlySet<SseTopic> = new Set<SseTopic>([
  "collective-portfolio",
  "messages",
  "consortium-apply",
  "gdpr",
]);

/** All other topics in SSE_TOPICS are treated as chapter-scoped. */
function isChapterTopic(t: SseTopic): boolean {
  return !PARTNER_TOPICS.has(t) && !ANY_OF_TOPICS.has(t);
}

function parseRequestedTopics(raw: unknown): SseTopic[] | "all" {
  if (typeof raw !== "string" || raw.trim() === "") {
    return "all";
  }
  const out: SseTopic[] = [];
  for (const t of raw.split(",")) {
    const trimmed = t.trim();
    if (isValidTopic(trimmed) && !out.includes(trimmed)) {
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * Compute the topics the caller is authorized for, given their resolved
 * memberships and the chapter context (if any).
 */
function authorizedTopics(args: {
  isAdmin: boolean;
  chapterMember: boolean;
  partnerMember: boolean;
  collectiveMember: boolean;
  chapterScoped: boolean;
}): SseTopic[] {
  const { isAdmin, chapterMember, partnerMember, collectiveMember, chapterScoped } = args;
  const allowed: SseTopic[] = [];
  for (const topic of SSE_TOPICS) {
    if (isAdmin) {
      allowed.push(topic);
      continue;
    }
    if (PARTNER_TOPICS.has(topic)) {
      if (partnerMember) allowed.push(topic);
      continue;
    }
    if (ANY_OF_TOPICS.has(topic)) {
      // CP Phase C hotfix: when chapter_id is supplied, ANY_OF topics must be
      // grounded in actual chapter or partner membership of that scope —
      // bare Collective membership is not sufficient to subscribe to a
      // chapter the caller does not belong to.
      if (chapterScoped) {
        if (chapterMember || partnerMember) allowed.push(topic);
      } else if (chapterMember || partnerMember || collectiveMember) {
        allowed.push(topic);
      }
      continue;
    }
    // chapter-scoped: requires chapter membership of the *requested* chapter.
    if (chapterMember) allowed.push(topic);
  }
  return allowed;
}

interface SseHandlerCtx {
  userId: string;
  isAdmin: boolean;
}

async function handleSseRequest(
  req: Request,
  res: Response,
  ctx: SseHandlerCtx,
): Promise<void> {
  const { userId, isAdmin } = ctx;

  const chapterId = String(
    (req.query.chapter_id ?? req.query.chapterId ?? "") as string,
  ).trim();

  // Resolve the caller's partner team membership (returns partnerId or null).
  const partnerId = resolvePartnerId(userId);
  const partnerMember = isAdmin || partnerId !== null;

  // Resolve chapter membership iff a chapter_id was supplied. Admins bypass.
  const chapterMember =
    chapterId.length > 0 &&
    (isAdmin || chapterMemberInternal.isActiveChapterMember(userId, chapterId));

  const collectiveMember = isAdmin || hasActiveCollectiveMembership(userId);

  // Validate the optional explicit partner_id query param — if supplied it
  // must equal the caller's resolved partnerId (admins bypass).
  const explicitPartnerId = String(
    (req.query.partner_id ?? req.query.partnerId ?? "") as string,
  ).trim();
  if (explicitPartnerId && !isAdmin && explicitPartnerId !== partnerId) {
    res.status(403).json({ ok: false, error: "partner_id_mismatch" });
    return;
  }

  // CP Phase C hotfix: if a chapter_id was supplied, the caller must have
  // a concrete membership tie to that chapter scope (chapter member, partner
  // team member, or admin). A bare Collective membership is NOT sufficient
  // to open a stream against an arbitrary chapter the caller does not belong
  // to — that was a CP-C regression that this guard closes.
  const chapterScoped = chapterId.length > 0;
  if (chapterScoped && !chapterMember && !partnerMember && !isAdmin) {
    res.status(403).json({ ok: false, error: "not_member" });
    return;
  }

  const requested = parseRequestedTopics(req.query.topics);
  const allowed = authorizedTopics({
    isAdmin,
    chapterMember,
    partnerMember,
    collectiveMember,
    chapterScoped,
  });

  // Compute intersection.
  let topics: SseTopic[];
  if (requested === "all") {
    topics = allowed;
  } else {
    const allowedSet = new Set(allowed);
    topics = requested.filter((t) => allowedSet.has(t));
  }

  if (topics.length === 0) {
    res.status(403).json({ ok: false, error: "no_authorized_topics" });
    return;
  }

  // For chapter-scoped topics we must have a chapter_id; reject otherwise.
  const needsChapter = topics.some((t) => isChapterTopic(t));
  if (needsChapter && chapterId.length === 0) {
    res.status(400).json({ ok: false, error: "missing_chapter_id" });
    return;
  }

  // Subscription "chapter id" — for chapter topics we use the requested
  // chapterId. For partner-only subscriptions we use the partnerId as the
  // synthetic chapter id (matches partnerWorkspaceV19Store.publish() which
  // uses chapterId=partnerId for partner-workspace topic publishes).
  // For mixed subscriptions we have to split: chapter topics on chapterId,
  // partner topics on partnerId.
  const chapterTopics = topics.filter((t) => isChapterTopic(t) || ANY_OF_TOPICS.has(t));
  const partnerOnlyTopics = topics.filter((t) => PARTNER_TOPICS.has(t));

  // SSE headers.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const correlationId = (req as Request & { id?: string }).id ?? "unknown";
  try {
    res.write(`:connected cid=${correlationId}\n\n`);
  } catch {
    return;
  }

  const subs: Array<{ close: () => void; iterator: AsyncIterableIterator<{ topic: string; data: unknown }> }> = [];

  if (chapterTopics.length > 0 && chapterId) {
    subs.push(subscribe({ userId, chapterId, topics: chapterTopics }));
  }
  if (partnerOnlyTopics.length > 0 && (partnerId || isAdmin)) {
    // For admin without a partnerId, fall back to wildcard partner scope by
    // using an explicit partner_id query param if provided; otherwise skip.
    const partnerScope = partnerId ?? explicitPartnerId;
    if (partnerScope) {
      subs.push(
        subscribe({ userId, chapterId: partnerScope, topics: partnerOnlyTopics }),
      );
    }
  }

  if (subs.length === 0) {
    // Should not happen because we already checked topics.length, but be
    // defensive — if we couldn't pin a chapter or partner scope, 403.
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "no_subscribable_scope" })}\n\n`);
    } catch { /* noop */ }
    try { res.end(); } catch { /* noop */ }
    return;
  }

  const beat = setInterval(() => {
    try {
      res.write(`:hb cid=${correlationId}\n\n`);
    } catch {
      /* close handler will clean up */
    }
  }, HEARTBEAT_INTERVAL_MS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (beat as any)?.unref?.();

  let closed = false;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    try { clearInterval(beat); } catch { /* noop */ }
    for (const s of subs) { try { s.close(); } catch { /* noop */ } }
    try { res.end(); } catch { /* noop */ }
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);

  // Drain all subscriptions concurrently.
  for (const s of subs) {
    (async () => {
      try {
        for await (const evt of s.iterator) {
          if (closed) break;
          try {
            const dataStr =
              typeof evt.data === "string" ? evt.data : JSON.stringify(evt.data);
            res.write(`event: ${evt.topic}\ndata: ${dataStr}\n\n`);
          } catch {
            cleanup();
            break;
          }
        }
      } catch {
        cleanup();
      }
    })();
  }
}

export function registerCollectiveSseRoutes(app: Express): void {
  const handler = async (req: Request, res: Response): Promise<void> => {
    const ctx = (req as Request & {
      userContext?: { userId?: string; isAdmin?: boolean };
    }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      res.status(401).json({ ok: false, error: "missing_identity" });
      return;
    }
    await handleSseRequest(req, res, { userId, isAdmin: !!ctx?.isAdmin });
  };

  app.get(
    "/api/collective/stream",
    requireCollectiveEnabled,
    requireAuth,
    handler,
  );

  // CP-034 — partners need a path that doesn't require Collective feature
  // flag activation. /api/stream is the new canonical name; it gates only
  // on requireAuth and topic-level authorization.
  app.get("/api/stream", requireAuth, handler);
}

export default registerCollectiveSseRoutes;
