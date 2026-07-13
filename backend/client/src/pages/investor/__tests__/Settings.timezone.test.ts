// @vitest-environment jsdom
/**
 * AVI-TZ (Wave 3) — investor Settings timezone display precedence.
 *
 * DEFECT: the timezone SAVES server-side (PATCH /api/auth/me → 200, survives
 * re-login) but the Settings UI showed the BROWSER default because `tzValue`
 * was seeded from Intl and the persisted `me.timezone` was only applied via a
 * racy effect. FIX: the persisted `me.timezone` is the source of truth (browser
 * tz is a fallback used ONLY when nothing is saved); the edit buffer is seeded
 * from the saved value.
 *
 * These tests render the REAL InvestorSettings page and assert:
 *   1) given me.timezone set to a value DIFFERENT from the browser tz, the
 *      view shows the SAVED value (not the browser default);
 *   2) with me.timezone UNSET, the view falls back to the browser tz.
 *
 * Written without JSX (React.createElement) as a plain `.test.ts` so it is
 * picked up by vitest's client glob but excluded from the tsc budget by the
 * tsconfig test-file exclude (601/598 baseline intact).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

// Force a deterministic "browser" timezone that is NOT the saved value, so a
// failure to prefer the persisted value is observable.
const BROWSER_TZ = "America/Toronto";
const SAVED_TZ = "Asia/Tokyo";

beforeEach(() => {
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
    () => ({ resolvedOptions: () => ({ timeZone: BROWSER_TZ }) }) as unknown as Intl.DateTimeFormat,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

// Mock the realtime SSE hook (no network / EventSource in jsdom).
vi.mock("@/lib/realtimeSync", () => ({ useRealtimeSync: () => {} }));

// Mock the accreditation card (its own queries are irrelevant to this test).
vi.mock("@/components/investor/AccreditationDeclaration", () => ({
  AccreditationDeclaration: () => React.createElement("div", { "data-testid": "accred-stub" }),
}));

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { RoleProvider } from "@/lib/role";
import InvestorSettings from "@/pages/investor/Settings";

function renderSettings(meData: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        // The page uses useQuery({ queryKey: ["/api/auth/me"] }) with no
        // explicit queryFn, relying on the client default. Provide one here.
        queryFn: async () => meData,
      },
    },
  });
  window.history.pushState({}, "", "/investor/settings");
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        Router,
        null,
        React.createElement(RoleProvider, null, React.createElement(InvestorSettings, null)),
      ),
    ),
  );
}

describe("AVI-TZ — investor Settings displays the persisted timezone", () => {
  it("shows the SAVED me.timezone (not the browser default) when set", async () => {
    renderSettings({ id: "u_test", timezone: SAVED_TZ });
    // View-mode paragraph renders the effective saved tz.
    const shown = await screen.findByText(new RegExp(SAVED_TZ));
    expect(shown).toBeTruthy();
    // The browser default must NOT be what is displayed.
    expect(screen.queryByText(new RegExp(BROWSER_TZ))).toBeNull();
  });

  it("seeds the edit Select from the saved value when entering edit mode", async () => {
    renderSettings({ id: "u_test", timezone: SAVED_TZ });
    // Wait for the persisted value to hydrate the view (not the browser default).
    await screen.findByText(new RegExp(SAVED_TZ));
    const editBtn = await screen.findByTestId("button-edit-timezone");
    fireEvent.click(editBtn);
    // The Radix Select trigger shows the currently-selected value = saved tz.
    const trigger = await screen.findByTestId("select-timezone");
    await waitFor(() => expect(trigger.textContent).toContain(SAVED_TZ));
  });

  it("falls back to the browser timezone when me.timezone is UNSET", async () => {
    renderSettings({ id: "u_test" });
    const shown = await screen.findByText(new RegExp(BROWSER_TZ));
    expect(shown).toBeTruthy();
  });
});
