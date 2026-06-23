/**
 * Wave C / FIX C7 — Admin sidebar route coverage + 404 polish.
 *
 * A-FINAL-023 (Avi, 24-May-2026): live QA reported that `/admin/lifecycle`
 * and `/admin/chapters` rendered the generic dev placeholder ("Did you
 * forget to add the page to the router?") instead of an admin-aware 404.
 * The sidebar nav link is `/admin/lifecycle-policies` — visitors who
 * pasted the shorter URL hit the bare placeholder.
 *
 * The Wave C fix does THREE things in client/src/App.tsx:
 *   1. Adds an explicit alias `/admin/lifecycle` → `/admin/lifecycle-policies`.
 *   2. Adds an `/admin/:rest*` catch-all rendering the polished
 *      `AdminNotFound` component for unregistered admin paths.
 *   3. Confirms every admin sidebar link (defined in
 *      client/src/components/AppShell.tsx:adminNav) has a corresponding
 *      registered route in App.tsx.
 *
 * This test is a string-level audit of App.tsx + AppShell.tsx (the same
 * harness used in unauthRouteHardening.test.ts) so we can run it without
 * a JSDOM client-render harness. Math-sacred guarantee: no cap-table
 * state touched.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_PATH = path.resolve(__dirname, "../../client/src/App.tsx");
const SHELL_PATH = path.resolve(__dirname, "../../client/src/components/AppShell.tsx");
const ADMIN_404_PATH = path.resolve(__dirname, "../../client/src/pages/admin/AdminNotFound.tsx");
const APP = fs.readFileSync(APP_PATH, "utf8");
const SHELL = fs.readFileSync(SHELL_PATH, "utf8");

/** Extract every `href: "/admin/..."` literal from the `adminNav` block. */
function extractAdminSidebarLinks(shellSrc: string): string[] {
  const adminNavStart = shellSrc.indexOf("const adminNav");
  expect(adminNavStart).toBeGreaterThan(-1);
  const next = shellSrc.indexOf("function ", adminNavStart);
  const slice = shellSrc.slice(adminNavStart, next > -1 ? next : shellSrc.length);
  const links = Array.from(slice.matchAll(/href:\s*"(\/admin\/[^"]+)"/g)).map(
    (m) => m[1],
  );
  return Array.from(new Set(links));
}

/** Extract every `<Route path="/admin/..."` URL from App.tsx. */
function extractAdminRoutes(appSrc: string): string[] {
  const matches = Array.from(
    appSrc.matchAll(/<Route\s+path="(\/admin\/[^"]+)"/g),
  ).map((m) => m[1]);
  return Array.from(new Set(matches));
}

describe("Wave C FIX C7 — admin sidebar route coverage + 404 polish", () => {
  it("AdminNotFound component file exists", () => {
    expect(fs.existsSync(ADMIN_404_PATH)).toBe(true);
    const src = fs.readFileSync(ADMIN_404_PATH, "utf8");
    expect(src).toMatch(/data-testid="admin-not-found"/);
    expect(src).toMatch(/\/admin\/dashboard/);
    expect(src).toMatch(/\/admin\/lifecycle-policies/);
  });

  it("App.tsx imports AdminNotFound", () => {
    expect(APP).toMatch(/from\s+["']@\/pages\/admin\/AdminNotFound["']/);
  });

  it("App.tsx registers the /admin/lifecycle legacy alias route", () => {
    expect(APP).toMatch(/path="\/admin\/lifecycle"/);
    // The handler must redirect to the canonical URL.
    const idx = APP.indexOf('path="/admin/lifecycle"');
    const window = APP.slice(idx, idx + 200);
    expect(window).toMatch(/Redirect[^>]*to="\/admin\/lifecycle-policies"/);
  });

  it("App.tsx registers the /admin/:rest* catch-all rendering AdminNotFound", () => {
    expect(APP).toMatch(/path="\/admin\/:rest\*"/);
    const idx = APP.indexOf('path="/admin/:rest*"');
    const window = APP.slice(idx, idx + 300);
    expect(window).toContain("AdminNotFound");
    // Catch-all must be gated by RequireAuth role="admin" so the unauth
    // shell-leak guarantee from FIX C6 still holds.
    expect(window).toMatch(/RequireAuth[^>]*role="admin"/);
  });

  it("every admin sidebar link is registered as a route in App.tsx", () => {
    const links = extractAdminSidebarLinks(SHELL);
    const routes = extractAdminRoutes(APP);
    // Routes use exact or prefix matching (wouter). For each link we look
    // for either an exact registered path OR a registered prefix the link
    // would match.
    const missing = links.filter((link) => {
      if (routes.includes(link)) return true ? false : true;
      // Prefix match: e.g. /admin/companies/:id covers /admin/companies.
      // For coverage of static sidebar links, an exact match is required
      // OR a parametric variant whose static prefix is the link.
      const prefixMatch = routes.some(
        (r) => r === link || r.startsWith(link + "/"),
      );
      return !prefixMatch;
    });
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.error("Admin sidebar links without a registered route:", missing);
    }
    expect(missing).toEqual([]);
  });

  it("each canonical admin link the audit named is registered", () => {
    // Hard-coded subset Avi explicitly called out in A-FINAL-023 so a
    // future rename doesn't silently re-break the link.
    const canonical = [
      "/admin/dashboard",
      "/admin/companies",
      "/admin/investors",
      "/admin/users",
      "/admin/formulas",
      "/admin/regions",
      "/admin/lifecycle-policies",
      "/admin/reconciliation",
      "/admin/telemetry",
      "/admin/audit-log",
      "/admin/audit-chain-verify",
      "/admin/consortium-applications",
      "/admin/bridge",
      "/admin/sync",
      "/admin/migration",
      "/admin/email",
      "/admin/notifications",
      "/admin/pricing",
    ];
    for (const c of canonical) {
      expect(APP, `${c} should be registered`).toMatch(
        new RegExp(`path="${c.replace(/\//g, "\\/")}"`),
      );
    }
  });

  it("/admin/lifecycle legacy alias appears BEFORE the /admin/:rest* catch-all", () => {
    const aliasIdx = APP.indexOf('path="/admin/lifecycle"');
    const catchAllIdx = APP.indexOf('path="/admin/:rest*"');
    expect(aliasIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeGreaterThan(-1);
    // wouter <Switch> matches the FIRST matching <Route>, so the alias
    // must appear above the catch-all.
    expect(aliasIdx).toBeLessThan(catchAllIdx);
  });

  it("/admin/:rest* catch-all appears BEFORE the global NotFoundOrLogin catch-all", () => {
    const adminCatchIdx = APP.indexOf('path="/admin/:rest*"');
    const globalCatchIdx = APP.indexOf("<Route component={NotFoundOrLogin}");
    expect(adminCatchIdx).toBeGreaterThan(-1);
    expect(globalCatchIdx).toBeGreaterThan(-1);
    expect(adminCatchIdx).toBeLessThan(globalCatchIdx);
  });

  it("AdminNotFound provides a back-to-dashboard CTA", () => {
    const src = fs.readFileSync(ADMIN_404_PATH, "utf8");
    expect(src).toMatch(/Back to Admin Dashboard/);
    expect(src).toMatch(/href="\/admin\/dashboard"/);
  });
});
