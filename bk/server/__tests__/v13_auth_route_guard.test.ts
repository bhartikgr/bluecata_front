/**
 * v13 — Avi's Issue 2: dashboard auth gate.
 *
 * "if a user copies the dashboard link and is logged out, accessing the
 *  dashboard page directly should not work unless the user is logged in.
 *  Please fix this — it's important."
 *
 * Two contract layers must hold:
 *   1. <RequireAuth> wraps every /founder/*, /investor/*, /admin/*, /collective/*
 *      route in App.tsx so an unauthenticated user is bounced to /auth/login.
 *   2. <RequireAuth> appends `?returnTo=<original-path>` to the redirect target
 *      so login can return the user to the page they tried to reach.
 *
 * Server-side requireAuth on /api/* routes is the matching backend guard.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("v13 B-V13-2 — route-level auth guard", () => {
  it("RequireAuth.tsx builds a returnTo redirect URL", () => {
    const src = read("client/src/components/RequireAuth.tsx");
    expect(src).toMatch(/B-V13-2 fix/);
    expect(src).toMatch(/buildLoginRedirect/);
    expect(src).toMatch(/returnTo=/);
    expect(src).toMatch(/encodeURIComponent/);
  });

  it("App.tsx wraps the founder dashboard in <RequireAuth>", () => {
    const src = read("client/src/App.tsx");
    expect(src).toMatch(/path="\/founder\/dashboard"/);
    // Founder dashboard line carries RequireAuth + RequireActiveSubscription
    expect(src).toMatch(/<RequireAuth><RequireActiveSubscription><FounderDashboard/);
  });

  it("App.tsx wraps every protected route group in <RequireAuth>", () => {
    const src = read("client/src/App.tsx");
    // Founder routes
    expect(src).toMatch(/===== FOUNDER ROUTES — RequireAuth/);
    // Investor routes
    expect(src).toMatch(/===== INVESTOR ROUTES — RequireAuth/);
    // Admin routes
    expect(src).toMatch(/===== ADMIN ROUTES — RequireAuth role="admin"/);
    // Collective routes
    expect(src).toMatch(/===== COLLECTIVE ROUTES — RequireAuth/);
  });

  it("server-side requireAuth middleware exists and is used", () => {
    const routes = read("server/routes.ts");
    expect(routes).toMatch(/requireAuth/);
  });

  it("buildLoginRedirect avoids redirect loops on auth pages", () => {
    const src = read("client/src/components/RequireAuth.tsx");
    expect(src).toMatch(/current\.startsWith\("\/auth"\)/);
  });
});
