/**
 * WAVE 225 · ITEM B — WHAT THE ADMIN TELEMETRY PAGE ACTUALLY SAYS NOW.
 *
 * Handbook §8 / R176.2 — NEVER PROVE A REPLICA. This mounts the REAL default
 * export of `client/src/pages/admin/Telemetry.tsx`. The cohort-benchmarks card,
 * the "Cohorts" stat and `BurnVsRaiseWidget` all execute their production code.
 * Only the network boundary is stubbed.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 * `packages/telemetry/src/benchmarks.ts:350` calls
 * `seedSyntheticBenchmarks(defaultBenchmarkStore)` unconditionally at module
 * load — no environment gate of any kind — putting 130 INVENTED rounds across 21
 * cohorts into the singleton store that ships in the production client bundle.
 * `addToCohort` has no non-seed, non-test caller in the tree, so those invented
 * rounds were not "mixed into" real data: they were 100% of it.
 *
 * Three sinks published derived figures from that store to platform admins:
 * per-cohort p25/p50/p75/p90 for pre-money valuation, lead-investor cheque size
 * and total round size; a "Cohorts: 21" stat labelled "Active benchmark sets";
 * and a Pearson correlation coefficient to two decimal places.
 *
 * ── WHAT IS ASSERTED ─────────────────────────────────────────────────────────
 *  1. the page still mounts and renders (refusing must not break a working screen);
 *  2. the cohort-benchmarks card refuses instead of publishing percentiles;
 *  3. the refusal explains that only observed closed rounds count — the
 *     pre-existing "Closed rounds add organically" literal survives BYTE-FOR-BYTE
 *     (R143.1) with the correction APPENDED beside it;
 *  4. the correlation widget shows no `r = ` value and says why;
 *  5. the intro's "honest peer comparisons" claim is corrected adjacently, since
 *     `AdminPageIntro` has no `children` prop and R143.1 forbids editing its
 *     `positive` literal.
 *
 * Ruling R193.2. Owner instruction: "If they reach a user: the derived figures
 * are fabricated and must refuse rather than compute."
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { RoleProvider } from "@/lib/role";
import AdminTelemetry from "../Telemetry";
import { totalObservedRounds, observedCohorts } from "@/lib/wave225BenchmarkProvenance";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The pre-existing literal that must survive byte-for-byte. */
const PRE_EXISTING_EMPTY_COPY = "No data yet for this cohort. Closed rounds add organically.";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      {/* The REAL provider, not a stub: `useRole()` throws "RoleProvider missing"
          without it, and stubbing it would move this file toward a replica. */}
      <RoleProvider>
        <AdminTelemetry />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/api/rounds")) return jsonResponse([]);
    if (url.includes("telemetry/event-counts") || url.includes("counts")) {
      return jsonResponse({ ok: true, measured: true, today: 0, thisWeek: 0, allTime: 0 });
    }
    return jsonResponse([]);
  });
});

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W225 · Item B — the observed-round store starts empty and cannot be seeded", () => {
  it("holds zero observed rounds and zero cohorts", () => {
    // This is the load-bearing fact behind every DOM assertion below: the
    // provenance layer constructs its OWN `BenchmarkStore` and never imports
    // `seedSyntheticBenchmarks`, so no invented round can enter it.
    expect(totalObservedRounds()).toBe(0);
    expect(observedCohorts()).toEqual([]);
  });
});

describe("W225 · Item B — the admin telemetry page refuses rather than computes", () => {
  it("still mounts (refusing did not break the page)", async () => {
    renderPage();
    await waitFor(() => expect(document.body.textContent).toContain("Cohort benchmarks"));
  });

  it("publishes NO cohort percentiles", async () => {
    renderPage();
    await waitFor(() => expect(document.body.textContent).toContain("Cohort benchmarks"));
    // The percentile grid must not render at all.
    expect(screen.queryByTestId("cohort-benchmarks")).toBeNull();
    // And none of the percentile row labels may appear.
    expect(document.body.textContent).not.toContain("Pre-money valuation ($)");
    expect(document.body.textContent).not.toContain("Lead investor cheque");
    expect(document.body.textContent).not.toContain("closed rounds");
  });

  it("keeps the pre-existing empty-state literal byte-for-byte and APPENDS the correction", async () => {
    renderPage();
    const refusal = await screen.findByTestId("cohort-benchmarks-refusal");
    expect(refusal.textContent).toContain(PRE_EXISTING_EMPTY_COPY);

    const detail = await screen.findByTestId("cohort-benchmarks-refusal-detail");
    expect(detail.textContent).toContain("has not observed a closed round in this cohort");

    const basis = await screen.findByTestId("cohort-benchmarks-refusal-basis");
    expect(basis.textContent).toContain("only from rounds Capavate observed closing");
    expect(basis.textContent).toContain("Seeded, sample and");
  });

  it("corrects the intro's 'honest peer comparisons' claim adjacently", async () => {
    renderPage();
    const correction = await screen.findByTestId("telemetry-benchmark-provenance-correction");
    expect(correction.textContent).toContain("has not yet observed a single closed round");
    expect(correction.textContent).toContain("seeded preview data, not measurements");
    // R143.1 — the original `positive` literal is NOT edited, so it must still
    // be on the page verbatim.
    expect(document.body.textContent).toContain("honest peer comparisons");
  });

  it("publishes NO Pearson correlation coefficient, and says why", async () => {
    renderPage();
    await waitFor(() => expect(document.body.textContent).toContain("Cohort benchmarks"));
    /* `BurnVsRaiseWidget` lives on the "M&A intelligence" tab, and Radix does NOT
       mount an unselected tab panel. My first draft of this test asserted against
       `document.body` while the "Funnel & cohorts" tab was active, so the widget
       was never rendered and the assertion was VACUOUS — adversarial disarm D17
       (recompute `r` from the 130 seeded rounds) came back GREEN and exposed it.
       The tab is therefore actually clicked. */
    const tab = await screen.findByTestId("tab-tel-intel");
    // Radix activates on mouse-down, not on a bare synthetic click.
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() => expect(tab.getAttribute("data-state")).toBe("active"));
    const card = await screen.findByTestId("card-burn-raise");
    // No `r = ` value. Pre-fix this read something like "r = -0.42", to two
    // decimal places, computed entirely from invented rounds.
    expect(card.textContent).not.toMatch(/r = -?\d/);
    expect(card.textContent).toContain("\u2014");
    // And it says why, rather than leaving a bare dash.
    const why = await screen.findByTestId("burn-raise-refusal-detail");
    expect(why.textContent).toContain("has not observed enough closed rounds");
    expect(why.textContent).toContain("Seeded and sample rounds are excluded");
  });

  it("counts observed cohorts, not the 21 seeded ones", async () => {
    renderPage();
    await waitFor(() => expect(document.body.textContent).toContain("Cohort benchmarks"));
    expect(document.body.textContent).toContain("Cohorts with rounds Capavate observed closing");
    // The stale label is gone from the hint.
    expect(document.body.textContent).not.toContain("Active benchmark sets");
    /* The VALUE, not just the label. Adversarial disarm D14 swaps
       `observedCohorts()` back to `defaultBenchmarkStore.listCohorts()`, which
       returns the 21 SEEDED cohorts; asserting only the hint text left that
       disarm GREEN, so the number itself is pinned here. */
    const stat = await screen.findByTestId("admin-intro-stat-value-cohorts");
    expect(stat.textContent).toBe("0");
  });
});
