/* v25.39 Phase 5 — E2E: admin write endpoint for the collective application fee.
 *
 * Proves the v25.39 carry-forward closure: the previously READ-only
 * collective_application_fee_config now has an admin-only WRITE surface,
 * satisfying the SACRED rule "Pricing plans are determined from the Admin area."
 *
 * Auth matrix + contract:
 *   - Unauthenticated PUT                              → 401
 *   - Non-admin (authed) PUT                           → 403
 *   - Admin PUT with a valid body                      → 200; DB row updated;
 *     resolver returns the new value with source="db"
 *   - Admin PUT with invalid bodies (negative / float /
 *     missing / NaN / string)                          → 400
 *   - An admin audit_log entry is created (appendAdminAudit)
 *   - GET /api/collective/application-fee reflects the new value afterwards
 *
 * Boots the real express app exactly like the v25.34/35/36 E2E harness
 * (registerRoutes), with the Vitest-gated x-user-id identity. The 401 path
 * disables the dev bypass for the duration of the no-auth request.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { getApplicationFeeMinor } from "../lib/collectiveApplicationFeeResolver.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2539_fee_admin_${STAMP}`;
const NONADMIN = `u_v2539_fee_member_${STAMP}`;

/** HTTP request with an explicit x-user-id (defaults to ADMIN). */
function req(method, path, { body, userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? ADMIN };
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** No-identity request with the sandbox dev-bypass disabled → proves 401. */
function reqNoAuth(method, path, body) {
  return new Promise((resolve, reject) => {
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    const headers = { "Content-Type": "application/json" };
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
        else process.env.DISABLE_DEV_BYPASS = prev;
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", (e) => {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
      reject(e);
    });
    if (payload) r.write(payload);
    r.end();
  });
}

function feeRow() {
  return rawDb()
    .prepare(`SELECT amount_minor, currency, updated_by FROM collective_application_fee_config WHERE id='default'`)
    .get();
}
function auditCount() {
  try {
    return rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'application_fee.updated'`)
      .get().n;
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2539.test`, name: "v25.39 Fee Admin",
    isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  __setRuntimePersona({
    userId: NONADMIN, email: `${NONADMIN}@v2539.test`, name: "v25.39 Fee Member",
    isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false,
  });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.39 PUT /api/admin/collective/application-fee — auth matrix", () => {
  it("unauthenticated PUT → 401", async () => {
    const res = await reqNoAuth("PUT", "/api/admin/collective/application-fee", { amountMinor: 5000 });
    expect(res.status).toBe(401);
  });

  it("non-admin PUT → 403", async () => {
    const res = await req("PUT", "/api/admin/collective/application-fee", { body: { amountMinor: 5000 }, userId: NONADMIN });
    expect(res.status).toBe(403);
  });
});

describe("v25.39 PUT /api/admin/collective/application-fee — validation", () => {
  for (const [label, body] of [
    ["missing amountMinor", {}],
    ["negative amountMinor", { amountMinor: -1 }],
    ["non-integer amountMinor", { amountMinor: 12.5 }],
    ["NaN amountMinor", { amountMinor: Number.NaN }],
    ["string amountMinor", { amountMinor: "5000" }],
  ]) {
    it(`admin PUT with ${label} → 400`, async () => {
      const res = await req("PUT", "/api/admin/collective/application-fee", { body });
      expect(res.status).toBe(400);
    });
  }
});

describe("v25.39 PUT /api/admin/collective/application-fee — happy path", () => {
  it("admin PUT with a valid body → 200; DB updated; resolver source='db'; audit + GET reflect it", async () => {
    const before = feeRow();
    const beforeAudit = auditCount();
    const newAmount = 5000;
    const res = await req("PUT", "/api/admin/collective/application-fee", { body: { amountMinor: newAmount, currency: "usd" } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.amountMinor).toBe(newAmount);
    expect(res.body.currency).toBe("USD"); // normalised upper-case
    expect(res.body.source).toBe("db");

    // DB row updated (+ provenance recorded in updated_by).
    const row = feeRow();
    expect(row.amount_minor).toBe(newAmount);
    expect(row.updated_by).toBeTruthy();

    // Resolver agrees.
    const resolved = getApplicationFeeMinor();
    expect(resolved.amountMinor).toBe(newAmount);
    expect(resolved.source).toBe("db");

    // Audit entry created.
    expect(auditCount()).toBe(beforeAudit + 1);

    // The public founder-facing GET returns the new value cleanly.
    const pub = await req("GET", "/api/collective/application-fee");
    expect(pub.status).toBe(200);
    expect(pub.body.amountMinor).toBe(newAmount);

    // Restore the seed for test isolation.
    await req("PUT", "/api/admin/collective/application-fee", { body: { amountMinor: before.amount_minor, currency: before.currency } });
  });
});

// v25.39 round-2 regression scenarios (per GPT-5.5)
describe("v25.39 round-2 — admin fee: unsafe integer + unit semantics", () => {
  it("rejects amountMinor === Number.MAX_SAFE_INTEGER + 1 (unsafe int) with 400", async () => {
    const r = await req("PUT", "/api/admin/collective/application-fee", {
      body: { amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: "USD" },
    });
    expect(r.status).toBe(400);
  });

  it("rejects amountMinor === Number.MAX_SAFE_INTEGER + 10 (unsafe int) with 400", async () => {
    const r = await req("PUT", "/api/admin/collective/application-fee", {
      body: { amountMinor: Number.MAX_SAFE_INTEGER + 10, currency: "USD" },
    });
    expect(r.status).toBe(400);
  });

  it("accepts amountMinor === Number.MAX_SAFE_INTEGER (boundary safe int)", async () => {
    const r = await req("PUT", "/api/admin/collective/application-fee", {
      body: { amountMinor: Number.MAX_SAFE_INTEGER, currency: "USD" },
    });
    expect(r.status).toBe(200);
  });

  it("unit semantics: PUT amountMinor=2500 -> GET amountMinor=2500 (no /100 conversion server-side)", async () => {
    await req("PUT", "/api/admin/collective/application-fee", {
      body: { amountMinor: 2500, currency: "USD" },
    });
    const get = await req("GET", "/api/collective/application-fee");
    expect(get.status).toBe(200);
    expect(get.body.amountMinor).toBe(2500);
  });
});
