/**
 * v16 F-coll-2 — gate every collective read endpoint with requireCollectiveMember.
 *
 * Acceptance gates #2 + #3:
 *   - grep `requireCollectiveMember` in collectiveRoutes.ts ≥ 7
 *   - Anonymous → 401/403 on every protected endpoint
 *   - Non-member identity → 403 NOT_COLLECTIVE_MEMBER
 *   - Member → 200
 *
 * /api/subscriptions/mine specifically:
 *   - Now derives companyId from ctx.founder.activeCompanyId (not headers).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { registerRoutes } from "../routes";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

let app: Express;
let server: http.Server;
let port: number;

const PROTECTED_PATHS = [
  "/api/collective/dashboard",
  "/api/collective/dealroom/companies",
  "/api/collective/dsc/pipeline",
  "/api/collective/dsc/scores",
  "/api/collective/dsc/composite/co_arboreal",
  "/api/collective/dsc/prep",
  "/api/subscriptions/mine",
];

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  // Activate aisha so the positive-case requests succeed.
  collectiveMembershipStore.activate("u_aisha_patel", "u_admin");
  // Ensure maya is NOT a collective member for the negative-case test.
  try { collectiveMembershipStore.deactivate("u_maya_chen", "u_admin"); } catch {}
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
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
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

describe("v16 F-coll-2 — collective endpoints gated", () => {
  it("collectiveRoutes.ts has at least 7 requireCollectiveMember references", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "collectiveRoutes.ts"),
      "utf8",
    );
    const matches = src.match(/requireCollectiveMember/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(7);
  });

  for (const p of PROTECTED_PATHS) {
    it(`non-member is denied (403) on ${p}`, async () => {
      const r = await call("GET", p, { userId: "u_maya_chen" });
      // maya is NOT a collective member in either store.
      // /api/subscriptions/mine requires ctx.founder.activeCompanyId — maya is
      // a founder, so this returns either 403 (gated by member check, expected)
      // or 200 if her membership flag flipped. We assert it's NOT a 5xx and is
      // a 401/403 here.
      expect([401, 403]).toContain(r.status);
    });
  }

  it("collective member (aisha) gets 200 on /api/collective/dashboard", async () => {
    const r = await call("GET", "/api/collective/dashboard", {
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
  });
});
