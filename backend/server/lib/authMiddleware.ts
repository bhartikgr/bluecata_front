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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Sign in to continue." });
  }
  (req as Request & { userContext: ReturnType<typeof getUserContext> }).userContext = ctx;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
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
  (req as Request & { userContext: ReturnType<typeof getUserContext> }).userContext = ctx;
  next();
}
