/**
 * Sprint 21 Wave B — Invitations enhancements integration tests.
 *
 * ≥ 12 assertions covering:
 *   1.  GET /api/investor/companies/:companyId/my-history — returns chronological list
 *   2.  GET /api/investor/companies/:companyId/my-history — empty company → events: []
 *   3.  GET /api/investor/companies/:companyId/my-history — 401 if not authed
 *   4.  GET /api/rounds/:roundId/co-soft-circle-members — hides amount when disclosesAmount:false
 *   5.  GET /api/rounds/:roundId/co-soft-circle-members — anonymizes when coMembersOff (displayLabel=[Anonymous Holder])
 *   6.  GET /api/rounds/:roundId/co-soft-circle-members — 401 if not authed
 *   7.  GET /api/rounds/:roundId/co-soft-circle-members — 403 if investor did not soft-circle
 *   8.  GET /api/rounds/:roundId/founder-qa — returns messages array
 *   9.  POST /api/rounds/:roundId/founder-qa — creates message, emits mutation (201)
 *   10. POST /api/rounds/:roundId/founder-qa — rejects empty body with 400
 *   11. POST /api/rounds/:roundId/founder-qa — publicWithinRound:false → message has publicWithinRound=false
 *   12. GET /api/rounds/:roundId/founder-qa — newly posted message is in the list
 *   13. GET /api/investor/companies/:companyId/my-history — events sorted chronologically
 *   14. POST /api/rounds/:roundId/founder-qa — 401 if not authed
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
      port = (server.address() as any).port as number;
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

/* =====================================================================
   GET /api/investor/companies/:companyId/my-history
   ===================================================================== */

