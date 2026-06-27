/* v25.42 W3 — E2E: Featured deals grid backing endpoint /api/collective/dsc/scores.
 *   0. unauthenticated → 401/403 (fail-closed)
 *   1. member → 200, {scores:[],total} envelope (sortable by compositeScore)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("w3"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 W3 featured deals (dsc/scores) — E2E", () => {
  it("0. unauthenticated → 401/403", async () => {
    const res = await h.reqNoAuth("GET", "/api/collective/dsc/scores");
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. member → 200 with scores envelope", async () => {
    const res = await h.req("GET", "/api/collective/dsc/scores", { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("scores is array", Array.isArray(res.body?.scores), typeof res.body?.scores);
    expect(Array.isArray(res.body?.scores)).toBe(true);
    record("total is number", typeof res.body?.total === "number", String(res.body?.total));
    expect(typeof res.body?.total).toBe("number");
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 W3 featured deals E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
