/* v25.45 F20c — archived-workspace read-only middleware (403 enforcement).
 *
 * Asserts that once a founder workspace is archived:
 *   - mutating /api/founder/* requests return 403 WORKSPACE_ARCHIVED
 *   - GET /api/founder/* requests still succeed (read-only access preserved)
 *   - the reactivate escape-hatch is allow-listed and clears the archive flags
 *   - after reactivation, mutating requests are accepted again
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import { rawDb } from "../db/connection.ts";

let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f20c"); }, 60_000);
afterAll(async () => { await h.teardown(); });

function setArchived(companyId, status) {
  rawDb().prepare(
    `UPDATE companies SET archive_status = ?, archived_at = ?, archive_retention_until = ? WHERE id = ?`,
  ).run(
    status,
    status === "archived" ? new Date().toISOString() : null,
    status === "archived" ? new Date(Date.now() + 8 * 365.25 * 864e5).toISOString() : null,
    companyId,
  );
}

describe("v25.45 F20c archive middleware — E2E", () => {
  it("1. active workspace: PATCH profile is accepted", async () => {
    setArchived(h.ids.COMPANY, "active");
    const r = await h.patchProfile({ ma: { uniqueValueProposition: "Active edit ok." } });
    const ok = r.status === 200;
    record("active → PATCH 200", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("2. archived workspace: mutating founder request → 403 WORKSPACE_ARCHIVED", async () => {
    setArchived(h.ids.COMPANY, "archived");
    // A non-exempt mutating /api/founder/* endpoint (workspace/archive itself is
    // not allow-listed) must be rejected with 403 while the workspace is archived.
    const r2 = await h.req("POST", "/api/founder/workspace/archive", { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY } });
    const ok = r2.status === 403 && r2.body?.error === "WORKSPACE_ARCHIVED";
    record("archived → mutating 403 WORKSPACE_ARCHIVED", ok, `status ${r2.status} err ${r2.body?.error}`);
    expect(ok).toBe(true);
  });

  it("3. archived workspace: GET archive-status still succeeds (read-only access)", async () => {
    const r = await h.req("GET", `/api/founder/workspace/archive-status?companyId=${h.ids.COMPANY}`, { userId: h.ids.FOUNDER });
    const ok = r.status === 200 && r.body?.archiveStatus === "archived";
    record("archived → GET status 200", ok, `status ${r.status} st ${r.body?.archiveStatus}`);
    expect(ok).toBe(true);
  });

  it("4. reactivate escape-hatch is allow-listed and clears archive flags", async () => {
    const r = await h.req("POST", "/api/founder/workspace/reactivate", { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY } });
    const ok = r.status === 200 && r.body?.archiveStatus === "active";
    record("reactivate → 200 active", ok, `status ${r.status} st ${r.body?.archiveStatus}`);
    expect(ok).toBe(true);
  });

  it("5. after reactivation, mutating requests accepted again", async () => {
    const r = await h.req("POST", "/api/founder/workspace/archive", { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY } });
    const ok = r.status === 200 && r.body?.archiveStatus === "archived";
    record("post-reactivate mutating accepted", ok, `status ${r.status}`);
    // leave it archived; cleanup not required
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F20c middleware E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
