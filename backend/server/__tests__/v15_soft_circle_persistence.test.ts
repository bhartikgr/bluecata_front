/**
 * v15 P0-9 — soft-circle persistence + Collective wiring.
 *
 *   - createSoftCircle() persists a row in the in-memory mirror.
 *   - validateSoftCircle() transitions intent → confirmed.
 *   - listForCollective() returns rows the founder marked collectiveVisible.
 *   - HTTP POST /api/rounds/:id/soft-circle creates a row (requires auth).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  createSoftCircle,
  validateSoftCircle,
  listForCollective,
  _testAccessSoftCircles,
} from "../softCircleStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  _testAccessSoftCircles.reset();
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

describe("v15 P0-9: soft-circle persistence + Collective projection", () => {
  it("createSoftCircle persists a row", () => {
    _testAccessSoftCircles.reset();
    const sc = createSoftCircle({
      roundId: "rnd_persistence_a",
      companyId: "co_persistence_a",
      investorName: "Persistent Pat",
      amount: 25_000,
      currency: "USD",
    });
    expect(sc.id).toMatch(/^sc_/);
    expect(sc.status).toBe("intent");
    expect(sc.amountMinor).toBe(2_500_000);
    expect(_testAccessSoftCircles.rows.length).toBe(1);
  });

  it("validateSoftCircle transitions intent → confirmed", () => {
    _testAccessSoftCircles.reset();
    const sc = createSoftCircle({
      roundId: "rnd_persistence_b",
      companyId: "co_persistence_b",
      investorName: "Validate Vic",
      amount: 50_000,
    });
    const updated = validateSoftCircle(sc.id);
    expect(updated?.status).toBe("confirmed");
  });

  it("listForCollective returns only collectiveVisible rows", () => {
    _testAccessSoftCircles.reset();
    createSoftCircle({
      roundId: "rnd_coll_a",
      companyId: "co_coll_a",
      investorName: "Visible Vincent",
      amount: 10_000,
      collectiveVisible: true,
    });
    createSoftCircle({
      roundId: "rnd_coll_a",
      companyId: "co_coll_a",
      investorName: "Hidden Hannah",
      amount: 20_000,
      collectiveVisible: false,
    });
    const collective = listForCollective({ roundId: "rnd_coll_a" });
    expect(collective.length).toBe(1);
    expect(collective[0].investorName).toBe("Visible Vincent");
  });

  it("HTTP POST /api/rounds/:id/soft-circle anonymous → 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const r = await call("POST", "/api/rounds/rnd_novapay_foundation/soft-circle", {
        body: { investorName: "Anon", amount: 1000 },
      });
      expect(r.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("HTTP POST /api/rounds/:id/soft-circle as investor → 200, persisted", async () => {
    _testAccessSoftCircles.reset();
    const r = await call("POST", "/api/rounds/rnd_novapay_foundation/soft-circle", {
      body: { investorName: "Aisha Patel", amount: 100_000, currency: "USD" },
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.softCircle?.id).toMatch(/^sc_/);
    expect(_testAccessSoftCircles.rows.length).toBe(1);
  });

  it("invalid amount → 400", async () => {
    const r = await call("POST", "/api/rounds/rnd_novapay_foundation/soft-circle", {
      body: { investorName: "Bad Amount", amount: -1 },
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(400);
  });
});
