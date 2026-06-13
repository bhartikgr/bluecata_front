/**
 * v16 F-coll-X3 / F-coll-19 — unified member check.
 *
 * Pre-v16, requireCollectiveMember read ONLY collectiveMembershipStore,
 * while the entitlement gates read getMembership(userId)?.isCollectiveMember
 * from membershipStore. Admin approval wrote one store, the gate read the
 * other — newly-approved members were denied.
 *
 * v16 fix: requireCollectiveMember now accepts membership signal from EITHER
 * source (admin-approval store OR seed-fixture store OR ctx.collective).
 * Admin approval dual-writes via upsertActiveMembership/deactivateMembership
 * so both stores agree.
 *
 * Acceptance gate #2 / #3: anon + non-member → 401/403; member from either
 * source → 200 on a representative protected endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import {
  upsertActiveMembership,
  deactivateMembership,
} from "../membershipStore";

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

describe("v16 F-coll-X3 — unified collective member check", () => {
  it("accepts u_no_position when admin store activates them (admin-path source)", async () => {
    // u_no_position is a real persona but NOT a seed-collective-member.
    const uid = "u_no_position";
    // Ensure seed-store does NOT flag them.
    try { deactivateMembership(uid); } catch {}
    // Activate ONLY in the admin store.
    collectiveMembershipStore.activate(uid, "u_admin");
    const r = await call("GET", "/api/collective/dashboard", { userId: uid });
    expect(r.status).toBe(200);
    // Clean up.
    collectiveMembershipStore.deactivate(uid, "u_admin");
  });

  it("accepts u_aisha_patel via seed signal (isCollectiveMember=true) even with admin store cleared", async () => {
    // Aisha has isCollectiveMember=true in MOCK_MEMBERSHIP — the SEED path.
    try { collectiveMembershipStore.deactivate("u_aisha_patel", "u_admin"); } catch {}
    const r = await call("GET", "/api/collective/dashboard", { userId: "u_aisha_patel" });
    expect(r.status).toBe(200);
  });

  it("denies u_lapsed_lp (not active in either store) with 403 not_collective_member", async () => {
    const uid = "u_lapsed_lp";
    try { collectiveMembershipStore.deactivate(uid, "u_admin"); } catch {}
    // Lapsed has m.lapsed=true → status="lapsed", not "active". Gate denies.
    const r = await call("GET", "/api/collective/dashboard", { userId: uid });
    expect(r.status).toBe(403);
    expect(String(r.body?.error ?? r.body?.code ?? "")).toMatch(/not_collective_member/i);
  });

  it("anonymous calls: under DISABLE_DEV_BYPASS=1 / NODE_ENV=production, denied", async () => {
    // In Vitest with demo-fallback enabled, anon requests fall through to a
    // demo persona, so we must explicitly stub the bypass off. We assert the
    // production posture: anon → 401/403.
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const r = await call("GET", "/api/collective/dashboard");
      expect([401, 403]).toContain(r.status);
    } finally {
      delete process.env.DISABLE_DEV_BYPASS;
    }
  });

  it("admin dual-write helpers are exported and operable", () => {
    const m = upsertActiveMembership("u_test_dual_write", "2025-01-01", "2030-01-01");
    expect(m.isCollectiveMember).toBe(true);
    const cleared = deactivateMembership("u_test_dual_write");
    expect(cleared?.isCollectiveMember).toBe(false);
  });
});
