/* v25.42 R6 — E2E: Public profile page backing data.
 * Resolves a member from /api/collective/members by id (no per-user endpoint);
 * enriches self from /api/auth/me.
 *   0. /api/collective/members unauth → 401/403 (fail-closed)
 *   1. member directory returns rows that can be looked up by id
 *   2. self /api/auth/me carries identity + collective.role for enrichment
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("r6"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 R6 public profile — E2E", () => {
  it("0. members unauth → 401/403", async () => {
    const res = await h.reqNoAuth("GET", "/api/collective/members");
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. member directory rows carry id for lookup", async () => {
    const res = await h.req("GET", "/api/collective/members", { userId: h.ids.MEMBER });
    record("members 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const rows = res.body?.members ?? [];
    const ok = rows.every((m) => typeof m.id === "string");
    record("rows have id", ok || rows.length === 0, `n=${rows.length}`);
    expect(ok || rows.length === 0).toBe(true);
  });

  it("2. self me carries identity + role", async () => {
    const res = await h.req("GET", "/api/auth/me", { userId: h.ids.MEMBER });
    record("me 200", res.status === 200, `status ${res.status}`);
    record("identity present", !!res.body?.identity, JSON.stringify(res.body?.identity)?.slice(0, 60));
    expect(res.body?.identity).toBeTruthy();
    record("collective role key present", res.body?.collective && "role" in res.body.collective, JSON.stringify(res.body?.collective));
    expect("role" in (res.body?.collective ?? {})).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R6 public profile E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
