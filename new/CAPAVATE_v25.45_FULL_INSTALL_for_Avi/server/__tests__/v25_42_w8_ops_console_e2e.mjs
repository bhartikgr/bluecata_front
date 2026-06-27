/* v25.42 W8 — E2E: Operations console (admin-only) defense-in-depth.
 * The console renders only when /api/auth/me reports isAdmin===true (client
 * gate) AND the linked admin surfaces are themselves server-gated (requireAdmin).
 *   0. /api/auth/me: member isAdmin:false, admin isAdmin:true (client gate input)
 *   1. linked admin surface /api/admin/collective/applications: member → 403
 *   2. linked admin surface: admin → 200 (server gate passes for admin)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("w8"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 W8 operations console (admin gate) — E2E", () => {
  it("0. client-gate input: member isAdmin:false, admin isAdmin:true", async () => {
    const mem = await h.req("GET", "/api/auth/me", { userId: h.ids.MEMBER });
    const adm = await h.req("GET", "/api/auth/me", { userId: h.ids.ADMIN });
    record("member isAdmin false", mem.body?.isAdmin === false, String(mem.body?.isAdmin));
    record("admin isAdmin true", adm.body?.isAdmin === true, String(adm.body?.isAdmin));
    expect(mem.body?.isAdmin).toBe(false);
    expect(adm.body?.isAdmin).toBe(true);
  });

  it("1. linked admin surface rejects non-admin member (403)", async () => {
    const res = await h.req("GET", "/api/admin/collective/applications", { userId: h.ids.MEMBER });
    record("member 403", res.status === 403, `status ${res.status}`);
    expect(res.status).toBe(403);
  });

  it("2. linked admin surface allows admin (200)", async () => {
    const res = await h.req("GET", "/api/admin/collective/applications", { userId: h.ids.ADMIN });
    record("admin 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 W8 ops console E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
