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
  // Wave B FIX 12 (CP-BUG-001) — the consortium-partner apply form must be
  // reachable without a session. /api/public/* is the canonical public-API
  // namespace for unauthenticated endpoints (rate-limited per-IP in their
  // own handlers).
  "/api/public/",
  // Wave G HOTFIX (E2E partner.consortium-apply-public-works) — the REST-style
  // alias `/api/consortium-applications` (registered alongside the canonical
  // `/api/public/consortium/apply` in server/consortiumApplyStore.ts) MUST also
  // bypass the global default-auth route guard so anonymous POSTs reach the
  // rate-limited public handler. Without this entry, applyRouteGuards's
  // fall-through `requireAuth` short-circuits with 401 before the registered
  // public route runs. The route itself is rate-limited per-IP and validates
  // its body via publicApplySchema (returning 400 on bad input), so adding
  // the alias to the public bypass list is the minimal, surgical fix.
  "/api/consortium-applications",
  // v23.9.1 fix A1 (AV-04 / AV-05) — investor onboarding via invitation token.
  // The token IS the credential, so these MUST be reachable without a session.
  // v23.9 removed a duplicate route registration but missed this second gate:
  // the fall-through `requireAuth` below intercepted the redeem/check before
  // reaching the public handler at routes.ts:1367, returning a spurious 401.
  // Listed as exact paths (not an `/api/invitations/` prefix) so future
  // authenticated `/api/invitations/*` routes are not accidentally exposed.
  "/api/invitations/check",        // pre-validation, public
  "/api/invitations/redeem",       // public account creation via token
  // v24.1 hotfix — /api/auth/secure/redeem MUST be reachable without a session.
  // The token IS the credential (same pattern as /api/auth/redeem above).
  // Without this, the forgot-password + set-password + admin-reset flows all
  // return 401 at the route guard BEFORE the token-validation handler runs.
  // Smoke-caught by the main agent: POST /api/auth/secure/redeem -> 401.
  // The handler at server/lib/secureAuthRoutes.ts:139 already does the token
  // hash lookup + intent branching + bcrypt verification; it is safe to be
  // public-facing (rate-limited per-IP via the limiter in the handler).
  "/api/auth/secure/redeem",
  // CSRF for this path is already exempt via the /api/auth/redeem regex in
  // server/lib/csrf.ts:CSRF_BYPASS (matches /api/auth/redeem/ prefix).
  // v25.4 — webhook receivers verify their own signatures and have no session,
  // so they must bypass the default-deny route guard.
  "/api/webhooks/",                  // catchall for /api/webhooks/payment-gateway/{airwallex,stripe}
  "/api/airwallex/webhook/",         // collective-membership Airwallex webhook
  "/api/stripe/webhook/",            // deprecated stub returns 410 — still must be reachable
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
