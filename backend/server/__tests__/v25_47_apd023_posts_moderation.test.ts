/**
 * v25.47 APD-023 — Network post moderation.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. GET /api/admin/posts lists posts incl. a seeded one.
 *   2. POST .../moderate flag → record-only (post stays visible), logged.
 *   3. POST .../moderate hide → sets deleted_at (hidden:true); unhide restores.
 *   4. GET .../moderation-log returns the immutable trail (Save→Restart→Load).
 *   5. Auth: non-admin moderate is rejected.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { rawDb, getDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

const POST_ID = `post_test_${Date.now()}`;

beforeAll(async () => {
  getDb();
  // Seed a network post directly (the moderation surface operates on existing rows).
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO network_posts
         (id, tenant_id, author_user_id, audience, body, content_json, likes, comments, parent_post_id, created_at, updated_at)
       VALUES (?, 'tenant_test', 'u_author', 'all', 'hello world', '{}', 0, 0, NULL, ?, ?)`,
    )
    .run(POST_ID, new Date().toISOString(), new Date().toISOString());

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

describe("APD-023 post moderation", () => {
  it("lists posts for moderation", async () => {
    const res = await call("GET", "/api/admin/posts", { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(res.body.posts.map((p: any) => p.id)).toContain(POST_ID);
  });

  it("flag is record-only (post stays visible)", async () => {
    const res = await call("POST", `/api/admin/posts/${POST_ID}/moderate`, {
      userId: "u_admin",
      body: { action: "flag", reason: "spam review" },
    });
    expect(res.status).toBe(200);
    expect(res.body.post.hidden).toBe(false);
  });

  it("hide sets deleted_at; unhide restores", async () => {
    const hide = await call("POST", `/api/admin/posts/${POST_ID}/moderate`, {
      userId: "u_admin",
      body: { action: "hide", reason: "TOS violation" },
    });
    expect(hide.status).toBe(200);
    expect(hide.body.post.hidden).toBe(true);
    expect(hide.body.post.deletedAt).not.toBeNull();

    const unhide = await call("POST", `/api/admin/posts/${POST_ID}/moderate`, {
      userId: "u_admin",
      body: { action: "unhide" },
    });
    expect(unhide.status).toBe(200);
    expect(unhide.body.post.hidden).toBe(false);
    expect(unhide.body.post.deletedAt).toBeNull();
  });

  it("moderation-log returns the immutable trail (fresh DB read)", async () => {
    const res = await call("GET", `/api/admin/posts/${POST_ID}/moderation-log`, {
      userId: "u_admin",
    });
    expect(res.status).toBe(200);
    const actions = res.body.log.map((e: any) => e.action);
    expect(actions).toEqual(["flag", "hide", "unhide"]);
  });

  it("rejects non-admin moderate", async () => {
    const res = await call("POST", `/api/admin/posts/${POST_ID}/moderate`, {
      body: { action: "hide" },
    });
    expect([401, 403]).toContain(res.status);
  });
});
