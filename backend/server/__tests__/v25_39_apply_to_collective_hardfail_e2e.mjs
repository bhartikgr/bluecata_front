/* v25.39 Phase 5 — E2E: ApplyToCollective hard-fail loading contract.
 *
 * The v25.39 Phase 1 UX hard-fails instead of soft-falling to a stale $2,500:
 * the founder Apply page shows a spinner while the fee query is pending, an
 * error banner + Retry on failure, and enables Submit ONLY once a valid integer
 * fee resolves. The client relies on GET /api/collective/application-fee always
 * returning a CLEAN, well-formed payload (a non-negative integer amountMinor +
 * a currency) so it can drive its isPending / isError / isSuccess state machine.
 *
 * The project has no client test runner (no @testing-library/react in the tree),
 * so per the brief we assert the SERVER CONTRACT the client UX depends on:
 *
 *   1. With the config row present, the endpoint returns 200 with a finite,
 *      non-negative INTEGER amountMinor + currency (so feeReady can be true).
 *   2. With the config row genuinely MISSING, the resolver reports
 *      source="default" but the ENDPOINT STILL returns a clean 200 payload with
 *      a valid integer amount — the client never has to invent a fallback.
 *   3. The payload shape is exactly { amountMinor:number, currency:string,
 *      source:"db"|"default" } — no nulls / NaN that would break feeReady.
 *
 * Boots the real express app like the other v25.39 E2E suites.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";

let app, server, port;
const STAMP = Date.now();
const FOUNDER = `u_v2539_apply_founder_${STAMP}`;

function req(method, path, { userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? FOUNDER };
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
    r.end();
  });
}

function isCleanFeePayload(body) {
  return (
    body &&
    typeof body.amountMinor === "number" &&
    Number.isFinite(body.amountMinor) &&
    Number.isInteger(body.amountMinor) &&
    body.amountMinor >= 0 &&
    typeof body.currency === "string" &&
    body.currency.length > 0 &&
    (body.source === "db" || body.source === "default")
  );
}

beforeAll(async () => {
  __setRuntimePersona({
    userId: FOUNDER, email: `${FOUNDER}@v2539.test`, name: "v25.39 Apply Founder",
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

describe("v25.39 GET /api/collective/application-fee — hard-fail loading contract", () => {
  it("with the config row present → 200 + clean integer payload (feeReady can be true)", async () => {
    const res = await req("GET", "/api/collective/application-fee");
    expect(res.status).toBe(200);
    expect(isCleanFeePayload(res.body)).toBe(true);
    expect(res.body.source).toBe("db");
  });

  it("with the config row MISSING → resolver source='default' but endpoint still returns a clean 200 payload", async () => {
    const db = rawDb();
    const saved = db
      .prepare(`SELECT id, amount_minor, currency, updated_at, updated_by FROM collective_application_fee_config WHERE id='default'`)
      .get();
    db.prepare(`DELETE FROM collective_application_fee_config WHERE id='default'`).run();
    try {
      const res = await req("GET", "/api/collective/application-fee");
      expect(res.status).toBe(200);
      expect(isCleanFeePayload(res.body)).toBe(true);
      // Missing row → resolver default; the client still gets a usable amount.
      expect(res.body.source).toBe("default");
    } finally {
      db.prepare(
        `INSERT OR IGNORE INTO collective_application_fee_config (id, amount_minor, currency, updated_at, updated_by) VALUES (?,?,?,?,?)`,
      ).run(saved.id, saved.amount_minor, saved.currency, saved.updated_at, saved.updated_by ?? null);
    }
  });

  it("the payload never contains NaN / null amounts that would break the feeReady gate", async () => {
    const res = await req("GET", "/api/collective/application-fee");
    expect(res.body.amountMinor).not.toBeNull();
    expect(Number.isNaN(res.body.amountMinor)).toBe(false);
    expect(res.body.currency).not.toBeNull();
  });
});
