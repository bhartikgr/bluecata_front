/**
 * v25.47 APD-024 — Network post attachments.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. POST /api/posts/:id/attachments with an allowed MIME (image/png) stores
 *      it and returns the descriptor; GET reflects it (Save→Restart→Load via a
 *      fresh DB read).
 *   2. A disallowed MIME (text/plain) is rejected 400 unsupported_mime.
 *   3. Posting to a non-existent post → 404 post_not_found.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { rawDb, getDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

const POST_ID = `post_attach_${Date.now()}`;
const PNG = Buffer.from("89504e470d0a1a0a", "hex"); // PNG signature bytes

beforeAll(async () => {
  getDb();
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO network_posts
         (id, tenant_id, author_user_id, audience, body, content_json, likes, comments, parent_post_id, created_at, updated_at)
       VALUES (?, 'tenant_test', 'u_author', 'all', 'attach me', '{}', 0, 0, NULL, ?, ?)`,
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

/** Build a minimal multipart/form-data body with one file part. */
function multipart(field: string, filename: string, mime: string, content: Buffer): {
  body: Buffer;
  contentType: string;
} {
  const boundary = "----capvtest" + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function call(
  method: string,
  apiPath: string,
  opts: { raw?: Buffer; contentType?: string; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.raw) {
      headers["content-type"] = opts.contentType!;
      headers["content-length"] = String(opts.raw.length);
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
    if (opts.raw) r.write(opts.raw);
    r.end();
  });
}

describe("APD-024 post attachments", () => {
  it("accepts an allowed MIME and persists the descriptor", async () => {
    const mp = multipart("file", "pic.png", "image/png", PNG);
    const res = await call("POST", `/api/posts/${POST_ID}/attachments`, {
      raw: mp.body,
      contentType: mp.contentType,
      userId: "u_admin",
    });
    expect(res.status).toBe(201);
    expect(res.body.attachment.mime).toBe("image/png");
    expect(res.body.attachment.name).toBe("pic.png");

    const list = await call("GET", `/api/posts/${POST_ID}/attachments`, { userId: "u_admin" });
    expect(list.status).toBe(200);
    expect(list.body.attachments).toHaveLength(1);
    expect(list.body.attachments[0].mime).toBe("image/png");
  });

  it("rejects a disallowed MIME", async () => {
    const mp = multipart("file", "note.txt", "text/plain", Buffer.from("hi"));
    const res = await call("POST", `/api/posts/${POST_ID}/attachments`, {
      raw: mp.body,
      contentType: mp.contentType,
      userId: "u_admin",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_mime");
  });

  it("404s on a non-existent post", async () => {
    const mp = multipart("file", "pic.png", "image/png", PNG);
    const res = await call("POST", `/api/posts/does_not_exist/attachments`, {
      raw: mp.body,
      contentType: mp.contentType,
      userId: "u_admin",
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("post_not_found");
  });
});
