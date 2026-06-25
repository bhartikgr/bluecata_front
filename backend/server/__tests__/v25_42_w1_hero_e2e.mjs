/* v25.42 W1 — E2E: Hero card backing endpoint GET /api/auth/me.
 * The hero reads identity + collective status from /api/auth/me (DB-backed).
 *   0. unauthenticated → isAuthed:false (no 500)
 *   1. member → isAuthed:true, identity.name present, collective block present
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("w1"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 W1 hero (auth/me) — E2E", () => {
  it("0. unauthenticated → isAuthed:false", async () => {
    const res = await h.reqNoAuth("GET", "/api/auth/me");
    record("unauth isAuthed false", res.status === 200 && res.body?.isAuthed === false, `status ${res.status}`);
    expect(res.body?.isAuthed).toBe(false);
  });

  it("1. member → identity + collective present", async () => {
    const res = await h.req("GET", "/api/auth/me", { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("isAuthed true", res.body?.isAuthed === true, String(res.body?.isAuthed));
    expect(res.body?.isAuthed).toBe(true);
    record("identity present", !!res.body?.identity, JSON.stringify(res.body?.identity)?.slice(0, 80));
    expect(res.body?.identity).toBeTruthy();
    record("collective block present", !!res.body?.collective, JSON.stringify(res.body?.collective));
    expect(res.body?.collective).toBeTruthy();
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 W1 hero E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
