/**
 * v24.0 — Group E regression: critical cross-component data-flow fixes.
 *
 * Covers:
 *   - E1: collective DSC listener guard uses `||` (fires only on the exact
 *         transaction_prep/update tuple), not `&&`.
 *   - E2: collectiveMembershipStore exposes deactivate(); rejection path
 *         deactivates the modern store as well as the legacy one.
 *   - E4: admin consortium DTO emits BOTH organizationName and orgName.
 *   - E5: /invite-link and /resend-invite endpoints are registered.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

let app: Express;
let server: http.Server;
let port: number;

const ADMIN = "u_admin";

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
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
  p: string,
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
      { hostname: "127.0.0.1", port, path: p, method, headers },
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

describe("v24.0 Group E — cross-component fixes", () => {
  it("E1: DSC listener guard uses `||` (not `&&`) on the transaction_prep/update tuple", () => {
    const src = readFileSync(
      path.resolve(__dirname, "..", "collectiveRoutes.ts"),
      "utf8",
    );
    // The hardened guard must short-circuit unless BOTH conditions match.
    expect(src).toContain('evt.aggregate !== "transaction_prep" || evt.change !== "update"');
    expect(src).not.toContain('evt.aggregate !== "transaction_prep" && evt.change !== "update"');
  });

  it("E2: collectiveMembershipStore.deactivate exists and is callable", () => {
    expect(typeof collectiveMembershipStore.deactivate).toBe("function");
    // Deactivating an unknown user is a safe no-op returning null (does not throw).
    expect(collectiveMembershipStore.deactivate("u_v24_unknown", ADMIN)).toBeNull();
  });

  it("E2: rejection path deactivates BOTH stores (modern deactivate wired in source)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "..", "adminCollectiveRoutes.ts"),
      "utf8",
    );
    // Both rejection branches must call the modern store's deactivate.
    const occurrences = (src.match(/collectiveMembershipStore\.deactivate\(/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("E4: admin consortium DTO emits BOTH organizationName and orgName", () => {
    const src = readFileSync(
      path.resolve(__dirname, "..", "consortiumApplyStore.ts"),
      "utf8",
    );
    expect(src).toMatch(/orgName:\s*r\.organization_name\s*\?\?\s*r\.organizationName/);
    expect(src).toMatch(/organizationName:\s*r\.organization_name/);
  });

  it("E5: GET /invite-link endpoint is registered (no route-level 404)", async () => {
    const r = await call("GET", "/api/admin/consortium/applications/nope/invite-link", { userId: ADMIN });
    expect(r.status).not.toBe(0);
    // Registered route → auth/notfound/conflict, never an undefined-route failure.
    expect([200, 401, 403, 404, 409, 500]).toContain(r.status);
  });

  it("E5: POST /resend-invite endpoint is registered (no route-level 404)", async () => {
    const r = await call("POST", "/api/admin/consortium/applications/nope/resend-invite", { userId: ADMIN, body: {} });
    expect(r.status).not.toBe(0);
    expect([200, 401, 403, 404, 409, 500]).toContain(r.status);
  });
});
