/**
 * v14 Tier-1 Fix 1 — Identity-from-session helper.
 *
 * Replaces every banned `req.headers["x-user-id"]` / `?? "co_novapay"` /
 * `?? "u_demo"` / `?? "u_admin"` pattern in production code.
 *
 * Rules:
 *   • Identity comes ONLY from the authenticated session (cap_uid cookie),
 *     surfaced by the v12 `loadUserContext` middleware as `req.userContext`.
 *   • If the request has no resolvable identity, requireIdentity() throws
 *     `missing_identity` with `err.status = 401`. Route handlers MUST catch
 *     and forward to `next(e)` so the centralised error middleware emits the
 *     401 cleanly.
 *   • Header reads (`x-user-id`, `x-actor-user-id`, `x-actor-email`,
 *     `x-company-id`) are NOT consulted. The v14 lint test enforces this.
 *
 * Companion helpers:
 *   • `requireIdentity(req)` — { userId, tenantId, email, role, isAdmin }
 *   • `requireActor(req)` — back-compat shape `{ userId, email }` for stores
 *     that previously read `x-actor-email`. The email comes from the session
 *     identity, never from a client-supplied header.
 *   • `getCompanyIdFromContext(req)` — returns the active company id derived
 *     from session, replacing the banned `?? "co_novapay"` and
 *     `x-company-id` fallbacks. Returns null when no company is selected.
 *
 * SANDBOX-SAFE — no DB writes beyond what userContext already does.
 */
import type { Request } from "express";
import { getUserContext, type UserContext } from "./userContext";
import { getCurrentTenantId } from "./withTenant";

export interface ResolvedIdentity {
  userId: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: "admin" | "founder" | "investor" | "user";
  isAdmin: boolean;
  isAuthed: true;
  /** Active company id from session (founder's active company). May be null. */
  activeCompanyId: string | null;
  /** Full user context (avoid double-resolving in callers that need more). */
  ctx: UserContext;
}

/**
 * Throws `missing_identity` (HTTP 401) when the request has no authenticated
 * session. Returns a normalised identity object otherwise.
 *
 * Callers MUST wrap in try/catch and forward via `next(e)` (or rely on the
 * Express default error handler with `err.status`).
 */
export function requireIdentity(req: Request): ResolvedIdentity {
  // Prefer the userContext already attached by `requireAuth`/`requireAuthenticated`
  // middleware so we don't double-resolve. Fall back to a fresh resolve for
  // routes that haven't been mounted through the middleware (rare; route
  // guards already require it on every mutating endpoint).
  const attached = (req as Request & { userContext?: UserContext }).userContext;
  const ctx = attached ?? getUserContext(req);

  if (!ctx || !ctx.isAuthed || !ctx.userId) {
    const err: Error & { status?: number; code?: string } = new Error("missing_identity");
    err.status = 401;
    err.code = "missing_identity";
    throw err;
  }

  // Tenant id from session (user_prefs.active_tenant_id). May be null right
  // after signup before the first company is created — that's fine; callers
  // that absolutely need a tenant scope will gate further.
  const tenantId = getCurrentTenantId(req);

  const role: ResolvedIdentity["role"] = ctx.isAdmin
    ? "admin"
    : ctx.founder.companies.length > 0
      ? "founder"
      : ctx.investor.state !== "NONE"
        ? "investor"
        : "user";

  return {
    userId: ctx.userId,
    tenantId,
    email: ctx.identity.email,
    name: ctx.identity.name,
    role,
    isAdmin: ctx.isAdmin,
    isAuthed: true,
    activeCompanyId: ctx.founder.activeCompanyId,
    ctx,
  };
}

/**
 * Convenience wrapper for stores that previously composed an `actor` string
 * from `req.headers["x-actor-email"]`. Returns the session user's verified
 * email; never a client-supplied header.
 */
export function requireActor(req: Request): { userId: string; email: string; name: string } {
  const id = requireIdentity(req);
  return { userId: id.userId, email: id.email, name: id.name };
}

/**
 * Replaces the banned `?? "co_novapay"` / `req.headers["x-company-id"]`
 * patterns. Returns the active company id from session for founder personas,
 * or null when none is selected.
 *
 * For investor/admin reads keyed on a path/query param, prefer the explicit
 * param and DO NOT fall back to this helper.
 */
export function getCompanyIdFromContext(req: Request): string | null {
  const attached = (req as Request & { userContext?: UserContext }).userContext;
  const ctx = attached ?? getUserContext(req);
  if (!ctx?.isAuthed) return null;
  return ctx.founder.activeCompanyId ?? null;
}

/**
 * Thin assertion form — throws `missing_identity` if no company is selected.
 * Use on founder-only endpoints that absolutely require an active company.
 */
export function requireCompanyIdFromContext(req: Request): string {
  const cid = getCompanyIdFromContext(req);
  if (!cid) {
    const err: Error & { status?: number; code?: string } = new Error("missing_active_company");
    err.status = 400;
    err.code = "missing_active_company";
    throw err;
  }
  return cid;
}

/**
 * Helper for ownership-check routes (Tier-1 Fix 2). Throws 403 not_authorized
 * when the identified user does not own the company (admin always wins).
 *
 * Signature is intentionally async so future implementations can hit the DB
 * `company_members` table; the current implementation uses the user context's
 * pre-computed founder.companies array.
 */
export async function assertCompanyOwnership(req: Request, companyId: string): Promise<ResolvedIdentity> {
  const id = requireIdentity(req);
  if (id.isAdmin) return id;
  const owns = id.ctx.founder.companies.some((c) => c.companyId === companyId);
  if (owns) return id;

  // DB fallback — check company_members in case the in-memory context is stale
  try {
    // Lazy import to avoid circular dep + keep this helper sync-friendly.
    const { getDb } = await import("../db/connection");
    const { companyMembers } = await import("../../shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, id.userId)))
      .limit(1)
      .all();
    if (rows.length > 0) return id;
  } catch {
    // company_members table may not exist in some test harnesses — fall through to 403.
  }

  const err: Error & { status?: number; code?: string } = new Error("not_authorized");
  err.status = 403;
  err.code = "not_authorized";
  throw err;
}
