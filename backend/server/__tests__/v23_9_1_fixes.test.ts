/**
 * v23.9.1 — A1 (AV-04 / AV-05) investor-onboarding hotfix.
 *
 * v23.9.0 removed a duplicate route registration so the PUBLIC redeem/check
 * handlers (routes.ts:1342, routes.ts:1367) would win. But a SECOND gate was
 * missed: the global deny-by-default middleware in
 * server/lib/applyRouteGuards.ts ran `requireAuth` on any /api/* path not in
 * PUBLIC_API_PREFIXES — so anonymous `POST /api/invitations/redeem` still
 * returned 401 UNAUTHORIZED before reaching the public handler.
 *
 * The fix adds the two exact invitation endpoints to PUBLIC_API_PREFIXES.
 * This suite asserts the end-to-end behavior over HTTP with NO auth header:
 *   - POST /api/invitations/redeem (valid demo token)   → 200, ok:true
 *   - POST /api/invitations/redeem (invalid token)      → 404 not_found (NOT 401)
 *   - GET  /api/invitations/check?token=xxx             → 200 or 404 (NOT 401)
 *
 * Crucially, applyRouteGuards is what wires the global gate, so the harness
 * boots the route stack AND calls applyRouteGuards(app) — mirroring
 * server/index.ts — otherwise the regression vector wouldn't be exercised.
 *
 * Demo fixture (ENABLE_DEMO_SEED=1): inv_demo_1 carries the raw token
 * "demo7-novapay-seedext-aisha-..." for round rnd_novapay_seed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { applyRouteGuards } from "../lib/applyRouteGuards";

let app: Express;
let server: http.Server;
let port: number;

const VALID_TOKEN =
  "demo7-novapay-seedext-aisha-XJq8mQk2tR9pNvLwHc4dY7zFbE3sUaG6B";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  // Mirror server/index.ts: the global guard is what produced the spurious 401.
  applyRouteGuards(app);
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
  opts: { body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    // NOTE: deliberately NO x-user-id header — these calls are anonymous.
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
    if (data) r.write(data);
    r.end();
  });
}

describe("v23.9.1 A1 — anonymous invitation redeem/check bypass the global guard", () => {
  it("POST /api/invitations/redeem with an INVALID token → 404 not_found (NOT 401)", async () => {
    const r = await call("POST", "/api/invitations/redeem", {
      body: { token: "totally_invalid_token_value" },
    });
    // The whole point of v23.9.1: the global requireAuth must NOT intercept.
    expect(r.status).not.toBe(401);
    expect(r.status).toBe(404);
    expect(r.body?.reason).toBe("not_found");
  });

  it("GET /api/invitations/check?token=xxx → 200 or 404, never 401", async () => {
    const r = await call(
      "GET",
      "/api/invitations/check?token=does_not_exist_either",
    );
    expect(r.status).not.toBe(401);
    expect([200, 404]).toContain(r.status);
  });

  it("POST /api/invitations/redeem with a VALID demo token → 200, ok:true (account created)", async () => {
    const r = await call("POST", "/api/invitations/redeem", {
      body: { token: VALID_TOKEN, password: "changeme123" },
    });
    expect(r.status).not.toBe(401);
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.invitationId).toBe("inv_demo_1");
    expect(r.body?.roundId).toBe("rnd_novapay_seed");
  });
});
