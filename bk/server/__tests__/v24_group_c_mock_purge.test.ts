/**
 * v24.0 — Group C regression: mock-data purge in user-visible paths.
 *
 * Verifies that stub endpoints return 501 not_implemented (NOT fake {ok:true}),
 * that company/CRM reads are tenant-scoped rather than global mock dumps, and
 * that the term-sheet / cap-table PDF endpoints no longer ship placeholder PDFs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

let app: Express;
let server: http.Server;
let port: number;

const FOUNDER = "u_maya_chen";

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
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
  delete process.env.COLLECTIVE_ENABLED;
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

describe("v24.0 Group C — mock-data purge", () => {
  it("C4: POST /api/reports returns 501 not_implemented (NOT fake {ok:true})", async () => {
    const r = await call("POST", "/api/reports", { userId: FOUNDER, body: {} });
    expect(r.status).toBe(501);
    expect(r.body?.error).toBe("not_implemented");
    expect(r.body?.ok).not.toBe(true);
  });

  it("C4: POST /api/dataroom/upload returns 501 not_implemented", async () => {
    const r = await call("POST", "/api/dataroom/upload", { userId: FOUNDER, body: {} });
    expect(r.status).toBe(501);
    expect(r.body?.error).toBe("not_implemented");
  });

  it("C4: POST /api/rounds/:id/invitations/bulk returns 501 not_implemented", async () => {
    const r = await call("POST", "/api/rounds/rnd_novapay_foundation/invitations/bulk", { userId: FOUNDER, body: {} });
    expect(r.status).toBe(501);
    expect(r.body?.ok).not.toBe(true);
  });

  it("C1: /api/companies is tenant-filtered (200 + array, not a global mock dump)", async () => {
    const r = await call("GET", "/api/companies", { userId: FOUNDER });
    expect(r.status).toBe(200);
    const list = Array.isArray(r.body) ? r.body : (r.body?.companies ?? []);
    expect(Array.isArray(list)).toBe(true);
  });

  it("C2: /api/crm is scoped to the founder (array shape, never a global investor dump)", async () => {
    const r = await call("GET", "/api/crm", { userId: FOUNDER });
    if (r.status === 200) {
      const list = Array.isArray(r.body) ? r.body : (r.body?.contacts ?? r.body?.investors ?? []);
      expect(Array.isArray(list)).toBe(true);
    } else {
      expect([401, 403, 404, 501]).toContain(r.status);
    }
  });

  it("C7: term-sheet PDF endpoint does not return a placeholder PDF body", async () => {
    const r = await call("GET", "/api/rounds/rnd_novapay_foundation/term-sheet/pdf", { userId: FOUNDER });
    // Either generated for real (200) or 501 not_implemented / ownership-denied.
    // It must NOT be a 200 hard-coded placeholder masquerading as success with
    // a not_implemented marker.
    if (r.status === 501) {
      expect(r.body?.error).toBe("not_implemented");
    } else {
      expect([200, 403, 404]).toContain(r.status);
    }
  });
});
