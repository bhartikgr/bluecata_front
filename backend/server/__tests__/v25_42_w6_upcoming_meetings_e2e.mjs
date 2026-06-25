/* v25.42 W6 — E2E: Upcoming meetings backing endpoint
 * /api/collective/screening-events?from=<now> (+ announcements fallback).
 *   0. unauthenticated → 401/403 (fail-closed)
 *   1. member + chapter_id + from → 200 with events array
 *   2. announcements fallback endpoint also reachable (200 + announcements array)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();
const nowSec = Math.floor(Date.now() / 1000);

beforeAll(async () => { h = await setup("w6"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 W6 upcoming meetings — E2E", () => {
  it("0. unauthenticated → 401/403", async () => {
    const res = await h.reqNoAuth("GET", `/api/collective/screening-events?chapter_id=${h.ids.CHAPTER}&from=${nowSec}`);
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. member + from → 200 with events array", async () => {
    const res = await h.req("GET", `/api/collective/screening-events?chapter_id=${h.ids.CHAPTER}&from=${nowSec}`, { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("events array", Array.isArray(res.body?.events), typeof res.body?.events);
    expect(Array.isArray(res.body?.events)).toBe(true);
  });

  it("2. announcements fallback reachable", async () => {
    const res = await h.req("GET", `/api/collective/announcements?chapter_id=${h.ids.CHAPTER}&filter=active`, { userId: h.ids.MEMBER });
    record("announcements 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("announcements array", Array.isArray(res.body?.announcements), typeof res.body?.announcements);
    expect(Array.isArray(res.body?.announcements)).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 W6 upcoming meetings E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
