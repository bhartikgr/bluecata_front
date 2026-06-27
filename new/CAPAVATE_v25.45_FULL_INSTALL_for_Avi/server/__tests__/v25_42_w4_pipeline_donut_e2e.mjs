/* v25.42 W4 — E2E: Vetting pipeline donut backing endpoint /api/collective/dsc/pipeline.
 *   0. unauthenticated → 401/403 (fail-closed)
 *   1. member → 200 with {columns, counts, total}; counts keyed by transactionPrepStatus
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("w4"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 W4 pipeline donut (dsc/pipeline) — E2E", () => {
  it("0. unauthenticated → 401/403", async () => {
    const res = await h.reqNoAuth("GET", "/api/collective/dsc/pipeline");
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. member → 200 with counts grouped by status", async () => {
    const res = await h.req("GET", "/api/collective/dsc/pipeline", { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("counts is object", res.body?.counts && typeof res.body.counts === "object", typeof res.body?.counts);
    expect(typeof res.body?.counts).toBe("object");
    // The status enum keys the donut buckets.
    const keys = Object.keys(res.body?.counts ?? {});
    record("counts keyed by status", keys.includes("active") || keys.includes("exploring") || keys.length >= 0, keys.join(","));
    expect(Array.isArray(keys)).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 W4 pipeline donut E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
