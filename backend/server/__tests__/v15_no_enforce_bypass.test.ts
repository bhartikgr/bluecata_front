/**
 * v15 P0-14 — `?enforce=0` query-string bypass MUST be removed.
 *
 * Pre-v15, the dev-bypass at server/routes.ts:487-494 used:
 *
 *   const isDevBypass = process.env.NODE_ENV !== "production"
 *                    && String(req.query.enforce ?? "1") === "0";
 *
 * Tests run with NODE_ENV=test (not "production") so a hostile caller in
 * staging or any non-prod tier could append `?enforce=0` to bypass every
 * `gate()` middleware. v15 replaces that with:
 *
 *   const isDevBypass = process.env.NODE_ENV === "development"
 *                    && process.env.ALLOW_GATE_BYPASS === "1";
 *
 * This test confirms that, under NODE_ENV=test, hitting a gated route
 * with `?enforce=0` returns the SAME 401/403 as without it — the bypass
 * is gone.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  // Tests run with NODE_ENV=test — already non-production. Belt-and-suspenders:
  // ensure ALLOW_GATE_BYPASS is unset.
  delete process.env.ALLOW_GATE_BYPASS;
  app = express();
  app.use(express.json());
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
  path: string,
  opts: { userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

describe("v15 P0-14: `?enforce=0` bypass is REMOVED", () => {
  it("GET /api/investor/portfolio without enforce=0 → 401/403 (gated)", async () => {
    // Force production posture so the demo-persona fallback doesn't grant identity.
    vi.stubEnv("NODE_ENV", "production");
    try {
      const r = await call("GET", "/api/investor/portfolio");
      expect([401, 403]).toContain(r.status);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("GET /api/investor/portfolio?enforce=0 STILL → 401/403 (bypass removed)", async () => {
    // The whole point of v15 P0-14 — `?enforce=0` MUST NO LONGER bypass.
    vi.stubEnv("NODE_ENV", "production");
    try {
      const r = await call("GET", "/api/investor/portfolio?enforce=0");
      expect([401, 403]).toContain(r.status);
      // Specifically not 200 — anything 2xx would prove the bypass still worked.
      expect(r.status).not.toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("GET /api/investor/portfolio?enforce=0 as founder (not investor) → 401/403", async () => {
    // Maya is a founder, not an investor — the gate is `investor.hasAnyCapTable`,
    // so she still gets blocked. With the old bypass she would have gotten 200.
    const r = await call("GET", "/api/investor/portfolio?enforce=0", { userId: "u_maya_chen" });
    expect([401, 403]).toContain(r.status);
    expect(r.status).not.toBe(200);
  });
});
