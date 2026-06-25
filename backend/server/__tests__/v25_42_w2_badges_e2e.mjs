/* v25.42 W2 — E2E: Membership badges strip backing data (/api/auth/me).
 * Badges are derived client-side from isAdmin/collective.status/role/founder.
 *   0. member payload carries the fields needed to derive badges
 *   1. admin payload reports isAdmin:true (admin badge derivable)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("w2"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 W2 membership badges — E2E", () => {
  it("0. member payload has badge-derivation fields", async () => {
    const res = await h.req("GET", "/api/auth/me", { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("collective.status present", typeof res.body?.collective?.status === "string", String(res.body?.collective?.status));
    expect(typeof res.body?.collective?.status).toBe("string");
    record("isAdmin is boolean", typeof res.body?.isAdmin === "boolean", String(res.body?.isAdmin));
    expect(typeof res.body?.isAdmin).toBe("boolean");
  });

  it("1. admin payload reports isAdmin:true", async () => {
    const res = await h.req("GET", "/api/auth/me", { userId: h.ids.ADMIN });
    record("admin 200", res.status === 200, `status ${res.status}`);
    record("admin isAdmin true", res.body?.isAdmin === true, String(res.body?.isAdmin));
    expect(res.body?.isAdmin).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 W2 badges E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
