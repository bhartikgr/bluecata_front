/* v25.42h Round-2 (Blocker 2) — E2E: the 4 admin fail-OPEN paths are now
 * fail-CLOSED. On a DB read failure the affected route must respond 503 +
 * ok:false (never an empty/default literal payload that would silently present
 * fabricated/empty data as real).
 *
 * Strict mandate (from v25_42h_round2_brief.md):
 *   "on DB read failure, return 503 + ok:false, NEVER an empty/default literal."
 *
 * The 4 sites:
 *   2a. computeSubscriptionMetrics()      → KPI route 503  (momGrowthPct/churnPct/nrr)
 *   2b. computeCollectiveKpis()           → KPI route 503  (collective surface)
 *   2c. GET /api/admin/companies/:id/stats → 503           (dataroom_files)
 *   2d. GET /api/admin/investors/:id       → 503           (holdings/securities)
 *
 * How we induce a DB failure deterministically without corrupting the shared
 * in-memory DB: we RENAME the table the helper reads out of the way for the
 * duration of a single request, then rename it straight back in a finally
 * block. The schema + rows are preserved exactly (rename is lossless), so other
 * suites in the same single-fork run are unaffected.
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
const ADMIN = `u_v2542h_503_admin_${STAMP}`;
const CO_ID = `co_v2542h_503_${STAMP}`;
const TENANT = `tenant_${CO_ID}`;
const INV_ID = `u_v2542h_503_inv_${STAMP}`;

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

/**
 * Run `fn` with `table` renamed away (so any read of it throws), guaranteeing
 * the table is restored afterwards. Lossless: ALTER TABLE RENAME preserves the
 * full schema + all rows + indexes.
 */
