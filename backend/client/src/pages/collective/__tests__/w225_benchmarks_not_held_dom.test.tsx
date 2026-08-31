/**
 * WAVE 225 · ITEM C · DEFECT C-1 — A MEASURED MEDIAN REVENUE MULTIPLE OF ZERO.
 *
 * Handbook §8 / R176.2 — the REAL `MaIntel` page and the REAL `BenchmarksTab` are
 * mounted; only the network boundary is stubbed.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 * `viewBenchmarks()` in `server/collectiveMaIntelStore.ts` emitted
 *
 *     revenueMultipleLow:  0
 *     revenueMultipleHigh: 0
 *
 * for every sector, because no company profile carries a revenue multiple. Those
 * two keys are in `BENCHMARK_COLUMNS` under the headings "Rev × Low" and
 * "Rev × High", and the render path had exactly two branches — the k-anonymity
 * dash, or the number. A `0` is a number, so it fell through to the numeric
 * branch and an accredited investor read a sector median revenue multiple of
 * ZERO, in a table headed "Institutional-grade aggregation", next to real
 * k-anonymised scores that ARE measured. R143.4: a figure the platform does not
 * hold must not be rendered as a measurement of zero.
 *
 * ── THE FIX AND WHY IT NEEDS THREE POLES ─────────────────────────────────────
 * The server now emits `null`, and the client gained a THIRD render branch that
 * says "not held" — distinct from the k-anonymity dash, which means something
 * else entirely ("too few companies to disclose"). Both dashes look identical to
 * the eye, so the distinction lives in the `title` and the `data-testid`, and
 * both are asserted here.
 *
 * Three poles, because two would not catch the regressions that matter:
 *   1. NOT HELD  — `null` renders the not-held treatment, and NOT a "0";
 *   2. MEASURED  — a real number still renders as that number (proof the fix is
 *                  not a blanket blank that would hide working figures);
 *   3. K-ANONYMITY — `INSUFFICIENT_DATA` still renders the ORIGINAL dash with its
 *                  original title, byte-for-byte (R143.1).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import MaIntel from "../MaIntel";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The k-anonymity title literal that predates this wave. */
const K_ANON_TITLE = "Insufficient data (k-anonymity floor of 5)";

function medians(overrides: Record<string, number | null> = {}) {
  return {
    maScore: 71,
    acquirerFitScore: 64,
    productMarketFit: 68,
    technologyDifferentiation: 72,
    customerConcentration: 40,
    growthRate: 55,
    marketShare: 12,
    managementTeamStrength: 70,
    // The two keys at the heart of C-1.
    revenueMultipleLow: null,
    revenueMultipleHigh: null,
    ...overrides,
  };
}

function benchmarksPayload(sectors: unknown[]) {
  return { asOfDate: "2025-06-01T00:00:00.000Z", sectors };
}

function renderBenchmarks() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MaIntel />
    </QueryClientProvider>,
  );
}

function stub(payload: unknown) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) =>
    url.includes("view=benchmarks") ? jsonResponse(payload) : jsonResponse({}),
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/collective/ma-intel?view=benchmarks");
});

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W225 · C-1 — POLE 1: a figure the platform does not hold", () => {
  beforeEach(() => {
    stub(benchmarksPayload([{ sector: "fintech", n: 7, status: "OK", medians: medians() }]));
  });

  it("renders a NOT-HELD treatment for both revenue-multiple columns", async () => {
    renderBenchmarks();
    const low = await screen.findByTestId("ma-benchmarks-not-held-fintech-revenueMultipleLow");
    const high = await screen.findByTestId("ma-benchmarks-not-held-fintech-revenueMultipleHigh");
    expect(low).toBeTruthy();
    expect(high).toBeTruthy();
  });

  it("says WHY, and says it is not a measurement of zero", async () => {
    renderBenchmarks();
    const low = await screen.findByTestId("ma-benchmarks-not-held-fintech-revenueMultipleLow");
    const title = low.getAttribute("title") ?? "";
    expect(title).toContain("Not held");
    expect(title).toContain("no revenue-multiple figure");
    expect(title).toContain("not a measurement of zero");
    // And it is NOT the k-anonymity message — the two absences mean different
    // things and must not be conflated.
    expect(title).not.toContain("k-anonymity");
  });

  it("THE DEFECT: no zero is rendered in the revenue-multiple cells", async () => {
    renderBenchmarks();
    const low = await screen.findByTestId("ma-benchmarks-not-held-fintech-revenueMultipleLow");
    expect(low.textContent).not.toContain("0");
    const row = await screen.findByTestId("ma-benchmarks-row-fintech");
    // The other eight medians are real, so a bare "0" must come only from the
    // two revenue-multiple cells. Assert on the cells themselves.
    const high = await screen.findByTestId("ma-benchmarks-not-held-fintech-revenueMultipleHigh");
    expect(high.textContent).not.toContain("0");
    expect(row).toBeTruthy();
  });

  it("does not blank the measured columns alongside it", async () => {
    renderBenchmarks();
    const row = await screen.findByTestId("ma-benchmarks-row-fintech");
    // M&A Score 71 is measured and must still show.
    expect(row.textContent).toContain("71");
    expect(row.textContent).toContain("64");
  });
});

describe("W225 · C-1 — POLE 2: a figure the platform DOES hold still renders", () => {
  beforeEach(() => {
    stub(
      benchmarksPayload([
        {
          sector: "saas",
          n: 9,
          status: "OK",
          medians: medians({ revenueMultipleLow: 4, revenueMultipleHigh: 11 }),
        },
      ]),
    );
  });

  it("renders the numbers, not the not-held treatment", async () => {
    renderBenchmarks();
    const row = await screen.findByTestId("ma-benchmarks-row-saas");
    expect(row.textContent).toContain("4");
    expect(row.textContent).toContain("11");
    expect(screen.queryByTestId("ma-benchmarks-not-held-saas-revenueMultipleLow")).toBeNull();
    expect(screen.queryByTestId("ma-benchmarks-not-held-saas-revenueMultipleHigh")).toBeNull();
  });
});

describe("W225 · C-1 — POLE 3: the k-anonymity dash is untouched (R143.1)", () => {
  beforeEach(() => {
    stub(
      benchmarksPayload([
        { sector: "biotech", n: 3, status: "INSUFFICIENT_DATA", medians: null },
      ]),
    );
  });

  it("still renders the original k-anonymity dash with its original title", async () => {
    renderBenchmarks();
    const row = await screen.findByTestId("ma-benchmarks-row-biotech");
    const titled = row.querySelectorAll(`[title="${K_ANON_TITLE}"]`);
    // One per benchmark column.
    expect(titled.length).toBeGreaterThan(0);
    // And the not-held branch must NOT fire here — this absence has a different
    // cause and a different sentence.
    expect(screen.queryByTestId("ma-benchmarks-not-held-biotech-revenueMultipleLow")).toBeNull();
  });
});
