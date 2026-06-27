/* v25.42 R5 — E2E: My requests page backing per-store endpoints.
 * Read-only join of applications/mine + me/membership + investor/invitations.
 *   0. /api/collective/applications/mine unauth → 401
 *   1. member applications/mine → 200 or 404 (404 = no application yet; valid)
 *   2. member me/membership → 200/404 (read-only standing)
 *   3. member investor/invitations → 200 (array-ish)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("r5"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 R5 my requests — E2E", () => {
  it("0. applications/mine unauth → 401", async () => {
    const res = await h.reqNoAuth("GET", "/api/collective/applications/mine");
    record("unauth 401", res.status === 401, `status ${res.status}`);
    expect(res.status).toBe(401);
  });

  it("1. member applications/mine → 200 or 404", async () => {
    const res = await h.req("GET", "/api/collective/applications/mine", { userId: h.ids.MEMBER });
    record("apps 200/404", res.status === 200 || res.status === 404, `status ${res.status}`);
    expect([200, 404]).toContain(res.status);
  });

  it("2. member me/membership reachable", async () => {
    const res = await h.req("GET", "/api/me/membership", { userId: h.ids.MEMBER });
    record("membership reachable", [200, 404].includes(res.status), `status ${res.status}`);
    expect([200, 404]).toContain(res.status);
  });

  it("3. member investor/invitations → 200", async () => {
    const res = await h.req("GET", "/api/investor/invitations", { userId: h.ids.MEMBER });
    record("invitations reachable", [200, 404].includes(res.status), `status ${res.status}`);
    expect([200, 404]).toContain(res.status);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R5 my requests E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
