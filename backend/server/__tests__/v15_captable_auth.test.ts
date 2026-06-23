/**
 * v15 P0-1/P0-2/P0-3 — auth + founder-of-company on cap-table HTTP surface.
 *
 * Pre-v15, /api/founder/captable/ledger and /api/founder/captable/commit-funded
 * were anonymous: any caller could read or mutate any founder's ledger. v15
 * wraps every cap-table HTTP route in `requireAuth` + `founder.ofCompany`.
 *
 *   - Anonymous → 401 on GET ledger AND POST commit-funded-batch.
 *   - Authenticated investor (NOT a founder of co_novapay) → 403.
 *   - Legitimate founder (u_maya_chen) → 200.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

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

describe("v15 P0-1/2/3: auth + founder.ofCompany on cap-table HTTP surface", () => {
  const COMPANY_ID = "co_novapay";
  const ROUND_ID = "rnd_novapay_foundation";

  it("GET /api/founder/captable/ledger anonymous → 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await call("GET", `/api/founder/captable/ledger?companyId=${COMPANY_ID}`);
      expect(res.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("GET /api/founder/captable/ledger as wrong founder (investor) → 403", async () => {
    const res = await call("GET", `/api/founder/captable/ledger?companyId=${COMPANY_ID}`, {
      userId: "u_aisha_patel",
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/founder/captable/ledger as legitimate founder → 200", async () => {
    const res = await call("GET", `/api/founder/captable/ledger?companyId=${COMPANY_ID}`, {
      userId: "u_maya_chen",
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.entries)).toBe(true);
  });

  it("POST /api/founder/captable/commit-funded-batch anonymous → 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await call("POST", "/api/founder/captable/commit-funded-batch", {
        body: { companyId: COMPANY_ID, roundId: ROUND_ID },
      });
      expect(res.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("POST /api/founder/captable/commit-funded-batch wrong founder → 403", async () => {
    const res = await call("POST", "/api/founder/captable/commit-funded-batch", {
      body: { companyId: COMPANY_ID, roundId: ROUND_ID },
      userId: "u_aisha_patel",
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/founder/captable/funded-queue anonymous → 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await call("GET", `/api/founder/captable/funded-queue?companyId=${COMPANY_ID}&roundId=${ROUND_ID}`);
      expect(res.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
