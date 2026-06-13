/**
 * CP Phase C — any-of helper: requireCollectiveOrPartnerMember.
 *
 * Express middleware that admits the caller if EITHER:
 *   - they pass the Collective membership check (same logic as
 *     `requireCollectiveMember`), OR
 *   - they have an active partner team membership (same logic as
 *     `requirePartnerMember`).
 *
 * Used by Ask-an-Expert and Collective comms POST endpoints so partner
 * team members can participate without holding a separate Collective tier
 * subscription. Closes audit findings CP-022 / CP-023 / CP-024.
 *
 * Admins bypass (matching the other gate middlewares).
 *
 * Failure modes:
 *   - No identity                                  → 401 missing_identity
 *   - Identity but neither membership is active   → 403 not_member
 */
import type { Request, Response, NextFunction } from "express";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { getMembership } from "../membershipStore";
import { hasActivePartnerMembership } from "./requirePartner";

type V14Ctx = {
  userId?: string;
  isAdmin?: boolean;
  identity?: { email?: string };
  collective?: { status?: string };
};

/**
 * Returns true if `userId` resolves to a Collective member through any of
 * the three unified sources used by `requireCollectiveMember`.
 */
export function hasActiveCollectiveMembership(userId: string): boolean {
  if (!userId) return false;
  try {
    if (collectiveMembershipStore.isActive(userId)) return true;
  } catch { /* store unavailable */ }
  try {
    const m = getMembership(userId);
    if (m && m.isCollectiveMember === true) return true;
  } catch { /* store unavailable */ }
  return false;
}

export function requireCollectiveOrPartnerMember(
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
  if (ctx?.isAdmin) {
    next();
    return;
  }
  // Collective overlay on the request context counts.
  if (ctx?.collective?.status === "active") {
    next();
    return;
  }
  if (hasActiveCollectiveMembership(userId)) {
    next();
    return;
  }
  if (hasActivePartnerMembership(userId)) {
    next();
    return;
  }
  res.status(403).json({ ok: false, error: "not_member" });
}

export default requireCollectiveOrPartnerMember;
