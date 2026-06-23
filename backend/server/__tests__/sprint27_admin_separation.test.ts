/**
 * Sprint 27 — Admin/public-login separation tests.
 *
 * Coverage:
 *   1. Public Login.tsx no longer has an "admin" portal tab.
 *   2. Public Login.tsx redirects ?portal=admin → /admin/login.
 *   3. Public Login.tsx rejects admin sign-in with a clear error message.
 *   4. AdminLogin.tsx exists at the expected location and renders an admin
 *      sign-in form with the correct test ids.
 *   5. AdminLogin.tsx rejects a non-admin account explicitly.
 *   6. App.tsx registers /admin/login as a bare-shell route.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, root), "utf-8");
}

describe("Sprint 27 — admin separation: public Login.tsx", () => {
  const src = read("client/src/pages/auth/Login.tsx");

  it("1. Portal type no longer includes 'admin'", () => {
    // The active Portal type is the founder + investor union only.
    expect(src).toMatch(/type Portal = "founder" \| "investor";/);
    // Must NOT have the legacy three-way union (admin variant removed).
    expect(src).not.toMatch(/type Portal = "founder" \| "investor" \| "admin";/);
  });

  it("2. Redirects ?portal=admin to /admin/login", () => {
    expect(src).toMatch(/navigate\("\/admin\/login"\)/);
    // Should be inside a useEffect that checks rawPortal === "admin"
    expect(src).toMatch(/rawPortal === "admin".*navigate\("\/admin\/login"\)/s);
  });

  it("3. Admin sign-in rejected with explicit error (no silent route)", () => {
    // After login if ctx.isAdmin, we set an error — do NOT auto-navigate to /admin/dashboard
    expect(src).toMatch(/Admin sign-in is on a separate page/);
    // The old auto-route to /admin/dashboard must be gone from the route() function
    const routeFn = src.slice(src.indexOf("function route(ctx: UserContext)"));
    const next200 = routeFn.slice(0, 1000);
    expect(next200).not.toMatch(/setRole\("admin"\);\s*navigate\("\/admin\/dashboard"\)/);
  });

  it("4. Demo personas no longer expose admin credentials", () => {
    // The DEMO_PRESETS constant must not contain admin@capavate.io
    const presetBlock = src.slice(src.indexOf("DEMO_PRESETS"), src.indexOf("];", src.indexOf("DEMO_PRESETS")) + 2);
    expect(presetBlock).not.toMatch(/admin@capavate\.io/);
  });

  it("5. Admin portal tab no longer appears in the UI", () => {
    // No "tab-portal-admin" test id should be rendered
    expect(src).not.toMatch(/tab-portal-admin/);
    // Submit button label no longer special-cases admin
    expect(src).not.toMatch(/portal === "admin"/);
  });
});

describe("Sprint 27 — admin separation: dedicated /admin/login page", () => {
  const src = read("client/src/pages/admin/Login.tsx");

  it("6. AdminLogin.tsx exists and is the default export", () => {
    expect(src).toMatch(/export default function AdminLogin/);
  });

  it("7. Posts to /api/auth/login and checks ctx.isAdmin", () => {
    expect(src).toMatch(/POST.*"\/api\/auth\/login"/);
    expect(src).toMatch(/json\.ctx\.isAdmin/);
  });

  it("8. Rejects non-admin accounts with an explicit error", () => {
    expect(src).toMatch(/not authorised for admin access/);
  });

  it("9. On successful admin auth, routes to /admin/dashboard", () => {
    expect(src).toMatch(/navigate\("\/admin\/dashboard"\)/);
  });

  it("10. Renders the restricted-access banner", () => {
    expect(src).toMatch(/banner-admin-restricted/);
    expect(src).toMatch(/All sign-in attempts here are logged/);
  });

  it("11. Has a 'back to public login' link", () => {
    expect(src).toMatch(/link-back-to-public-login/);
    expect(src).toMatch(/Back to founder \/ investor sign-in/);
  });

  it("12. Demo admin persona only visible with ?demo=1", () => {
    expect(src).toMatch(/demoMode = query\.get\("demo"\) === "1"/);
    expect(src).toMatch(/admin@capavate\.io/);
  });
});

describe("Sprint 27 — admin separation: App.tsx route registration", () => {
  const src = read("client/src/App.tsx");

  it("13. /admin/login is registered as a bare-shell auth route", () => {
    expect(src).toMatch(/path === "\/admin\/login"/);
    expect(src).toMatch(/<Route path="\/admin\/login" component=\{AdminLogin\} \/>/);
  });

  it("14. AdminLogin is imported", () => {
    expect(src).toMatch(/import AdminLogin from "@\/pages\/admin\/Login"/);
  });
});
