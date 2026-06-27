/**
 * v14 Tier-1 Fix 3 — requireCollectiveMember middleware.
 *
 * v16 F-coll-X3 / F-coll-19 UNIFICATION:
 *   Previously this middleware read ONLY from `collectiveMembershipStore`
 *   (the admin-approval write target), while `gate("collective.active")`
 *   read `ctx.collective.status` derived from `getMembership(userId)` in
 *   `server/membershipStore.ts`. Admin approval wrote ONE store; the gate
 *   read the OTHER. Newly-approved members were denied access.
 *
 *   v16 fix — read BOTH sources. A user is a collective member if:
 *     - `collectiveMembershipStore.isActive(userId) === true`, OR
 *     - `getMembership(userId)?.isCollectiveMember === true`, OR
 *     - `ctx.collective?.status === "active"` (the overlay the gate reads).
 *   Either source counts. The admin approval flow now writes to BOTH,
 *   but this middleware tolerates either being authoritative.
 *
 * Closes audit finding F-collective-01 + v16 F-coll-X3 / F-coll-19.
 *
 * Identity source: req.userContext (populated by requireAuth*). No
 * `x-user-id`/`x-actor-*` headers are read — that path was removed in v14
 * Tier-1 Fix 1.
 *
 * Failure modes:
 *   - No identity → 401 { error: "missing_identity" }
 *   - Identity but no active membership in either source → 403
 *     { error: "not_collective_member" }
 *
 * Usage:
 *   app.get("/api/collective/companies", requireCollectiveMember, handler);
 *   // or, when chained with requireAuthenticated:
 *   app.get("/api/collective/members", requireAuthenticated, requireCollectiveMember, handler);
 */
import type { Request, Response, NextFunction } from "express";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { getMembership } from "../membershipStore";
// v25.32 P0'' — detect partner-only sessions so the 403 can tell the client
// to switch to the partner workspace instead of silently rendering a
// zeroed-out Collective dashboard ("Failed to load dashboard data").
import { partnerTeamStore } from "../partnerWorkspaceStore";
// v24.5 GAP-3 — DB-fallback for admin role check so admins whose
// RUNTIME_PERSONAS entry was not yet built (e.g. first request in a
// fresh process after create_admin.ts ran) still pass through.
import { rawDb } from "../db/connection";

type V14Ctx = {
  userId?: string;
  isAdmin?: boolean;
  identity?: { email?: string };
  collective?: { status?: string };
};

/** v24.5 GAP-3 — Check DB for admin role when in-memory persona says false. */
function isDbAdmin(userId: string): boolean {
  try {
    const row = rawDb().prepare(
      `SELECT role FROM users WHERE id = ? LIMIT 1`,
    ).get(userId) as { role?: string } | undefined;
    if (row?.role === "admin") return true;
  } catch { /* non-fatal */ }
  return false;
}

/**
 * v25.35 (BLOCKER #11) — defense-in-depth DB fallback for the gate itself.
 * `collectiveMembershipStore.isActive()` is now DB-first, but we query the
 * DB directly here as a second line so a cold cache (fresh process before
 * hydration) can never 403 a genuinely-active member on every
 * `/api/collective/me/*` route. Read errors degrade to "not active".
 */
function isDbActiveMember(userId: string): boolean {
  try {
    const row = rawDb().prepare(
      `SELECT 1 FROM collective_memberships WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
    ).get(userId);
    return !!row;
  } catch { /* non-fatal */ }
  return false;
}

export function requireCollectiveMember(req: Request, res: Response, next: NextFunction): void {
  const ctx = (req as Request & { userContext?: V14Ctx }).userContext;
  const userId = ctx?.userId;
  if (!userId) {
    res.status(401).json({ ok: false, error: "missing_identity" });
    return;
  }
  // Admins bypass — they need read access for moderation.
  // v24.5 GAP-3: also check DB for admin role in case the in-memory persona
  // was not yet built (fresh process after create_admin.ts ran, before login).
  if (ctx?.isAdmin || isDbAdmin(userId)) {
    next();
    return;
  }
  // v16 UNIFIED CHECK — any of three sources counts as "active member".
  const fromAdminStore = collectiveMembershipStore.isActive(userId);
  let fromSeedStore = false;
  try {
    const m = getMembership(userId);
    fromSeedStore = !!m && m.isCollectiveMember === true;
  } catch { /* getMembership may not be available in some test contexts */ }
  const fromCtxOverlay = ctx?.collective?.status === "active";

  if (fromAdminStore || fromSeedStore || fromCtxOverlay) {
    next();
    return;
  }

  // v25.35 (BLOCKER #11) — cold-cache defense in depth: before denying, query
  // the DB directly for an active membership row. Closes the post-restart
  // lockout where an active member was 403'd on every /api/collective/me/*
  // route because the in-memory mirror had not yet hydrated.
  if (isDbActiveMember(userId)) {
    next();
    return;
  }

  // v25.32 P0'' — DIAGNOSIS: a partner-only session (active partner_team_member
  // but NOT a collective member) hits this exact 403. The previous response
  // was `{ ok:false, error:"not_collective_member" }` with no human message,
  // so the client's react-query error state rendered the generic "Failed to
  // load dashboard data. Please refresh." banner with all-zero KPI cards.
  // We now (a) always include a friendly `message`, and (b) when the caller
  // actually IS a partner, set `partnerWorkspace: true` + a redirect hint so
  // the client routes them to /collective/partner/dashboard instead of
  // stranding them on an empty Collective dashboard.
  let isPartner = false;
  try {
    isPartner = !!partnerTeamStore.findByUserId(userId);
  } catch { /* store may be unavailable in some test contexts; non-fatal */ }

  if (isPartner) {
    res.status(403).json({
      ok: false,
      error: "not_collective_member",
      partnerWorkspace: true,
      redirectTo: "/collective/partner/dashboard",
      message:
        "You're signed in as a consortium partner. Switch to your partner workspace to continue.",
    });
    return;
  }

  res.status(403).json({
    ok: false,
    error: "not_collective_member",
    message:
      "Your account isn't an active Collective member yet. If you applied recently, an admin still needs to approve your membership.",
  });
}

export default requireCollectiveMember;
