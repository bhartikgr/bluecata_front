/* v25.44 S7 — Monthly meetings endpoint E2E. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s7mm"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S7 monthly meetings — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", "/api/collective/monthly-meetings");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("1. member → past/current/upcoming arrays", async () => {
    const r = await h.req("GET", "/api/collective/monthly-meetings", { userId: h.ids.MEMBER });
    const ok = r.status === 200 && Array.isArray(r.body?.past) && Array.isArray(r.body?.current) && Array.isArray(r.body?.upcoming);
    record("3 arrays", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S7 monthly meetings E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
