/**
 * Sprint 21 Wave A — Server endpoint tests for Investor Dashboard restructure.
 *
 * Tests:
 *  1.  GET  /api/investor/companies/:companyId/co-members returns array (co_novapay)
 *  2.  GET  /api/investor/companies/:companyId/co-members returns array (co_helia)
 *  3.  GET  /api/investor/companies/:companyId/co-members returns array (co_tideline)
 *  4.  Co-members endpoint: privacy — anonymous members have [Anonymous Holder] label
 *  5.  Co-members endpoint: 401 without x-user-id header
 *  6.  Co-members endpoint: unknown company returns empty array (not 404)
 *  7.  POST /api/investor/dashboard/ma-discuss with mode="message" returns 201
 *  8.  POST /api/investor/dashboard/ma-discuss with mode="message" includes recipientCount
 *  9.  POST /api/investor/dashboard/ma-discuss with mode="post" returns cap_table visibility
 *  10. POST /api/investor/dashboard/ma-discuss: 400 with missing companyId
 *  11. POST /api/investor/dashboard/ma-discuss: 400 with missing body
 *  12. POST /api/investor/dashboard/ma-discuss: 400 with invalid mode
 *  13. POST /api/investor/dashboard/ma-discuss: 401 without auth header
 *  14. Co-members of co_novapay has at least 4 members
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerSprint21Routes } from "../sprint21Routes";

// ---------------------------------------------------------------------------
// Shared server setup
// ---------------------------------------------------------------------------

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
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

// ---------------------------------------------------------------------------
// Tests: GET /api/investor/companies/:companyId/co-members
// ---------------------------------------------------------------------------

describe("GET /api/investor/companies/:companyId/co-members", () => {
  it("returns an array for co_novapay", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_novapay/co-members",
      { userId: "u_aisha_patel" },
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns an array for co_helia", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_helia/co-members",
      { userId: "u_aisha_patel" },
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns an array for co_tideline", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_tideline/co-members",
      { userId: "u_aisha_patel" },
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(4);
  });

  it("co_novapay has at least 4 co-members", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_novapay/co-members",
      { userId: "u_aisha_patel" },
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(4);
  });

  it("anonymises members with screenNameOnly: true to [Anonymous Holder]", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_novapay/co-members",
      { userId: "u_aisha_patel" },
    );
    expect(status).toBe(200);
    // At least one member should be anonymous (see seed data)
    const anonymised = body.filter((m: any) => m.displayLabel === "[Anonymous Holder]");
    expect(anonymised.length).toBeGreaterThanOrEqual(1);
    // Anonymous members must not have allowDM: true
    for (const m of anonymised) {
      expect(m.allowDM).toBe(false);
    }
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_novapay/co-members",
    );
    expect(status).toBe(401);
    expect(body).toHaveProperty("message");
  });

  it("returns empty array for an unknown company (not 404)", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_does_not_exist/co-members",
      { userId: "u_aisha_patel" },
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/investor/dashboard/ma-discuss
// ---------------------------------------------------------------------------

describe("POST /api/investor/dashboard/ma-discuss", () => {
  it("mode=message returns 201 with ok:true", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/dashboard/ma-discuss",
      {
        userId: "u_aisha_patel",
        body: {
          companyId: "co_novapay",
          body: "Discussing M&A signal on NovaPay — top buyer Stripe, M&A score 72/100.",
          recipientIds: ["m_novapay_1", "m_novapay_3"],
          mode: "message",
        },
      },
    );
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("message");
  });

  it("mode=message returns recipientCount matching recipientIds length", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/dashboard/ma-discuss",
      {
        userId: "u_aisha_patel",
        body: {
          companyId: "co_helia",
          body: "Discussing M&A for Helia AI.",
          recipientIds: ["m_helia_1", "m_helia_2"],
          mode: "message",
        },
      },
    );
    expect(status).toBe(201);
    expect(body.recipientCount).toBe(2);
  });

  it("mode=post returns 201 with visibility cap_table", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/dashboard/ma-discuss",
      {
        userId: "u_aisha_patel",
        body: {
          companyId: "co_novapay",
          body: "Posting M&A discussion to cap-table channel.",
          recipientIds: [],
          mode: "post",
        },
      },
    );
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("post");
    expect(body.visibility).toBe("cap_table");
  });

  it("returns 400 when companyId is missing", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/dashboard/ma-discuss",
      {
        userId: "u_aisha_patel",
        body: {
          body: "Some discussion body",
          recipientIds: [],
          mode: "message",
        },
      },
    );
    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  it("returns 400 when body is missing", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/dashboard/ma-discuss",
      {
        userId: "u_aisha_patel",
        body: {
          companyId: "co_novapay",
          recipientIds: [],
          mode: "message",
        },
      },
    );
    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  it("returns 400 when mode is invalid", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/dashboard/ma-discuss",
      {
        userId: "u_aisha_patel",
        body: {
          companyId: "co_novapay",
          body: "Some body",
          recipientIds: [],
          mode: "invalid_mode",
        },
      },
    );
    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/dashboard/ma-discuss",
      {
        body: {
          companyId: "co_novapay",
          body: "Some body",
          recipientIds: [],
          mode: "message",
        },
      },
    );
    expect(status).toBe(401);
    expect(body).toHaveProperty("message");
  });
});
