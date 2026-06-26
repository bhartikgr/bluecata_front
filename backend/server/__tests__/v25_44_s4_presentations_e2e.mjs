/* v25.44 S4 — Chapter presentations endpoint E2E (chapter-membership gated). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s4pres"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S4 presentations — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", `/api/collective/chapters/${h.ids.CHAPTER}/presentations`);
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("1. member of chapter → 200 shape", async () => {
    const r = await h.req("GET", `/api/collective/chapters/${h.ids.CHAPTER}/presentations`, { userId: h.ids.MEMBER });
    const ok = r.status === 200 && "nextMeeting" in r.body && Array.isArray(r.body?.upcoming);
    record("nextMeeting + upcoming[]", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("2. non-chapter member → 403", async () => {
    const r = await h.req("GET", `/api/collective/chapters/chap_other_xyz/presentations`, { userId: h.ids.MEMBER });
    const ok = r.status === 403;
    record("cross-chapter blocked", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S4 presentations E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
