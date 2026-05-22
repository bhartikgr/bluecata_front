/**
 * Foundation Build — Partner workspace authorization middleware.
 *
 * Resolves `req.partnerContext` from the SESSION (via getUserContext()) and
 * cross-references `partner_team_members`. NEVER reads `partnerId` from the
 * URL — that is the data-isolation guarantee (Section 9.2 of the master spec).
 *
 * Exposes three composable middlewares:
 *   - requirePartnerAuth: enforces an authenticated user with an active
 *     partner_team_members record under an active consortium_partner contact.
 *   - assertSubRole(...roles): refuses if req.partnerContext.partnerSubRole is
 *     not in the allowlist.
 *   - assertTier(minTier): refuses if req.partnerContext.tier is below minTier.
 *
 * `assertTierSeats(partnerId)` is a free function (not a middleware) used by
 * the invitation-create endpoint to atomically check seat availability.
 */
import type { Request, Response, NextFunction } from "express";
import { getUserContext } from "./userContext";
import { partnerTeamStore, partnerInvitationStore } from "../partnerWorkspaceStore";
import { getById as getContactById, TIER_RANK, TIER_SEAT_LIMITS, type PartnerTier, type PartnerSubRole } from "../adminContactsStoreShim";

export interface PartnerContext {
  userId: string;
  email: string;
  name: string;
  partnerId: string;
  partnerSubRole: PartnerSubRole;
  tier: PartnerTier;
  isAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partnerContext?: PartnerContext;
      userContext?: ReturnType<typeof getUserContext>;
    }
  }
}

export function requirePartnerAuth(req: Request, res: Response, next: NextFunction): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed || !ctx.userId) {
    res.status(401).json({ error: "PARTNER_AUTH_REQUIRED", message: "Sign in to access partner workspace." });
    return;
  }
  const teamMember = partnerTeamStore.findByUserId(ctx.userId);
  if (!teamMember) {
    res.status(403).json({ error: "PARTNER_NOT_FOUND", message: "No active partner membership for this account." });
    return;
  }
  const partner = getContactById(teamMember.partnerId);
  if (!partner || partner.kind !== "consortium_partner" || partner.status !== "active") {
    res.status(403).json({ error: "PARTNER_NOT_ACTIVE", message: "Partner record is not active." });
    return;
  }
  req.partnerContext = {
    userId: ctx.userId,
    email: ctx.identity.email,
    name: ctx.identity.name,
    partnerId: teamMember.partnerId,
    partnerSubRole: teamMember.subRole as PartnerSubRole,
    tier: (partner.tier as PartnerTier) ?? "catalyst",
    isAdmin: ctx.isAdmin,
  };
  next();
}

export function assertSubRole(...allowed: PartnerSubRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.partnerContext) {
      res.status(401).json({ error: "PARTNER_AUTH_REQUIRED" });
      return;
    }
    if (!allowed.includes(req.partnerContext.partnerSubRole)) {
      res.status(403).json({
        error: "PARTNER_SUB_ROLE_INSUFFICIENT",
        details: { current: req.partnerContext.partnerSubRole, allowed },
      });
      return;
    }
    next();
  };
}

export function assertTier(minTier: PartnerTier) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.partnerContext) {
      res.status(401).json({ error: "PARTNER_AUTH_REQUIRED" });
      return;
    }
    if (TIER_RANK[req.partnerContext.tier] < TIER_RANK[minTier]) {
      res.status(403).json({
        error: "PARTNER_TIER_INSUFFICIENT",
        details: { current: req.partnerContext.tier, required: minTier },
      });
      return;
    }
    next();
  };
}

/**
 * Check that the partner has at least one open seat (counting active members
 * + pending invitations). Throws `PARTNER_TIER_SEAT_LIMIT_REACHED` if not.
 *
 * NOTE: this is a free function (not a middleware) so callers can run it in
 * the same critical section as the invitation creation.
 */
export function assertTierSeats(partnerId: string): void {
  const partner = getContactById(partnerId);
  if (!partner) throw new Error("PARTNER_NOT_FOUND");
  const tier: PartnerTier = (partner.tier as PartnerTier) ?? "catalyst";
  const active = partnerTeamStore.countActiveSeats(partnerId);
  const pending = partnerInvitationStore.countPendingByPartner(partnerId);
  if (active + pending >= TIER_SEAT_LIMITS[tier]) {
    throw new Error("PARTNER_TIER_SEAT_LIMIT_REACHED");
  }
}
