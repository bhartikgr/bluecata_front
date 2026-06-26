/* v25.44 S3 — My Portfolio endpoint E2E. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s3pf"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S3 my portfolio — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", "/api/collective/me/portfolio");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("1. member → shape", async () => {
    const r = await h.req("GET", "/api/collective/me/portfolio", { userId: h.ids.MEMBER });
    const ok = r.status === 200 && Array.isArray(r.body?.positions) && typeof r.body?.count === "number"
      && (r.body.totalValueUsd === null || typeof r.body.totalValueUsd === "number");
    record("positions[] + count + totalValueUsd|null", ok, `count ${r.body?.count}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S3 portfolio E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
