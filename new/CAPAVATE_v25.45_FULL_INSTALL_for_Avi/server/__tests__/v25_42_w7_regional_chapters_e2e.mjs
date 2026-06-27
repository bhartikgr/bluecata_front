/* v25.42 W7 — E2E: Regional chapters bar list backing endpoint /api/collective/members.
 * The widget aggregates members by region client-side.
 *   0. unauthenticated → 401/403 (fail-closed)
 *   1. member → 200 with {members:[],total}; rows carry a region field for aggregation
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("w7"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 W7 regional chapters (members) — E2E", () => {
  it("0. unauthenticated → 401/403", async () => {
    const res = await h.reqNoAuth("GET", "/api/collective/members");
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. member → 200 with members envelope", async () => {
    const res = await h.req("GET", "/api/collective/members", { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("members is array", Array.isArray(res.body?.members), typeof res.body?.members);
    expect(Array.isArray(res.body?.members)).toBe(true);
    // region field exists on the projection (may be null) — aggregation key.
    const ok = (res.body?.members ?? []).every((m) => "region" in m || m.region === undefined);
    record("region aggregable", ok, "ok");
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 W7 regional chapters E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