async function withMissingTable(table, fn) {
  const db = rawDb();
  const bak = `${table}__v2542h_503_bak`;
  db.exec(`ALTER TABLE ${table} RENAME TO ${bak};`);
  try {
    return await fn();
  } finally {
    db.exec(`ALTER TABLE ${bak} RENAME TO ${table};`);
  }
}

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2542h.test`, name: "v25.42h Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  const db = rawDb();
  // Seed a real company + an investor user so the happy-path (control) requests
  // return 200 — proving the 503 is specifically the induced DB failure, not a
  // pre-existing missing row.
  db.prepare(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at) VALUES (?, ?, ?, 0, NULL)`,
  ).run(CO_ID, TENANT, `V2542H 503 Co ${STAMP}`);
  db.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, name, email, role, deleted_at) VALUES (?, ?, ?, ?, 'investor', NULL)`,
  ).run(INV_ID, TENANT, `Investor ${STAMP}`, `${INV_ID}@v2542h.test`);
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.42h round-2 fail-closed 503 paths — E2E", () => {
  /* ---- Control: happy paths return 200 (so 503s below are meaningful) ---- */
  it("control: KPI / company-stats / investor endpoints return 200 normally", async () => {
    const kpis = await req("GET", "/api/admin/dashboard/kpis");
    record("control kpis 200", kpis.status === 200, `status ${kpis.status}`);
    expect(kpis.status).toBe(200);

    const stats = await req("GET", `/api/admin/companies/${CO_ID}/stats`);
    record("control company-stats 200", stats.status === 200, `status ${stats.status}`);
    expect(stats.status).toBe(200);

    const inv = await req("GET", `/api/admin/investors/${INV_ID}`);
    record("control investor 200", inv.status === 200, `status ${inv.status}`);
    expect(inv.status).toBe(200);
  });

  /* ---- 2a. computeSubscriptionMetrics() → KPI 503 ---- */
  it("2a. KPIs return 503 ok:false when the subscriptions table read fails", async () => {
    const res = await withMissingTable("subscriptions", () => req("GET", "/api/admin/dashboard/kpis?surface=capavate"));
    record("2a kpis 503", res.status === 503, `status ${res.status}`);
    expect(res.status).toBe(503);
    record("2a body ok:false", res.body?.ok === false, JSON.stringify(res.body));
    expect(res.body?.ok).toBe(false);
    record("2a error db_unavailable", res.body?.error === "db_unavailable", JSON.stringify(res.body));
    expect(res.body?.error).toBe("db_unavailable");
    record("2a has message (resource named)", typeof res.body?.message === "string" && res.body.message.length > 0, JSON.stringify(res.body));
    expect(typeof res.body?.message).toBe("string");
    // CRITICAL: must NOT be a 200 with a fabricated {momGrowthPct:null,...} payload.
    record("2a did NOT fail-open to a 200 literal", res.status !== 200 && res.body?.summary === undefined, JSON.stringify(res.body).slice(0, 120));
    expect(res.body?.summary).toBeUndefined();
  });

  /* ---- 2b. computeCollectiveKpis() → KPI 503 ---- */
  it("2b. collective KPIs return 503 ok:false when collective_apps read fails", async () => {
    const res = await withMissingTable("collective_apps", () => req("GET", "/api/admin/dashboard/kpis?surface=collective"));
    record("2b collective kpis 503", res.status === 503, `status ${res.status}`);
    expect(res.status).toBe(503);
    record("2b body ok:false", res.body?.ok === false, JSON.stringify(res.body));
    expect(res.body?.ok).toBe(false);
    record("2b error db_unavailable", res.body?.error === "db_unavailable", JSON.stringify(res.body));
    expect(res.body?.error).toBe("db_unavailable");
    // CRITICAL: must NOT fail-open to a 200 with empty funnels/topCompanies/regions.
    record("2b did NOT fail-open to a 200 literal", res.body?.summary === undefined, JSON.stringify(res.body).slice(0, 120));
    expect(res.body?.summary).toBeUndefined();
  });

  /* ---- 2c. companies/:id/stats → 503 (dataroom_files) ---- */
  it("2c. company stats return 503 ok:false when dataroom_files read fails", async () => {
    const res = await withMissingTable("dataroom_files", () => req("GET", `/api/admin/companies/${CO_ID}/stats`));
    record("2c company-stats 503", res.status === 503, `status ${res.status}`);
    expect(res.status).toBe(503);
    record("2c body ok:false", res.body?.ok === false, JSON.stringify(res.body));
    expect(res.body?.ok).toBe(false);
    record("2c error db_unavailable", res.body?.error === "db_unavailable", JSON.stringify(res.body));
    expect(res.body?.error).toBe("db_unavailable");
    // CRITICAL: must NOT fail-open to a 200 with dataroom.topDocs:[].
    record("2c did NOT fail-open to a 200 with empty topDocs", res.body?.dataroom === undefined, JSON.stringify(res.body).slice(0, 120));
    expect(res.body?.dataroom).toBeUndefined();
  });

  /* ---- 2d. investors/:id → 503 (holdings/securities) ---- */
  it("2d. investor detail returns 503 ok:false when securities read fails", async () => {
    const res = await withMissingTable("securities", () => req("GET", `/api/admin/investors/${INV_ID}`));
    record("2d investor 503", res.status === 503, `status ${res.status}`);
    expect(res.status).toBe(503);
    record("2d body ok:false", res.body?.ok === false, JSON.stringify(res.body));
    expect(res.body?.ok).toBe(false);
    record("2d error db_unavailable", res.body?.error === "db_unavailable", JSON.stringify(res.body));
    expect(res.body?.error).toBe("db_unavailable");
    // CRITICAL: must NOT fail-open to a 200 with holdings:[].
    record("2d did NOT fail-open to a 200 with empty holdings", res.body?.holdings === undefined, JSON.stringify(res.body).slice(0, 120));
    expect(res.body?.holdings).toBeUndefined();
  });

  /* ---- post-condition: tables restored, happy path green again ---- */
  it("post: all endpoints return 200 again after the induced failures (tables restored)", async () => {
    const kpis = await req("GET", "/api/admin/dashboard/kpis");
    record("post kpis 200", kpis.status === 200, `status ${kpis.status}`);
    expect(kpis.status).toBe(200);
    const stats = await req("GET", `/api/admin/companies/${CO_ID}/stats`);
    record("post company-stats 200", stats.status === 200, `status ${stats.status}`);
    expect(stats.status).toBe(200);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42h fail-closed 503 E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