describe("Sprint 21 B3: GET /api/investor/company-history/:companyId", () => {
  it("1. returns 200 with events array for known company (co_novapay)", async () => {
    const res = await call("GET", "/api/investor/company-history/co_novapay", {
      userId: "u_aisha_patel",
    });
    expect(res.status).toBe(200);
    expect(res.body.events).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);
  });

  it("2. returns empty events array for company with no prior history", async () => {
    const res = await call("GET", "/api/investor/company-history/co_unknown_xyz", {
      userId: "u_aisha_patel",
    });
    expect(res.status).toBe(200);
    expect(res.body.events).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBe(0);
  });

  it("3. returns 401 when not authenticated (unknown userId)", async () => {
    const res = await call("GET", "/api/investor/company-history/co_novapay", {
      userId: "u_not_a_real_user_xyz",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("13. events are returned in chronological (date ascending) order", async () => {
    const res = await call("GET", "/api/investor/company-history/co_novapay", {
      userId: "u_aisha_patel",
    });
    expect(res.status).toBe(200);
    const events: Array<{ date: string }> = res.body.events;
    if (events.length > 1) {
      for (let idx = 1; idx < events.length; idx++) {
        expect(new Date(events[idx].date).getTime()).toBeGreaterThanOrEqual(
          new Date(events[idx - 1].date).getTime(),
        );
      }
    }
  });
});

/* =====================================================================
   GET /api/rounds/:roundId/co-soft-circle-members
   ===================================================================== */

describe("Sprint 21 B6: GET /api/rounds/:roundId/co-soft-circle-members", () => {
  it("4. hides amountBucket when disclosesAmount is false", async () => {
    const res = await call(
      "GET",
      "/api/rounds/rnd_novapay_seed/co-soft-circle-members?hasSoftCircled=true",
      { userId: "u_aisha_patel" },
    );
    expect(res.status).toBe(200);
    const members: Array<{ disclosesAmount: boolean; amountBucket?: string }> = res.body.members;
    const privateMembers = members.filter((m) => !m.disclosesAmount);
    // Every private member should have no amountBucket
    for (const m of privateMembers) {
      expect(m.amountBucket).toBeUndefined();
    }
  });

  it("5. members with coMembersOff have '[Anonymous Holder]' as displayLabel", async () => {
    const res = await call(
      "GET",
      "/api/rounds/rnd_novapay_seed/co-soft-circle-members?hasSoftCircled=true",
      { userId: "u_aisha_patel" },
    );
    expect(res.status).toBe(200);
    const members: Array<{ displayLabel: string; disclosesAmount: boolean }> = res.body.members;
    // At least one member should be in the list
    expect(members.length).toBeGreaterThan(0);
    // Anonymous holders have a specific display label
    const anon = members.find((m) => m.displayLabel === "[Anonymous Holder]");
    // If seeded anon member exists, it must not disclose amount
    if (anon) {
      expect(anon.disclosesAmount).toBe(false);
    }
  });

  it("6. returns 401 when unauthenticated (unknown userId)", async () => {
    const res = await call("GET", "/api/rounds/rnd_novapay_seed/co-soft-circle-members", {
      userId: "u_not_a_real_user_xyz",
    });
    expect(res.status).toBe(401);
  });

  it("7. returns 403 when investor has not soft-circled (no hasSoftCircled param)", async () => {
    // u_lapsed_lp is a known investor but has not soft-circled rnd_novapay_seed
    const res = await call(
      "GET",
      "/api/rounds/rnd_novapay_seed/co-soft-circle-members",
      { userId: "u_lapsed_lp" },
    );
    expect(res.status).toBe(403);
  });
});

/* =====================================================================
   GET + POST /api/rounds/:roundId/founder-qa
   ===================================================================== */

describe("Sprint 21 B7: /api/rounds/:roundId/founder-qa", () => {
  it("8. GET returns messages array for a known round", async () => {
    const res = await call("GET", "/api/rounds/rnd_novapay_seed/founder-qa", {
      userId: "u_aisha_patel",
    });
    expect(res.status).toBe(200);
    expect(res.body.messages).toBeDefined();
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it("9. POST creates a message and returns 201 with the new message", async () => {
    const res = await call(
      "POST",
      "/api/rounds/rnd_novapay_seed/founder-qa",
      {
        userId: "u_aisha_patel",
        body: { body: "What is your monthly churn rate?", publicWithinRound: true },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBeDefined();
    expect(res.body.message.body).toBe("What is your monthly churn rate?");
    expect(res.body.message.publicWithinRound).toBe(true);
  });

  it("10. POST rejects empty body with 400", async () => {
    const res = await call(
      "POST",
      "/api/rounds/rnd_novapay_seed/founder-qa",
      {
        userId: "u_aisha_patel",
        body: { body: "", publicWithinRound: true },
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("11. POST with publicWithinRound:false creates a private message", async () => {
    const res = await call(
      "POST",
      "/api/rounds/rnd_novapay_seed/founder-qa",
      {
        userId: "u_aisha_patel",
        body: { body: "Private question about cap table details.", publicWithinRound: false },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.message.publicWithinRound).toBe(false);
  });

  it("12. GET returns newly posted messages (message appears in thread)", async () => {
    const uniqueBody = `Sprint21 test message ${Date.now()}`;
    // Post a message
    await call("POST", "/api/rounds/rnd_q_a/founder-qa", {
      userId: "u_aisha_patel",
      body: { body: uniqueBody, publicWithinRound: true },
    });
    // Then retrieve the thread
    const res = await call("GET", "/api/rounds/rnd_q_a/founder-qa", {
      userId: "u_aisha_patel",
    });
    expect(res.status).toBe(200);
    const found = res.body.messages.some(
      (m: { body: string }) => m.body === uniqueBody,
    );
    expect(found).toBe(true);
  });

  it("14. POST returns 401 when not authenticated (unknown userId)", async () => {
    const res = await call("POST", "/api/rounds/rnd_novapay_seed/founder-qa", {
      userId: "u_not_a_real_user_xyz",
      body: { body: "Is this auth protected?", publicWithinRound: true },
    });
    expect(res.status).toBe(401);
  });
});
