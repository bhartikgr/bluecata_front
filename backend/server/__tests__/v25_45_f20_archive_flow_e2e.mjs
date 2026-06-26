/* v25.45 F20 — archive flow + retention + revival. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f20arch"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F20 archive flow — E2E", () => {
  it("POST /archive sets archived_at, status=archived, retention=+8yrs", async () => {
    const r = await h.req("POST", "/api/founder/workspace/archive", {
      userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY },
    });
    const ok = r.status === 200 && r.body?.archiveStatus === "archived"
      && !!r.body?.archivedAt && !!r.body?.archiveRetentionUntil;
    record("archive sets flags", ok, `status ${r.status} ${r.body?.archiveStatus}`);
    expect(ok).toBe(true);
  });
  it("retention is exactly archived_at + 8 years", async () => {
    const { computeRetentionUntil, getArchiveState } = await import("../lib/workspaceArchiveStore.ts");
    const st = getArchiveState(h.ids.COMPANY);
    const expected = computeRetentionUntil(st.archivedAt);
    const ay = new Date(st.archivedAt).getUTCFullYear();
    const ry = new Date(st.archiveRetentionUntil).getUTCFullYear();
    const ok = st.archiveRetentionUntil === expected && (ry - ay) === 8;
    record("retention = +8 years", ok, `${ay} → ${ry}`);
    expect(ok).toBe(true);
  });
  it("archive captures last_active_plan for revival pre-select", async () => {
    const { getArchiveState } = await import("../lib/workspaceArchiveStore.ts");
    const st = getArchiveState(h.ids.COMPANY);
    // last_active_plan may be null if no subscription row exists; column must be present.
    const ok = st !== null && "lastActivePlan" in st;
    record("last_active_plan captured field present", ok, `plan=${st?.lastActivePlan}`);
    expect(ok).toBe(true);
  });
  it("DB row reflects archived state", async () => {
    const { getArchiveState } = await import("../lib/workspaceArchiveStore.ts");
    const st = getArchiveState(h.ids.COMPANY);
    record("DB archive_status=archived", st?.archiveStatus === "archived", `${st?.archiveStatus}`);
    expect(st?.archiveStatus).toBe("archived");
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F20 archive E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
