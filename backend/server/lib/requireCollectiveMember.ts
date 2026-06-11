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
  res.status(403).json({ ok: false, error: "not_collective_member" });
}

export default requireCollectiveMember;
