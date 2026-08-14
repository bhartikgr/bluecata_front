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
import { getById as getContactById, TIER_RANK, type PartnerTier, type PartnerSubRole } from "../adminContactsStoreShim";
/* WAVE 45 (R3) — seat caps are DB rows now; isWithinLimit is the ONLY correct
 * way to compare, because "unlimited" and "not configured" are not numbers. */
import { isWithinLimit } from "./partnerTierCapabilityStore";
import { resolvePartnerSeatLimit } from "./partnerFeeResolver"; /* W-V44 FIX R3 */

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

/**
 * GROUP F3 — self-gate for the ONE bootstrap read `GET /api/partner/me`.
 *
 * IDENTICAL to `requirePartnerAuth` in EVERY fail-closed respect, with a
 * SINGLE, DELIBERATE relaxation: it does NOT require
 * `partner.status === "active"`. This lets a SUSPENDED / ARCHIVED (but still
 * existing) consortium_partner load `/me` — and ONLY `/me` — so the FE can
 * render a "your account is suspended" status banner. It grants NO data and NO
 * writes: every other `/api/partner/me/*` route keeps hard `requirePartnerAuth`.
 *
 * Still FAIL-CLOSED on everything else, exactly like requirePartnerAuth:
 *   - 401 PARTNER_AUTH_REQUIRED   — no authenticated user.
 *   - 403 PARTNER_NOT_FOUND       — no partner_team_members record.
 *   - 403 PARTNER_NOT_FOUND       — the contact was deleted / does not exist,
 *                                    OR is not a consortium_partner.
 * `partnerId` is ALWAYS taken from the session-resolved team member — NEVER
 * from the request body or query — preserving the data-isolation guarantee.
 * This middleware does NOT weaken requirePartnerAuth or any other gate.
 */
export function requirePartnerSelf(req: Request, res: Response, next: NextFunction): void {
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
  // Fail-closed on a deleted/non-existent record or a non-partner contact.
  // The ONLY relaxation vs requirePartnerAuth is that `status` need NOT be
  // "active" — a suspended/archived consortium_partner PASSES here.
  if (!partner || partner.kind !== "consortium_partner") {
    res.status(403).json({ error: "PARTNER_NOT_FOUND", message: "No partner record for this account." });
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
 * requirePartnerSubrole — Gap C6 subrole middleware.
 *
 * Wire directly on any endpoint that needs a subrole gate. Returns 403
 * with error SUBROLE_FORBIDDEN when the caller's subRole is not in
 * the `allowedSubroles` array. Requires requirePartnerAuth to have run
 * first (so req.partnerContext is populated).
 *
 * Example:
 *   app.get('/api/partner/me/billing',
 *     requirePartnerAuth,
 *     requirePartnerSubrole(['managing_partner']),
 *     handler);
 */
import type { SubRole } from "../partnerWorkspaceStore";

export function requirePartnerSubrole(allowedSubroles: SubRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.partnerContext) {
      res.status(401).json({ error: "PARTNER_AUTH_REQUIRED" });
      return;
    }
    const actual = req.partnerContext.partnerSubRole as SubRole;
    if (!allowedSubroles.includes(actual)) {
      res.status(403).json({
        error: "SUBROLE_FORBIDDEN",
        message: `SubRole '${actual}' is not permitted. Required: ${allowedSubroles.join(" | ")}.`,
        required: allowedSubroles,
        actual,
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
  assertSeatCapacity(partnerId, {
    activeSeats: partnerTeamStore.countActiveSeats(partnerId),
    pending: partnerInvitationStore.countPendingByPartner(partnerId),
  });
}

/**
 * WAVE 19 FE-19 / SEAT-04 — the seat POLICY, separated from the seat READ.
 *
 * `assertTierSeats` above reads the counts and then judges them. That is fine
 * for a read-only caller, but it is useless as a race guard: by the time the
 * verdict is returned the counts are already stale, and the invitation insert
 * that follows is a separate, unprotected statement.
 *
 * So the judgement is factored out to take counts as an ARGUMENT. That lets
 * `partnerInvitationStore.createWithSeatGuard()` re-read the durable counts
 * inside its IMMEDIATE transaction and call this with them, under the write
 * lock, in the same critical section as the insert.
 *
 * The policy itself is unchanged and deliberately still lives here, not in the
 * store: tier resolution and the per-partner seat override
 * (`resolvePartnerSeatLimit`) are auth concerns, and a second copy in the
 * store would be a second definition of a paid limit — the kind of divergence
 * that produced this defect in the first place.
 */
export function assertSeatCapacity(
  partnerId: string,
  counts: { activeSeats: number; pending: number },
): void {
  const partner = getContactById(partnerId);
  if (!partner) throw new Error("PARTNER_NOT_FOUND");
  const tier: PartnerTier = (partner.tier as PartnerTier) ?? "catalyst";
  // W-V44 FIX R3, rebased onto data by WAVE 45 — enforce the EFFECTIVE seat
  // limit (per-partner override, else the tier capability row) so an
  // admin-granted individual seat allowance is honoured.
  //
  // NOT a raw `>=` against a number. The previous code compared against a
  // seatLimit that was 9999 for "unlimited", which happened to work only because
  // no partner ever had 9999 seats. isWithinLimit() branches on the three-state
  // resolution: configured (0 means zero), unlimited (always allowed), and
  // not_configured (refused, and reported as unconfigured rather than as zero).
  const { capability, seatLimit } = resolvePartnerSeatLimit(partnerId, tier);
  const verdict = isWithinLimit(capability, counts.activeSeats + counts.pending);

  /* FE-19 MISS #16 — THE BOUNDARY IS EXCLUSIVE, AND THE OPERATOR IS PINNED.
   *
   * A mutation harness once changed `>=` to `>` here and 23 tests still passed
   * while every paid tier sold one seat too many, so `wave19_fe19_partner_seat_
   * integrity.test.ts` pins this comparison as SOURCE TEXT. WAVE 45 keeps the
   * finite comparison exactly as written rather than hiding it inside a helper:
   * a helper is invisible to that pin, and losing the pin is how the off-by-one
   * came back. For a finite configured limit this is the whole policy. */
  if (seatLimit !== null && counts.activeSeats + counts.pending >= seatLimit) {
    throw new Error("PARTNER_TIER_SEAT_LIMIT_REACHED");
  }

  /* The finite comparison above cannot express the other two states, which is
   * the gap-2 defect: `unlimited` used to be the magic number 9999 (so it was a
   * real ceiling), and `not_configured` was indistinguishable from 0 (so it
   * either locked partners out or let everyone in, depending on the operator).
   * isWithinLimit() judges those two cases. It must AGREE with the branch above
   * on every finite limit; it is only ever reached when seatLimit is null. */
  if (!verdict.within) {
    // Error message preserved verbatim — the token is a cross-layer contract
    // that `client/src/pages/partner/PartnerTeam.tsx` matches on to render its
    // banner. The machine-readable reason rides alongside, never instead.
    const err = new Error("PARTNER_TIER_SEAT_LIMIT_REACHED") as Error & { reason?: string };
    err.reason = verdict.reason;
    throw err;
  }
}
