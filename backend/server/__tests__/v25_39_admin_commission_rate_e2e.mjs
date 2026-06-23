/* v25.39 Phase 5 — E2E: admin write endpoints for partner commission rates.
 *
 * Proves the v25.39 carry-forward closure: the previously READ-only
 * partner_commission_rate_config now has an admin-only WRITE surface + a list
 * endpoint, satisfying "Pricing plans are determined from the Admin area."
 *
 * AVI-CODE PRESERVATION: Avi's literal COMMISSION_RATE table in
 * partnerConsortiumRoutes.ts is untouched; these endpoints write the additive
 * DB config table only.
 *
 * Auth matrix + contract:
 *   - Unauthenticated PUT                                  → 401
 *   - Non-admin (authed) PUT                               → 403
 *   - Invalid tier (:tier = bogus)                         → 400
 *   - Invalid rate (2 / -0.1 / NaN / missing / string)     → 400
 *   - Per-tier valid update                                → 200; ONLY that
 *     tier's row changes; the other tiers stay byte-identical
 *   - An admin audit_log entry is created per update
 *   - GET list endpoint returns all 5 tiers in deterministic order
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { getCommissionRate } from "../lib/partnerCommissionRateResolver.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2539_rate_admin_${STAMP}`;
const NONADMIN = `u_v2539_rate_member_${STAMP}`;
const TIERS = ["catalyst", "builder", "amplifier", "nexus", "founding_member"];

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

function allRows() {
  const rows = rawDb()
    .prepare(`SELECT tier, rate FROM partner_commission_rate_config`)
    .all();
  const map = {};
  for (const r of rows) map[r.tier] = r.rate;
  return map;
}
function auditCount() {
  try {
    return rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'commission_rate.updated'`)
      .get().n;
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2539.test`, name: "v25.39 Rate Admin",
    isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  __setRuntimePersona({
    userId: NONADMIN, email: `${NONADMIN}@v2539.test`, name: "v25.39 Rate Member",
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

describe("v25.39 PUT /api/admin/partner/commission-rates/:tier — auth matrix", () => {
  it("unauthenticated PUT → 401", async () => {
    const res = await reqNoAuth("PUT", "/api/admin/partner/commission-rates/catalyst", { rate: 0.03 });
    expect(res.status).toBe(401);
  });
  it("non-admin PUT → 403", async () => {
    const res = await req("PUT", "/api/admin/partner/commission-rates/catalyst", { body: { rate: 0.03 }, userId: NONADMIN });
    expect(res.status).toBe(403);
  });
});

describe("v25.39 PUT /api/admin/partner/commission-rates/:tier — validation", () => {
  it("invalid tier → 400", async () => {
    const res = await req("PUT", "/api/admin/partner/commission-rates/bogus", { body: { rate: 0.03 } });
    expect(res.status).toBe(400);
  });
  for (const [label, body] of [
    ["rate=2 (>1)", { rate: 2 }],
    ["rate=-0.1 (<0)", { rate: -0.1 }],
    ["rate=NaN", { rate: Number.NaN }],
    ["missing rate", {}],
    ["string rate", { rate: "0.03" }],
  ]) {
    it(`admin PUT amplifier with ${label} → 400`, async () => {
      const res = await req("PUT", "/api/admin/partner/commission-rates/amplifier", { body });
      expect(res.status).toBe(400);
    });
  }
});

describe("v25.39 GET /api/admin/partner/commission-rates — list view", () => {
  it("returns all 5 tiers in deterministic order", async () => {
    const res = await req("GET", "/api/admin/partner/commission-rates");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.rates)).toBe(true);
    expect(res.body.rates.map((r) => r.tier)).toEqual(TIERS);
    for (const r of res.body.rates) {
      expect(typeof r.rate).toBe("number");
      expect(r.source === "db" || r.source === "default").toBe(true);
    }
  });
});

describe("v25.39 PUT /api/admin/partner/commission-rates/:tier — per-tier update isolation", () => {
  it("updating ONE tier changes only that row; others stay byte-identical; audit + resolver agree", async () => {
    const before = allRows();
    const beforeAudit = auditCount();
    const targetTier = "builder";
    const newRate = 0.077;

    const res = await req("PUT", `/api/admin/partner/commission-rates/${targetTier}`, { body: { rate: newRate } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tier).toBe(targetTier);
    expect(res.body.rate).toBe(newRate);
    expect(res.body.source).toBe("db");
    // Response carries the full deterministic list too.
    expect(res.body.rates.map((r) => r.tier)).toEqual(TIERS);

    const after = allRows();
    expect(after[targetTier]).toBe(newRate);
    // Every OTHER tier is unchanged (byte-identical rate).
    for (const t of TIERS) {
      if (t === targetTier) continue;
      expect(after[t]).toBe(before[t]);
    }

    // Resolver agrees for the changed tier.
    const resolved = getCommissionRate(targetTier);
    expect(resolved.rate).toBe(newRate);
    expect(resolved.source).toBe("db");

    // One audit entry created.
    expect(auditCount()).toBe(beforeAudit + 1);

    // Restore the seed value for isolation.
    await req("PUT", `/api/admin/partner/commission-rates/${targetTier}`, { body: { rate: before[targetTier] } });
  });
});
