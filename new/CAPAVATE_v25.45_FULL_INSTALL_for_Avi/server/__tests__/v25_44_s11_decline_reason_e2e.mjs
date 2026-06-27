/* v25.44 S11 — Decline-with-reason endpoint E2E (writes declined_reason column). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
import { rawDb } from "../db/connection.ts";
let h; const { results, record } = recorder();
let appId;
beforeAll(async () => {
  h = await setup("s11dec");
  appId = `capp_test_${Date.now()}`;
  const now = new Date().toISOString();
  rawDb().prepare(`INSERT INTO collective_apps (id, tenant_id, chapter_id, user_id, status, payload_json, submitted_at, created_at) VALUES (?, ?, ?, ?, 'submitted', '{}', ?, ?)`)
    .run(appId, `tenant_chap_${h.ids.CHAPTER}`, h.ids.CHAPTER, h.ids.MEMBER, now, now);
}, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S11 decline-with-reason — E2E", () => {
  it("0. non-admin → 403", async () => {
    const r = await h.req("POST", `/api/admin/applications/${appId}/decline`, { userId: h.ids.MEMBER, body: { reason: "x" } });
    record("member blocked", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });
  it("1. admin missing reason → 400", async () => {
    const r = await h.req("POST", `/api/admin/applications/${appId}/decline`, { userId: h.ids.ADMIN, body: {} });
    record("400 on missing reason", r.status === 400, `status ${r.status}`);
    expect(r.status).toBe(400);
  });
  it("2. admin with reason → 200 + persisted declined_reason", async () => {
    const r = await h.req("POST", `/api/admin/applications/${appId}/decline`, { userId: h.ids.ADMIN, body: { reason: "Not a sector fit" } });
    const ok = r.status === 200 && r.body?.status === "rejected";
    record("200 rejected", ok, `status ${r.status}`);
    expect(ok).toBe(true);
    const row = rawDb().prepare("SELECT status, declined_reason FROM collective_apps WHERE id = ?").get(appId);
    const persisted = row?.status === "rejected" && row?.declined_reason === "Not a sector fit";
    record("declined_reason persisted", !!persisted, JSON.stringify(row));
    expect(!!persisted).toBe(true);
  });
  it("3. unknown id → 404", async () => {
    const r = await h.req("POST", `/api/admin/applications/nope_xyz/decline`, { userId: h.ids.ADMIN, body: { reason: "y" } });
    record("404 unknown", r.status === 404, `status ${r.status}`);
    expect(r.status).toBe(404);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S11 decline-reason E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
