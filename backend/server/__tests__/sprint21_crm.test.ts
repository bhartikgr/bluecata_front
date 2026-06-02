/**
 * Sprint 21 Wave D — Investor CRM endpoint tests.
 *
 * ≥10 supertest-style assertions covering:
 *   1.  GET  /api/investor/crm             — returns array
 *   2.  POST /api/investor/crm             — creates contact
 *   3.  PATCH /api/investor/crm/:id        — updates contact
 *   4.  DELETE /api/investor/crm/:id       — removes contact
 *   5.  POST /api/investor/crm/:id/notes   — appends note
 *   6.  POST /api/investor/crm/:id/tasks   — adds task
 *   7.  POST /api/investor/crm/broadcast mode=dm    — creates DMs
 *   8.  POST /api/investor/crm/broadcast mode=post  — creates one post
 *   9.  POST /api/investor/crm/broadcast without auth → 401
 *  10.  POST /api/investor/crm/broadcast with empty body → 400
 *  11.  PATCH /api/investor/crm/:id/tasks/:taskId — marks task done
 *  12.  GET  /api/investor/crm/contacts           — legacy alias returns { contacts: [] }
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerInvestorCrmRoutes } from "../investorCrmStore";

// ---------------------------------------------------------------------------
// Test server
// ---------------------------------------------------------------------------

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerInvestorCrmRoutes(app);
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
    if (opts.userId) {
      headers["x-user-id"] = opts.userId;
    }

    const req = http.request(
      { method, path, port, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: raw });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sprint 21 Wave D — Investor CRM", () => {
  let contactId: string;
  let taskId: string;

  // 1. GET /api/investor/crm returns array
  it("GET /api/investor/crm returns an array", async () => {
    const { status, body } = await call("GET", "/api/investor/crm");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  // 2. POST /api/investor/crm creates contact
  it("POST /api/investor/crm creates a contact", async () => {
    const { status, body } = await call("POST", "/api/investor/crm", {
      body: {
        name: "Alice Founder",
        role: "CEO",
        email: "alice@example.com",
        affiliation: "AliceCo",
        stage: "met",
        tags: ["fintech"],
      },
      userId: "u_test_investor",
    });
    expect(status).toBe(201);
    expect(body.name).toBe("Alice Founder");
    expect(body.stage).toBe("met");
    expect(body.id).toBeTruthy();
    contactId = body.id;
  });

  // 3. PATCH /api/investor/crm/:id updates contact
  it("PATCH /api/investor/crm/:id updates stage", async () => {
    const { status, body } = await call("PATCH", `/api/investor/crm/${contactId}`, {
      body: { stage: "discussing" },
      userId: "u_test_investor",
    });
    expect(status).toBe(200);
    expect(body.stage).toBe("discussing");
  });

  // 5. POST /api/investor/crm/:id/notes appends note
  it("POST /api/investor/crm/:id/notes appends a note", async () => {
    const { status, body } = await call("POST", `/api/investor/crm/${contactId}/notes`, {
      body: { body: "Great first meeting.", noteType: "meeting" },
      userId: "u_test_investor",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.note.body).toBe("Great first meeting.");
    expect(body.note.noteType).toBe("meeting");
  });

  // 6. POST /api/investor/crm/:id/tasks adds task
  it("POST /api/investor/crm/:id/tasks adds a task", async () => {
    const { status, body } = await call("POST", `/api/investor/crm/${contactId}/tasks`, {
      body: { title: "Follow up on deck", priority: "high" },
      userId: "u_test_investor",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.task.title).toBe("Follow up on deck");
    expect(body.task.priority).toBe("high");
    expect(body.task.status).toBe("todo");
    taskId = body.task.id;
  });

  // 11. PATCH /api/investor/crm/:id/tasks/:taskId — marks task done
  it("PATCH /api/investor/crm/:id/tasks/:taskId marks task done", async () => {
    const { status, body } = await call(
      "PATCH",
      `/api/investor/crm/${contactId}/tasks/${taskId}`,
      { body: { status: "done" }, userId: "u_test_investor" },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.task.status).toBe("done");
    expect(body.task.completedAt).toBeTruthy();
  });

  // 4. DELETE /api/investor/crm/:id removes contact
  // (run near end so other tests can use the contact)
  let secondContactId: string;
  it("DELETE /api/investor/crm/:id removes a contact", async () => {
    // Create a disposable contact first
    const create = await call("POST", "/api/investor/crm", {
      body: { name: "Temp Contact", email: "temp@example.com", affiliation: "TempCo" },
      userId: "u_test_investor",
    });
    secondContactId = create.body.id;
    const { status, body } = await call("DELETE", `/api/investor/crm/${secondContactId}`, {
      userId: "u_test_investor",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(secondContactId);
  });

  // 7. POST /api/investor/crm/broadcast mode=dm
  it("POST /api/investor/crm/broadcast mode=dm returns sent count", async () => {
    const { status, body } = await call("POST", "/api/investor/crm/broadcast", {
      body: { recipientIds: [contactId], body: "Hello from investor!", mode: "dm" },
      userId: "u_test_investor",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("dm");
    expect(typeof body.sent).toBe("number");
  });

  // 8. POST /api/investor/crm/broadcast mode=post
  it("POST /api/investor/crm/broadcast mode=post creates a network post", async () => {
    const { status, body } = await call("POST", "/api/investor/crm/broadcast", {
      body: { recipientIds: [], body: "Network update!", mode: "post" },
      userId: "u_test_investor",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("post");
    expect(body.sent).toBe(1);
  });

  // 9. POST /api/investor/crm/broadcast without auth → 401
  it("POST /api/investor/crm/broadcast without auth returns 401", async () => {
    const { status } = await call("POST", "/api/investor/crm/broadcast", {
      body: { recipientIds: [], body: "Hello", mode: "dm" },
      // no userId header → anonymous
    });
    expect(status).toBe(401);
  });

  // 10. POST /api/investor/crm/broadcast with empty body → 400
  it("POST /api/investor/crm/broadcast with empty body returns 400", async () => {
    const { status } = await call("POST", "/api/investor/crm/broadcast", {
      body: { recipientIds: [], body: "", mode: "dm" },
      userId: "u_test_investor",
    });
    expect(status).toBe(400);
  });

  // 12. Legacy alias GET /api/investor/crm/contacts — returns { contacts: [] }
  it("GET /api/investor/crm/contacts (legacy alias) returns { contacts: Array }", async () => {
    const { status, body } = await call("GET", "/api/investor/crm/contacts");
    expect(status).toBe(200);
    expect(body).toHaveProperty("contacts");
    expect(Array.isArray(body.contacts)).toBe(true);
  });
});
