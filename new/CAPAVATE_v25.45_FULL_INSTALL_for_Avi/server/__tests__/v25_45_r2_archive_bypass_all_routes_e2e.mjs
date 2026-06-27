/* v25.45 ROUND 2 (BLOCKER 1) — exhaustive archive-bypass guard.
 *
 * GPT-5.5 proved that the /api/founder path-prefix archive middleware did NOT
 * cover company-scoped mutation routes mounted OUTSIDE /api/founder (e.g.
 * PATCH /api/companies/:id/profile). This test archives a company and then
 * fires EVERY non-GET founder-owned mutation endpoint, asserting each returns
 * 403 WORKSPACE_ARCHIVED (never 200). It also confirms GET still works while
 * archived (read-only is preserved).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import { rawDb } from "../db/connection.ts";

let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("r2allroutes"); }, 60_000);
afterAll(async () => { await h.teardown(); });

function archive() {
  rawDb().prepare(
    `UPDATE companies SET archive_status='archived', archived_at=?, archive_retention_until=? WHERE id=?`,
  ).run(new Date().toISOString(), new Date(Date.now() + 8 * 365.25 * 864e5).toISOString(), h.ids.COMPANY);
}
function unarchive() {
  rawDb().prepare(
    `UPDATE companies SET archive_status='active', archived_at=NULL, archive_retention_until=NULL WHERE id=?`,
  ).run(h.ids.COMPANY);
}

describe("v25.45 R2 — archive bypass closed on ALL company mutations", () => {
  it("GET still works while archived (read-only preserved)", async () => {
    archive();
    const g = await h.getProfile();
    const ok = g.status === 200;
    record("GET /profile returns 200 while archived", ok, `status ${g.status}`);
    expect(ok).toBe(true);
  });

  it("PATCH /api/companies/:id/profile → 403 WORKSPACE_ARCHIVED", async () => {
    archive();
    const r = await h.patchProfile({ contact: { companyEmail: "x@y.com" } });
    record("profile PATCH blocked", r.status === 403 && r.body?.error === "WORKSPACE_ARCHIVED", `status ${r.status} err ${r.body?.error}`);
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("WORKSPACE_ARCHIVED");
  });

  it("PATCH /api/companies/:id/ma-intelligence → 403", async () => {
    archive();
    const r = await h.req("PATCH", `/api/companies/${h.ids.COMPANY}/ma-intelligence`, { userId: h.ids.FOUNDER, body: { maScore: 1 } });
    record("ma-intelligence PATCH blocked", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("POST /api/rounds (body.companyId) → 403", async () => {
    archive();
    const r = await h.req("POST", "/api/rounds", { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY, type: "SAFE", targetAmount: 100000 } });
    record("round create blocked", r.status === 403, `status ${r.status} err ${r.body?.error}`);
    expect(r.status).toBe(403);
  });

  it("POST /api/companies/:id/securities → 403", async () => {
    archive();
    const r = await h.req("POST", `/api/companies/${h.ids.COMPANY}/securities`, { userId: h.ids.FOUNDER, body: { kind: "common", principal: 1000 } });
    record("securities POST blocked", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("PATCH /api/companies/:id → 403", async () => {
    archive();
    const r = await h.req("PATCH", `/api/companies/${h.ids.COMPANY}`, { userId: h.ids.FOUNDER, body: { displayName: "Renamed" } });
    record("company PATCH blocked", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("after unarchive, mutations succeed again (gate is reversible)", async () => {
    unarchive();
    const r = await h.patchProfile({ contact: { companyEmail: "reactivated@y.com" } });
    const ok = r.status === 200;
    record("profile PATCH 200 after unarchive", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 R2 archive-bypass-all-routes: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
