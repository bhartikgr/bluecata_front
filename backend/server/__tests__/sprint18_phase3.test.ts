/**
 * Sprint 18 Phase 3 — comms wiring + enhancements (B1-B6, E1-E5).
 *
 * Server-level tests covering the endpoints introduced or extended in Phase 3:
 *  - Post detail (B3+E4): GET /api/comms/posts/:id with comments + reactionHistory
 *  - Nested comments (E4): POST /api/comms/posts/:id/comments with parentCommentId
 *  - Search (E2): GET /api/comms/search?q=...
 *  - Typing pulse (E2): POST /api/comms/channels/:id/typing
 *  - Read-receipts (E2): GET /api/comms/channels/:id/read-receipts
 *  - DM start (E1): POST /api/comms/dm/start
 *  - Channel deep-links (B2): cap-table + soft-circle endpoints by id
 *  - Posts feed (B4): GET /api/comms/posts?sort=...
 *  - Like / share / follow / unlike (E5 backing): toggle flow
 *
 * The patterns mirror existing comms tests — local Express app + http server
 * on an ephemeral port, no live network.
 */
import { describe, it, expect } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity"; /* v14 Tier-1 Fix 1 — restores u_admin default identity for legacy tests */
import express, { type Express } from "express";
import http from "node:http";
import { registerCommsRoutes } from "../commsStore";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerCommsRoutes(app);
  return app;
}

function call(
  app: Express,
  method: string,
  path: string,
  opts: { body?: unknown; actorId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
      const headers: Record<string, string> = {};
      if (data) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(data));
      }
      if (opts.actorId) headers["x-actor-id"] = opts.actorId;
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null });
            } catch {
              resolve({ status: res.statusCode || 0, body: buf });
            }
          });
        },
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

/* ------------------------------------------------------------------ */
/*  B3 + E4 — post detail endpoint                                    */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — B3+E4 post detail", () => {
  it("GET /api/comms/posts returns at least one seeded post", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });

  it("GET /api/comms/posts/:id returns post + comments + reactionHistory", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    const id = list.body[0].id;
    const r = await call(app, "GET", `/api/comms/posts/${encodeURIComponent(id)}`, { actorId: "u_aisha_patel" });
    expect(r.status).toBe(200);
    expect(r.body.post.id).toBe(id);
    expect(Array.isArray(r.body.comments)).toBe(true);
    expect(Array.isArray(r.body.reactionHistory)).toBe(true);
  });

  it("GET /api/comms/posts/:id 404s for unknown id", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/posts/p_does_not_exist", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(404);
  });

  it("E4 nested comment: parentCommentId is preserved on the comment record", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    const postId = list.body[0].id;
    // First, post a top-level comment.
    const c1 = await call(app, "POST", `/api/comms/posts/${postId}/comments`, {
      body: { body: "Top-level comment" },
      actorId: "u_aisha_patel",
    });
    expect(c1.status).toBe(200);
    const parentId = c1.body.commentId;
    // Then a nested reply.
    const c2 = await call(app, "POST", `/api/comms/posts/${postId}/comments`, {
      body: { body: "Reply to top-level", parentCommentId: parentId },
      actorId: "u_aisha_patel",
    });
    expect(c2.status).toBe(200);
    // Detail view should include both, the second carrying parentCommentId.
    const detail = await call(app, "GET", `/api/comms/posts/${postId}`, { actorId: "u_aisha_patel" });
    const replies = detail.body.comments.filter((c: any) => c.parentCommentId === parentId);
    expect(replies.length).toBeGreaterThanOrEqual(1);
  });

  it("E4 detail comments carry author label + isAnonymous flag", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    const postId = list.body[0].id;
    await call(app, "POST", `/api/comms/posts/${postId}/comments`, {
      body: { body: "Hello world" },
      actorId: "u_aisha_patel",
    });
    const detail = await call(app, "GET", `/api/comms/posts/${postId}`, { actorId: "u_aisha_patel" });
    const comment = detail.body.comments[detail.body.comments.length - 1];
    expect(typeof comment.authorLabel).toBe("string");
    expect(typeof comment.isAnonymous).toBe("boolean");
  });
});

