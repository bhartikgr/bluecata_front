/* v25.42 R2 — E2E: Recaps page backing endpoint /api/collective/announcements?filter=recap.
 *   0. unauthenticated → 401/403 (fail-closed)
 *   1. missing chapter_id → 400
 *   2. member + chapter_id → 200 with announcements array
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("r2"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 R2 recaps (announcements) — E2E", () => {
  it("0. unauthenticated → 401/403", async () => {
    const res = await h.reqNoAuth("GET", `/api/collective/announcements?chapter_id=${h.ids.CHAPTER}&filter=recap`);
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. missing chapter_id → 400", async () => {
    const res = await h.req("GET", "/api/collective/announcements?filter=recap", { userId: h.ids.MEMBER });
    record("missing chapter 400", res.status === 400, `status ${res.status}`);
    expect(res.status).toBe(400);
  });

  it("2. member + chapter_id → 200 with announcements array", async () => {
    const res = await h.req("GET", `/api/collective/announcements?chapter_id=${h.ids.CHAPTER}&filter=recap`, { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("announcements array", Array.isArray(res.body?.announcements), typeof res.body?.announcements);
    expect(Array.isArray(res.body?.announcements)).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R2 recaps E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
