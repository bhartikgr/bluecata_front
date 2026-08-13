// @vitest-environment jsdom
/**
 * WAVE 35 · F2 (client pole) — the founder Billing/Plan cards must not render a
 * non-USD price with a "$" and the wrong magnitude.
 *
 * THE DEFECT (Review A, F2): `server/adminPricingStore.ts` emitted
 * `annualUsd: Math.round(annualMinor / 100)` regardless of the tier's own
 * `currency`, and this page piped that number straight into `fmtUSD()`. A
 * ¥1,200,000/year plan was shown to the founder as **$12,000** — 100×
 * understated and in the wrong currency.
 *
 * THE FIX: the server emits `currency` + integer `monthlyMinor`/`annualMinor`
 * and nulls the USD-named fields for non-USD tiers; this page formats with
 * `formatMinor(minor, currency)`.
 *
 * BOTH POLES, rendered through the REAL page component:
 *   JPY pole — "¥1,200,000" appears and neither "$12,000" nor "$1,200,000" does.
 *   USD pole — a USD tier still renders "$12,000", so a fix that simply stopped
 *              dividing (or stopped rendering) fails.
 * Plus a THIRD pole: when the server can supply neither shape, the card renders
 * an explicit refusal rather than "$0" or "Free".
 *
 * Preconditions are established here (the payload is defined in this file);
 * `process.env` is never read. Plain `.test.ts` + React.createElement (no JSX)
 * so it stays outside the tsc budget, matching Settings.timezone.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";

type Tier = Record<string, unknown>;

/** Mutable holder read by the mocked network layer. */
let TIERS: Tier[] = [];

const JPY_TIER: Tier = {
  id: "w35_jpy",
  name: "Capavate Annual (JP)",
  blurb: "wave35 fixture",
  features: [],
  billingCycle: "annual",
  currency: "JPY",
  monthlyMinor: 1_200_000,
  annualMinor: 1_200_000,
  // The server nulls these for a non-USD tier.
  monthlyUsd: null,
  annualUsd: null,
};

const USD_TIER: Tier = {
  id: "w35_usd",
  name: "Capavate Annual (US)",
  blurb: "wave35 fixture",
  features: [],
  billingCycle: "annual",
  currency: "USD",
  monthlyMinor: 1_200_000,
  annualMinor: 1_200_000,
  monthlyUsd: 12_000,
  annualUsd: 12_000,
};

/** Neither minor units nor a USD number — the refusal pole. */
const UNPRICED_TIER: Tier = {
  id: "w35_unpriced",
  name: "Bespoke",
  blurb: "wave35 fixture",
  features: [],
  billingCycle: "annual",
  currency: "CHF",
  monthlyUsd: null,
  annualUsd: null,
};

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const bodyFor = (url: string): unknown => {
    if (url.startsWith("/api/founder/pricing-tiers")) return TIERS;
    if (url.startsWith("/api/auth/me")) return { isAuthed: true, userId: "u_w35_founder" };
    if (url.startsWith("/api/founder/active-company")) return { activeCompanyId: "co_w35", companies: [] };
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

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompany: () => ({ data: { activeCompanyId: "co_w35" }, isLoading: false }),
  useActiveCompanyId: () => "co_w35",
}));

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { RoleProvider } from "@/lib/role";
import { LegalDrawerProvider } from "@/lib/legalDrawer";
import FounderSettings from "@/pages/founder/Settings";

afterEach(() => cleanup());

function renderBillingTab(tiers: Tier[]) {
  TIERS = tiers;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const url = String(queryKey[0]);
          if (url.startsWith("/api/founder/pricing-tiers")) return TIERS;
          if (url.startsWith("/api/founder/active-company")) return { activeCompanyId: "co_w35", companies: [] };
          if (url.startsWith("/api/auth/me")) return { isAuthed: true, userId: "u_w35_founder" };
          return { ok: true };
        },
      },
    },
  });
  window.history.pushState({}, "", "/founder/settings?tab=plan");
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

/** The rendered price text of one tier card. */
async function priceTextFor(id: string): Promise<string> {
  const el = await screen.findByTestId(`tier-price-${id}`, {}, { timeout: 5000 });
  return el.textContent ?? "";
}

describe("WAVE 35 F2 — founder plan cards format with the tier's OWN currency", () => {
  it("JPY POLE: a ¥1,200,000 plan is never rendered as $12,000", async () => {
    // Two tiers so the multi-plan grid (the fmtUSD path) renders, not the
    // single-tier displayPrice shortcut.
    renderBillingTab([JPY_TIER, USD_TIER]);

    await waitFor(async () => {
      const text = await priceTextFor("w35_jpy");
      // THE DEFECT'S OUTPUT — the exact string a founder was shown.
      expect(text).not.toContain("$12,000");
      expect(text).not.toContain("$");
      // The truth, at the correct magnitude.
      expect(text.replace(/[\s\u00a0]/g, "")).toMatch(/1,200,000/);
    }, { timeout: 5000 });
  });

  it("USD POLE: a USD plan at the SAME minor price still renders $12,000", async () => {
    renderBillingTab([JPY_TIER, USD_TIER]);
    await waitFor(async () => {
      const text = await priceTextFor("w35_usd");
      expect(text).toContain("$12,000");
      // An over-fix that rendered raw minor units would fail here.
      expect(text).not.toContain("1,200,000");
    }, { timeout: 5000 });
  });

  it("REFUSAL POLE: a tier with no expressible price says so — it is not shown as Free or $0", async () => {
    renderBillingTab([UNPRICED_TIER, USD_TIER]);
    await waitFor(async () => {
      const text = await priceTextFor("w35_unpriced");
      expect(text).toContain("Price unavailable");
      expect(text).not.toContain("Free");
      expect(text).not.toContain("$0");
    }, { timeout: 5000 });
  });

  it("FREE is still FREE — a zero-minor tier keeps its existing copy", async () => {
    renderBillingTab([{ ...USD_TIER, id: "w35_free", monthlyMinor: 0, annualMinor: 0, monthlyUsd: 0, annualUsd: 0 }, USD_TIER]);
    await waitFor(async () => {
      expect(await priceTextFor("w35_free")).toContain("Free");
    }, { timeout: 5000 });
  });
});
