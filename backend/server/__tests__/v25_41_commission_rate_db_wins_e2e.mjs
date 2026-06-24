/* v25.41 Phase 4 — E2E: DB commission rate WINS over the literal (Q1, Avi=A).
 *
 * Q1 (Avi authorized = A): partnerConsortiumRoutes.commissionPct() now resolves
 * the per-tier commission rate DB-FIRST (partnerCommissionRateResolver →
 * partner_commission_rate_config) and falls back to Avi's BYTE-IDENTICAL
 * COMMISSION_RATE literal only when no DB row exists. This proves Avi's
 * unifying directive ("all DB-driven; nothing hardcoded") for the commission
 * path while leaving Avi's literal table untouched.
 *
 * Contract pinned here (resolver is the single helper commissionPct wraps):
 *   - With NO DB row, getCommissionRate(tier) === Avi's literal, source="default"
 *   - After an admin PUT writes a DB rate, getCommissionRate(tier) returns the
 *     DB rate with source="db" (DB WINS over the literal)
 *   - Restoring the DB rate to Avi's literal value re-yields the literal number
 *   - The admin write surface enforces the same auth matrix (401 unauth)
 *   - Avi's literal fallback values are unchanged (catalyst 0.02 .. founding 0.06)
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
const ADMIN = `u_v2541_q1_admin_${STAMP}`;

// Avi's literal COMMISSION_RATE values (mirrored fallback) — MUST stay constant.
const AVI_LITERAL = {
  catalyst: 0.02,
  builder: 0.03,
  amplifier: 0.04,
  nexus: 0.05,
  founding_member: 0.06,
};

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

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

/** Read the raw DB row rate (undefined if none). */
function dbRate(tier) {
  try {
    const row = rawDb().prepare(`SELECT rate FROM partner_commission_rate_config WHERE tier = ?`).get(tier);
    return row?.rate;
  } catch { return undefined; }
}
/** Hard-delete the DB row so getCommissionRate falls back to the literal. */
function deleteDbRate(tier) {
  try { rawDb().prepare(`DELETE FROM partner_commission_rate_config WHERE tier = ?`).run(tier); } catch { /* table may not exist */ }
}

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2541.test`, name: "v25.41 Q1 Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.41 commission rate — Avi's literal fallback intact", () => {
  it("with NO DB row, the resolver returns Avi's literal with source=default", () => {
    const TIER = "amplifier";
    deleteDbRate(TIER);
    const r = getCommissionRate(TIER);
    record("no-DB-row amplifier === Avi literal 0.04", r.rate === AVI_LITERAL.amplifier, `rate ${r.rate}`);
    expect(r.rate).toBe(AVI_LITERAL.amplifier);
    record("no-DB-row source === default", r.source === "default", r.source);
    expect(r.source).toBe("default");
  });

  it("every tier's literal fallback value is unchanged", () => {
    for (const [tier, lit] of Object.entries(AVI_LITERAL)) {
      deleteDbRate(tier);
      const r = getCommissionRate(tier);
      record(`fallback ${tier} === ${lit}`, r.rate === lit && r.source === "default", `rate ${r.rate} src ${r.source}`);
      expect(r.rate).toBe(lit);
      expect(r.source).toBe("default");
    }
  });
});

describe("v25.41 commission rate — DB WINS over the literal (Q1)", () => {
  it("after an admin PUT writes a DB rate, the resolver returns DB rate with source=db", async () => {
    const TIER = "builder";
    const NEW_RATE = 0.099; // distinct from Avi's literal 0.03
    deleteDbRate(TIER);

    // Sanity: literal first.
    expect(getCommissionRate(TIER).rate).toBe(AVI_LITERAL.builder);

    const put = await req("PUT", `/api/admin/partner/commission-rates/${TIER}`, { body: { rate: NEW_RATE } });
    record("admin PUT builder rate 200", put.status === 200, `status ${put.status}`);
    expect(put.status).toBe(200);

    record("DB row written", dbRate(TIER) === NEW_RATE, `dbRate ${dbRate(TIER)}`);
    expect(dbRate(TIER)).toBe(NEW_RATE);

    const resolved = getCommissionRate(TIER);
    record("resolver returns DB rate (DB WINS)", resolved.rate === NEW_RATE, `rate ${resolved.rate}`);
    expect(resolved.rate).toBe(NEW_RATE);
    record("resolver source === db", resolved.source === "db", resolved.source);
    expect(resolved.source).toBe("db");

    // The DB rate (0.099) is NOT Avi's literal (0.03) — proves DB overrides.
    record("DB rate differs from Avi literal (override proven)", resolved.rate !== AVI_LITERAL.builder);
    expect(resolved.rate).not.toBe(AVI_LITERAL.builder);

    // Restore to Avi's literal value via the admin surface, leave consistent.
    const restore = await req("PUT", `/api/admin/partner/commission-rates/${TIER}`, { body: { rate: AVI_LITERAL.builder } });
    expect(restore.status).toBe(200);
    record("after restore, resolver yields literal value again", getCommissionRate(TIER).rate === AVI_LITERAL.builder, `rate ${getCommissionRate(TIER).rate}`);
    expect(getCommissionRate(TIER).rate).toBe(AVI_LITERAL.builder);
  });

  it("unauthenticated admin PUT → 401 (write surface guarded)", async () => {
    const res = await reqNoAuth("PUT", "/api/admin/partner/commission-rates/catalyst", { rate: 0.05 });
    record("unauth PUT 401", res.status === 401, `status ${res.status}`);
    expect(res.status).toBe(401);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.41 commission DB-wins E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
