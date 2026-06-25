/* v25.42 R9 — E2E: Regional KPI rollup (admin /admin/regions card) backing data.
 * Aggregates /api/collective/members + /api/collective/companies by region.
 *   0. members + companies unauth → 401/403 (fail-closed)
 *   1. member → both endpoints return arrays (aggregation inputs)
 *   2. rows carry a region/hq field so client-side rollup is possible
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("r9"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 R9 region KPI rollup — E2E", () => {
  it("0. members + companies unauth → 401/403", async () => {
    const m = await h.reqNoAuth("GET", "/api/collective/members");
    const c = await h.reqNoAuth("GET", "/api/collective/companies");
    record("members unauth blocked", [401, 403].includes(m.status), `status ${m.status}`);
    record("companies unauth blocked", [401, 403].includes(c.status), `status ${c.status}`);
    expect([401, 403]).toContain(m.status);
    expect([401, 403]).toContain(c.status);
  });

  it("1. member → both endpoints return arrays", async () => {
    const m = await h.req("GET", "/api/collective/members", { userId: h.ids.MEMBER });
    const c = await h.req("GET", "/api/collective/companies", { userId: h.ids.MEMBER });
    record("members array", m.status === 200 && Array.isArray(m.body?.members), `status ${m.status}`);
    record("companies array", c.status === 200 && Array.isArray(c.body?.companies), `status ${c.status}`);
    expect(Array.isArray(m.body?.members)).toBe(true);
    expect(Array.isArray(c.body?.companies)).toBe(true);
    h._members = m.body.members;
  });

  it("2. member rows carry a region key for rollup", async () => {
    const rows = h._members ?? [];
    const ok = rows.every((r) => "region" in r) || rows.length === 0;
    record("region key present", ok, `n=${rows.length}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R9 region rollup E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
