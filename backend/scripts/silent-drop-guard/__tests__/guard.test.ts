/**
 * scripts/silent-drop-guard/__tests__/guard.test.ts
 *
 * Tests for the Anti-Silent-Drop Build Guard.
 *
 * Run explicitly (this path is outside the default vitest `include` globs):
 *   npx vitest run scripts/silent-drop-guard/__tests__/guard.test.ts
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runGuard } from "../guard.ts";
import { buildInventory, type Inventory } from "../extract-inventory.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function baselineFrom(inv: Inventory) {
  return {
    generatedAt: "test",
    gitHead: "test",
    routes: inv.routes,
    clientRoutes: inv.clientRoutes,
    nav: inv.nav,
  };
}

const emptyAllowlist = { removedRoutes: [], removedClientRoutes: [], removedNav: [] };

describe("silent-drop guard — runGuard()", () => {
  const base: Inventory = {
    routes: ["GET /api/a", "POST /api/b", "DELETE /api/c"],
    clientRoutes: ["/x", "/y"],
    nav: ["/x\tX", "/y\tY"],
  };

  it("(a) identical inventory → exit 0", () => {
    const { code, report } = runGuard({
      baseline: baselineFrom(base),
      current: base,
      allowlist: emptyAllowlist,
    });
    expect(code).toBe(0);
    expect(report).toMatch(/no silent drops/);
    expect(report).toContain("3 routes, 2 pages, 2 nav");
  });

  it("(b) a removed route NOT in allowlist → exit 1 and names it", () => {
    const current: Inventory = {
      ...base,
      routes: ["GET /api/a", "DELETE /api/c"], // POST /api/b dropped
    };
    const { code, report } = runGuard({
      baseline: baselineFrom(base),
      current,
      allowlist: emptyAllowlist,
    });
    expect(code).toBe(1);
    expect(report).toContain("SILENT DROP DETECTED");
    expect(report).toContain("POST /api/b");
  });

  it("(c) a removed route present in allowlist (object form) → exit 0", () => {
    const current: Inventory = { ...base, routes: ["GET /api/a", "DELETE /api/c"] };
    const { code } = runGuard({
      baseline: baselineFrom(base),
      current,
      allowlist: {
        removedRoutes: [
          { id: "POST /api/b", reason: "deprecated", approvedBy: "Ozan", date: "2026-07-09" },
        ],
        removedClientRoutes: [],
        removedNav: [],
      },
    });
    expect(code).toBe(0);
  });

  it("(c2) allowlist plain-string id form also works → exit 0", () => {
    const current: Inventory = { ...base, routes: ["GET /api/a", "DELETE /api/c"] };
    const { code } = runGuard({
      baseline: baselineFrom(base),
      current,
      allowlist: { removedRoutes: ["POST /api/b"], removedClientRoutes: [], removedNav: [] },
    });
    expect(code).toBe(0);
  });

  it("(d) an ADDED route → exit 0 (informational)", () => {
    const current: Inventory = {
      ...base,
      routes: [...base.routes, "GET /api/new"],
    };
    const { code, report } = runGuard({
      baseline: baselineFrom(base),
      current,
      allowlist: emptyAllowlist,
    });
    expect(code).toBe(0);
    expect(report).toContain("INFO:");
    expect(report).toContain("GET /api/new");
  });

  it("removed client route → exit 1 and names it", () => {
    const current: Inventory = { ...base, clientRoutes: ["/x"] };
    const { code, report } = runGuard({
      baseline: baselineFrom(base),
      current,
      allowlist: emptyAllowlist,
    });
    expect(code).toBe(1);
    expect(report).toContain("/y");
  });

  it("removed nav entry → exit 1 and names it", () => {
    const current: Inventory = { ...base, nav: ["/x\tX"] };
    const { code, report } = runGuard({
      baseline: baselineFrom(base),
      current,
      allowlist: emptyAllowlist,
    });
    expect(code).toBe(1);
    expect(report).toContain("/y");
  });
});

describe("silent-drop guard — extractor determinism", () => {
  it("(e) extractor output is sorted, de-duped and stable across runs", () => {
    const a = buildInventory(REPO_ROOT);
    const b = buildInventory(REPO_ROOT);
    // Stable across runs.
    expect(a).toEqual(b);
    for (const key of ["routes", "clientRoutes", "nav"] as const) {
      const arr = a[key];
      // Sorted.
      const sorted = [...arr].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
      expect(arr).toEqual(sorted);
      // De-duped.
      expect(new Set(arr).size).toBe(arr.length);
      // Non-empty (sanity — repo has real inventory).
      expect(arr.length).toBeGreaterThan(0);
    }
  });

  it("real repo inventory meets-or-exceeds the committed baseline counts", () => {
    // Additive philosophy (rule #8): the inventory may only GROW. Assert
    // monotonic floors (923/192/91 at guard inception) instead of brittle exact
    // counts, so legitimate new endpoints/pages/nav never fail this test. A DROP
    // below the committed baseline is caught by the guard's disappearance check
    // (see cases b/c above) and by server/__tests__/anti_silent_drop.test.ts.
    const inv = buildInventory(REPO_ROOT);
    expect(inv.routes.length).toBeGreaterThanOrEqual(923);
    expect(inv.clientRoutes.length).toBeGreaterThanOrEqual(192);
    // WAVE 2B / BLOCKER 3 — floor lowered 91 -> 90. The 91st entry was the nav
    // id "/collective/partner/contacts\tContacts". That label was renamed to
    // "Contacts (CRM)" in v26.1.x; the route and page are unchanged and still
    // reachable. Because the guard keys nav on href+label, the rename reads as
    // one id out and one id in — a net count of 90 with the old id allowlisted.
    // See scripts/silent-drop-guard/allowlist.json → removedNav[0]
    // (approvedBy "Ozan", date "2026-07-09"). The floor, not the guard, was
    // stale: the disappearance itself was already approved.
    expect(inv.nav.length).toBeGreaterThanOrEqual(90);
  });
});
