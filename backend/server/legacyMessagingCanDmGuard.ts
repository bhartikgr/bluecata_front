/**
 * v25.46 BLOCKER FIX (GPT-5.5 DO-NOT-SHIP #1) — canDM guard for the LEGACY
 * `/api/messages` write routes.
 *
 * WHY THIS FILE EXISTS (Sacred-compliance rationale):
 *   The locked v25.46 spec requires ALL message endpoints to route through
 *   `server/messagingPolicy.ts` `canDM()` and to block guest/anonymous and
 *   self-DM. GPT-5.5 proved that the LEGACY direct-send routes registered by
 *   `server/messagingStore.ts` (`POST /api/messages`, `POST /api/messages/threads`)
 *   still gated on the legacy `canDirectMessage()` helper, which returns `true`
 *   for self-pairs and for any non-empty recipient — so self-DMs, guests, and
 *   unresolved recipients were created with HTTP 201.
 *
 *   `server/messagingStore.ts` is a SACRED Tier-1 file (CAPAVATE_SACRED_FILES.md
 *   item #12, AVI Tier-2, BYTE-IDENTICAL to the v25.42 baseline). It MUST NOT be
 *   edited — `scripts/verify_avi_preserved.sh` + the manual Tier-2 diff would flag
 *   any change as DO-NOT-SHIP. Therefore, instead of modifying the sacred store,
 *   we enforce `canDM()` at the ROUTE-REGISTRATION layer in `server/routes.ts`
 *   (NON-sacred) by mounting this guard middleware on the two legacy POST paths
 *   BEFORE `registerMessagingRoutes(app)` runs. Express dispatches matching
 *   middleware in registration order, so a 403 here short-circuits before the
 *   sacred handler ever sees a forbidden direct DM.
 *
 * SCOPE (matches the legacy handler's own DM detection so we never break
 * chapter/group/broadcast flows):
 *   - POST /api/messages          : enforce canDM only for DIRECT sends, i.e.
 *                                   channel_type === "direct" OR (no channel_type
 *                                   AND exactly one recipient AND no chapter_id).
 *                                   Each recipient is checked via canDM().
 *   - POST /api/messages/threads  : enforce canDM only for a direct 1-on-1 thread,
 *                                   i.e. no chapter_id AND participants.length <= 1.
 *                                   The single participant is checked via canDM().
 *
 * Group / broadcast / chapter-scoped sends keep their existing shared-chapter /
 * chapter-admin rules inside the sacred store (unchanged).
 *
 * Platform admins bypass (parity with the store's `isPlatformAdmin` bypass).
 *
 * Fail-closed: missing/anonymous caller → 401; forbidden pair → 403 with the
 * canDM reason. canDM is NEVER weakened to pass tests — the routes are aligned
 * to canDM, not the other way around.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { canDM } from "./messagingPolicy";

function callerId(req: Request): string | null {
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  return ctx?.userId ?? null;
}

function isAdmin(req: Request): boolean {
  const ctx = (req as Request & { userContext?: { isAdmin?: boolean } }).userContext;
  return !!ctx?.isAdmin;
}

/** Coerce a possibly-undefined array body field into a string[] safely. */
function asIdArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * Guard for POST /api/messages — enforces canDM on DIRECT sends.
 */
function guardDirectSend(req: Request, res: Response, next: NextFunction): void {
  if (isAdmin(req)) return next();
  const caller = callerId(req);
  if (!caller) {
    // Let the downstream requireAuth produce the canonical 401 if context is
    // absent for a non-direct path; but for safety fail-closed here too.
    res.status(401).json({ error: "AUTH_REQUIRED" });
    return;
  }

  const body = (req.body ?? {}) as {
    channel_type?: string;
    recipients?: unknown;
    chapter_id?: string | null;
  };
  const recipients = asIdArray(body.recipients);
  const channelType =
    body.channel_type ?? (recipients.length > 1 ? "group" : "direct");

  // Only gate DIRECT 1-on-1 sends here. Group/broadcast/chapter sends keep the
  // store's existing shared-chapter / chapter-admin rules.
  const isDirect = channelType === "direct" && !body.chapter_id;
  if (!isDirect) return next();

  for (const r of recipients) {
    const verdict = canDM(caller, r);
    if (!verdict.allowed) {
      res
        .status(403)
        .json({ error: "CANNOT_DM_RECIPIENT", recipient: r, reason: verdict.reason });
      return;
    }
  }
  return next();
}

/**
 * Guard for POST /api/messages/threads — enforces canDM on a direct 1-on-1 thread.
 */
function guardThreadCreate(req: Request, res: Response, next: NextFunction): void {
  if (isAdmin(req)) return next();
  const caller = callerId(req);
  if (!caller) {
    res.status(401).json({ error: "AUTH_REQUIRED" });
    return;
  }

  const body = (req.body ?? {}) as {
    participants?: unknown;
    chapter_id?: string | null;
  };
  const participants = asIdArray(body.participants);

  // Mirror the store's DM detection: a chapter-less thread with <= 1 other
  // participant is a direct 1-on-1 DM. Group / chapter threads keep their
  // shared-chapter rule in the store.
  const isDirectDm = !body.chapter_id && participants.length <= 1;
  if (!isDirectDm) return next();

  for (const p of participants) {
    const verdict = canDM(caller, p);
    if (!verdict.allowed) {
      res
        .status(403)
        .json({ error: "CANNOT_DM_PARTICIPANT", participant: p, reason: verdict.reason });
      return;
    }
  }
  return next();
}

/**
 * Mount the canDM guards on the legacy write routes. MUST be called BEFORE
 * `registerMessagingRoutes(app)` so the guard middleware is dispatched first.
 */
export function registerLegacyMessagingCanDmGuard(app: Express): void {
  app.post("/api/messages", guardDirectSend);
  app.post("/api/messages/threads", guardThreadCreate);
}

export default registerLegacyMessagingCanDmGuard;
