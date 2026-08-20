/**
 * REPAIR WAVE 1 · ITEM 4 — logout must actually revoke.
 *
 * WHAT WAS BROKEN (W57_REVIEW_3_RISK.md §1.2).
 *   1. KEY MISMATCH. `server/routes.ts` called
 *      `revokeSession(readSessionCookie(req))` — the RAW SIGNED 3-part cookie
 *      body — while `server/lib/userContext.ts:494-500` checks
 *      `isRevoked(resolvedUserId)`. Two key spaces over one in-memory Set, so
 *      `isRevoked()` could never match. Revocation was not partial, it was ZERO.
 *   2. THE SECOND COOKIE FAMILY. `/api/auth/secure/*` issues `cap_sid`
 *      (Max-Age 14 DAYS) and `cap_csrf`. Logout cleared neither, and never
 *      called the server-side `revokeSession(sid)` at `server/lib/auth.ts:231`,
 *      so an invited investor's server-side session stayed `revoked = false`.
 *
 * WHAT MUST NOT REGRESS.
 *   3. `res.clearCookie("cap_jwt")` is NOT dead code. `cap_jwt` is issued at
 *      `server/lib/secureAuthRoutes.ts:54` and read for authentication at :125,
 *      :234 and :258. An earlier pass classified it as dead; independent review
 *      refuted that, and the refutation is correct. There is a test below that
 *      goes red if anyone removes it.
 *   4. Logout with no cookie must not poison the revocation set, and must stay
 *      idempotent (`sprint23_wave_a.test.ts:137`, `logoutSessionDestroy.test.ts:214`).
 *   5. Re-login must clear the revocation, so "logout → re-login with the same
 *      credentials" stays idempotent.
 *
 * Tests 1, 2 and the cap_sid/cap_csrf assertions FAIL without the fix.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express, type Request } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { _resetRevocation, isRevoked, _allRevoked } from "../lib/sessionRevocation";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";
import { rawDb } from "../db/connection";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let app: Express;
let server: http.Server;
let port: number;

/** Same inline cookie parser server/index.ts installs. */
function cookieMiddleware(req: Request, _res: unknown, next: () => void) {
  const r = req as Request & { cookies?: Record<string, string> };
  if (!r.cookies) {
    const header = req.headers.cookie;
    const out: Record<string, string> = {};
    if (typeof header === "string" && header.length > 0) {
      for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k.length > 0) {
          try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
        }
      }
    }
    r.cookies = out;
  }
  next();
}

async function post(path: string, cookie?: string): Promise<{ status: number; setCookies: string[]; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: "{}",
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, setCookies: raw, body };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(cookieMiddleware as any);
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  _resetRevocation();
});

const USER = "u_repair1_logout_probe";

describe("REPAIR 1 · Item 4 — revocation is keyed on the VERIFIED userId", () => {
  it("logout revokes the userId, not the raw cookie string (before this wave it revoked the cookie body, which isRevoked() could never match)", async () => {
    const signed = signSessionValue(USER);
    expect(signed.split(".")).toHaveLength(3);
    expect(isRevoked(USER)).toBe(false);

    const r = await post("/api/auth/logout", `${LEGACY_SESSION_COOKIE}=${signed}`);
    expect(r.status).toBe(200);

    // THE assertion. This is what was broken.
    expect(isRevoked(USER), "the verified userId must be in the revocation set").toBe(true);
    // And the thing that used to be stored must NOT be.
    expect(isRevoked(signed), "the raw signed cookie body must never be the key").toBe(false);
    expect([..._allRevoked()]).toEqual([USER]);
  });

  it("logout WITHOUT a cookie does not poison the revocation set and still returns 200 (idempotency guard)", async () => {
    const r = await post("/api/auth/logout");
    expect(r.status).toBe(200);
    expect([..._allRevoked()]).toHaveLength(0);
  });

  it("logout with a GARBAGE cookie revokes nothing — an unverifiable cookie yields no identity", async () => {
    const r = await post("/api/auth/logout", `${LEGACY_SESSION_COOKIE}=not.a.valid.signature`);
    expect(r.status).toBe(200);
    expect([..._allRevoked()]).toHaveLength(0);
  });

  it("logout is idempotent — calling it twice leaves exactly one revoked id", async () => {
    const signed = signSessionValue(USER);
    await post("/api/auth/logout", `${LEGACY_SESSION_COOKIE}=${signed}`);
    await post("/api/auth/logout", `${LEGACY_SESSION_COOKIE}=${signed}`);
    expect([..._allRevoked()]).toEqual([USER]);
  });
});

