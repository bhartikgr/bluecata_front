/* v25.42 R3 — E2E: Screening recaps page backing endpoint
 * /api/collective/screening-events?status=completed.
 *   0. unauthenticated → 401/403 (fail-closed)
 *   1. member + chapter_id + status=completed → 200 with events array
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("r3"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 R3 screening recaps — E2E", () => {
  it("0. unauthenticated → 401/403", async () => {
    const res = await h.reqNoAuth("GET", `/api/collective/screening-events?chapter_id=${h.ids.CHAPTER}&status=completed`);
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. member + status=completed → 200 with events array", async () => {
    const res = await h.req("GET", `/api/collective/screening-events?chapter_id=${h.ids.CHAPTER}&status=completed`, { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("events array", Array.isArray(res.body?.events), typeof res.body?.events);
    expect(Array.isArray(res.body?.events)).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R3 screening recaps E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
