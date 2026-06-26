/* v25.44 S10 — Admin deal statistics endpoint E2E (admin-only). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s10ds"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S10 admin deal-statistics — E2E", () => {
  it("0. non-admin member → 403", async () => {
    const r = await h.req("GET", "/api/admin/deal-statistics", { userId: h.ids.MEMBER });
    record("member blocked", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });
  it("1. admin → 200 funnel + conversion", async () => {
    const r = await h.req("GET", "/api/admin/deal-statistics", { userId: h.ids.ADMIN });
    const ok = r.status === 200 && !!r.body?.funnel && typeof r.body.funnel.companies === "number" && !!r.body?.conversion;
    record("funnel + conversion", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S10 deal-stats E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
