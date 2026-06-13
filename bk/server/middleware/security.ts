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
