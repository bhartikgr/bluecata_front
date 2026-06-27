/* v25.44 S5 — Network posts feed endpoint E2E (read-only). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s5posts"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S5 network posts — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", "/api/collective/posts");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("1. member → posts[] + nextCursor", async () => {
    const r = await h.req("GET", "/api/collective/posts?limit=20", { userId: h.ids.MEMBER });
    const ok = r.status === 200 && Array.isArray(r.body?.posts) && ("nextCursor" in r.body);
    record("posts[] + nextCursor", ok, `n=${r.body?.posts?.length}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S5 network posts E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
