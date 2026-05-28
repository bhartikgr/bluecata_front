/**
 * Sprint 17 D2 — CSRF middleware (double-submit pattern).
 *
 * - Token issued on session start + every login.
 * - Mounted on `app.use("/api", csrfMiddleware)` so every state-mutating
 *   request must present a matching X-CSRF-Token header.
 * - Read methods (GET/HEAD/OPTIONS) bypass.
 * - Endpoints explicitly listed in CSRF_BYPASS skip too (login/signup,
 *   webhook bridges that have their own HMAC).
 * - The token comes from the active server-side session (looked up by
 *   the cap_sid cookie or the X-CSRF-Token header during pre-auth).
 */
import type { Request, Response, NextFunction } from "express";
import { getSession } from "./auth";
import * as crypto from "node:crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Endpoints that issue tokens, can't yet have one, or use bridge HMAC. */
const CSRF_BYPASS = [
  /^\/?api\/auth\/(login|signup|redeem|forgot|csrf|me)(\/|$)/,
  /^\/?auth\/(login|signup|redeem|forgot|csrf|me)(\/|$)/,
  /^\/?api\/bridge\//,             // outbound/inbound webhooks have their own HMAC
  /^\/?bridge\//,
  /^\/?api\/notifications\/stream/, // SSE doesn't carry a body
  /^\/?notifications\/stream/,
  /^\/?api\/events\/stream/,        // realtime SSE, no body
  /^\/?events\/stream/,
  /^\/?api\/auth\/secure\/(signup|login|redeem|csrf)(\/|$)/, // secure auth bootstrap
  /^\/?auth\/secure\/(signup|login|redeem|csrf)(\/|$)/,
];

export function isCsrfExempt(path: string): boolean {
  // Use both raw path and originalUrl-shaped path for safety: middleware mounted
  // at "/api" strips the prefix from req.path.
  return CSRF_BYPASS.some(re => re.test(path));
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  // Check both paths because Express trims the mount prefix from req.path.
  if (isCsrfExempt(req.path) || isCsrfExempt(req.originalUrl.split("?")[0])) return next();

  const sid = (req as any).sessionId ||
    (req.headers["x-session-id"] as string | undefined) ||
    parseCookie(req.headers.cookie || "", "cap_sid");
  if (!sid) return res.status(403).json({ error: "csrf_no_session" });

  const sess = getSession(sid);
  if (!sess || sess.revoked) return res.status(403).json({ error: "csrf_invalid_session" });

  const got = (req.headers["x-csrf-token"] as string | undefined) ||
    (req.body && (req.body as Record<string, unknown>)._csrf as string | undefined);
  if (!got || typeof got !== "string") return res.status(403).json({ error: "csrf_token_missing" });

  const a = Buffer.from(got);
  const b = Buffer.from(sess.csrfToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "csrf_token_invalid" });
  }
  next();
}

export function parseCookie(header: string, name: string): string | undefined {
  const parts = header.split(";").map(s => s.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    if (p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return undefined;
}
