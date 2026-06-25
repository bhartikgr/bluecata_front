/* v25.43 R3-4 — E2E: GET /api/feeds/ticker returns the documented shape.
 *
 * Asserts:
 *   1. 200 with { status, market, crypto, macro, capavate }.
 *   2. status is either "OK" (a real provider is configured) or
 *      "PROVIDER_NOT_CONFIGURED" (no provider — the acceptable round-3 default).
 *      When PROVIDER_NOT_CONFIGURED, market/crypto/macro are empty arrays
 *      (no fabricated numbers).
 *   3. The capavate sub-object carries REAL DB-backed numbers: applicationsToday,
 *      roundsOpenedToday, connectionsToday, asOf. We insert a
 *      founder_collective_applications row dated today and assert the
 *      applications count reflects it (>= 1), proving the count is a live DB
 *      query rather than a constant.
 *
 * NON-NEGOTIABLE (Ozan): the external feed is never faked. With no provider
 * configured (the test environment default) the endpoint must clearly mark
 * itself PROVIDER_NOT_CONFIGURED while still returning real Capavate-internal
 * counts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { registerRoutes } from "../routes.ts";
import { getDb, rawDb } from "../db/connection.ts";
import { founderCollectiveApplications as appsTable } from "../../shared/schema.ts";

let app, server, port;
const STAMP = Date.now();

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

function call(method, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port, path, method }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    });
    r.on("error", reject);
    r.end();
  });
}

describe("v25.43 R3-4 — GET /api/feeds/ticker", () => {
  beforeAll(async () => {
    const db = getDb();
    // Insert a founder_collective_applications row dated TODAY so the
    // Capavate-internal applicationsToday count is a real, non-zero DB query.
    const now = new Date().toISOString();
    db.insert(appsTable)
      .values({
        id: `app_r3ticker_${STAMP}_${randomBytes(3).toString("hex")}`,
        tenantId: `tenant_r3_${STAMP}`,
        chapterId: `chap_r3_${STAMP}`,
        companyId: `co_r3_${STAMP}`,
        founderId: `fo_r3_${STAMP}`,
        pitchDeckFilename: "deck.pdf",
        tractionMrr: 0,
        tractionUsers: 0,
        tractionGrowthPct: 0,
        asks: "intro",
        referencesText: "",
        coverLetter: "hello",
        feeAcknowledged: 1,
        status: "submitted",
        submittedAt: now,
        createdAt: now,
      })
      .run();

    app = express();
    app.use(express.json());
    server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise((resolve) =>
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
  });

  it("returns 200 with the documented shape", async () => {
    const r = await call("GET", "/api/feeds/ticker");
    const b = r.body || {};
    const ok =
      r.status === 200 &&
      typeof b.status === "string" &&
      Array.isArray(b.market) &&
      Array.isArray(b.crypto) &&
      Array.isArray(b.macro) &&
      b.capavate &&
      typeof b.capavate === "object";
    record("200 + documented shape", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("status is OK or PROVIDER_NOT_CONFIGURED (no faked numbers)", async () => {
    const r = await call("GET", "/api/feeds/ticker");
    const b = r.body;
    const validStatus = b.status === "OK" || b.status === "PROVIDER_NOT_CONFIGURED";
    record("status valid", validStatus, b.status);
    expect(validStatus).toBe(true);
    if (b.status === "PROVIDER_NOT_CONFIGURED") {
      const empty = b.market.length === 0 && b.crypto.length === 0 && b.macro.length === 0;
      record("PROVIDER_NOT_CONFIGURED → empty market arrays", empty);
      expect(empty).toBe(true);
    }
  });

  it("capavate sub-object carries real DB-backed numbers", async () => {
    const r = await call("GET", "/api/feeds/ticker");
    const cap = r.body.capavate;
    const shapeOk =
      typeof cap.applicationsToday === "number" &&
      typeof cap.roundsOpenedToday === "number" &&
      typeof cap.connectionsToday === "number" &&
      typeof cap.asOf === "string";
    record("capavate numeric fields present", shapeOk);
    expect(shapeOk).toBe(true);
    // The application we inserted dated today must be reflected.
    record("applicationsToday reflects today's DB row (>= 1)", cap.applicationsToday >= 1, String(cap.applicationsToday));
    expect(cap.applicationsToday).toBeGreaterThanOrEqual(1);
  });

  it("summary", () => {
    console.log(
      `\n  v25.43 R3-4 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`,
    );
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
