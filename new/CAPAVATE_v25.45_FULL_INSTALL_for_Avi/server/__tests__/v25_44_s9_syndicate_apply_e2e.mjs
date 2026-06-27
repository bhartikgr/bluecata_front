/* v25.44 S9 — Syndicate apply POST endpoint E2E (reuses collective_apps). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
import { rawDb } from "../db/connection.ts";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s9syn"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S9 syndicate apply — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("POST", "/api/collective/syndicate/apply");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("1. member → 201, persisted into collective_apps with syndicate kind", async () => {
    const r = await h.req("POST", "/api/collective/syndicate/apply", { userId: h.ids.MEMBER, body: { applicationType: "syndicate", chapterId: h.ids.CHAPTER, payload: { syndicateName: "Alpha Syndicate" } } });
    const ok = r.status === 201 && r.body?.applicationType === "syndicate";
    record("201 syndicate", ok, `status ${r.status}`);
    expect(ok).toBe(true);
    const row = rawDb().prepare("SELECT payload_json FROM collective_apps WHERE id = ?").get(r.body.id);
    const persisted = row && JSON.parse(row.payload_json).applicationType === "syndicate";
    record("persisted with applicationType=syndicate", !!persisted);
    expect(!!persisted).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S9 syndicate apply E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
