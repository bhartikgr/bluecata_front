// @vitest-environment jsdom
/**
 * AVI-TZ (Wave 3) — founder Settings timezone display precedence.
 *
 * Founder Settings shares the same timezone pattern as the investor Settings:
 * the Select was seeded from the browser tz (detectBrowserTimezone) and NEVER
 * hydrated from the persisted `me.timezone`, so it always showed the browser
 * default. FIX (mirrors the investor fix): hydrate the timezone Select from the
 * persisted `me.timezone`, using the browser tz only as a fallback when nothing
 * is saved.
 *
 * These tests render the REAL founder Settings page (Profile tab is the default
 * view, where the timezone Select lives) and assert:
 *   1) with me.timezone set to a value DIFFERENT from the browser tz, the Select
 *      shows the SAVED value;
 *   2) with me.timezone UNSET, it falls back to the browser tz.
 *
 * Plain `.test.ts` + React.createElement (no JSX) so it is excluded from the
 * tsc budget by the tsconfig test-file exclude.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

const BROWSER_TZ = "America/Toronto"; // in TIMEZONES_IANA
const SAVED_TZ = "Asia/Tokyo";        // in TIMEZONES_IANA, different label region

// me payload is toggled per test via this mutable holder read by the mock.
let ME_PAYLOAD: Record<string, unknown> = {};

beforeEach(() => {
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
    () => ({ resolvedOptions: () => ({ timeZone: BROWSER_TZ }) }) as unknown as Intl.DateTimeFormat,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

// Deterministic network layer for every apiRequest / default-queryFn URL the
// founder Settings page touches. Only /api/auth/me carries the timezone under
// test; the rest return benign empty shapes.
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const bodyFor = (url: string): unknown => {
    if (url.startsWith("/api/auth/me")) return ME_PAYLOAD;
    if (url.startsWith("/api/founder/active-company")) return { activeCompanyId: "co_test", companies: [] };
    if (url.startsWith("/api/founder/pricing-tiers")) return [];
    if (url.startsWith("/api/founder/privacy")) return { ok: true, privacy: {} };
    if (url.startsWith("/api/founder/team/members")) return { members: [] };
    if (url.startsWith("/api/legal/consent/mine")) return { ok: true, consents: [] };
    return { ok: true };
  };
  return {
    ...actual,
    apiRequest: vi.fn(async (_method: string, url: string) => ({
      ok: true,
      status: 200,
      json: async () => bodyFor(url),
    }) as unknown as Response),
  };
});

// Company-active hook + legal drawer need no network beyond the mocked default.
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompany: () => ({ data: { activeCompanyId: "co_test" }, isLoading: false }),
  useActiveCompanyId: () => "co_test",
}));

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { RoleProvider } from "@/lib/role";
import { LegalDrawerProvider } from "@/lib/legalDrawer";
import FounderSettings from "@/pages/founder/Settings";

function renderSettings(meData: Record<string, unknown>) {
  ME_PAYLOAD = meData;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        // Default queryFn for the hooks that pass only a queryKey (e.g.
        // useActiveCompany). Route by the URL in queryKey[0].
        queryFn: async ({ queryKey }) => {
          const url = String(queryKey[0]);
          if (url.startsWith("/api/founder/active-company")) return { activeCompanyId: "co_test", companies: [] };
          if (url.startsWith("/api/auth/me")) return meData;
          return { ok: true };
        },
      },
    },
  });
  window.history.pushState({}, "", "/founder/settings");
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
            React.createElement(FounderSettings, null),
          ),
        ),
      ),
    ),
  );
}

describe("AVI-TZ — founder Settings displays the persisted timezone", () => {
  it("shows the SAVED me.timezone (not the browser default) in the Select", async () => {
    renderSettings({ isAuthed: true, userId: "u_test", timezone: SAVED_TZ });
    const trigger = await screen.findByTestId("select-timezone", {}, { timeout: 4000 });
    // The Radix Select renders the selected option's LABEL. Tokyo's label is
    // "Tokyo (JST)"; Toronto's is "Toronto (EST/EDT)". The hydration effect
    // applies the persisted value after the me query resolves, so wait for it.
    await waitFor(() => {
      expect(trigger.textContent).toContain("Tokyo");
      expect(trigger.textContent).not.toContain("Toronto");
    }, { timeout: 4000 });
  });

  it("falls back to the browser timezone when me.timezone is UNSET", async () => {
    renderSettings({ isAuthed: true, userId: "u_test" });
    const trigger = await screen.findByTestId("select-timezone", {}, { timeout: 4000 });
    expect(trigger.textContent).toContain("Toronto");
  });
});
