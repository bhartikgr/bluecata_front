/**
 * v14 Tier-1 Fix 3 regression test — requireCollectiveMember.
 *
 * A user who is NOT registered in collectiveMembershipStore cannot read
 * /api/collective/companies even with a valid session. They must receive
 * 403 NOT_COLLECTIVE_MEMBER (under non-prod) or 401 AUTH_REQUIRED in prod
 * if their session is not active.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  // Activate aisha as a Collective member (positive control).
  collectiveMembershipStore.activate("u_aisha_patel", "u_admin");
  // Ensure maya_chen (a known founder persona) is NOT an active Collective
  // member — she should be denied with 403 NOT_COLLECTIVE_MEMBER.
  try {
    collectiveMembershipStore.deactivate("u_maya_chen", "u_admin");
  } catch {
    /* may not be member yet — fine */
  }
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

describe("v14: requireCollectiveMember gates /api/collective/companies", () => {
  it("non-Collective member (maya_chen, founder-only) → 403 not_collective_member", async () => {
    const res = await call("GET", "/api/collective/companies", {
      userId: "u_maya_chen",
    });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("not_collective_member");
  });

  it("active Collective member (aisha) → 200", async () => {
    const res = await call("GET", "/api/collective/companies", {
      userId: "u_aisha_patel",
    });
    expect(res.status).toBe(200);
  });
});
