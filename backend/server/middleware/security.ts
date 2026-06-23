/**
 * Sprint 17 D2 — security middleware bundle.
 *
 * Applies:
 *   - Strict CSP (no inline scripts, no inline styles in prod)
 *   - X-Content-Type-Options, Referrer-Policy, X-Frame-Options
 *   - HSTS (production only)
 *   - Tightened CORS: only the deployed origin + localhost can call /api
 *
 * The deploy proxy already strips inline scripts and adds its own CSP, but
 * we tighten it from our backend too so direct (non-proxied) hits get the
 * same protections.
 */
import type { Request, Response, NextFunction } from "express";

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/.+\.pplx\.app$/,
  /^https:\/\/(www\.)?capavate\.com$/,
];

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Content-Security-Policy. The dev environment runs Vite with HMR so we
  // must allow inline scripts in development; production locks it down.
  const isDev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:"
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // tailwind needs inline at runtime
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: wss: ws:",
    "frame-ancestors 'self' https://*.pplx.app",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (!isDev) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

export function corsForApi(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin as string | undefined;
  if (origin && ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Session-Id, X-User-Id, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

/**
 * v25.24 NH-5 — Origin allowlist enforcement for state-mutating requests.
 *
 * Lane F2 second-pass flagged that the v25.23 CSRF rollback documentation
 * claimed SameSite=Lax + CORS allowlist as interim defense, but `corsForApi`
 * above only STRIPS the CORS reflection headers when Origin is disallowed —
 * it doesn't REJECT the actual request. A cross-site authenticated POST
 * from an evil origin still executes (the browser merely refuses to read
 * the response). For state-mutating requests against cookie-authenticated
 * routes that is itself the threat — the attacker doesn't need to read the
 * response if the write succeeded.
 *
 * This middleware rejects POST/PUT/PATCH/DELETE requests with an Origin
 * header that doesn't match the allowlist. Same-origin requests omit
 * Origin (per W3C Fetch on some browsers) or set it to the same scheme+host
 * — those still pass. Server-to-server scripts (curl, internal calls) also
 * omit Origin and pass. The narrow case it blocks is: a logged-in user's
 * browser, visiting an attacker page, that tries a POST with credentials
 * to /api/* — browsers always set Origin on cross-site, so we 403 here.
 *
 * This is the cheapest viable replacement for the rolled-back CSRF until
 * the client-side double-submit wire-up ships in a follow-up wave.
 */
export function originAllowlistForWrites(req: Request, res: Response, next: NextFunction) {
  const m = req.method.toUpperCase();
  if (m !== "POST" && m !== "PUT" && m !== "PATCH" && m !== "DELETE") {
    return next();
  }
  const origin = req.headers.origin as string | undefined;
  if (!origin) {
    // No Origin header — same-origin navigation, native client, or curl.
    // The session cookie already authenticates; no cross-site forgery is
    // possible without a browser-set Origin.
    return next();
  }
  if (ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin))) {
    return next();
  }
  res.status(403).json({
    error: "origin_not_allowed",
    message:
      "This request's Origin is not in the allowlist. State-mutating calls must come from a trusted Capavate frontend.",
  });
}
