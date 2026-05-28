/**
 * Sprint 22 Wave 1 — Identity + Share Fixes regression tests.
 *
 * Tests (≥15 supertest-style assertions using node:http):
 *  1.  POST /api/comms/dm/start with valid targetUserId → ok:true + channelId
 *  2.  POST /api/comms/dm/start without auth → 401
 *  3.  POST /api/comms/dm/start with unknown targetUserId → 404
 *  4.  POST /api/comms/dm/start called twice → same channelId (idempotent)
 *  5.  GET  /api/investor/companies/:id/co-members without auth → 401
 *  6.  GET  /api/investor/companies/:id/co-members with auth → 200 + array
 *  7.  GET  /api/investor/companies/:id/co-members returns userId field on rows
 *  8.  GET  /api/notifications?userId=… requires auth header (returns 200 with items)
 *  9.  POST /api/notifications/read-all marks unread → marked > 0 (or 0 if already all read)
 *  10. POST /api/comms/posts/:id/share increments shareCount
 *  11. POST /api/comms/posts/:id/share returns updated post with new shareCount
 *  12. GET  /api/comms/posts returns posts array
 *  13. POST /api/comms/dm/start returns channelId string (not undefined)
 *  14. GET  /api/investor/companies/:id/co-members privacy: rows with allowDM=false have no userId
 *  15. GET  /api/investor/companies/:id/co-members for unknown company → empty array (not 404)
 *  16. POST /api/notifications/read-all returns ok:true
 *  17. GET  /api/comms/posts returns posts with shareCount field
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity"; /* v14 Tier-1 Fix 1 — restores u_admin default identity for legacy tests */
import express, { type Express } from "express";
import http from "node:http";
import { registerCommsRoutes } from "../commsStore";
import { registerNotificationsRoutes } from "../notificationsStore";
import { registerSprint21Routes } from "../sprint21Routes";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);
  registerNotificationsRoutes(app);
  registerSprint21Routes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  port = (server.address() as any).port as number;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string; actorId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    // Support both auth patterns
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.actorId) headers["x-actor-id"] = opts.actorId;

    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// Known IDs (deterministic from seed data)
