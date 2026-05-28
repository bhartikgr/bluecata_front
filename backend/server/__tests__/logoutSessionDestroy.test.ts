/**
 * Wave C — FIX C1 (W-2) — Logout destroys server-side session.
 *
 * Verifies that POST /api/auth/logout adds the session token (the
 * cookie value, which IS the userId in the Capavate auth model) to the
 * revocation set so the OLD cookie can no longer authenticate even
 * before its TTL expires.
 *
 * Re-login with the same credentials clears the revocation, restoring
 * the idempotent "logout then sign back in" flow QA expects.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express, type Request } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { _resetRevocation, isRevoked } from "../lib/sessionRevocation";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  // Mirror the inline cookie parser from server/index.ts so the cookie
  // value set by login flows through to the session resolver.
  app.use((req, _res, next) => {
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
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  _resetRevocation();
});

type CallResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string | string[]>;
};

function call(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.cookie) {
      headers["cookie"] = opts.cookie;
    }
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(raw),
              headers: res.headers as Record<string, string | string[]>,
            });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw, headers: {} });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function extractCookieValue(setCookieHeader: string | string[] | undefined): string | null {
  if (!setCookieHeader) return null;
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const c of cookies) {
    // accept either __Host-cap_uid or cap_uid
    const m = c.match(/(?:^|;\s*)(?:__Host-cap_uid|cap_uid)=([^;]+)/);
    if (m && m[1] && m[1].length > 0 && m[1] !== "" && !/^\s*$/.test(m[1])) {
      return `${c.split(";")[0]}`; // "name=value"
    }
  }
  return null;
}

describe("Wave C FIX C1 — POST /api/auth/logout destroys session", () => {
  it("login → /api/auth/me reports isAuthed=true", async () => {
    const loginR = await call("POST", "/api/auth/login", {
      body: { email: "maya@novapay.ai", password: "password123" },
    });
    expect(loginR.status).toBe(200);
    const cookie = extractCookieValue(loginR.headers["set-cookie"]);
    expect(cookie).toBeTruthy();
    const meR = await call("GET", "/api/auth/me", { cookie: cookie! });
    expect(meR.status).toBe(200);
    const meBody = meR.body as { isAuthed: boolean; userId: string };
    expect(meBody.isAuthed).toBe(true);
    expect(meBody.userId).toBe("u_maya_chen");
  });

  it("after logout, the same cookie no longer authenticates as the revoked user (production semantics)", async () => {
    // 1) login
    const loginR = await call("POST", "/api/auth/login", {
      body: { email: "maya@novapay.ai", password: "password123" },
    });
    expect(loginR.status).toBe(200);
    const cookie = extractCookieValue(loginR.headers["set-cookie"]);
    expect(cookie).toBeTruthy();

    // 2) confirm authed under the cookie
    const before = await call("GET", "/api/auth/me", { cookie: cookie! });
    expect((before.body as { isAuthed: boolean; userId: string }).isAuthed).toBe(true);
    expect((before.body as { userId: string }).userId).toBe("u_maya_chen");

    // 3) logout (sends the cookie, so the server revokes the right userId)
    const logoutR = await call("POST", "/api/auth/logout", { cookie: cookie! });
    expect(logoutR.status).toBe(200);
    expect((logoutR.body as { ok: boolean }).ok).toBe(true);

    // 4) revocation set should now contain the user's id
    expect(isRevoked("u_maya_chen")).toBe(true);

    // 5) Production-mode replay: with DISABLE_DEV_BYPASS=1 there is no
    //    sandbox fallback, so the OLD cookie returns isAuthed=false.
    const prevBypass = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const after = await call("GET", "/api/auth/me", { cookie: cookie! });
      const afterBody = after.body as { isAuthed: boolean; userId: string | null };
      expect(afterBody.isAuthed).toBe(false);
      expect(afterBody.userId).toBeFalsy();
    } finally {
      if (prevBypass === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prevBypass;
    }
  });

  it("sandbox mode: revoked cookie never authenticates as the original (revoked) user — sandbox may fall through to default", async () => {
    // Same as above, but without DISABLE_DEV_BYPASS. Sandbox/test mode may
    // fall back to a default persona when the cookie's userId is revoked
    // (see resolvePersonaIdWithFallback). The security guarantee is that
    // the OLD cookie does NOT continue to authenticate as the revoked user.
    const loginR = await call("POST", "/api/auth/login", {
      body: { email: "maya@novapay.ai", password: "password123" },
    });
    const cookie = extractCookieValue(loginR.headers["set-cookie"])!;
    await call("POST", "/api/auth/logout", { cookie });
    expect(isRevoked("u_maya_chen")).toBe(true);
    const after = await call("GET", "/api/auth/me", { cookie });
    const afterBody = after.body as { isAuthed: boolean; userId: string | null };
    // Even if isAuthed is true via sandbox fallback, it MUST NOT be u_maya_chen.
    expect(afterBody.userId).not.toBe("u_maya_chen");
  });

  it("after logout, a re-login with the same creds clears the revocation and authenticates", async () => {
    // initial login + logout
    const loginR = await call("POST", "/api/auth/login", {
      body: { email: "maya@novapay.ai", password: "password123" },
    });
    const cookie = extractCookieValue(loginR.headers["set-cookie"])!;
    await call("POST", "/api/auth/logout", { cookie });
    expect(isRevoked("u_maya_chen")).toBe(true);

    // re-login
    const reR = await call("POST", "/api/auth/login", {
      body: { email: "maya@novapay.ai", password: "password123" },
    });
    expect(reR.status).toBe(200);
    expect(isRevoked("u_maya_chen")).toBe(false);

    const newCookie = extractCookieValue(reR.headers["set-cookie"])!;
    const meR = await call("GET", "/api/auth/me", { cookie: newCookie });
    expect((meR.body as { isAuthed: boolean; userId: string }).isAuthed).toBe(true);
    expect((meR.body as { userId: string }).userId).toBe("u_maya_chen");
  });

  it("logout without a cookie still returns 200 and does not poison the revocation set", async () => {
    const r = await call("POST", "/api/auth/logout");
    expect(r.status).toBe(200);
    expect(isRevoked("")).toBe(false);
    expect(isRevoked("u_maya_chen")).toBe(false);
  });

  it("logout clears the cookie via Set-Cookie response header", async () => {
    const loginR = await call("POST", "/api/auth/login", {
      body: { email: "maya@novapay.ai", password: "password123" },
    });
    const cookie = extractCookieValue(loginR.headers["set-cookie"])!;
    const logoutR = await call("POST", "/api/auth/logout", { cookie });
    const setCookies = logoutR.headers["set-cookie"];
    const arr = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
    // expect at least one cap_uid-clearing Set-Cookie header
    const hasClear = arr.some(
      (c) =>
        c.match(/(?:__Host-)?cap_uid=\s*;/) ||
        c.match(/(?:__Host-)?cap_uid=;/) ||
        c.toLowerCase().includes("expires=thu, 01 jan 1970"),
    );
    expect(hasClear).toBe(true);
  });
});
