/**
 * WAVE 189 · ITEM B · R159.6 — LP THREAD FIRM VISIBILITY, WITHOUT TOUCHING A SACRED FILE.
 * ══════════════════════════════════════════════════════════════════════════════
 * Owner: *"Team-visible. Go with your recommendation and global investor grade best
 * practice."*
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL — A CORRECTED MISTAKE, RECORDED
 * ══════════════════════════════════════════════════════════════════════════════
 * The first implementation of this item added the widening condition directly to the
 * three read handlers inside `server/messagingStore.ts`. THAT FILE IS SACRED. The
 * edit tripped `npm run sacred` (DRIFTED: expected 17bd5608…, actual 1b1508b3…), and
 * R121 is absolute: fix from non-sacred code, never seek a tenth waiver. The edit was
 * reverted byte-for-byte — `server/messagingStore.ts` hashes to 17bd5608… again — and
 * the widening was rebuilt here instead.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * HOW IT WORKS: A PRE-ROUTER THAT ONLY EVER ADDS
 * ══════════════════════════════════════════════════════════════════════════════
 * `registerPartnerLpThreadVisibilityRoutes(app)` MUST be called BEFORE
 * `registerMessagingRoutes(app)`. Express dispatches in registration order, so these
 * handlers see each request first. Each one asks a single question:
 *
 *     Is this a read the sacred handler would REFUSE, that the owner's ruling says
 *     should now succeed?
 *
 *   · NO  → `next()`. The sacred handler runs verbatim and produces its own response,
 *           byte-for-byte as before. This is the path for EVERY pre-existing caller:
 *           participants, platform admins, and everybody the fence refuses.
 *   · YES → this module answers, mirroring the sacred handler's response shape.
 *
 * SO THIS CANNOT REMOVE ACCESS OR CHANGE AN EXISTING RESPONSE. There is no branch in
 * which a request that previously succeeded is now handled here, because interception
 * requires the caller to be a NON-participant and a NON-admin — precisely the callers
 * the sacred handler was about to 403. That is why waves 167 and 168 keep their exact
 * verdicts: nothing they exercise reaches this file.
 *
 * WHY THE RESPONSES ARE READ THROUGH `_messagingInternal`. The sacred store exports
 * `findThreadByIdAnyTenant`, `rowToMessage`, `rowToThread` and its caches. Reading
 * through them — CALL-ONLY, never edited — means the payload this module returns is
 * assembled from the same rows, by the same mappers, as the payload the sacred handler
 * would have returned. A colleague reading a thread sees the identical shape a
 * participant sees, not a parallel reimplementation that can drift.
 *
 * THE FENCE ITSELF IS NOT HERE. It lives in `server/lib/partnerLpThreadVisibility.ts`
 * as one predicate with three clauses and a fail-closed guarantee. This file is only
 * the transport.
 *
 * IT IS READ-ONLY. Nothing here intercepts a POST, PATCH or DELETE. Reading the firm's
 * record is the ruling; speaking as the firm is not, so writes stay participant-only
 * and sender-only inside the untouched sacred store.
 */
import type { Express, Request } from "express";
import { requireAuth } from "./lib/authMiddleware";
import { getDb } from "./db/connection";
import { messages as messagesTable, messageThreads as messageThreadsTable } from "@shared/schema";
import {
  _messagingInternal,
  type MessageRow,
  type MessageThreadRow,
} from "./messagingStore";
import {
  mayPartnerOrgReadLpThread,
  lpThreadIsVisibleToAPartnerFirm,
} from "./lib/partnerLpThreadVisibility";

/* The two identity readers are reproduced here rather than imported, because the
   sacred store keeps them module-private. They are three lines each and read the
   SAME `req.userContext` fields the sacred versions read, so a caller resolves
   identically on both sides of the hand-off. */
function callerUserId(req: Request): string | null {
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  return ctx?.userId ?? null;
}

function isPlatformAdmin(req: Request): boolean {
  const ctx = (req as Request & { userContext?: { isAdmin?: boolean } }).userContext;
  return !!ctx?.isAdmin;
}

/** Every live thread, read through the sacred store's own mapper, with the same
 *  cache fallback the sacred handlers use. */
function allLiveThreads(): MessageThreadRow[] {
  try {
    const db: any = getDb();
    return (db.select().from(messageThreadsTable).all() as any[])
      .map(_messagingInternal.rowToThread)
      .filter((t: MessageThreadRow) => !t.deletedAt);
  } catch {
    return Array.from(_messagingInternal.threadsCache.values()).filter((t) => !t.deletedAt);
  }
}

/** Live messages in one thread, read through the sacred store's own mapper. */
function liveMessagesInThread(threadId: string): MessageRow[] {
  try {
    const db: any = getDb();
    return (db.select().from(messagesTable).all() as any[])
      .map(_messagingInternal.rowToMessage)
      .filter((m: MessageRow) => m.threadId === threadId && !m.deletedAt && m.status !== "deleted");
  } catch {
    return Array.from(_messagingInternal.messagesCache.values()).filter(
      (m) => m.threadId === threadId && !m.deletedAt && m.status !== "deleted",
    );
  }
}

/**
 * MUST be registered BEFORE `registerMessagingRoutes(app)`.
 *
 * If it is registered after, every handler here becomes unreachable — Express will
 * have already matched the sacred route — and the widening silently does nothing.
 * `wave189_itemB_lp_thread_firm_visibility.test.ts` asserts the ordering in
 * `server/routes.ts` structurally for exactly that reason.
 */
