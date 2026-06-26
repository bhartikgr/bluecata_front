/* v25.44 S1 — Engagement Score endpoint E2E.
 *   0. unauth → 401/403
 *   1. member → 200, score 0-100, 4 components with weights 25/15/10/5
 *   2. asOf is ISO timestamp
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();
beforeAll(async () => { h = await setup("s1eng"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.44 S1 engagement score — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", "/api/collective/me/engagement");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });

  it("1. member → score + components", async () => {
    const r = await h.req("GET", "/api/collective/me/engagement", { userId: h.ids.MEMBER });
    const ok = r.status === 200 && typeof r.body?.score === "number" && r.body.score >= 0 && r.body.score <= 100;
    record("score 0-100", ok, `score ${r.body?.score}`);
    const c = r.body?.components;
    const weightsOk = c?.softCircles?.weight === 25 && c?.screeningsVoted?.weight === 15 &&
      c?.inquiriesSent?.weight === 10 && c?.dealsListed?.weight === 5;
    record("component weights", weightsOk);
    expect(ok).toBe(true);
    expect(weightsOk).toBe(true);
  });

  it("2. asOf ISO", async () => {
    const r = await h.req("GET", "/api/collective/me/engagement", { userId: h.ids.MEMBER });
    const ok = typeof r.body?.asOf === "string" && !Number.isNaN(Date.parse(r.body.asOf));
    record("asOf ISO", ok, r.body?.asOf);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S1 engagement E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
