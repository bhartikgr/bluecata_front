/* v25.42 R4 — E2E: Chapters page backing endpoint /api/me/chapters.
 *   0. unauthenticated → 401/503 (fail-closed)
 *   1. member → 200 with chapters array (the seeded chapter appears)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setup("r4"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 R4 chapters (me/chapters) — E2E", () => {
  it("0. unauthenticated → blocked (401/403/503)", async () => {
    const res = await h.reqNoAuth("GET", "/api/me/chapters");
    record("unauth blocked", [401, 403, 503].includes(res.status), `status ${res.status}`);
    expect([401, 403, 503]).toContain(res.status);
  });

  it("1. member → 200 with chapters array incl. seeded chapter", async () => {
    const res = await h.req("GET", "/api/me/chapters", { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const chapters = res.body?.chapters ?? [];
    record("chapters array", Array.isArray(chapters), typeof chapters);
    expect(Array.isArray(chapters)).toBe(true);
    const found = chapters.some((c) => c.id === h.ids.CHAPTER);
    record("seeded chapter present", found, chapters.map((c) => c.id).join(","));
    expect(found).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R4 chapters E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
