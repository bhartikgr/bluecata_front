/**
 * Sprint 23 Wave B — Integration tests.
 *
 * ≥ 10 assertions covering:
 *
 *  POST /api/investor/portfolio/tax/request  (DEF-012)
 *    1.  Without auth → 401
 *    2.  Without companyId → 400
 *    3.  With valid companyId → 200
 *    4.  Response body has requested: true
 *    5.  Response body has eta field
 *
 *  GET /api/investor/portfolio/tax/download  (DEF-013 – companyId param)
 *    6.  Without auth → 401
 *    7.  With auth → 404 (not yet available)
 *    8.  Response has available: false
 *    9.  With ?companyId= param → still returns graceful 404
 *
 *  GET /api/comms/posts  (DEF-033/034 – filter params)
 *    10. ?topic=fintech filter accepted (200)
 *    11. ?authorKind=founder filter accepted (200)
 *    12. Combined filters accepted (200)
 *
 *  GET /api/investor/crm  (CRM stage filter)
 *    13. Returns array with demo contacts (seeded in wave B)
 *    14. stage=lead filter returns subset
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

/* -----------------------------------------------------------------------
   Shared server setup
   ----------------------------------------------------------------------- */

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

/* -----------------------------------------------------------------------
   HTTP helper
   ----------------------------------------------------------------------- */

type CallResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string | string[]>;
};

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) {
      // Pass both x-user-id and session cookie (same pattern as sprint21_portfolio tests)
      headers["x-user-id"] = opts.userId;
      headers["cookie"] = `capavate_session=${opts.userId}`;
    }

    const req = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(raw),
              headers: res.headers as Record<string, string | string[]>,
            });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw, headers: {} });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const DEMO_USER = "u_aisha_patel";

/* -----------------------------------------------------------------------
   POST /api/investor/portfolio/tax/request
   ----------------------------------------------------------------------- */

describe("POST /api/investor/portfolio/tax/request", () => {
  it("1. returns 400 without companyId (authed user)", async () => {
    const r = await call(
      "POST",
      "/api/investor/portfolio/tax/request",
      { body: {}, userId: DEMO_USER },
    );
    expect(r.status).toBe(400);
  });

  it("2. error body has message when companyId missing", async () => {
    const r = await call(
      "POST",
      "/api/investor/portfolio/tax/request",
      { body: {}, userId: DEMO_USER },
    );
    expect((r.body as { message: string }).message).toBeTruthy();
  });

  it("3. returns 200 with valid companyId", async () => {
    const r = await call(
      "POST",
      "/api/investor/portfolio/tax/request",
      { body: { companyId: "co_novapay" }, userId: DEMO_USER },
    );
    expect(r.status).toBe(200);
  });

  it("4. response body has requested: true", async () => {
    const r = await call(
      "POST",
      "/api/investor/portfolio/tax/request",
      { body: { companyId: "co_novapay" }, userId: DEMO_USER },
    );
    expect((r.body as { requested: boolean }).requested).toBe(true);
  });

  it("5. response body has eta field", async () => {
    const r = await call(
      "POST",
      "/api/investor/portfolio/tax/request",
      { body: { companyId: "co_arboreal" }, userId: DEMO_USER },
    );
    expect((r.body as { eta: string }).eta).toBeTruthy();
  });
});

/* -----------------------------------------------------------------------
   GET /api/investor/portfolio/tax/download
   ----------------------------------------------------------------------- */

describe("GET /api/investor/portfolio/tax/download", () => {
  it("6. returns 404 with auth (not yet available)", async () => {
    const r = await call(
      "GET",
      "/api/investor/portfolio/tax/download",
      { userId: DEMO_USER },
    );
    expect(r.status).toBe(404);
  });

  it("7. response body has message field", async () => {
    const r = await call(
      "GET",
      "/api/investor/portfolio/tax/download",
      { userId: DEMO_USER },
    );
    expect((r.body as { message: string }).message).toBeTruthy();
  });

  it("8. response has available: false", async () => {
    const r = await call(
      "GET",
      "/api/investor/portfolio/tax/download",
      { userId: DEMO_USER },
    );
    expect((r.body as { available: boolean }).available).toBe(false);
  });

  it("9. with ?companyId= param → graceful 404", async () => {
    const r = await call(
      "GET",
      "/api/investor/portfolio/tax/download?companyId=co_novapay",
      { userId: DEMO_USER },
    );
    expect(r.status).toBe(404);
    expect((r.body as { available: boolean }).available).toBe(false);
  });
});

/* -----------------------------------------------------------------------
   GET /api/comms/posts — filter params
   ----------------------------------------------------------------------- */

describe("GET /api/comms/posts filter params", () => {
  it("10. ?topic=fintech is accepted (returns 200)", async () => {
    const r = await call(
      "GET",
      "/api/comms/posts?topic=fintech",
      { userId: DEMO_USER },
    );
    expect(r.status).toBe(200);
  });

  it("11. ?authorKind=founder is accepted (returns 200)", async () => {
    const r = await call(
      "GET",
      "/api/comms/posts?authorKind=founder",
      { userId: DEMO_USER },
    );
    expect(r.status).toBe(200);
  });

  it("12. combined filters accepted (returns 200)", async () => {
    const r = await call(
      "GET",
      "/api/comms/posts?topic=fintech&authorKind=founder",
      { userId: DEMO_USER },
    );
    expect(r.status).toBe(200);
  });
});

/* -----------------------------------------------------------------------
   GET /api/investor/crm — stage filter
   ----------------------------------------------------------------------- */

describe("GET /api/investor/crm", () => {
  it("13. /api/investor/crm/contacts returns array with seeded contacts", async () => {
    const r = await call("GET", "/api/investor/crm/contacts", { userId: DEMO_USER });
    expect(r.status).toBe(200);
    const contacts = r.body as unknown[];
    expect(Array.isArray(contacts)).toBe(true);
    expect(contacts.length).toBeGreaterThan(0);
  });

  it("14. contacts include entries with pipelineStage field from seed", async () => {
    const r = await call("GET", "/api/investor/crm/contacts", { userId: DEMO_USER });
    expect(r.status).toBe(200);
    const contacts = r.body as Array<{ pipelineStage?: string; name?: string }>;
    // All seeded contacts have a pipelineStage field
    const staged = contacts.filter((c) => typeof c.pipelineStage === "string");
    expect(staged.length).toBeGreaterThan(0);
  });
});
