/**
 * WAVE 201 — TWO ADMIN TABS, TWO DIFFERENT MRR FIGURES FOR ONE PLATFORM.
 *
 * The finding, as reported from the live site: the Subscriptions tab showed
 * "Total MRR (shown)" = $6,684.50 while the Billing Metrics tab showed
 * MRR = $2,244.00. Two surfaces disagreeing on a headline revenue figure.
 *
 * WHAT THESE TESTS ESTABLISH, AND WHAT THEY DELIBERATELY DO NOT.
 *
 * They do NOT assert either live number. This wave has no live access, the two
 * live figures were read from a different release, and a test that hardcoded
 * $6,684.50 would be asserting a snapshot of a database rather than a property
 * of the code.
 *
 * What they DO assert is the property that explains the disagreement, driven
 * through the real components from ONE shared payload: the Subscriptions tile
 * counts `active` AND `trialing` from the list as filtered, while the Billing
 * Metrics tile counts `active` only across every row. Given one payload
 * containing both statuses, the two tiles must therefore print different
 * numbers — and each must now say which population it counted.
 *
 * NEITHER NUMBER IS CHANGED BY THIS WAVE. Which of the two is the platform's
 * headline MRR is a definition the owner chooses; presenting either as a bare
 * "MRR" is the defect, and that is what is closed here.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

let subscriptionsResponse: unknown;

vi.mock("@/lib/queryClient", () => {
  const client = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), getQueryData: vi.fn() };
  return {
    queryClient: client,
    apiRequest: vi.fn(async (_method: string, url: string) => {
      const body = url.startsWith("/api/admin/subscriptions") ? subscriptionsResponse : {};
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
    getQueryFn: () => async () => ({}),
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { SubscriptionsTab, BillingMetricsTab } from "@/pages/admin/Pricing";

function Wrap({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<QueryClient | null>(null);
  if (!ref.current) {
    ref.current = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0, queryFn: async () => subscriptionsResponse },
      },
    });
  }
  return <QueryClientProvider client={ref.current}>{children}</QueryClientProvider>;
}

const sub = (over: Partial<Record<string, unknown>>) => ({
  companyId: "co_test",
  status: "active",
  plan: "capavate-annual",
  annualAmountMinor: 84000,
  currency: "USD",
  renewsOn: "2027-01-01",
  cardLast4: null,
  invoicesCount: 0,
  version: 1,
  revisionHash: "h",
  updatedAt: "2026-08-01T00:00:00.000Z",
  updatedBy: "system",
  ...over,
});

/* ONE payload, read by both tabs. Two active rows and one trialing row, so the
   two populations are genuinely different by exactly one row. */
const SHARED_PAYLOAD = {
  subscriptions: [
    sub({ companyId: "co_active_1", status: "active", annualAmountMinor: 120000 }),
    sub({ companyId: "co_active_2", status: "active", annualAmountMinor: 120000 }),
    sub({ companyId: "co_trial_1", status: "trialing", annualAmountMinor: 240000 }),
  ],
};

beforeEach(() => {
  subscriptionsResponse = SHARED_PAYLOAD;
});
afterEach(() => cleanup());

describe("wave 201 · the two MRR surfaces count different populations", () => {
  it("the Subscriptions tile INCLUDES trialing: (120000+120000+240000) minor / 12 = $400.00", async () => {
    render(
      <Wrap>
        <SubscriptionsTab />
      </Wrap>,
    );
    /* The tile is present while the query is still in flight, reading "Not on
       record" — so waiting for the ELEMENT is not waiting for the ANSWER. */
    const tile = await screen.findByTestId("text-total-mrr-shown");
    await waitFor(() => expect(tile.textContent).not.toContain("Not on record"));
    /* 480,000 minor units of annual revenue over twelve months = 40,000 minor
       units a month = $400.00. Asserted on the tile's OWN node, not on the
       document, so a matching figure elsewhere on the page cannot satisfy it. */
    expect(tile.textContent).toContain("400.00");
  });

  it("the Billing Metrics tile EXCLUDES trialing: (120000+120000) minor / 12 = $200.00", async () => {
    render(
      <Wrap>
        <BillingMetricsTab />
      </Wrap>,
    );
    /* The MRR figure is the first of the metric tiles; assert on the rendered
       document text rather than an index, so a re-ordering of tiles does not
       silently make this pass against the wrong number. */
    await screen.findByTestId("text-billing-metrics-mrr-population");
    /* 240,000 minor units of annual revenue over twelve months = $200.00 — the
       trialing row's 240,000 is NOT in this population. The label is included in
       the match so that an equal figure in another tile cannot satisfy it, and
       the trialing-inclusive answer is asserted ABSENT from this tile. */
    expect(document.body.textContent).toContain("MRR$200.00");
    expect(document.body.textContent).toContain("ARR$2,400.00");
    expect(document.body.textContent).not.toContain("MRR$400.00");
  });

  it("each tile names its own population, so a reader can tell a definition apart from a data fault", async () => {
    render(
      <Wrap>
        <SubscriptionsTab />
      </Wrap>,
    );
    const a = await screen.findByTestId("text-total-mrr-population");
    expect(a.textContent).toContain("ACTIVE and TRIALING");
    expect(a.textContent).toContain("Billing Metrics tab counts ACTIVE only");
    expect(a.textContent).toContain("not expected to agree");
    cleanup();

    render(
      <Wrap>
        <BillingMetricsTab />
      </Wrap>,
    );
    const b = await screen.findByTestId("text-billing-metrics-mrr-population");
    expect(b.textContent).toContain("ACTIVE subscriptions only");
    expect(b.textContent).toContain("also counts TRIALING");
    expect(b.textContent).toContain("not expected to agree");
  });

  it("keeps the wave 180/184 currency-scope lines intact alongside the new disclosure (R143.1)", async () => {
    render(
      <Wrap>
        <SubscriptionsTab />
      </Wrap>,
    );
    expect(await screen.findByTestId("text-total-mrr-scope")).toBeTruthy();
    cleanup();
    render(
      <Wrap>
        <BillingMetricsTab />
      </Wrap>,
    );
    expect(await screen.findByTestId("text-billing-metrics-scope")).toBeTruthy();
  });
});
