/* v25.42 R1 — E2E: Connections page backing data.
 * Derived client-side from /api/auth/me (investor.capTablePositions) +
 * /api/collective/members. No new endpoint.
 *   0. /api/collective/members unauth → 401/403 (fail-closed)
 *   1. member → /api/auth/me carries investor.capTablePositions array
 *   2. member → /api/collective/members returns members array
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("r1"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 R1 connections — E2E", () => {
  it("0. members unauth → 401/403", async () => {
    const res = await h.reqNoAuth("GET", "/api/collective/members");
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. me carries investor.capTablePositions", async () => {
    const res = await h.req("GET", "/api/auth/me", { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const ok = Array.isArray(res.body?.investor?.capTablePositions);
    record("capTablePositions array", ok, typeof res.body?.investor?.capTablePositions);
    expect(ok).toBe(true);
  });

  it("2. members list returns array", async () => {
    const res = await h.req("GET", "/api/collective/members", { userId: h.ids.MEMBER });
    record("members 200", res.status === 200, `status ${res.status}`);
    record("members array", Array.isArray(res.body?.members), typeof res.body?.members);
    expect(Array.isArray(res.body?.members)).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R1 connections E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
