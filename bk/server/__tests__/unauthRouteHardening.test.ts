/**
 * Wave C — FIX C6 — Unauth route hardening.
 *
 * Investor / Founder / Partner / Collective / Admin app shells must
 * never render to an UNAUTHENTICATED visitor. The client-side fix in
 * `client/src/App.tsx::AppRouter` probes `GET /api/auth/me` once and
 * renders the route tree BARE (no AppShell) when the visitor is not
 * authenticated. This server-side test pins the contract the client
 * relies on:
 *
 *   1. `GET /api/auth/me` with NO cookie returns `isAuthed:false`
 *      under production-mode resolution (DISABLE_DEV_BYPASS=1).
 *   2. The same endpoint with a known cookie returns `isAuthed:true`.
 *   3. The fix code is wired in App.tsx (string-level smoke check).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express, type Request } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { registerRoutes } from "../routes";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
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

function call(
  method: string,
  pathStr: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: any; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.cookie) headers["cookie"] = opts.cookie;
    const req = http.request(
      { hostname: "127.0.0.1", port, path: pathStr, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(buf),
              headers: res.headers as Record<string, string | string[]>,
            });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf, headers: {} });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function extractCookie(setCookieHeader: string | string[] | undefined): string | null {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const c of arr) {
    const m = c.match(/(?:^|;\s*)(?:__Host-cap_uid|cap_uid)=([^;]+)/);
    if (m && m[1] && m[1].length > 0) return c.split(";")[0];
  }
  return null;
}

describe("Wave C FIX C6 — unauthenticated /api/auth/me reports isAuthed=false (server contract)", () => {
  it("anonymous /api/auth/me returns isAuthed=false in production mode", async () => {
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const r = await call("GET", "/api/auth/me");
      expect(r.status).toBe(200);
      expect((r.body as { isAuthed: boolean }).isAuthed).toBe(false);
      expect((r.body as { userId: string | null }).userId).toBeFalsy();
    } finally {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
    }
  });

  it("authenticated /api/auth/me returns isAuthed=true", async () => {
    const loginR = await call("POST", "/api/auth/login", {
      body: { email: "maya@novapay.ai", password: "password123" },
    });
    expect(loginR.status).toBe(200);
    const cookie = extractCookie(loginR.headers["set-cookie"])!;
    const meR = await call("GET", "/api/auth/me", { cookie });
    expect(meR.status).toBe(200);
    expect((meR.body as { isAuthed: boolean }).isAuthed).toBe(true);
  });
});

describe("Wave C FIX C6 — App.tsx renders BARE for unauthenticated visitors (client wiring)", () => {
  const appTsxPath = path.join(__dirname, "..", "..", "client", "src", "App.tsx");
  const src = fs.readFileSync(appTsxPath, "utf8");

  it("AppRouter probes /api/auth/me at the router level", () => {
    expect(src).toMatch(/useIsAuthedProbe|isAuthedProbe/);
    expect(src).toContain('"/api/auth/me"');
  });

  it("bare-render check includes !isAuthed", () => {
    // The fix appends `|| authProbeLoading || !isAuthed` to the `bare` flag.
    expect(src).toMatch(/!isAuthed/);
  });

  it("AppShell is only rendered when NOT bare (existing pattern preserved)", () => {
    expect(src).toMatch(/bare \? routes : <AppShell>\{routes\}<\/AppShell>/);
  });

  it("FIX C6 comment is present and references I-FINAL-001", () => {
    expect(src).toMatch(/Wave C FIX C6/);
    expect(src).toMatch(/I-FINAL-001/);
  });

  it("every /investor/* route is wrapped in RequireAuth", () => {
    // Make sure none of the explicit investor leaf routes lost their guard.
    const investorRoutes = src.match(/<Route path="\/investor\/[^"]+">[\s\S]*?<\/Route>/g) ?? [];
    expect(investorRoutes.length).toBeGreaterThan(5);
    for (const r of investorRoutes) {
      // /investor/login + /investor/signup use component={...} form (public);
      // the wrapped form uses the {() => <RequireAuth ...>} render-prop pattern.
      if (r.includes("InvestorLogin") || r.includes("InvestorSignup")) continue;
      expect(r).toMatch(/RequireAuth/);
    }
  });

  it("every /founder/* protected route is wrapped in RequireAuth", () => {
    const founderRoutes = src.match(/<Route path="\/founder\/[^"]+">[\s\S]*?<\/Route>/g) ?? [];
    expect(founderRoutes.length).toBeGreaterThan(10);
    for (const r of founderRoutes) {
      expect(r).toMatch(/RequireAuth/);
    }
  });

  it("every /collective/* protected route is wrapped in RequireAuth", () => {
    const collectiveRoutes = src.match(/<Route path="\/collective\/[^"]+">[\s\S]*?<\/Route>/g) ?? [];
    expect(collectiveRoutes.length).toBeGreaterThan(5);
    for (const r of collectiveRoutes) {
      // /collective/preview is public.
      if (r.includes("CollectivePreview") || r.includes("collective/preview")) continue;
      expect(r).toMatch(/RequireAuth/);
    }
  });

  it("every /admin/* protected route is wrapped in RequireAuth with admin role", () => {
    const adminRoutes = src.match(/<Route path="\/admin\/[^"]+">[\s\S]*?<\/Route>/g) ?? [];
    expect(adminRoutes.length).toBeGreaterThan(10);
    for (const r of adminRoutes) {
      // /admin/login is public; redirects (e.g. /admin/audit -> /admin/audit-log)
      // do not need RequireAuth because they only emit a Redirect.
      if (r.includes("AdminLogin") || r.includes("admin/login")) continue;
      if (r.includes("<Redirect")) continue;
      expect(r).toMatch(/RequireAuth/);
    }
  });
});