describe("REPAIR 1 · Item 4 — both cookie families are cleared", () => {
  let setCookies: string[];

  beforeEach(async () => {
    const r = await post("/api/auth/logout", `${LEGACY_SESSION_COOKIE}=${signSessionValue(USER)}`);
    setCookies = r.setCookies;
  });

  it("clears cap_sid — the 14-day invited-user cookie logout used to ignore entirely", () => {
    expect(setCookies.some((c) => c.startsWith("cap_sid="))).toBe(true);
  });

  it("clears cap_csrf — the readable double-submit token logout used to ignore entirely", () => {
    expect(setCookies.some((c) => c.startsWith("cap_csrf="))).toBe(true);
  });

  it("STILL clears cap_jwt — it is NOT dead code and removing it would be a silent auth regression", () => {
    expect(setCookies.some((c) => c.startsWith("cap_jwt="))).toBe(true);
  });

  it("STILL clears both session-cookie names (__Host-cap_uid and the legacy cap_uid)", () => {
    expect(setCookies.some((c) => c.startsWith("__Host-cap_uid="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("cap_uid="))).toBe(true);
  });
});

describe("REPAIR 1 · Item 4 — the server-side session is revoked by its own key (sid)", () => {
  it("logout flips auth_sessions.revoked for the cap_sid it was given", async () => {
    const db = rawDb();
    const sid = "sid_repair1_probe";
    const now = new Date();
    const expires = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO auth_sessions
         (id, user_id, refresh_token_hash, csrf_token, issued_at, expires_at, revoked, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
    ).run(sid, "usr_repair1", "hash", "csrf", now.toISOString(), expires);

    const before = db.prepare(`SELECT revoked FROM auth_sessions WHERE id = ?`).get(sid) as { revoked: number };
    expect(Number(before.revoked)).toBe(0);

    const r = await post("/api/auth/logout", `cap_sid=${sid}`);
    expect(r.status).toBe(200);

    const after = db.prepare(`SELECT revoked FROM auth_sessions WHERE id = ?`).get(sid) as { revoked: number };
    expect(
      Number(after.revoked),
      "the invited-user server-side session must be revoked, not left alive for 14 days",
    ).toBe(1);
  });

  it("logout without a cap_sid does not revoke any other session row", async () => {
    const db = rawDb();
    const sid = "sid_repair1_untouched";
    const now = new Date();
    db.prepare(
      `INSERT OR REPLACE INTO auth_sessions
         (id, user_id, refresh_token_hash, csrf_token, issued_at, expires_at, revoked, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
    ).run(sid, "usr_repair1b", "hash", "csrf", now.toISOString(), new Date(now.getTime() + 3600_000).toISOString());

    await post("/api/auth/logout");
    const after = db.prepare(`SELECT revoked FROM auth_sessions WHERE id = ?`).get(sid) as { revoked: number };
    expect(Number(after.revoked)).toBe(0);
  });
});

describe("REPAIR 1 · Item 4 — the source still maps all three revocation paths", () => {
  const src = readFileSync(join(__dirname, "..", "routes.ts"), "utf8");

  it("keys the in-memory revocation on extractUserIdFromCookie, not readSessionCookie", () => {
    const handler = src.slice(src.indexOf('app.post("/api/auth/logout"'));
    const body = handler.slice(0, handler.indexOf('res.status(200).json({ ok: true, message: "Logged out" })'));
    /* Strip comments before asserting the ABSENCE of the old call: the fix's own
       comment quotes the defect verbatim so a future reader can see what changed,
       and a naive grep would match that quotation. */
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).toMatch(/extractUserIdFromCookie\(req\)/);
    expect(code).not.toMatch(/revokeSession\(readSessionCookie\(req\)\)/);
  });

  it("the cap_jwt clear line is present in the logout handler (tripwire against re-classifying it as dead code)", () => {
    const handler = src.slice(src.indexOf('app.post("/api/auth/logout"'));
    const body = handler.slice(0, handler.indexOf('res.status(200).json({ ok: true, message: "Logged out" })'));
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).toContain('res.clearCookie("cap_jwt"');
    expect(code).toContain('res.clearCookie("cap_sid"');
    expect(code).toContain('res.clearCookie("cap_csrf"');
  });

  it("re-login clears the revocation, so logout → re-login stays idempotent (authRoutes calls clearRevocation on the same userId key)", () => {
    const authSrc = readFileSync(join(__dirname, "..", "lib", "authRoutes.ts"), "utf8");
    const calls = authSrc.match(/clearRevocation\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    // The keys must be userIds — same space the logout handler now revokes on.
    expect(authSrc).toMatch(/clearRevocation\((adminId|canonicalId|runtimeId|userId)\)/);
  });
});