export function registerPartnerLpThreadVisibilityRoutes(app: Express): void {
  /* ──────────────────────────────────────────────────────────────────────────
     READ PATH 1 of 3 — GET /api/messages?thread_id=…
     Intercepted ONLY for the widened case. Every other query shape on this route
     (`chapter_id`, `recipient_user_id`, the default inbox) falls straight through,
     untouched, because this module has nothing to say about them.
     ────────────────────────────────────────────────────────────────────────── */
  app.get("/api/messages", requireAuth, (req, res, next) => {
    const caller = callerUserId(req);
    const threadId = typeof req.query.thread_id === "string" ? req.query.thread_id : undefined;
    if (!caller || !threadId || isPlatformAdmin(req)) return next();

    const t = _messagingInternal.findThreadByIdAnyTenant(threadId);
    /* A missing thread is the SACRED handler's 404 to give, not ours. */
    if (!t) return next();
    /* A participant is already entitled; the sacred handler serves them verbatim. */
    if (t.participantUserIds.includes(caller)) return next();
    /* Not entitled under the new rule either — let the sacred handler 403. */
    if (!mayPartnerOrgReadLpThread(t, caller)) return next();

    const filtered = liveMessagesInThread(t.id);
    filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json({ messages: filtered, count: filtered.length });
  });

  /* ──────────────────────────────────────────────────────────────────────────
     READ PATH 2 of 3 — GET /api/messages/threads
     Without this the widening would be useless in practice: a colleague could open
     a thread by id but would never see it listed, so they could only read
     conversations whose id they already knew.

     INTERCEPTED ONLY WHEN IT WOULD CHANGE THE ANSWER. If the caller gains no thread
     from the widening, this hands off and the sacred handler produces its response
     exactly as before — which is the case for every caller who is not a partner
     team member. When it does intercept, the list it returns is the sacred
     handler's own rule (participant) OR'd with the new one, so nothing is dropped.
     ────────────────────────────────────────────────────────────────────────── */
  app.get("/api/messages/threads", requireAuth, (req, res, next) => {
    const caller = callerUserId(req);
    if (!caller || isPlatformAdmin(req)) return next();

    const threads = allLiveThreads();
    const gained = threads.filter(
      (t) => !t.participantUserIds.includes(caller) && mayPartnerOrgReadLpThread(t, caller),
    );
    if (gained.length === 0) return next();

    const mine = threads.filter(
      (t) => t.participantUserIds.includes(caller) || mayPartnerOrgReadLpThread(t, caller),
    );
    mine.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    res.json({ threads: mine, count: mine.length });
  });

  /* ──────────────────────────────────────────────────────────────────────────
     READ PATH 3 of 3 — GET /api/messages/threads/:id
     Mirrors the sacred handler's pagination contract exactly: the same `limit`
     clamp (1–200, default 50), the same `offset` floor, the same sort, and the same
     `{ thread, messages, total, limit, offset }` envelope. A colleague must see the
     identical shape a participant sees.
     ────────────────────────────────────────────────────────────────────────── */
  app.get("/api/messages/threads/:id", requireAuth, (req, res, next) => {
    const caller = callerUserId(req);
    if (!caller || isPlatformAdmin(req)) return next();

    const t = _messagingInternal.findThreadByIdAnyTenant(String(req.params.id));
    if (!t || t.deletedAt) return next();
    if (t.participantUserIds.includes(caller)) return next();
    if (!mayPartnerOrgReadLpThread(t, caller)) return next();

    /* `parseInt` on a PAGINATION parameter, deliberately. The money rule bans
       `Number`/`parseInt`/`parseFloat` for ARITHMETIC ON MONEY; a page size is not
       money, carries no currency and is clamped to 1–200. This is the sacred
       handler's own expression, reproduced so the contract cannot diverge. */
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

    const msgs = liveMessagesInThread(t.id);
    msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const total = msgs.length;
    const page = msgs.slice(offset, offset + limit);
    res.json({ thread: t, messages: page, total, limit, offset });
  });

  /* ──────────────────────────────────────────────────────────────────────────
     R159.6 clause 3 — "TELL THE LP."

     GET /api/messages/lp-firm-visibility

     Owner's framing: *"The disclosure is what makes it investor-grade; without it
     this is a privacy change made silently."* So the widening ships WITH a way for
     the investor to see it. A NEW path, so it collides with nothing in the sacred
     store and needs no ordering guarantee.

     IT ANSWERS ONE QUESTION AND ONLY WHEN THE ANSWER IS TRUE. The notice must never
     appear for an investor whose conversations are not in fact firm-visible, because
     a false privacy statement is worse than none. So this walks the caller's OWN
     threads and reports `visible: true` only when at least one of them actually has
     an active partner-team participant on the other side.

     IT DISCLOSES NOTHING ELSE: no thread ids, no participant ids, no message bodies,
     no other investor's data. The firm's registered NAME is returned only when
     `partner_organizations` holds one, which is rare.

     IT IS SELF-SCOPED. The answer is derived from `callerUserId(req)` alone. There is
     no parameter that could aim it at another user.
     ────────────────────────────────────────────────────────────────────────── */
  app.get("/api/messages/lp-firm-visibility", requireAuth, (req, res) => {
    const caller = callerUserId(req);
    if (!caller) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }

    const firmNames = new Set<string>();
    let visible = false;
    for (const t of allLiveThreads()) {
      const verdict = lpThreadIsVisibleToAPartnerFirm(t, caller);
      if (!verdict.visible) continue;
      visible = true;
      if (verdict.partnerName) firmNames.add(verdict.partnerName);
    }

    res.json({
      visible,
      /* Sorted so the payload is stable across requests: an unstable order would
         make the rendered sentence flicker between reads for no reason.
         `Array.from(set.values())` rather than `for...of` over the set — this tree's
         TS config raises TS2802 on direct iteration of a Set/Map. */
      firmNames: Array.from(firmNames.values()).sort(),
    });
  });
}

export default registerPartnerLpThreadVisibilityRoutes;
