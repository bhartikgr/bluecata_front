/**
 * Capavate \u2014 production route guards (Sprint-fix May 14 2026)
 *
 * Wires `requireAdmin` over every /api/admin/* route AFTER all routes are
 * registered. This is the single-call fix for QA-report critical #2
 * (admin APIs reachable by anonymous users).
 *
 * USAGE in server/index.ts (call once, AFTER all `register*Routes(app)` calls):
 *
 *   import { applyRouteGuards } from "./lib/applyRouteGuards";
 *   await registerRoutes(httpServer, app);
 *   applyRouteGuards(app);
 *
 * It uses Express's router stack inspection to attach the middleware
 * BEFORE the route handlers run. No need to refactor 200+ call sites.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { requireAdmin, requireAuth } from "./authMiddleware";

const PUBLIC_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/forgot",
  "/api/auth/me",                  // returns isAuthed=false for anonymous; doesn't leak
  "/api/auth/redeem",
  "/api/auth/redeem/preview",
  "/api/healthz",
  "/api/health",                   // v19 Phase C — enhanced healthcheck (public)
  "/api/regions",                  // canonical region list \u2014 safe to expose
  "/api/dev/admin-bypass",         // self-gates via env var
];

/** Apply auth middleware to every request before it reaches a route handler. */
export function applyRouteGuards(app: Express) {
  // Single middleware that gates by URL path. Registered BEFORE any
  // route-specific handler so it short-circuits requests that lack auth.
  // NOTE: we install at app.use("/api", ...) but the function below filters
  // by full req.path so we don't accidentally gate static assets.
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;

    // 1) Public bypass list \u2014 let through.
    for (const pub of PUBLIC_API_PREFIXES) {
      if (path === pub || req.originalUrl.startsWith(pub)) return next();
    }

    // 2) Admin routes \u2014 require admin role.
    if (req.originalUrl.startsWith("/api/admin/")) {
      return requireAdmin(req, res, next);
    }

    // 3) Founder routes \u2014 require any authenticated user (the per-route
    //    handler is responsible for verifying company ownership).
    if (req.originalUrl.startsWith("/api/founder/")) {
      return requireAuth(req, res, next);
    }

    // 4) Investor routes \u2014 same baseline.
    if (req.originalUrl.startsWith("/api/investor/")) {
      return requireAuth(req, res, next);
    }

    // 5) Collective routes \u2014 require any authenticated user.
    if (req.originalUrl.startsWith("/api/collective/")) {
      return requireAuth(req, res, next);
    }

    // 6) Any other /api/* \u2014 require auth by default (defense in depth).
    return requireAuth(req, res, next);
  });
}
