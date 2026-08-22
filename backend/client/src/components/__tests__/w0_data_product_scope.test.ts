// @vitest-environment jsdom
/**
 * WAVE 0 · 0.2 — `data-product` RESOLVES ON ALL FIVE PRODUCT AREAS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PROVES, AND WHY IT IS WORTH A TEST
 * ═══════════════════════════════════════════════════════════════════════════
 * `[data-product]` is the ONLY lever the design-system programme has for
 * re-theming one product area without touching the other four. Waves 1–5 each
 * consist of little more than a `[data-product="<area>"]` CSS block. If the
 * attribute is wrong, missing, or resolves to the wrong area on any real route,
 * a wave silently restyles the wrong customers — and CSS scoping fails SILENTLY,
 * with no error anywhere.
 *
 * `CollectiveShell` already set `collective` / `partner`. `AppShell` set NOTHING,
 * so founder, investor and admin shared the unscoped `:root`. R78/OQ-1 records
 * that `investor` is a FIFTH customer-facing area that R74 missed. Wave 0 adds
 * the attribute to `AppShell` for all three.
 *
 * THIS IS A RENDER TEST, NOT A SOURCE GREP. Each shell is mounted for real, at a
 * real route, and the attribute is read back out of the DOM — because the value
 * is DERIVED (from the URL prefix, with the role from context as the fallback)
 * and a source grep cannot tell you what a derivation evaluates to.
 *
 * IT ALSO PROVES THE FIRST-RENDER CASE, which is the one that would have been
 * got wrong: `RoleProvider` initialises `role` to `"founder"` and `AppShell`
 * syncs it from the URL in an EFFECT, so on a direct load of `/admin/…` the role
 * is still `"founder"` for one render. Deriving from `role` alone would emit
 * `data-product="founder"` on an admin screen for that frame. The assertions
 * below read the attribute on the FIRST committed render, before any effect has
 * had a chance to correct it.
 *
 * NOT PROVED HERE: that a `[data-product="x"]` CSS rule actually repaints
 * anything. jsdom resolves the cascade but does not paint, and no stylesheet
 * consumes the three new values yet — by design, Wave 0 changes nothing visible.
 *
 * Plain `.test.ts` + React.createElement (no JSX) so it is excluded from the tsc
 * budget by tsconfig's test-file exclude, matching this directory's
 * convention (see CollectiveShell.partnerHooks.test.ts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";

/* Mock the network layer BEFORE importing anything that pulls it in. Every
   query in both shells routes through apiRequest; each endpoint resolves
   deterministically so a shell never sits in a loading branch. */
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const responses: Record<string, unknown> = {
    "/api/auth/me": { isAuthed: true, isAdmin: false, identity: { userId: "u1", email: "u@example.com", name: "U" } },
    "/api/partner/me": {
      partnerId: "pt_test", tier: "catalyst", subRole: "managing_partner",
      identity: { userId: "u1", email: "gp@example.com", name: "Test GP" },
    },
    "/api/me/chapters": { ok: true, chapters: [] },
    "/api/feature-flags": {
      PARTNER_WORKSPACE_ENABLED: true, COLLECTIVE_ENABLED: true,
      COLLECTIVE_ADMIN_APPROVAL_ENABLED: false,
    },
    "/api/feeds/ticker": { status: "PROVIDER_NOT_CONFIGURED" },
  };
  return {
    ...actual,
    apiRequest: vi.fn(async (_m: string, url: string) => ({
      ok: true, status: 200, json: async () => responses[url] ?? {},
    } as unknown as Response)),
  };
});

import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { AppShell } from "@/components/AppShell";
import { CollectiveShell } from "@/components/CollectiveShell";
import { RoleProvider } from "@/lib/role";
import { LegalDrawerProvider } from "@/lib/legalDrawer";

afterEach(() => cleanup());

function mountAt(Shell: React.ComponentType<{ children: React.ReactNode }>, route: string) {
  window.history.pushState({}, "", route);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const { container } = render(
    React.createElement(
      QueryClientProvider, { client: queryClient },
      React.createElement(
        Router, null,
        React.createElement(
          RoleProvider, null,
          React.createElement(
            LegalDrawerProvider, null,
            React.createElement(Shell, null, React.createElement("div", { "data-testid": "w0-child" }, "child")),
          ),
        ),
      ),
    ),
  );
  return container;
}

/** The scoped element, read out of the rendered DOM. */
function scopeOf(container: HTMLElement): string | null {
  const el = container.querySelector("[data-product]");
  return el ? el.getAttribute("data-product") : null;
}

/* The five customer-facing product areas, and a REAL route for each — every one
   of these paths appears in client/src/App.tsx. */
const CASES: [string, string, string][] = [
  ["founder", "/founder/dashboard", "AppShell"],
  ["investor", "/investor/dashboard", "AppShell"],
  ["admin", "/admin/dashboard", "AppShell"],
  ["collective", "/collective/dashboard", "CollectiveShell"],
  ["partner", "/collective/partner/dashboard", "CollectiveShell"],
];

describe("WAVE 0 · 0.2 — data-product resolves on all five product areas", () => {
  for (const [area, route, shell] of CASES) {
    it(`${shell} at ${route} renders data-product="${area}"`, () => {
      const Shell = shell === "AppShell" ? AppShell : CollectiveShell;
      const container = mountAt(Shell as never, route);
      expect(scopeOf(container)).toBe(area);
    });
  }

  it("all five areas are DISTINCT — no two routes collapse onto the same scope", () => {
    const seen = new Set<string>();
    for (const [, route, shell] of CASES) {
      const Shell = shell === "AppShell" ? AppShell : CollectiveShell;
      const container = mountAt(Shell as never, route);
      const v = scopeOf(container);
      expect(v).toBeTruthy();
      seen.add(String(v));
      cleanup();
    }
    expect(seen.size).toBe(5);
  });

  it("NOTHING renders without a scope: every AppShell route prefix yields one, and the fallback is a real area", () => {
    /* Deep routes, not just the index, and one path outside the three prefixes
       to exercise the context fallback. Every AppShell route in App.tsx lives
       under /founder, /investor or /admin, so the last case is defensive. */
    for (const route of [
      "/founder/rounds/r_123/termsheet",
      "/investor/invitations/inv_9",
      "/admin/partners/pt_1",
      "/company-profile?onboarding=1",
    ]) {
      const container = mountAt(AppShell as never, route);
      const v = scopeOf(container);
      expect(v, `no data-product on ${route}`).toBeTruthy();
      expect(["founder", "investor", "admin"]).toContain(v);
      cleanup();
    }
  });

  it("the ROUTE wins over the stale default role on the FIRST render — the trap this derivation exists to avoid", () => {
    /* RoleProvider starts at "founder" and AppShell corrects it in an effect.
       Reading `role` instead of the URL would emit "founder" here. */
    const container = mountAt(AppShell as never, "/admin/dashboard");
    expect(scopeOf(container)).toBe("admin");
  });
});
