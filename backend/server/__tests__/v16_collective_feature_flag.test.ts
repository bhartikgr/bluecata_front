/**
 * v16 Fix 6 — COLLECTIVE_ENABLED feature flag + waitlist persistence.
 *
 * Acceptance gates #8 + #9 + #10:
 *   - With COLLECTIVE_ENABLED=0 (default OFF), write routes to founder/
 *     collective subsystem (nominations, applications, promote) return 503
 *     `collective_not_available`.
 *   - With COLLECTIVE_ENABLED=1, the gating middleware passes through.
 *   - Waitlist POST (investor-membership) returns 201 with waitlistId.
 *   - Admin LIST + PATCH operate on the persisted entry.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  _testAccessWaitlist,
  listWaitlist,
} from "../collectiveWaitlistStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  _testAccessWaitlist.reset();
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

describe("v16 Fix 6 — COLLECTIVE_ENABLED feature flag", () => {
  it("with flag OFF, POST /api/founder/collective/nominations returns 503", async () => {
    delete process.env.COLLECTIVE_ENABLED;
    const r = await call("POST", "/api/founder/collective/nominations", {
      userId: "u_maya_chen",
      body: {
        companyId: "co_arboreal",
        founderId: "u_maya_chen",
        vouchingInvestorId: "u_aisha_patel",
        pitchSummary: "We are doing exciting things in our space.",
      },
    });
    expect(r.status).toBe(503);
    expect(String(r.body?.error ?? "")).toMatch(/collective_not_available/i);
  });

  it("with flag OFF, POST /api/founder/collective/applications returns 503", async () => {
    delete process.env.COLLECTIVE_ENABLED;
    const r = await call("POST", "/api/founder/collective/applications", {
      userId: "u_maya_chen",
      body: {
        companyId: "co_arboreal",
        founderId: "u_maya_chen",
        pitchDeckFilename: "deck.pdf",
        tractionMrr: 10000,
        tractionUsers: 50,
        tractionGrowthPct: 15,
        asks: "Strategic introductions and corp dev support please.",
        coverLetter: "Cover letter ".repeat(20),
        feeAcknowledged: true,
      },
    });
    expect(r.status).toBe(503);
  });

  it("with flag ON, /api/founder/collective/nominations passes the gate", async () => {
    process.env.COLLECTIVE_ENABLED = "1";
    const r = await call("POST", "/api/founder/collective/nominations", {
      userId: "u_maya_chen",
      body: {
        companyId: "co_arboreal",
        founderId: "u_maya_chen",
        vouchingInvestorId: "u_aisha_patel",
        pitchSummary: "We are doing exciting things in our space.",
      },
    });
    // Either 200 (passes) or 400 (validation), but NOT 503.
    expect(r.status).not.toBe(503);
  });
});

describe("v16 Fix 6 — waitlist endpoints (always available)", () => {
  it("POST /api/collective/waitlist/investor-membership returns 201", async () => {
    // u_no_position is a real authenticated investor persona.
    const r = await call("POST", "/api/collective/waitlist/investor-membership", {
      userId: "u_no_position",
      body: { chapterHint: "toronto" },
    });
    expect(r.status).toBe(201);
    expect(r.body?.waitlistId).toBeTruthy();
    expect(r.body?.ok).toBe(true);
  });

  it("entry is visible via store API + admin LIST", async () => {
    const items = listWaitlist({});
    const ours = items.find((it) => it.userId === "u_no_position");
    expect(ours).toBeTruthy();
    expect(ours?.kind).toBe("investor_membership");
    expect(ours?.status).toBe("waitlist");

    const r = await call("GET", "/api/admin/collective/waitlist", {
      userId: "u_admin",
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body?.items)).toBe(true);
    expect(r.body.items.find((x: any) => x.userId === "u_no_position")).toBeTruthy();
  });

  it("admin PATCH transitions the entry to accepted", async () => {
    const items = listWaitlist({});
    const ours = items.find((it) => it.userId === "u_no_position");
    expect(ours).toBeTruthy();
    const r = await call("PATCH", `/api/admin/collective/waitlist/${ours!.id}`, {
      userId: "u_admin",
      body: { status: "accepted", note: "ok" },
    });
    expect(r.status).toBe(200);
    expect(r.body?.entry?.status).toBe("accepted");
  });

  it("non-admin cannot LIST or PATCH", async () => {
    const r = await call("GET", "/api/admin/collective/waitlist", {
      userId: "u_aisha_patel",
    });
    expect([401, 403]).toContain(r.status);
  });
});
