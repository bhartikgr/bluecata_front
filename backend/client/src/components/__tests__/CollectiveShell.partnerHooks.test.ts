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
/* WAVE 37 — static imports (never dynamic) for the source-side pole of the
 * brand-label assertion; see the note in the test body. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

    /* WAVE 37 — STALE SELECTOR. The code is right; the probe named a element
     * that no longer exists.
     *
     * The sanity check read `[data-testid="brand-chip"]` and looked for the
     * string "CONSORTIUM". W-LOGO replaced the old "C" tile plus inline
     * CONSORTIUM/COLLECTIVE badge with the real Capavate logo and the product
     * name written underneath — `client/src/components/CollectiveShell.tsx:369-383`,
     * where the comment records the swap. The element is now
     * `brand-block` / `brand-product-label`, and a partner-only session reads
     * "Consortium Partner" rather than the shouted "CONSORTIUM".
     *
     * STRENGTHENED. The old line was a one-sided substring check: a shell that
     * hard-coded the consortium wording for EVERY session would have satisfied
     * it, and mislabelling a Collective member's sidebar is precisely the
     * dual-role confusion the branch exists to prevent. This now pins the
     * exact rendered label, asserts the OTHER pole's wording is absent from
     * the brand block, and — because a single render can only exercise one
     * branch — confirms from source that the label is driven by `partnerOnly`
     * and that the two arms are genuinely different strings. */
    const brand = screen.getByTestId("brand-block");
    const label = screen.getByTestId("brand-product-label");
    expect(brand).toBeTruthy();
    // Partner-only session: this pole, exactly.
    expect(label.textContent?.trim()).toBe("Consortium Partner");
    // ...and NOT the Collective pole. A hard-coded label fails one of these.
    expect(brand.textContent).not.toContain("Collective");
    // The retired chip must not come back alongside the new block.
    expect(screen.queryByTestId("brand-chip")).toBeNull();

    // Both arms exist and differ — a single render cannot show this.
    const shellSrc = readFileSync(
      resolve(__dirname, "../CollectiveShell.tsx"),
      "utf8",
    );
    expect(shellSrc).toContain('data-testid="brand-product-label"');
    expect(shellSrc).toMatch(
      /partnerOnly\s*\?\s*"Consortium Partner"\s*:\s*"Collective"/,
    );
  });
});
