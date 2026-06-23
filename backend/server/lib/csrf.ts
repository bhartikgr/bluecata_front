/**
 * Sprint 17 D2 — CSRF middleware (double-submit pattern).
 *
 * v25.23 docstring correction (HONEST STATE OF AFFAIRS):
 *
 * The prior header here claimed a global `app.use("/api", csrfMiddleware)`
 * mount. That mount does NOT exist and never has. The actual CSRF mount
 * set as of v25.23 is intentionally narrow:
 *   - `/api/auth/secure/*` — full csrfMiddleware (all methods).
 *     This is the only flow that returns a csrfToken to the client
 *     (server/lib/secureAuthRoutes.ts:84, :112, :214) AND sets the
 *     `cap_csrf` cookie. A double-submit check works end-to-end here.
 *   - `/api/invitations/redeem` POST — unauth bootstrap; the token IS
 *     the credential.
 *   - `/api/collective/applications` POST — unauth path.
 *   - `/api/rounds` PATCH .../decision — G7 fix; client-paired.
 *
 * What v25.22 NH-2 and v25.23 NH-G ATTEMPTED to add (and what we have
 * NOT shipped because the client cannot complete the double-submit
 * handshake):
 *   - `/api/collective`, `/api/admin/collective`, `/api/admin/consortium`,
 *     `/api/founder/collective`, `/api/investor/collective`
 *   - `/api/partner`, `/api/admin/partners`, `/api/admin/contacts`
 *
 * The blocker: the legacy `/api/auth/login` flow does NOT return the
 * session's csrfToken to the client, and the client (apiRequest helper,
 * every UI page) does NOT read or send an X-CSRF-Token header anywhere.
 * Mounting CSRF on those write paths would block every authenticated
 * write from the real product. The follow-up wave must:
 *   1. Modify the legacy login handler to set `cap_csrf` cookie + return
 *      `csrfToken` in the response body.
 *   2. Add a `csrfToken` cache in `client/src/lib/queryClient.ts`.
 *   3. Update `apiRequest` to attach `X-CSRF-Token` on every
 *      state-mutating call.
 *   4. THEN re-enable the v25.22 NH-2 + v25.23 NH-G mounts.
 *
 * In the meantime, the SameSite=Lax cookie attribute on `cap_uid`
 * (server/lib/securityHeaders.ts) plus the CORS origin allowlist on /api
 * (routes.ts line 317) provide meaningful CSRF mitigation for modern
 * browsers — not as strong as a true double-submit token but a
 * defensible interim defense.
 *
 * Behaviour:
 * - Token issued on session start + every login.
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
  // v23.9.1 fix A1 (AV-04 / AV-05) — public invitation onboarding. The token
  // IS the credential and the caller has no prior session, so a double-submit
  // CSRF check (which requires an existing session, csrf.ts:47) can only 403
  // here — defeating onboarding. Same class as /api/auth/redeem above, which
  // is already exempt. The handlers are rate-limited per-IP (routes.ts:1342,
  // 1367) and validate the token themselves, so this is the minimal fix.
  /^\/?api\/invitations\/(check|redeem)(\/|$)/,
  /^\/?invitations\/(check|redeem)(\/|$)/,
  /^\/?api\/bridge\//,             // outbound/inbound webhooks have their own HMAC
  /^\/?bridge\//,
  /* v25.22 NH-2 fix — explicitly exempt the Airwallex + Stripe webhook
   * paths. These are signature-authenticated (no session cookie) and
   * cannot supply a CSRF token; without explicit bypass the new global
   * mount below would block legitimate webhook deliveries. */
  /^\/?api\/airwallex\/webhook\//,
  /^\/?airwallex\/webhook\//,
  /^\/?api\/stripe\/webhook\//,
  /^\/?stripe\/webhook\//,
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
