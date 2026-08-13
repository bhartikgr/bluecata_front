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

/**
 * v26.7.3 FIX-1 (R3) — TRUE exact-match public allowlist.
 *
 * Entries here are matched against the request's full URL path (query string
 * stripped, one optional trailing slash tolerated) and NOTHING else. They are
 * NOT prefixes: `/api/pricing-public` here does not admit
 * `/api/pricing-public-admin`, `/api/pricing-publicXYZ`, or
 * `/api/pricing-public/anything`.
 *
 * This exists because PUBLIC_API_PREFIXES below is, and always has been,
 * evaluated as an open prefix list (see the matcher note there). New
 * single-endpoint bypasses belong in this set, not in that array.
 */
const PUBLIC_API_EXACT_PATHS = new Set<string>([
  // v26.7.3 FIX-1 — public pricing is read-only (GET /api/pricing-public,
  // server/publicPricingRoutes.ts) and intentionally available before sign-in;
  // without this bypass the global default-deny guard returns 401.
  "/api/pricing-public",
]);

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
  // NOTE (corrected v26.7.3 R3): these two entries were previously commented as
  // being "exact paths", which was FALSE — every entry in this array is matched
  // with `req.originalUrl.startsWith(...)`, so `/api/invitations/check...`,
  // `/api/invitations/checkout`, etc. do bypass the guard today. Behaviour is
  // deliberately left unchanged here (pre-existing, out of scope for v26.7.3);
  // only the misleading comment is corrected. Use PUBLIC_API_EXACT_PATHS above
  // if you need a genuinely exact single-endpoint bypass.
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
  // NOTE (corrected v26.7.3 R3): we install at app.use("/api", ...), so Express
  // STRIPS the mount point and `req.path` is mount-relative ("/pricing-public",
  // not "/api/pricing-public"). The `path === pub` comparison below therefore
  // never fires for any entry, and PUBLIC_API_PREFIXES is effectively a pure
  // `originalUrl` prefix list. It is left as-is to avoid changing the behaviour
  // of the 20 pre-existing entries; exact single-endpoint bypasses go through
  // PUBLIC_API_EXACT_PATHS instead.
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;

    // 0) v26.7.3 FIX-1 (R3) — exact-path public bypass. Strip the query string
    //    and at most one trailing slash, then require a whole-path match.
    const exactPath = req.originalUrl.split("?")[0].replace(/\/$/, "");
    if (PUBLIC_API_EXACT_PATHS.has(exactPath)) return next();

    // 1) Public bypass list \u2014 let through (PREFIX semantics, see note above).
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
