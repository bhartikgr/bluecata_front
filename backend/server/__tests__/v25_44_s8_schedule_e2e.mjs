/* v25.44 S8 — Schedule POST endpoint E2E (additive insert into chapter_announcements). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s8sched"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S8 schedule — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("POST", "/api/collective/schedule");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("1. missing chapterId → 400", async () => {
    const r = await h.req("POST", "/api/collective/schedule", { userId: h.ids.MEMBER, body: { title: "x" } });
    record("400 on missing chapterId", r.status === 400, `status ${r.status}`);
    expect(r.status).toBe(400);
  });
  it("2. member of chapter → 201 created", async () => {
    const r = await h.req("POST", "/api/collective/schedule", { userId: h.ids.MEMBER, body: { chapterId: h.ids.CHAPTER, title: "June meeting", date: "2026-07-01T18:00:00Z", attendees: [h.ids.MEMBER], rsvpTrack: true } });
    const ok = r.status === 201 && r.body?.ok === true && typeof r.body?.id === "string";
    record("201 created", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("3. non-chapter member → 403", async () => {
    const r = await h.req("POST", "/api/collective/schedule", { userId: h.ids.MEMBER, body: { chapterId: "chap_other_zzz", title: "x" } });
    record("cross-chapter blocked", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S8 schedule E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
