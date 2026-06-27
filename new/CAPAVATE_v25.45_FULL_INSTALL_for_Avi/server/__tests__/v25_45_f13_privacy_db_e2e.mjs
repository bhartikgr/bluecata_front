/* v25.45 F13a — privacy toggle persists to DB (DB-driven, not in-memory). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f13db"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F13a privacy DB — E2E", () => {
  it("PUT /api/founder/privacy persists toggles", async () => {
    const r = await h.req("PUT", "/api/founder/privacy", {
      userId: h.ids.FOUNDER,
      body: { screenName: "MayaC", visibleToCoMembers: false, visibleToCollectiveNetwork: true },
    });
    record("PUT privacy → ok", r.status === 200 && r.body?.ok, `status ${r.status}`);
    expect(r.status).toBe(200);
  });
  it("GET reflects persisted privacy", async () => {
    const r = await h.req("GET", "/api/founder/privacy", { userId: h.ids.FOUNDER });
    const p = r.body?.privacy ?? {};
    const ok = p.screenName === "MayaC" && p.visibleToCoMembers === false;
    record("GET privacy reflects DB", ok, JSON.stringify(p));
    expect(ok).toBe(true);
  });
  it("resolver reads the same DB-backed row", async () => {
    const { readUserPrivacy } = await import("../lib/userPrivacyResolver.ts");
    const p = readUserPrivacy(h.ids.FOUNDER);
    const ok = p.screenName === "MayaC" && p.visibleToCoMembers === false && p.visibleInCollectiveDirectory === true;
    record("resolver reads persisted privacy", ok, JSON.stringify(p));
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F13 db E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
