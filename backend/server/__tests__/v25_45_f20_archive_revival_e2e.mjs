/* v25.45 F20d — self-serve revival clears archive flags. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f20rev"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F20 revival — E2E", () => {
  it("archive then reactivate clears all archive flags", async () => {
    await h.req("POST", "/api/founder/workspace/archive", { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY } });
    const r = await h.req("POST", "/api/founder/workspace/reactivate", { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY } });
    const ok = r.status === 200 && r.body?.archiveStatus === "active";
    record("reactivate → active", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("DB flags cleared (archived_at NULL, retention NULL, status active)", async () => {
    const { getArchiveState } = await import("../lib/workspaceArchiveStore.ts");
    const st = getArchiveState(h.ids.COMPANY);
    const ok = st?.archiveStatus === "active" && st?.archivedAt === null && st?.archiveRetentionUntil === null;
    record("flags cleared", ok, JSON.stringify(st));
    expect(ok).toBe(true);
  });
  it("non-owner cannot archive (403)", async () => {
    const r = await h.req("POST", "/api/founder/workspace/archive", { userId: "u_not_owner_x", body: { companyId: h.ids.COMPANY } });
    record("non-owner archive blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F20 revival E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
