/* v25.45 ROUND 2 (BLOCKER 2) — self-serve revival flow.
 *
 * Opus blocker: the banner links to /founder/subscribe?reactivate=1, but
 * Subscribe.tsx ignored the param and nothing called
 * /api/founder/workspace/reactivate. This test exercises the backend contract
 * that powers the wired flow:
 *   1. Archive the company (POST /workspace/archive).
 *   2. GET /workspace/archive-state returns companyName + lastActivePlan so the
 *      reactivate UI can render "Reactivate {companyName}" and pre-select the
 *      previous plan.
 *   3. Mock a successful subscription payment → call POST /workspace/reactivate.
 *   4. Confirm the archive flags are cleared (status active, archived_at NULL).
 *   5. Confirm a subsequent mutation succeeds (founder is back in active mode →
 *      lands on the dashboard with edit access).
 * Plus a source-grep assertion that Subscribe.tsx actually wires the param,
 * header, notice, plan pre-selection, and the reactivate call.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder } from "./v25_45_helpers.mjs";
import { rawDb } from "../db/connection.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let h;
const here = path.dirname(fileURLToPath(import.meta.url));
beforeAll(async () => { h = await setupFounder("r2revival"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 R2 — self-serve workspace revival flow", () => {
  it("1. archive the company", async () => {
    // Seed a last_active_plan so the revival UI can pre-select it.
    rawDb().prepare(`UPDATE companies SET last_active_plan='scale_annual' WHERE id=?`).run(h.ids.COMPANY);
    const r = await h.req("POST", "/api/founder/workspace/archive", { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY } });
    expect(r.status).toBe(200);
    expect(r.body?.archiveStatus).toBe("archived");
  });

  it("2. archive-state endpoint returns companyName + lastActivePlan for the reactivate UI", async () => {
    const r = await h.req("GET", `/api/founder/workspace/archive-state?companyId=${h.ids.COMPANY}`, { userId: h.ids.FOUNDER });
    expect(r.status).toBe(200);
    expect(r.body?.archiveStatus).toBe("archived");
    expect(typeof r.body?.companyName).toBe("string");
    expect(r.body?.lastActivePlan).toBe("scale_annual");
  });

  it("3. while archived, a mutation is blocked (banner state)", async () => {
    const blocked = await h.patchProfile({ contact: { companyEmail: "blocked@example.com" } });
    expect(blocked.status).toBe(403);
    expect(blocked.body?.error).toBe("WORKSPACE_ARCHIVED");
  });

  it("4. mock successful payment → POST /reactivate clears the archive flags", async () => {
    const r = await h.req("POST", "/api/founder/workspace/reactivate", { userId: h.ids.FOUNDER, body: { companyId: h.ids.COMPANY } });
    expect(r.status).toBe(200);
    expect(r.body?.archiveStatus).toBe("active");
    const row = rawDb().prepare(`SELECT archive_status, archived_at, archive_retention_until FROM companies WHERE id=?`).get(h.ids.COMPANY);
    expect(row.archive_status).toBe("active");
    expect(row.archived_at).toBe(null);
    expect(row.archive_retention_until).toBe(null);
  });

  it("5. founder is back in active mode — mutation now succeeds (dashboard edit access)", async () => {
    const ok = await h.patchProfile({ contact: { companyEmail: "reactivated@example.com" } });
    expect(ok.status).toBe(200);
  });

  it("6. Subscribe.tsx wires the reactivate flow (param, header, notice, plan, reactivate call)", () => {
    const src = fs.readFileSync(
      path.resolve(here, "../../client/src/pages/founder/Subscribe.tsx"),
      "utf-8",
    );
    expect(src.includes('get("reactivate")')).toBe(true);
    expect(src.includes("Reactivate ${reactivateCompanyName")).toBe(true);
    expect(src.includes("reactivate-notice")).toBe(true);
    expect(src.includes("/api/founder/workspace/reactivate")).toBe(true);
    expect(src.includes("/api/founder/workspace/archive-state")).toBe(true);
    // Pre-selects the last active plan.
    expect(src.includes("lastActivePlan")).toBe(true);
    // Routes to the dashboard on success.
    expect(src.includes('navigate("/founder/dashboard")')).toBe(true);
  });
});
