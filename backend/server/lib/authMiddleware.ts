/**
 * Capavate — production auth middleware
 *
 * Three helpers to gate routes server-side:
 *   - requireAuth      → 401 if no session
 *   - requireAdmin     → 403 if no session OR not admin
 *   - requireFounder   → 403 if no session OR not founder of the company in :id param
 *
 * Wire these on EVERY admin route + every founder route in routes.ts.
 *
 * USAGE in routes.ts:
 *   import { requireAuth, requireAdmin, requireFounder } from "./lib/authMiddleware";
 *   app.get("/api/admin/contacts", requireAdmin, (req, res) => { ... });
 *   app.get("/api/founder/companies/:id/profile", requireFounder, (req, res) => { ... });
 *
 * The middleware DOES NOT block public routes (/api/auth/login, /api/auth/signup, /api/auth/me).
 */
import type { Request, Response, NextFunction } from "express";
import { getUserContext } from "./userContext";
import { getAccountStatusByUserId, isBlockedAccountStatus } from "./accountStatus";

/**
 * v25.48.2 MF-E — enforce account status for ALREADY-logged-in sessions.
 *
 * MF2 blocked NEW logins for suspended accounts, but an EXISTING valid session
 * for a user suspended MID-SESSION still passed every request. `userContext.ts`
 * (the session→identity resolver) is SACRED and cannot be edited, so we enforce
 * status here in the (non-sacred) auth-middleware layer, which every protected
 * route already funnels through.
 *
 * DB-driven (auth_users.status via getAccountStatusByUserId — a lightweight
 * indexed PK lookup, cheap enough per-request). Fail-CLOSED:
 *   - suspended / inactive / archived / disabled → 403 ACCOUNT_SUSPENDED
 *   - status lookup THREW (DB/schema error)      → 503 ACCOUNT_STATUS_UNAVAILABLE
 *     (deny the request but do NOT crash / do NOT silently log the user out)
 *   - no auth_users row (demo/runtime personas)  → allow (never suspended)
 *
 * Returns TRUE (and has already sent the response) when the request must be
 * blocked; FALSE when the session may proceed.
 */
function sessionBlockedByStatus(userId: string | null | undefined, res: Response): boolean {
  if (!userId) return false;
  try {
    const status = getAccountStatusByUserId(userId);
    if (isBlockedAccountStatus(status)) {
      res.status(403).json({
        ok: false,
        error: "ACCOUNT_SUSPENDED",
        status,
        message: `This account is ${status}. Contact your administrator to restore access.`,
      });
      return true;
    }
    return false;
  } catch {
    // Transient DB/read error — deny with 503 (fail-closed) rather than crash
    // or fail-open. The session is not destroyed; the caller may retry.
    res.status(503).json({
      ok: false,
      error: "ACCOUNT_STATUS_UNAVAILABLE",
      message: "Unable to verify account status right now. Please try again.",
    });
    return true;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Sign in to continue." });
  }
  if (sessionBlockedByStatus(ctx.userId, res)) return;
  (req as Request & { userContext: ReturnType<typeof getUserContext> }).userContext = ctx;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  if (sessionBlockedByStatus(ctx.userId, res)) return;
  if (!ctx.isAdmin) {
    return res.status(403).json({ ok: false, error: "ADMIN_REQUIRED", message: "Admin role required." });
  }
  (req as Request & { userContext: ReturnType<typeof getUserContext> }).userContext = ctx;
  next();
}

export function requireFounder(req: Request, res: Response, next: NextFunction) {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  if (sessionBlockedByStatus(ctx.userId, res)) return;
  const companyId = req.params.id ?? req.params.companyId;
  if (companyId) {
    const ownsCompany = ctx.founder.companies.some((c) => c.companyId === companyId);
    if (!ownsCompany && !ctx.isAdmin) {
      return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "You do not own this company." });
    }
  }
  (req as Request & { userContext: ReturnType<typeof getUserContext> }).userContext = ctx;
  next();
}

/**
 * Gate that explicitly enforces an authenticated session. Use on all
 * mutating endpoints that should never accept anonymous traffic.
 */
export function requireAuthOrThrow(req: Request, res: Response, next: NextFunction) {
  return requireAuth(req, res, next);
}

/**
 * Patch v5 — `requireAuthenticated` is the canonical guard for the
 * /api/collective/* surface. Behaviour:
 *   - 401 with { error: "AUTH_REQUIRED" } when no authenticated user.
 *   - Any authenticated persona (admin, member, dsc-member,
 *     consortium-partner, founder, investor) is allowed through.
 *     Per-endpoint entitlement decisions live downstream (gate() framework).
 *     This middleware's only job is to reject anonymous callers.
 */
export function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) {
    return res.status(401).json({ error: "AUTH_REQUIRED" });
  }
  if (sessionBlockedByStatus(ctx.userId, res)) return;
  (req as Request & { userContext: ReturnType<typeof getUserContext> }).userContext = ctx;
  next();
}
