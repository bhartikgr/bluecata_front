/* v25.44 S2 — Platform Pulse endpoint E2E.
 *   0. unauth → 401/403
 *   1. member → 200; status OK with 6 numeric counts OR AUDIT_LOG_UNAVAILABLE w/ counts:null (NO fake numbers)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();
beforeAll(async () => { h = await setup("s2pulse"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.44 S2 platform pulse — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", "/api/collective/platform-pulse");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });

  it("1. member → OK counts OR fail-closed", async () => {
    const r = await h.req("GET", "/api/collective/platform-pulse", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const b = r.body;
    if (b.status === "AUDIT_LOG_UNAVAILABLE") {
      const ok = b.counts === null;
      record("fail-closed null counts (no fake numbers)", ok);
      expect(ok).toBe(true);
    } else {
      const c = b.counts;
      const keys = ["membersOnline", "dealUpdatesToday", "softCirclesToday", "screeningsThisWeek", "activeDeals", "openDeals"];
      const ok = b.status === "OK" && c && keys.every((k) => typeof c[k] === "number");
      record("OK 6 numeric counts", ok, JSON.stringify(c));
      expect(ok).toBe(true);
    }
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S2 pulse E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