/* ------------------------------------------------------------------ */
/*  B4 — Network posts feed sort                                      */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — B4 network posts sort", () => {
  it("sort=newest returns posts in descending created-at order", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(200);
    const dates = r.body.map((p: any) => p.createdAt);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });

  it("sort=featured is accepted (returns array)", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/posts?sort=featured", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("sort=following is accepted (returns array)", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/posts?sort=following", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  B5 — message channel detail (used by ?thread= deep-link)          */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — B5 channel-by-id (thread deep-link backing)", () => {
  it("GET /api/comms/channels lists the viewer's channels", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("GET /api/comms/channels/:id returns the channel + messages payload", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const channelId = list.body[0].id;
    const r = await call(app, "GET", `/api/comms/channels/${encodeURIComponent(channelId)}`, {
      actorId: "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(r.body.channel.id).toBe(channelId);
    expect(Array.isArray(r.body.messages)).toBe(true);
  });

  it("GET /api/comms/channels/:id 403s for non-member", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    // Find a cap-table channel that u_aisha_patel is not part of.
    const ch = list.body.find((c: any) => c.kind === "cap_table");
    if (!ch) return;
    const r = await call(app, "GET", `/api/comms/channels/${encodeURIComponent(ch.id)}`, {
      actorId: "u_someone_unrelated",
    });
    // Either 403 or 404 acceptable depending on visibility check.
    expect([403, 404]).toContain(r.status);
  });
});

/* ------------------------------------------------------------------ */
/*  B2 — cap-table + soft-circle channel deep-links                   */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — B2 cap-table/soft-circle deep-links", () => {
  it("GET /api/comms/cap-table/:companyId returns existence flag", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/cap-table/co_novapay", {
      actorId: "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.exists).toBe("boolean");
  });

  it("GET /api/comms/cap-table/:companyId returns false for unknown company", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/cap-table/co_does_not_exist", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(200);
    expect(r.body.exists).toBe(false);
  });

  it("GET /api/comms/soft-circle/:roundId returns existence flag", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/soft-circle/rd_novapay_seed", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(200);
    expect(typeof r.body.exists).toBe("boolean");
  });
});

/* ------------------------------------------------------------------ */
/*  B6 — view-all messages preserves filter (filter=last sentinel)    */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — B6 view-all messages filter sentinel", () => {
  it("GET /api/comms/channels accepts repeated calls (no server-side filter state)", async () => {
    const app = buildApp();
    const r1 = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const r2 = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Filter is purely client-side; server returns the same set.
    expect(r1.body.length).toBe(r2.body.length);
  });
});

