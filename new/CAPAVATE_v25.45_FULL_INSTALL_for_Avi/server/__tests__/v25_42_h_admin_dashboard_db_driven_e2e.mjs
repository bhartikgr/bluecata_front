/* v25.42h Housekeeping — E2E: the admin dashboard's 6 fixed sites are now
 * DB-derived, NOT hardcoded literals.
 *
 * adminPlatformStore.ts header described all store data as "in-memory mock
 * seeded from existing fixtures". v25.42h replaces the fabricated literals with
 * real DB queries. This test boots the live express app (registerRoutes),
 * seeds known rows into the DB, and asserts the dashboard reflects the DB —
 * and never the old hardcoded fixtures.
 *
 * Sites covered (per the brief):
 *   1. computeKpis()  — momGrowthPct/churnPct/nrr no longer 11.4/2.1/1.18;
 *                       health.capTableReconcile derived from recon_runs;
 *                       funnels derived from audit_log; topCompanies/Investors
 *                       derived from real companies/users.
 *   2. dashboard/activity — sourced from audit_log (DB-driven), and reflects a
 *                       freshly-appended audit row.
 *   3. companies/:id/stats — cap-table from real securities table.
 *   4. investors/:id — DB-derived profile; 404 for unknown id (no fabricated
 *                       Aisha Patel fixture).
 *   5. fail-closed — none of the old hardcoded sentinels (NovaPay literal id in
 *                       the KPI topCompanies, 11.4 growth) appear.
 *   6. users/:id — unknown id returns 404 (hardcoded short-circuit removed).
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { appendAdminAudit } from "../adminPlatformStore.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2542h_admin_${STAMP}`;
const CO_ID = `co_v2542h_${STAMP}`;
const TENANT = `tenant_${CO_ID}`;
const ACTIVITY_EVENT = `round.closed`;

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

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2542h.test`, name: "v25.42h Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  const db = rawDb();
  const now = new Date().toISOString();
  // Seed a real company so company-stats + topCompanies have a DB source.
  db.prepare(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at) VALUES (?, ?, ?, 0, NULL)`,
  ).run(CO_ID, TENANT, `V2542H Co ${STAMP}`);
  // Seed two securities rows for the cap-table aggregate (holders + shares).
  db.prepare(
    `INSERT OR REPLACE INTO securities (id, company_id, holder_name, holder_type, instrument, shares, shares_str, amount_minor, deleted_at)
     VALUES (?, ?, ?, 'investor', 'SAFE', 1000, '1000', 0, NULL)`,
  ).run(`sec_${STAMP}_1`, CO_ID, `holder_${STAMP}_a`);
  db.prepare(
    `INSERT OR REPLACE INTO securities (id, company_id, holder_name, holder_type, instrument, shares, shares_str, amount_minor, deleted_at)
     VALUES (?, ?, ?, 'investor', 'Common', 500, '500', 0, NULL)`,
  ).run(`sec_${STAMP}_2`, CO_ID, `holder_${STAMP}_b`);
  // Seed a recon_runs row so health.capTableReconcile is derived (ok:true).
  db.prepare(
    `INSERT OR REPLACE INTO recon_runs (id, tenant_id, company_id, round_id, ts, engine_main_json, engine_ref_json, diff_json, actor, deleted_at)
     VALUES (?, ?, ?, 'rnd_x', ?, '{}', '{}', '{"ok":true}', 'system', NULL)`,
  ).run(`rec_${STAMP}`, TENANT, CO_ID, now);
  // Append an audit row of a funnel/activity kind via the canonical writer.
  appendAdminAudit(ADMIN, CO_ID, ACTIVITY_EVENT, { closed: true }, TENANT);
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.42h admin dashboard DB-driven — E2E", () => {
  it("1. KPIs no longer return the old hardcoded growth/churn/nrr literals", async () => {
    const res = await req("GET", "/api/admin/dashboard/kpis");
    record("kpis 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const s = res.body?.summary ?? {};
    // The old fabricated values were 11.4 / 2.1 / 1.18. DB-derived or null is
    // acceptable; the exact fabricated triple is NOT.
    const isOldTriple = s.momGrowthPct === 11.4 && s.churnPct === 2.1 && s.nrr === 1.18;
    record("growth/churn/nrr are not the fabricated 11.4/2.1/1.18", !isOldTriple, `mom=${s.momGrowthPct} churn=${s.churnPct} nrr=${s.nrr}`);
    expect(isOldTriple).toBe(false);
  });

  it("2. KPI topCompanies are DB-derived (no hardcoded co_novapay fixture)", async () => {
    const res = await req("GET", "/api/admin/dashboard/kpis");
    const top = res.body?.topCompanies ?? [];
    // Old fixture always returned co_novapay/co_quanta/... regardless of DB.
    const hasFixtureNova = top.some((c) => c.id === "co_novapay" && c.name === "NovaPay AI" && c.raised === 6_500_000);
    record("topCompanies is not the hardcoded NovaPay fixture", !hasFixtureNova, `ids=${top.map((c) => c.id).join(",")}`);
    expect(hasFixtureNova).toBe(false);
    // Our seeded company should appear (it has audit activity from the seed).
    const hasSeeded = top.some((c) => c.id === CO_ID);
    record("seeded company present in DB-derived topCompanies", hasSeeded, `ids=${top.map((c) => c.id).join(",")}`);
    expect(hasSeeded).toBe(true);
  });

  it("3. KPI health.capTableReconcile is derived from recon_runs", async () => {
    const res = await req("GET", "/api/admin/dashboard/kpis");
    const h = res.body?.health?.capTableReconcile ?? {};
    // Old fixture was runs:318 success:316. We seeded exactly 1 ok run, so the
    // count must reflect the DB (>=1) and NOT the 318 literal.
    record("recon runs not the hardcoded 318", h.runs !== 318, `runs=${h.runs}`);
    expect(h.runs).not.toBe(318);
    record("recon runs reflects >=1 seeded run", typeof h.runs === "number" && h.runs >= 1, `runs=${h.runs}`);
    expect(h.runs >= 1).toBe(true);
  });

  it("4. KPI funnels are DB-derived from audit_log (round.closed counted)", async () => {
    const res = await req("GET", "/api/admin/dashboard/kpis");
    const onboarding = res.body?.funnels?.onboarding ?? [];
    const firstClose = onboarding.find((f) => f.step === "first_close");
    record("first_close funnel present", !!firstClose, JSON.stringify(onboarding));
    expect(!!firstClose).toBe(true);
    // We appended one round.closed audit row → first_close count must be >=1
    // and not the old hardcoded 9.
    record("first_close count is DB-derived (>=1, not 9-literal-only)", typeof firstClose.count === "number" && firstClose.count >= 1, `count=${firstClose?.count}`);
    expect(firstClose.count >= 1).toBe(true);
  });

  it("5. dashboard/activity is DB-driven and shows the appended audit row", async () => {
    const res = await req("GET", "/api/admin/dashboard/activity");
    record("activity 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const items = res.body?.items ?? [];
    const found = items.some((a) => a.entity === CO_ID && a.kind === ACTIVITY_EVENT);
    record("appended audit row appears in activity feed", found, `items=${items.length}`);
    expect(found).toBe(true);
    // Old static fixture ids (act_1..act_5) must NOT be the only content.
    const onlyStaticFixture = items.length > 0 && items.every((a) => /^act_\d$/.test(String(a.id)));
    record("activity feed is not the static act_1..act_5 fixture", !onlyStaticFixture, `ids=${items.map((a) => a.id).slice(0, 6).join(",")}`);
    expect(onlyStaticFixture).toBe(false);
  });

  it("6. companies/:id/stats cap-table is DB-derived from securities", async () => {
    const res = await req("GET", `/api/admin/companies/${CO_ID}/stats`);
    record("company stats 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const cap = res.body?.capTable ?? {};
    // Old fixture was holders:12 totalShares:"12500000". We seeded 2 holders /
    // 1500 shares.
    record("holders DB-derived (==2, not 12-literal)", cap.holders === 2, `holders=${cap.holders}`);
    expect(cap.holders).toBe(2);
    record("totalShares DB-derived (==1500, not 12500000)", String(cap.totalShares) === "1500", `totalShares=${cap.totalShares}`);
    expect(String(cap.totalShares)).toBe("1500");
  });

  it("7. investors/:id returns 404 for an unknown id (no Aisha Patel fixture)", async () => {
    const res = await req("GET", `/api/admin/investors/u_does_not_exist_${STAMP}`);
    record("unknown investor 404 (not 200 with fabricated profile)", res.status === 404, `status ${res.status}`);
    expect(res.status).toBe(404);
  });

  it("8. users/:id returns 404 for an unknown id (hardcoded short-circuit removed)", async () => {
    const res = await req("GET", `/api/admin/users/u_does_not_exist_${STAMP}`);
    record("unknown user 404", res.status === 404, `status ${res.status}`);
    expect(res.status).toBe(404);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42h admin dashboard DB-driven E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
