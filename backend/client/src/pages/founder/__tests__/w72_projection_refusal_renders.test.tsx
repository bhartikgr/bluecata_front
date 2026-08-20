/**
 * WAVE 72 · DEFECT 1 / R58 — THE PROJECTION REFUSAL REACHES THE SCREEN.
 * ═══════════════════════════════════════════════════════════════════════════
 * R58's rule, in the owner's words: "A wave may not claim a user-visible
 * improvement unless the string is rendered by a component and a test asserts it
 * renders", and "`onError` handlers that discard a server message are a defect".
 *
 * WHAT THIS FILE EXISTS TO STOP ME CLAIMING FALSELY. `projectPostClose` is called
 * BARE IN RENDER by `ProjectionPanel`. Every named refusal it raises — including
 * Wave 72's `zero_pricing_denominator` — therefore used to propagate to the
 * app-level `ErrorBoundary` (`client/src/App.tsx:607`), which replaces the WHOLE
 * page: the founder would have got a generic failure instead of the sentence the
 * refusal carries, and the pre-close column, the terms and the disclosures would
 * have gone with it. That is a refusal replacing its CONTAINER, which this project
 * forbids.
 *
 * BOTH POLES:
 *   REFUSAL pole  a zero-share company with a positive pre-money and target →
 *                 the refusal's own sentence and code render INSIDE the card, the
 *                 pre-close table is STILL THERE, and the "add a pre-money
 *                 valuation" copy (which would be false — both are set) does NOT
 *                 appear.
 *   SUCCESS pole  the same panel over a real ledger → both projection tables
 *                 render and no refusal panel appears.
 *
 * MUTATION TRANSCRIPT: build_log/wave72/W72_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { ProjectionPanel } from "../RoundDetail";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function wire(securities: unknown[]) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/securities$/.test(url)) return jsonResponse(securities);
    if (/pricing-order$/.test(url)) {
      return jsonResponse({
        ok: true,
        pricingOrder: { mode: "w52_post_pool_post_conversion", enabled: true, source: "default", version: null },
        disclosure: { headline: "Pricing order", body: "…" },
      });
    }
    return jsonResponse([]);
  });
}

/** A round with BOTH terms present, so `canProject` is true and the projection
    is actually attempted — which is the only way to reach the refusal. */
const ROUND = {
  id: "rnd_w72", companyId: "co_w72", name: "Series A", type: "priced_equity",
  state: "terms_set", preMoney: 30_000_000, targetAmount: 10_000_000, pricePerShare: null,
  currency: "USD",
} as never;

const ZERO_SHARE = [{
  id: "sec_zero", companyId: "co_w72", holderName: "Ada Founder", holderType: "founder",
  instrument: "common", series: null, shares: 0, pricePerShare: null, investmentAmount: null,
  issuedAt: "2024-01-01",
}];
const REAL = [{
  id: "sec_real", companyId: "co_w72", holderName: "Bo Founder", holderType: "founder",
  instrument: "common", series: null, shares: 8_000_000, pricePerShare: null, investmentAmount: null,
  issuedAt: "2024-01-01",
}];

function renderPanel(securities: unknown[]) {
  wire(securities);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  /* ── WHY THE CACHE IS PRE-SEEDED, STATED RATHER THAN GLOSSED ───────────────
     `ProjectionPanel` returns EARLY (`if (!securities.data) return <Loading/>`)
     BEFORE its second `useQuery`, so a mount whose securities query has not yet
     resolved runs one hook on the first render and two on the second, and React
     raises "Rendered more hooks than during the previous render". That is a
     PRE-EXISTING hook-order defect in the panel — it predates Wave 72, it is
     unrelated to the refusal under test, and this wave does NOT change it (it is
     reported in `build_log/wave72/WAVE72_REPORT.md` under FINDINGS NOT FIXED, with
     an owner question). Seeding both queries reproduces the production case where
     the page has already loaded the holder list, and keeps this file measuring the
     refusal rather than that defect. */
  qc.setQueryData(["/api/companies", "co_w72", "securities"], securities);
  qc.setQueryData(["/api/founder/round-math/pricing-order", "rnd_w72"], {
    ok: true,
    pricingOrder: { mode: "w52_post_pool_post_conversion", enabled: true, source: "default", version: null },
    disclosure: { headline: "Pricing order", body: "…" },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ProjectionPanel round={ROUND} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); apiRequestMock.mockReset(); });

describe("W72-R58 — the projection refusal is on the screen, not in the console", () => {
  it("W72-R58a — REFUSAL POLE: the zero-denominator refusal renders inside the card, with its code", async () => {
    renderPanel(ZERO_SHARE);
    await waitFor(() => expect(screen.getByTestId("projection-refused")).toBeTruthy());
    const msg = screen.getByTestId("projection-refused-message").textContent ?? "";
    /* The engine's own sentence — the condition, the rule and the screen path. */
    expect(msg).toContain("no fully-diluted shares to price against");
    /* The surface it names must EXIST and be the one that works (R58): equity
       originates through /founder/rounds; /founder/captable is view-only. */
    expect(msg).toContain("/founder/rounds");
    expect(screen.getByTestId("projection-refused-code").textContent).toBe("zero_pricing_denominator");
    /* NO SILENT DROP: the pre-close column is still rendered beside the refusal. */
    expect(screen.getByTestId("table-pre")).toBeTruthy();
    /* AND THE FALSE ALTERNATIVE IS ABSENT: both terms ARE set, so the
       "add a pre-money valuation and a target amount" copy must not appear. */
    expect(screen.queryByTestId("projection-needs-terms")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("Infinity");
  });

  it("W72-R58b — SUCCESS POLE: a real ledger still renders both projection tables and no refusal", async () => {
    renderPanel(REAL);
    await waitFor(() => expect(screen.getByTestId("table-post")).toBeTruthy());
    expect(screen.getByTestId("table-pre")).toBeTruthy();
    expect(screen.queryByTestId("projection-refused")).toBeNull();
    expect(screen.queryByTestId("projection-needs-terms")).toBeNull();
    /* 8,000,000 shares at a $30m pre-money and a $10m raise → 2,666,666 new
       investor shares at 25.00%, the same control numbers `W72-A4` pins from the
       engine side (the table header carries the total; the rows carry the split). */
    const post = screen.getByTestId("table-post").textContent ?? "";
    expect(post).toContain("2,666,666");
    expect(post).toContain("25.00%");
    expect(post).toContain("75.00%");
    expect(post).not.toContain("NaN");
    expect(post).not.toContain("—%");
  });
});
