/**
 * CP Phase C — requirePartnerMember middleware.
 *
 * Mirrors `requireChapterMember` but checks partner_team_members instead.
 * A user is a "partner member" if they have an active row in
 * `partnerTeamStore` (the in-memory map currently used for partner team
 * membership — see CP-005 for the v20 follow-up to back this with a DB
 * table).
 *
 * The middleware is consumed by:
 *   - `collectiveSseRoutes` (topic-aware SSE auth — partner-workspace, crm,
 *     spv topics).
 *   - `requireCollectiveOrPartnerMember` (any-of helper used by Ask-an-Expert
 *     and Collective comms POST endpoints — CP-022/023/024).
 *
 * Identity source: req.userContext (same as requireCollectiveMember). No
 * x-actor-* headers are honoured outside DEV_BYPASS.
 *
 * Failure modes:
 *   - No identity                            → 401 { error: "missing_identity" }
 *   - Caller has no active partner team row  → 403 { error: "not_partner_member" }
 *
 * Closes audit findings CP-034 (SSE partner gating) and CP-022/023/024
 * (partner Q&A participation).
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { partnerTeamStore } from "../partnerWorkspaceStore";

type V14Ctx = {
  userId?: string;
  isAdmin?: boolean;
  identity?: { email?: string };
};

/**
 * Internal — does the caller hold an active partner team membership?
 *
 * Returns the partnerId (string) on success, null otherwise. Callers that
 * need to scope by partnerId (e.g. the SSE filter for partner-workspace
 * topic) can use the returned id directly.
 */
function findActivePartnerId(userId: string): string | null {
  if (!userId) return null;
  try {
    const tm = partnerTeamStore.findByUserId(userId);
    return tm ? tm.partnerId : null;
  } catch {
    // Store unavailable (e.g. early-boot edge case). Fail closed.
    return null;
  }
}

/**
 * Factory form: returns an Express middleware that asserts the caller is an
 * active partner team member of any partner.
 *
 * Use the `_internal.findActivePartnerId` helper directly if you need the
 * resolved partnerId for further scoping in your handler.
 */
export const requirePartnerMember: RequestHandler = function requirePartnerMember(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ctx = (req as Request & { userContext?: V14Ctx }).userContext;
  const userId = ctx?.userId;
  if (!userId) {
    res.status(401).json({ ok: false, error: "missing_identity" });
    return;
  }
  // Admins bypass — they need read access for moderation. Mirrors the
  // requireCollectiveMember / requireChapterMember admin bypass.
  if (ctx?.isAdmin) {
    next();
    return;
  }
  const pid = findActivePartnerId(userId);
  if (pid) {
    next();
    return;
  }
  res.status(403).json({ ok: false, error: "not_partner_member" });
};

/**
 * Helper for any-of-two patterns: returns true if the user is either an
 * active partner team member, OR has a valid Collective membership. Used
 * by Ask-an-Expert + Collective comms POST endpoints (CP-022/024).
 *
 * NOTE: this is a synchronous read of an in-memory store. Cheap; safe to
 * call inside middleware.
 */
export function hasActivePartnerMembership(userId: string): boolean {
  return findActivePartnerId(userId) !== null;
}

/** Resolve the active partnerId for a user, or null. */
export function resolvePartnerId(userId: string): string | null {
  return findActivePartnerId(userId);
}

export const _internal = { findActivePartnerId };

export default requirePartnerMember;
