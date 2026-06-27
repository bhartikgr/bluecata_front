/* v25.44 S6 — Connections extended endpoint E2E. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s6conn"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S6 connections extended — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", "/api/collective/me/connections");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("1. member → connections[] with mutualDeals + sharedSoftCircles keys", async () => {
    const r = await h.req("GET", "/api/collective/me/connections", { userId: h.ids.MEMBER });
    const ok = r.status === 200 && Array.isArray(r.body?.connections)
      && r.body.connections.every((c) => Array.isArray(c.mutualDeals) && Array.isArray(c.sharedSoftCircles));
    record("connections[] extended shape", ok, `n=${r.body?.connections?.length}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S6 connections E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
