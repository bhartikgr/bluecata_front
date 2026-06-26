/* v25.44 S12 — Admin regions rollup endpoint E2E. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s12reg"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S12 regions rollup — E2E", () => {
  it("0. non-admin → 403", async () => {
    const r = await h.req("GET", "/api/admin/regions/rollup", { userId: h.ids.MEMBER });
    record("member blocked", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });
  it("1. admin → 200 regions[] with chapters+members counts", async () => {
    const r = await h.req("GET", "/api/admin/regions/rollup", { userId: h.ids.ADMIN });
    const ok = r.status === 200 && Array.isArray(r.body?.regions)
      && r.body.regions.every((x) => typeof x.chapters === "number" && typeof x.members === "number");
    record("regions[] rollup", ok, `n=${r.body?.regions?.length}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S12 regions rollup E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
