// @vitest-environment jsdom
/**
 * Regression test for the P0 "Minified React error #310" crash.
 *
 * ROOT CAUSE (client/src/components/CollectiveShell.tsx): inside
 * CollectiveSidebar, `useCollectiveMembershipActive()` was called on the RHS of
 *   const partnerOnly = partner.isPartner && !useCollectiveMembershipActive();
 * The `&&` short-circuits, so the hook was SKIPPED while the soft
 * `usePartnerMembership()` probe was still pending (isPartner === false) and
 * then CALLED once the probe resolved to a real partner (isPartner === true).
 * The hook count changed between renders → "Rendered more hooks than during the
 * previous render" (React #310 in production builds), crashing the entire
 * partner workspace on every page.
 *
 * This test renders the REAL CollectiveShell and drives the exact
 * pending→resolved transition of /api/partner/me. Before the fix it throws
 * the hooks-order error during the second render; after the fix the partner
 * nav renders normally.
 *
 * Written without JSX (React.createElement) and as a plain .test.ts file so it
 * is picked up by vitest's client test glob but excluded from the tsc budget by
 * the tsconfig test-file exclude, keeping the 601 baseline intact.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

// Mock the network layer BEFORE importing anything that pulls it in.
// Every query in the shell (partner probe, chapters, feature-flags, ticker)
// routes through apiRequest; we resolve each endpoint deterministically.
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  const responses: Record<string, unknown> = {
    // A real, active partner identity — this is what flips isPartner false→true.
    "/api/partner/me": {
      partnerId: "pt_test",
      tier: "catalyst",
      subRole: "managing_partner",
      identity: { userId: "u_test", email: "gp@example.com", name: "Test GP" },
    },
    // Empty chapters ⇒ NOT an active collective member ⇒ partner-only mode.
    "/api/me/chapters": { ok: true, chapters: [] },
    "/api/feature-flags": {
      PARTNER_WORKSPACE_ENABLED: true,
      COLLECTIVE_ENABLED: false,
      COLLECTIVE_ADMIN_APPROVAL_ENABLED: false,
    },
    "/api/feeds/ticker": { status: "PROVIDER_NOT_CONFIGURED" },
  };
  return {
    ...actual,
    apiRequest: vi.fn(async (_method: string, url: string) => {
      const body = responses[url] ?? {};
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as unknown as Response;
    }),
  };
});

import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { CollectiveShell } from "@/components/CollectiveShell";
import { RoleProvider } from "@/lib/role";
import { LegalDrawerProvider } from "@/lib/legalDrawer";

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // Drive wouter to a partner-workspace route so isMemberGateExempt() is true
  // (the member gate is bypassed) and the partner-only sidebar branch is taken.
  window.history.pushState({}, "", "/collective/partner/dashboard");
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        Router,
        null,
        React.createElement(
          RoleProvider,
          null,
          React.createElement(
            LegalDrawerProvider,
            null,
            React.createElement(
              CollectiveShell,
              null,
              React.createElement("div", { "data-testid": "child" }, "child"),
            ),
          ),
        ),
      ),
    ),
  );
}

describe("CollectiveShell partner hooks-order (React #310 regression)", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the partner workspace nav after /api/partner/me resolves without a hooks-order crash", async () => {
    renderShell();
    // findBy* waits for the async pending→resolved transition. With the bug the
    // second render throws React #310 and this never resolves; with the fix the
    // partner nav mounts cleanly.
    const dashNav = await screen.findByTestId(
      "nav-partner-dashboard",
      {},
      { timeout: 4000 },
    );
    expect(dashNav).toBeTruthy();
    // Sanity: partner-only mode is active (CONSORTIUM brand chip).
    expect(screen.getByTestId("brand-chip").textContent).toContain("CONSORTIUM");
  });
});
