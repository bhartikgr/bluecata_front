/**
 * v16 F-coll-25 / Fix 4 — DSC mock inbound endpoint is admin-gated and
 * requires an explicit confirm header. Successful writes are appended to
 * the admin audit trail.
 *
 * Acceptance gate #6:
 *   - Anonymous → 401 AUTH_REQUIRED.
 *   - Authed non-admin → 403 ADMIN_REQUIRED (or equivalent).
 *   - Authed admin WITHOUT confirm header → 403 mock_confirmation_required.
 *   - Authed admin WITH confirm header + valid body → 201 + audit row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { getAuditLog } from "../adminPlatformStore";

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
  apiPath: string,
  opts: { body?: unknown; userId?: string; mockConfirm?: boolean } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.mockConfirm) headers["x-mock-confirm"] = "yes-i-understand-this-is-mock-data";
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

const VALID_BODY = {
  companyId: "co_test_mock_inbound",
  tier: "qualified" as const,
  dimensions: { team: 80, market: 70, traction: 65 },
  narrative: "Test narrative",
  collectiveShortlist: [],
};

describe("v16 F-coll-25 — _mock_inbound gating", () => {
  it("anonymous → 401/403", async () => {
    const r = await call("POST", "/api/founder/ma/dsc-feedback/_mock_inbound", {
      body: VALID_BODY,
    });
    expect([401, 403]).toContain(r.status);
  });

  it("authed non-admin → 403", async () => {
    const r = await call("POST", "/api/founder/ma/dsc-feedback/_mock_inbound", {
      userId: "u_maya_chen",
      body: VALID_BODY,
    });
    expect([401, 403]).toContain(r.status);
  });

  it("admin WITHOUT confirm header → 403 mock_confirmation_required", async () => {
    const r = await call("POST", "/api/founder/ma/dsc-feedback/_mock_inbound", {
      userId: "u_admin",
      body: VALID_BODY,
    });
    // Should be admin-passed, but confirm-rejected → 403.
    expect(r.status).toBe(403);
    expect(String(r.body?.error ?? "")).toMatch(/mock_confirmation_required/i);
  });

  it("admin WITH confirm header + valid body → 201 and appends audit", async () => {
    const before = getAuditLog().filter((e) => e.eventType === "dsc.mock_inbound.write").length;
    const r = await call("POST", "/api/founder/ma/dsc-feedback/_mock_inbound", {
      userId: "u_admin",
      mockConfirm: true,
      body: VALID_BODY,
    });
    expect(r.status).toBe(201);
    expect(r.body?.id).toBeTruthy();
    const after = getAuditLog().filter((e) => e.eventType === "dsc.mock_inbound.write").length;
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });
});
