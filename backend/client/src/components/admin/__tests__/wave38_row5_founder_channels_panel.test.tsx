/**
 * WAVE 38 · ROW 5 — what an admin actually SEES on the founder-channels panel.
 *
 * The server half is exercised in
 * `server/__tests__/wave36_row9_dead_promise_and_orphan.test.ts` (P10-P10d).
 * This file closes the other half: the panel is RENDERED against each response
 * shape the endpoint can produce, and the assertions read the rendered text.
 *
 * The prior harness only searched `FounderChannelsPanel.tsx` for strings, which
 * is why Review 3B's broken-output mutation went unnoticed. A rendered refusal
 * is a UI claim and has to be proven in the UI.
 *
 * POLES
 *   A — single currency: the exact exponent-aware amount is shown, and no
 *       refusal text appears.
 *   B — JPY (exponent 0): no decimals, and the figure is not 100x.
 *   C — mixed currencies: the REFUSAL is shown with the reason and the currency
 *       list, both legs are still displayed, and NO scalar total is rendered.
 *   D — a genuine zero renders as a zero amount, NOT as the refusal. `!minor`
 *       instead of `minor == null` would fail exactly here.
 *   E — a failed request renders an error, never "0" and never an empty card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryCache, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

import { FounderChannelsPanel } from "../FounderChannelsPanel";

const COMPANY = "co_w38_r5_panel";

function serve(body: unknown) {
  apiRequestMock.mockImplementation(async () => ({ json: async () => body, ok: true }) as unknown as Response);
}

function renderPanel() {
  const qc = new QueryClient({
    /* The shipped app's QueryClient installs a QueryCache onError handler
       (client/src/lib/queryClient.ts). Installing one here too keeps a failed
       query's rejection owned by the cache, exactly as in production, instead
       of escaping as an unhandled rejection in the runner. */
    queryCache: new QueryCache({ onError: () => {} }),
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <FounderChannelsPanel companyId={COMPANY} />
    </QueryClientProvider>,
  );
}

/* BLOCK BODIES, deliberately. `beforeEach(() => mock.mockReset())` returns the
   mock FUNCTION, and vitest treats a value returned from a hook as that hook's
   teardown callback — so it invoked `apiRequestMock()` after every test. With
   the error pole's implementation still installed that produced a rejected
   promise nobody owned, and the runner attributed the stray rejection to the
   test as a failure even though every assertion in it had passed. Returning
   nothing is the whole fix. */
beforeEach(() => { apiRequestMock.mockReset(); });
afterEach(() => { cleanup(); });

describe("Wave 38 · Row 5 — FounderChannelsPanel renders the server's answer", () => {
  it("POLE A — a single-currency total renders the exact amount and no refusal", async () => {
    serve({
      ok: true,
      companyId: COMPANY,
      totalRaisedMinor: 400_000,
      totalRaisedCurrency: "USD",
      totalRaisedByCurrency: [{ currency: "USD", minor: 400_000 }],
      byChannel: { direct: { countSCs: 2, totalMinor: 400_000, currency: "USD" } },
    });
    renderPanel();
    const total = await waitFor(() => screen.getByTestId("admin-founder-channels-total"));
    expect(total.textContent).toContain("4,000.00");
    expect(screen.queryByTestId("admin-founder-channels-total-unavailable")).toBeNull();
    // The channel line carries the same figure, and the count is real.
    expect(screen.getByTestId("admin-founder-channels-direct-total").textContent).toContain("4,000.00");
    expect(screen.getByTestId("admin-founder-channels-direct-count").textContent).toContain("2 soft circles");
  });

  it("POLE B — JPY (exponent 0) renders with no decimals and is not scaled", async () => {
    serve({
      ok: true,
      totalRaisedMinor: 250_000,
      totalRaisedCurrency: "JPY",
      totalRaisedByCurrency: [{ currency: "JPY", minor: 250_000 }],
      byChannel: { direct: { countSCs: 1, totalMinor: 250_000, currency: "JPY" } },
    });
    renderPanel();
    const total = await waitFor(() => screen.getByTestId("admin-founder-channels-total"));
    expect(total.textContent).toContain("250,000");
    expect(total.textContent).not.toContain("2,500.00");
    expect(total.textContent).not.toContain("250,000.00");
  });

  it("POLE C — mixed currencies render the refusal, the reason and BOTH legs", async () => {
    serve({
      ok: true,
      totalRaisedMinor: null,
      totalRaisedCurrency: null,
      totalRaisedUnavailableReason: "needs_fx_conversion",
      currencies: ["JPY", "USD"],
      totalRaisedByCurrency: [
        { currency: "JPY", minor: 250_000 },
        { currency: "USD", minor: 400_000 },
      ],
      byChannel: {
        direct: {
          countSCs: 2,
          totalMinor: null,
          currency: null,
          unavailableReason: "needs_fx_conversion",
          currencies: ["JPY", "USD"],
          byCurrency: [
            { currency: "JPY", minor: 250_000 },
            { currency: "USD", minor: 400_000 },
          ],
        },
      },
    });
    renderPanel();
    const refusal = await waitFor(() => screen.getByTestId("admin-founder-channels-total-unavailable"));
    expect(refusal.textContent).toContain("does not convert between currencies");
    expect(refusal.textContent).toContain("JPY, USD");
    // No scalar total is rendered at all — not a 0, not a blank, not an em-dash.
    expect(screen.queryByTestId("admin-founder-channels-total")).toBeNull();
    // Both legs are still visible: refusing the scalar drops no information.
    expect(screen.getByTestId("admin-founder-channels-total-by-currency-JPY").textContent).toContain("250,000");
    expect(screen.getByTestId("admin-founder-channels-total-by-currency-USD").textContent).toContain("4,000.00");
    // And the summed figure is nowhere on screen.
    expect(document.body.textContent ?? "").not.toContain("650,000");
  });

  it("POLE D — a genuine zero renders as an amount, NOT as the refusal", async () => {
    serve({
      ok: true,
      totalRaisedMinor: 0,
      totalRaisedCurrency: "USD",
      totalRaisedByCurrency: [],
      byChannel: { direct: { countSCs: 0, totalMinor: 0, currency: "USD" } },
    });
    renderPanel();
    const total = await waitFor(() => screen.getByTestId("admin-founder-channels-total"));
    expect(total.textContent).toContain("0.00");
    expect(screen.queryByTestId("admin-founder-channels-total-unavailable")).toBeNull();
    expect(screen.getByTestId("admin-founder-channels-direct-count").textContent).toContain("0 soft circles");
  });

  it("POLE E — a failed request says so; it never renders a zero or an empty card", async () => {
    apiRequestMock.mockImplementation(() => Promise.reject(new Error("boom")));
    renderPanel();
    const err = await waitFor(() => screen.getByTestId("admin-founder-channels-error"));
    expect(err.textContent).toContain("Could not load the channel breakdown");
    expect(screen.queryByTestId("admin-founder-channels-total")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("0.00");
  });
});
