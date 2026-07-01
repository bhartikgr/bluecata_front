/**
 * v25.47 BLOCKER-2/3 (APD-026/027) — New rounds go live immediately so the
 * Collective apply-gate (hasActiveOrLiveRound) passes without manual activation.
 *
 * Creation hits the REAL POST /api/rounds route; the apply-gate is asserted via
 * the exported DB-direct predicate the founderCollectiveApplyStore consumes.
 *
 *   1. A round created with no explicit state defaults to "active".
 *   2. hasActiveOrLiveRound(companyId) is true immediately after creation.
 *   3. An explicit state override (draft) is honored and does NOT trip the gate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { hasActiveOrLiveRound } from "../roundsStore";

let app: Express;
let server: http.Server;
let port: number;

const ACTIVE_CO = `co_active_${Date.now()}`;
const DRAFT_CO = `co_draft_${Date.now()}`;

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    if (payload) headers["content-length"] = String(Buffer.byteLength(payload));
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
    if (payload) r.write(payload);
    r.end();
  });
}

beforeAll(async () => {
  getDb();
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

describe("BLOCKER-2/3 new rounds active immediately", () => {
  it("defaults a new round to active", async () => {
    const res = await call("POST", "/api/rounds", {
      userId: "u_admin",
      body: { companyId: ACTIVE_CO, name: "Seed", type: "seed", targetAmount: 1000000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state).toBe("active");
  });

  it("passes the apply-gate immediately after creation", () => {
    expect(hasActiveOrLiveRound(ACTIVE_CO)).toBe(true);
  });

  it("honors an explicit draft override (gate stays closed)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId: "u_admin",
      body: { companyId: DRAFT_CO, name: "Quiet", type: "seed", state: "draft", targetAmount: 500000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("draft");
    expect(hasActiveOrLiveRound(DRAFT_CO)).toBe(false);
  });
});
