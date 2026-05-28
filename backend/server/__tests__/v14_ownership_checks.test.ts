/**
 * v14 Tier-1 Fix 2 regression test — round-ownership check.
 *
 * Closes audit finding F-cross-03: previously any authenticated user could
 * POST /api/rounds/:id/invitations/issue and mint single-use invitation
 * tokens against any founder's round. v14 added an ownership check
 * (founder of round.companyId, or admin). This test exercises the gate:
 *
 *   - An authenticated INVESTOR persona (u_aisha_patel) attempts to issue
 *     an invitation for a NovaPay AI round (founder = Maya Chen). She is
 *     NOT a founder of co_novapay, so the server must return 403
 *     not_authorized.
 *   - The legitimate founder (u_maya_chen) can issue an invitation against
 *     the same round → 200.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
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

describe("v14: cross-tenant ownership check on /api/rounds/:id/invitations/issue", () => {
  const ROUND_ID = "rnd_novapay_foundation"; // co_novapay (Maya Chen's company)
  const INVITE_BODY = {
    inviteeEmail: "v14-ownership-probe@example.com",
    inviteeName: "v14 probe",
    ttlDays: 7,
  };

  it("non-owner investor (aisha) trying to mint invitation token → 403 not_authorized", async () => {
    const res = await call(
      "POST",
      `/api/rounds/${ROUND_ID}/invitations/issue`,
      { body: INVITE_BODY, userId: "u_aisha_patel" },
    );
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("not_authorized");
  });

  it("legitimate founder (maya_chen) on her own round → 200 + token", async () => {
    const res = await call(
      "POST",
      `/api/rounds/${ROUND_ID}/invitations/issue`,
      { body: INVITE_BODY, userId: "u_maya_chen" },
    );
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(typeof res.body?.tokenForEmail).toBe("string");
    expect((res.body?.tokenForEmail as string).length).toBeGreaterThan(20);
  });
});
