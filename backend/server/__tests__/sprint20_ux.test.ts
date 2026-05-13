/**
 * Sprint 20 Wave 2 — Investor UX endpoint tests.
 *
 * Covers all new endpoints introduced in Wave 2 (defects O & P):
 *
 *  Investor CRM (investorCrmStore):
 *   - GET  /api/investor/crm/contacts          (list)
 *   - POST /api/investor/crm/contacts          (create)
 *   - PATCH /api/investor/crm/contacts/:id     (update)
 *   - DELETE /api/investor/crm/contacts/:id    (delete)
 *
 *  Collective network (collectiveNetworkStore):
 *   - GET /api/collective/network              (deals + eligibility)
 *   - GET /api/investor/companies/:id/co-members
 *
 *  Portfolio stubs (sprint20Wave2Routes):
 *   - GET /api/investor/portfolio/:id/marks
 *   - GET /api/investor/portfolio/tax
 *
 *  KYC upload:
 *   - POST /api/collective/kyc-upload          (multipart)
 *
 *  Comms:
 *   - POST /api/comms/dm/start
 *   - POST /api/comms/posts/:id/mute-author
 *   - POST /api/comms/posts/:id/report
 *
 * 14 test cases — must not regress existing tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerSprint20Wave2Routes } from "../sprint20Wave2Routes";

// ---------------------------------------------------------------------------
// Shared HTTP server (single server for all tests — avoid port churn)
// ---------------------------------------------------------------------------

let app: Express;
let server: http.Server;
let port: number;

beforeAll(
  async () => {
    app = express();
    app.use(express.json());
    // multer handles its own content-type for multipart; no extra middleware needed
    registerSprint20Wave2Routes(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    port = (server.address() as any).port as number;
  },
);

afterAll(
  async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  },
);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function call(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    userId?: string;
    contentType?: string;
  } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = opts.contentType ?? "application/json";
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
// Investor CRM CRUD
// ---------------------------------------------------------------------------

describe("Investor CRM — contact CRUD", () => {
  it("GET /api/investor/crm/contacts returns a contacts array", async () => {
    const { status, body } = await call("GET", "/api/investor/crm/contacts");
    expect(status).toBe(200);
    expect(body).toHaveProperty("contacts");
    expect(Array.isArray(body.contacts)).toBe(true);
  });

  it("POST /api/investor/crm/contacts creates a contact and returns 201", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/crm/contacts",
      {
        userId: "u_test_investor",
        body: {
          companyName: "TestCo",
          founderName: "Alice Founder",
          founderEmail: "alice@testco.io",
          stage: "watching",
          sector: "SaaS",
          region: "CA",
          checkSizeUsd: 50_000,
        },
      },
    );
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.contact.companyName).toBe("TestCo");
    expect(body.contact.id).toMatch(/^icrm_/);
  });

  it("PATCH /api/investor/crm/contacts/:id updates stage", async () => {
    // Create first
    const create = await call("POST", "/api/investor/crm/contacts", {
      userId: "u_test_investor",
      body: { companyName: "PatchCo", stage: "prospect" },
    });
    const contactId: string = create.body.contact.id;

    const { status, body } = await call(
      "PATCH",
      `/api/investor/crm/contacts/${contactId}`,
      { body: { stage: "due_diligence" } },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.contact.stage).toBe("due_diligence");
  });

  it("PATCH /api/investor/crm/contacts/:id returns 404 for unknown id", async () => {
    const { status, body } = await call(
      "PATCH",
      "/api/investor/crm/contacts/icrm_does_not_exist",
      { body: { stage: "passed" } },
    );
    expect(status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it("DELETE /api/investor/crm/contacts/:id removes the contact", async () => {
    // Create first
    const create = await call("POST", "/api/investor/crm/contacts", {
      userId: "u_test_investor",
      body: { companyName: "DeleteCo", stage: "prospect" },
    });
    const contactId: string = create.body.contact.id;

    const { status, body } = await call("DELETE", `/api/investor/crm/contacts/${contactId}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(contactId);

    // Confirm it's gone — PATCH should 404 now
    const { status: s2 } = await call(
      "PATCH",
      `/api/investor/crm/contacts/${contactId}`,
      { body: { stage: "passed" } },
    );
    expect(s2).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Collective network
// ---------------------------------------------------------------------------

describe("Collective network", () => {
  it("GET /api/collective/network returns activeDeals and eligibilityChecks", async () => {
    const { status, body } = await call("GET", "/api/collective/network");
    expect(status).toBe(200);
    expect(Array.isArray(body.activeDeals)).toBe(true);
    expect(Array.isArray(body.eligibilityChecks)).toBe(true);
    expect(body.activeDeals.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/investor/companies/:id/co-members returns an array", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_novapay/co-members",
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Portfolio stubs
// ---------------------------------------------------------------------------

describe("Portfolio stubs", () => {
  it("GET /api/investor/portfolio/tax returns available=false with message", async () => {
    const { status, body } = await call("GET", "/api/investor/portfolio/tax");
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(typeof body.message).toBe("string");
    expect(body.message).toMatch(/2027/);
  });

  it("GET /api/investor/portfolio/:id/marks returns holdingId and empty marks array", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/portfolio/hold_abc123/marks",
    );
    expect(status).toBe(200);
    expect(body.holdingId).toBe("hold_abc123");
    expect(Array.isArray(body.marks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// KYC upload
// ---------------------------------------------------------------------------

describe("KYC upload", () => {
  it("POST /api/collective/kyc-upload with no file returns 400", async () => {
    // Send a regular JSON body — multer should not find a file
    const { status, body } = await call("POST", "/api/collective/kyc-upload", {
      body: {},
    });
    // multer won't parse JSON body as a file upload — returns 400
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DM start
// ---------------------------------------------------------------------------

describe("DM start", () => {
  it("POST /api/comms/dm/start returns a channelId", async () => {
    const { status, body } = await call("POST", "/api/comms/dm/start", {
      userId: "u_investor_a",
      body: { targetUserId: "u_founder_b" },
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.channelId).toBe("string");
    expect(body.channelId).toMatch(/^ch_dm_/);
  });

  it("POST /api/comms/dm/start is idempotent for the same pair", async () => {
    const first = await call("POST", "/api/comms/dm/start", {
      userId: "u_investor_a",
      body: { targetUserId: "u_founder_b" },
    });
    const second = await call("POST", "/api/comms/dm/start", {
      userId: "u_investor_a",
      body: { targetUserId: "u_founder_b" },
    });
    expect(first.body.channelId).toBe(second.body.channelId);
  });

  it("POST /api/comms/dm/start with missing targetUserId returns 400", async () => {
    const { status, body } = await call("POST", "/api/comms/dm/start", {
      userId: "u_investor_a",
      body: {},
    });
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Mute author
// ---------------------------------------------------------------------------

describe("Mute author", () => {
  it("POST /api/comms/posts/:id/mute-author returns ok with mutedAuthorId", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/posts/post_xyz/mute-author",
      {
        userId: "u_investor_a",
        body: { authorId: "u_founder_spammy" },
      },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mutedAuthorId).toBe("u_founder_spammy");
  });

  it("POST /api/comms/posts/:id/mute-author with no authorId returns 400", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/posts/post_xyz/mute-author",
      { body: {} },
    );
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Report post
// ---------------------------------------------------------------------------

describe("Report post", () => {
  it("POST /api/comms/posts/:id/report returns ok with under_review status", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/posts/post_abc/report",
      {
        userId: "u_investor_b",
        body: { reason: "spam" },
      },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.postId).toBe("post_abc");
    expect(body.status).toBe("under_review");
  });

  it("POST /api/comms/posts/:id/report accepts empty body (defaults reason)", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/posts/post_xyz/report",
      { body: {} },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