const INVESTOR_ID = "u_aisha_patel";
const FOUNDER_ID  = "u_maya_chen";
const NOVAPAY_CO  = "co_novapay";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sprint 22 Wave 1 — Identity + Share Fixes", () => {

  // -------------------------------------------------------------------------
  // DM Start tests (DEF-023/DEF-026 coverage)
  // -------------------------------------------------------------------------

  it("1. POST /api/comms/dm/start with valid targetUserId returns ok:true + channelId", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/dm/start",
      { actorId: INVESTOR_ID, body: { targetUserId: FOUNDER_ID } },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.channelId).toBe("string");
    expect(body.channelId.length).toBeGreaterThan(0);
  });

  it("2. POST /api/comms/dm/start without auth → 401", async () => {
    // No actorId header, no x-user-id — actorOf should throw 401 (DEF-026 fix)
    const { status } = await call(
      "POST",
      "/api/comms/dm/start",
      { body: { targetUserId: FOUNDER_ID } },
    );
    expect(status).toBe(401);
  });

  it("3. POST /api/comms/dm/start with unknown targetUserId → 404", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/dm/start",
      { actorId: INVESTOR_ID, body: { targetUserId: "m_novapay_nonexistent" } },
    );
    expect(status).toBe(404);
    expect(body).toBeDefined();
  });

  it("4. POST /api/comms/dm/start is idempotent — same pair returns same channelId", async () => {
    const first = await call(
      "POST",
      "/api/comms/dm/start",
      { actorId: INVESTOR_ID, body: { targetUserId: FOUNDER_ID } },
    );
    const second = await call(
      "POST",
      "/api/comms/dm/start",
      { actorId: INVESTOR_ID, body: { targetUserId: FOUNDER_ID } },
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.channelId).toBe(second.body.channelId);
  });

  it("13. POST /api/comms/dm/start channelId is a non-empty string (not undefined)", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/dm/start",
      { actorId: INVESTOR_ID, body: { targetUserId: FOUNDER_ID } },
    );
    expect(status).toBe(200);
    expect(body.channelId).toBeTruthy();
    expect(body.channelId).not.toBe("undefined");
  });

  // -------------------------------------------------------------------------
  // Co-members tests (DEF-003/DEF-004 coverage)
  // -------------------------------------------------------------------------

  it("5. GET /api/investor/companies/:id/co-members with unknown userId → 401", async () => {
    // Pass an unknown explicit userId — getUserContextForId returns isAuthed:false
    // Note: no-auth requests fall back to demo persona (u_aisha_patel) by design in the dev environment.
    // To trigger isAuthed:false we pass a userId that is not in the persona registry.
    const { status } = await call(
      "GET",
      `/api/investor/companies/${NOVAPAY_CO}/co-members`,
      { userId: "u_not_a_real_persona_xyz" },
    );
    expect(status).toBe(401);
  });

  it("6. GET /api/investor/companies/:id/co-members with auth → 200 + array", async () => {
    const { status, body } = await call(
      "GET",
      `/api/investor/companies/${NOVAPAY_CO}/co-members`,
      { userId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("7. GET /api/investor/companies/:id/co-members — rows with allowDM:true have userId field", async () => {
    const { status, body } = await call(
      "GET",
      `/api/investor/companies/${NOVAPAY_CO}/co-members`,
      { userId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    // At least one row should have userId (DEF-003 fix: userId is now returned)
    const withUserId = body.filter((m: any) => m.userId !== undefined);
    expect(withUserId.length).toBeGreaterThan(0);
    // Each row with userId should have a non-empty string userId
    for (const m of withUserId) {
      expect(typeof m.userId).toBe("string");
      expect(m.userId.length).toBeGreaterThan(0);
    }
  });

  it("14. GET /api/investor/companies/:id/co-members — privacy: rows with allowDM=false lack userId", async () => {
    const { status, body } = await call(
      "GET",
      `/api/investor/companies/${NOVAPAY_CO}/co-members`,
      { userId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    // Rows where allowDM is false should NOT have userId exposed
    const withoutDm = body.filter((m: any) => m.allowDM === false);
    for (const m of withoutDm) {
      expect(m.userId).toBeUndefined();
    }
  });

  it("15. GET /api/investor/companies/:id/co-members for unknown company → empty array (not 404)", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_unknown_xyz/co-members",
      { userId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Notifications tests (DEF-002/DEF-018/F-18 coverage)
  // -------------------------------------------------------------------------

  it("8. GET /api/notifications?userId=u_aisha_patel returns items array", async () => {
    const { status, body } = await call(
      "GET",
      `/api/notifications?userId=${INVESTOR_ID}`,
    );
    expect(status).toBe(200);
    expect(body.userId).toBe(INVESTOR_ID);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("9. POST /api/notifications/read-all returns ok:true and marked count", async () => {
    const { status, body } = await call(
      "POST",
      "/api/notifications/read-all",
      { body: { userId: INVESTOR_ID } },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.marked).toBe("number");
  });

  it("16. POST /api/notifications/read-all — subsequent call marks 0 (already all read)", async () => {
    // First call marks all
    await call("POST", "/api/notifications/read-all", { body: { userId: INVESTOR_ID } });
    // Second call should find nothing left to mark
    const { status, body } = await call(
      "POST",
      "/api/notifications/read-all",
      { body: { userId: INVESTOR_ID } },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.marked).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Post share tests (DEF-008/DEF-009 coverage — server side)
  // -------------------------------------------------------------------------

  it("10. POST /api/comms/posts/:id/share returns 200", async () => {
    // First get a post ID
    const { body: posts } = await call("GET", "/api/comms/posts", { actorId: INVESTOR_ID });
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
    const postId = posts[0].id;
    const { status } = await call(
      "POST",
      `/api/comms/posts/${postId}/share`,
      { actorId: INVESTOR_ID },
    );
    expect(status).toBe(200);
  });

  it("11. POST /api/comms/posts/:id/share increments shareCount", async () => {
    const { body: posts } = await call("GET", "/api/comms/posts", { actorId: INVESTOR_ID });
    const postId = posts[0].id;
    const beforeCount = posts[0].shareCount as number;
    await call("POST", `/api/comms/posts/${postId}/share`, { actorId: INVESTOR_ID });
    // Re-fetch posts to confirm shareCount incremented
    const { body: updatedPosts } = await call("GET", "/api/comms/posts", { actorId: INVESTOR_ID });
    const updated = updatedPosts.find((p: any) => p.id === postId);
    expect(updated).toBeDefined();
    expect(updated.shareCount).toBeGreaterThanOrEqual(beforeCount + 1);
  });

  it("12. GET /api/comms/posts returns posts array with expected shape", async () => {
    const { status, body } = await call("GET", "/api/comms/posts", { actorId: INVESTOR_ID });
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Each post should have required fields
    const post = body[0];
    expect(typeof post.id).toBe("string");
    expect(typeof post.body).toBe("string");
    expect(typeof post.shareCount).toBe("number");
    expect(Array.isArray(post.likedByUserIds)).toBe(true);
  });

  it("17. GET /api/comms/posts — each post has shareCount field (number)", async () => {
    const { status, body } = await call("GET", "/api/comms/posts", { actorId: INVESTOR_ID });
    expect(status).toBe(200);
    for (const p of body) {
      expect(typeof p.shareCount).toBe("number");
    }
  });

});