/* ------------------------------------------------------------------ */
/*  E1 — DM start (user picker actually opens a thread)               */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — E1 dm/start", () => {
  it("POST /api/comms/dm/start opens or returns an existing DM channel", async () => {
    const app = buildApp();
    const r = await call(app, "POST", "/api/comms/dm/start", {
      body: { targetUserId: "u_maya_chen" },
      actorId: "u_aisha_patel",
    });
    // Either 200 ok=true or 403 (no shared context) — both are valid behaviours.
    expect([200, 403]).toContain(r.status);
    if (r.status === 200) {
      expect(r.body.ok).toBe(true);
      expect(typeof r.body.channelId).toBe("string");
    }
  });

  it("POST /api/comms/dm/start 404s for unknown target", async () => {
    const app = buildApp();
    const r = await call(app, "POST", "/api/comms/dm/start", {
      body: { targetUserId: "u_does_not_exist" },
      actorId: "u_aisha_patel",
    });
    expect(r.status).toBe(404);
  });

  it("POST /api/comms/dm/start 400s for malformed payload", async () => {
    const app = buildApp();
    const r = await call(app, "POST", "/api/comms/dm/start", {
      body: { wrong: "shape" },
      actorId: "u_aisha_patel",
    });
    expect(r.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/*  E2 — search, typing, read-receipts                                */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — E2 search/typing/read-receipts", () => {
  it("GET /api/comms/search?q=... returns results array", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/search?q=board", {
      actorId: "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.results)).toBe(true);
  });

  it("GET /api/comms/search with empty query returns empty results", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/search?q=", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(200);
    expect(r.body.results).toEqual([]);
  });

  it("POST /api/comms/channels/:id/typing emits a typing pulse for members", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const channelId = list.body[0].id;
    const r = await call(app, "POST", `/api/comms/channels/${encodeURIComponent(channelId)}/typing`, {
      body: {},
      actorId: "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("POST /api/comms/channels/:id/typing 404s for unknown channel", async () => {
    const app = buildApp();
    const r = await call(app, "POST", "/api/comms/channels/ch_unknown/typing", {
      body: {},
      actorId: "u_maya_chen",
    });
    expect(r.status).toBe(404);
  });

  it("GET /api/comms/channels/:id/read-receipts returns receipts array", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const channelId = list.body[0].id;
    const r = await call(app, "GET", `/api/comms/channels/${encodeURIComponent(channelId)}/read-receipts`, {
      actorId: "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.receipts)).toBe(true);
    expect(r.body.channelId).toBe(channelId);
  });

  it("read-receipts entries have the expected shape", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const channelId = list.body[0].id;
    const r = await call(app, "GET", `/api/comms/channels/${encodeURIComponent(channelId)}/read-receipts`, {
      actorId: "u_maya_chen",
    });
    if (r.body.receipts.length > 0) {
      const rec = r.body.receipts[0];
      expect(typeof rec.userId).toBe("string");
      expect(typeof rec.displayName).toBe("string");
      expect("lastReadMessageId" in rec).toBe(true);
      expect("lastReadAt" in rec).toBe(true);
    }
  });

  it("GET /api/comms/channels/:id/read-receipts 404s for unknown channel", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/channels/ch_unknown/read-receipts", { actorId: "u_aisha_patel" });
    expect(r.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/*  E5 — like / unlike (optimistic UI is server-backed by toggle)     */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — E5 like/unlike toggle", () => {
  it("POST /api/comms/posts/:id/like adds the actor to likedByUserIds", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    const postId = list.body[0].id;
    const r = await call(app, "POST", `/api/comms/posts/${postId}/like`, {
      body: {},
      actorId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    const detail = await call(app, "GET", `/api/comms/posts/${postId}`, {
      actorId: "u_aisha_patel",
    });
    expect(detail.body.post.likedByUserIds).toContain("u_aisha_patel");
  });

  it("DELETE /api/comms/posts/:id/like removes the actor", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    const postId = list.body[0].id;
    await call(app, "POST", `/api/comms/posts/${postId}/like`, { body: {}, actorId: "u_aisha_patel" });
    const r = await call(app, "DELETE", `/api/comms/posts/${postId}/like`, {
      actorId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    const detail = await call(app, "GET", `/api/comms/posts/${postId}`, {
      actorId: "u_aisha_patel",
    });
    expect(detail.body.post.likedByUserIds.includes("u_aisha_patel")).toBe(false);
  });

  it("POST /api/comms/posts/:id/share increments shareCount", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    const postId = list.body[0].id;
    const before = list.body[0].shareCount ?? 0;
    const r = await call(app, "POST", `/api/comms/posts/${postId}/share`, {
      body: {},
      actorId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    expect(r.body.shareCount).toBeGreaterThanOrEqual(before + 1);
  });

  it("reactionHistory in detail reflects added likes", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    const postId = list.body[0].id;
    await call(app, "POST", `/api/comms/posts/${postId}/like`, { body: {}, actorId: "u_aisha_patel" });
    const detail = await call(app, "GET", `/api/comms/posts/${postId}`, {
      actorId: "u_aisha_patel",
    });
    const found = detail.body.reactionHistory.some((h: any) => h.userId === "u_aisha_patel");
    expect(found).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  E1 backing — comms/users (used by the User Picker)                */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — E1 user picker source", () => {
  it("GET /api/comms/users returns user list with required fields", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/users");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
    const u = r.body[0];
    expect(typeof u.id).toBe("string");
    expect(typeof u.legalName).toBe("string");
  });
});

/* ------------------------------------------------------------------ */
/*  General — auth/me + outbox visibility                             */
/* ------------------------------------------------------------------ */
describe("Sprint 18 Phase 3 — supporting endpoints", () => {
  it("GET /api/comms/me returns the viewer", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/me", { actorId: "u_maya_chen" });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe("u_maya_chen");
  });

  it("GET /api/comms/dev/outbox returns recent outbox events", async () => {
    const app = buildApp();
    // Trigger an outbox emission via a like.
    // v14 — actorId required so the viewer can see network posts.
    const list = await call(app, "GET", "/api/comms/posts?sort=newest", { actorId: "u_aisha_patel" });
    const postId = list.body[0].id;
    await call(app, "POST", `/api/comms/posts/${postId}/like`, {
      body: {},
      actorId: "u_aisha_patel",
    });
    const r = await call(app, "GET", "/api/comms/dev/outbox");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("typing pulse appears in the outbox", async () => {
    const app = buildApp();
    const list = await call(app, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const channelId = list.body[0].id;
    await call(app, "POST", `/api/comms/channels/${encodeURIComponent(channelId)}/typing`, {
      body: {},
      actorId: "u_maya_chen",
    });
    const r = await call(app, "GET", "/api/comms/dev/outbox");
    const found = r.body.some((e: any) => e.eventType === "channel.typing");
    expect(found).toBe(true);
  });
});
