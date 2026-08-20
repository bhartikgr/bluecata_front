/**
 * WAVE 61a · R47 — A CAP TABLE WITH ZERO SHARES HAS NO OWNERSHIP PERCENTAGE.
 *
 * ── THE DEFECT, AS THE FOUNDER SAW IT ────────────────────────────────────────
 * `client/src/pages/founder/CapTable.tsx` computed, pre-fix:
 *
 *     fmtPct((founderSharesNum / Math.max(1, totalSharesNum)) * 100, 2)
 *
 * On a load that SUCCEEDED and returned ZERO securities, `totalSharesNum` is 0,
 * so the ratio is 0/0 — mathematically UNDEFINED. `Math.max(1, 0)` INVENTED a
 * denominator of 1 and the page printed a confident:
 *
 *     Total shares          0
 *     Founder ownership     0.00%     (0 shares)
 *     Investor ownership    0.00%     (0 shares)
 *     Option pool           0.00%     (0 options)
 *
 * while the three cards immediately beneath honestly said "No option pool
 * reserved." and "None outstanding.". The tiles were not lying about a failed
 * load — Wave 55b already fixed that. They were lying about ARITHMETIC.
 *
 * ── WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT ─────────────────
 * `TOTAL SHARES 0` STAYS. A share count of zero is a FACT and the em-dash there
 * would be a regression. Only the three PERCENTAGES are undefined. Both halves
 * are asserted, because a fix that em-dashed all four tiles would be a silent
 * drop of a true number.
 *
 * ── BOTH POLES, BECAUSE ONE POLE PROVES NOTHING ──────────────────────────────
 *   LOWER  200 with []          -> the three ownership tiles show "—", `0.00%`
 *                                  is ABSENT from all of them, and `stat-total-shares`
 *                                  still shows `0` and NOT an em-dash.
 *   UPPER  200 with real rows   -> the three tiles print the REAL percentages,
 *                                  byte-for-byte what today's arithmetic gives.
 *                                  This is the pole that proves `Math.max` was
 *                                  removed without moving any value (R16): the
 *                                  removal is arithmetically inert for n > 0.
 *   UPPER  200 with []          -> the already-honest neighbours survive
 *                                  BYTE-IDENTICAL: "No option pool reserved.",
 *                                  "None outstanding.", and the
 *                                  `captable-empty-state` node (R44 row 3).
 *   REGRESSION                  -> Wave 55b's `securities.isError` refusal still
 *                                  mounts. This wave ADDS the genuine-zero case;
 *                                  it must not disturb the load-failure case.
 *   NO SILENT DROP              -> all four <Stat> tiles still mount in the
 *                                  zero-shares state. A refusal replaces a
 *                                  VALUE, never its CONTAINER.
 *
 * MUTATION TRANSCRIPT: build_log/wave61a/W61A_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/AppShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/AppShell")>("@/components/AppShell");
  return {
    ...actual,
    PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PageHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w61a_active",
  useActiveCompany: () => ({ data: { company: { companyName: "W61a Co" } } }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import CapTable from "../CapTable";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

/** Everything except the holder list resolves empty; the holder list is the
 *  variable under test — the same shape Wave 55b's file uses. */
function wireApi(securities: () => Promise<unknown>) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/securities$/.test(url)) return jsonResponse(await securities());
    return jsonResponse([]);
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <CapTable />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** The three tiles whose value is a PERCENTAGE, i.e. undefined at zero shares. */
const PERCENT_TILES = ["stat-founders", "stat-investors", "stat-options"];
/** The fourth tile. Its value is a COUNT, which is defined at zero. */
const COUNT_TILE = "stat-total-shares";

/** A real, populated cap table, in the `ApiSecurity` shape
 *  `shared/roundMathEngineAdapter.ts` declares. Founder 700,000 / investor
 *  250,000 / pool 50,000 of 1,000,000 total, so the expected renders are exact
 *  and hand-checkable: 70.00% / 25.00% / 5.00%. */
const POPULATED = [
  { id: "s1", companyId: "co_w61a_active", holderName: "Founder A", holderType: "founder", instrument: "common", series: null, shares: 700000, pricePerShare: 0.0001, investmentAmount: 70, cap: null, discount: null, issuedAt: "2025-01-01" },
  { id: "s2", companyId: "co_w61a_active", holderName: "Investor B", holderType: "investor", instrument: "preferred", series: "A", shares: 250000, pricePerShare: 4, investmentAmount: 1000000, cap: null, discount: null, issuedAt: "2025-02-01" },
  { id: "s3", companyId: "co_w61a_active", holderName: "Pool", holderType: "pool", instrument: "option", series: null, shares: 50000, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2025-01-01" },
];

/** The tiles only carry real values once the query has SUCCEEDED. Before that
 *  Wave 55b's `isSuccess` gate correctly shows the em-dash, so every pole below
 *  waits for success rather than for the tile merely to exist — otherwise a
 *  "shows the em-dash" assertion would pass on a still-loading page and prove
 *  nothing. `captable-empty-state` / a real percentage are the two success
 *  markers. */
async function awaitEmptySuccess() {
  await screen.findByText("No securities recorded yet.");
}
async function awaitPopulatedSuccess() {
  await waitFor(() =>
    expect(screen.getByTestId(COUNT_TILE).textContent ?? "").toContain("1,000,000"),
  );
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W61a · R47 — zero total shares means NO ownership percentage, not zero percent", () => {
  it("LOWER POLE — a SUCCESSFUL empty load shows '—' for all three ownership tiles and never '0.00%'", async () => {
    wireApi(async () => []);
    renderPage();
    await awaitEmptySuccess();

    for (const testid of PERCENT_TILES) {
      const text = screen.getByTestId(testid).textContent ?? "";
      /* The fabricated 0/0 percentage is gone … */
      expect(text).not.toContain("0.00%");
      /* … and nothing else percent-shaped took its place. */
      expect(text).not.toMatch(/\d%/);
      /* … replaced by the em-dash this file already uses for an unknown value. */
      expect(text).toContain("—");
    }
  });

  it("LOWER POLE — 'TOTAL SHARES 0' SURVIVES: a share count of zero is a fact, not an unknown", async () => {
    /* This is the assertion that stops the fix over-reaching. R47 is explicit:
       only the percentages are undefined. If a future change em-dashes this tile
       it deletes a true number and this test fails. */
    wireApi(async () => []);
    renderPage();
    await awaitEmptySuccess();
    const text = screen.getByTestId(COUNT_TILE).textContent ?? "";
    expect(text).toContain("0");
    expect(text).not.toContain("—");
  });

  it("NO SILENT DROP — all four tiles still mount at zero shares; a refusal replaces a value, not a container", async () => {
    wireApi(async () => []);
    renderPage();
    await awaitEmptySuccess();
    for (const testid of [COUNT_TILE, ...PERCENT_TILES]) {
      expect(screen.getByTestId(testid)).toBeTruthy();
    }
    /* And the tiles' own labels are untouched — no copy was changed in this item. */
    expect(screen.getByTestId("stat-founders").textContent).toContain("Founder ownership");
    expect(screen.getByTestId("stat-investors").textContent).toContain("Investor ownership");
    expect(screen.getByTestId("stat-options").textContent).toContain("Option pool");
  });

  it("LOWER POLE — the '0 shares' HINT is deliberately kept: it is a true fact and explains the em-dash", async () => {
    /* The pre-flight proposed em-dashing the hint too. That would drop a true
       number. "— (0 shares)" reads as "there are no shares, so there is no
       percentage", which is exactly the honest statement. Pinned so a later
       tidy-up has to argue with a test. */
    wireApi(async () => []);
    renderPage();
    await awaitEmptySuccess();
    expect(screen.getByTestId("stat-founders").textContent).toContain("0 shares");
    expect(screen.getByTestId("stat-options").textContent).toContain("0 options");
  });

  it("UPPER POLE — a POPULATED cap table prints the real percentages, unchanged by removing Math.max (R16)", async () => {
    /* 700,000 / 1,000,000 = 70.00% · 250,000 = 25.00% · 50,000 = 5.00%.
       `Math.max(1, n) === n` for every n > 0, so deleting the fabricated
       denominator is arithmetically inert on this pole. If any value moved, this
       fails. */
    wireApi(async () => POPULATED);
    renderPage();
    await awaitPopulatedSuccess();
    expect(screen.getByTestId("stat-founders").textContent).toContain("70.00%");
    expect(screen.getByTestId("stat-investors").textContent).toContain("25.00%");
    expect(screen.getByTestId("stat-options").textContent).toContain("5.00%");
    for (const testid of PERCENT_TILES) {
      expect(screen.getByTestId(testid).textContent).not.toContain("—");
    }
  });

  it("UPPER POLE — BYTE-IDENTICAL SURVIVAL of the already-honest neighbours (R44 row 3)", async () => {
    wireApi(async () => []);
    renderPage();
    /* Exact bytes, asserted individually. These are the two strings R44 names by
       name as examples of copy to LEAVE ALONE. */
    expect(await screen.findByText("No option pool reserved.")).toBeTruthy();
    expect(screen.queryAllByText("None outstanding.").length).toBeGreaterThan(0);
    expect(screen.getByTestId("captable-empty-state")).toBeTruthy();
    expect(await screen.findByText("No securities recorded yet.")).toBeTruthy();
  });

  it("REGRESSION — Wave 55b's load-FAILURE refusal still mounts and is not disturbed by the zero case", async () => {
    /* The two cases are different and must stay different: a FAILED load mounts
       LoadFailedRefusal; a SUCCESSFUL empty load does not, it just refuses the
       three percentages. */
    wireApi(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderPage();
    await screen.findByTestId("founder-captable-holders-error");
    expect(screen.queryByText("No securities recorded yet.")).toBeNull();
  });

  it("REGRESSION — the successful-empty case does NOT mount the load-failure refusal", async () => {
    wireApi(async () => []);
    renderPage();
    expect(await screen.findByText("No securities recorded yet.")).toBeTruthy();
    expect(screen.queryByTestId("founder-captable-holders-error")).toBeNull();
  });

  it("SOURCE — the fabricated denominator is REMOVED, not papered over, and NaN stays impossible", async () => {
    /* R47: "Remove the fabricated denominator, don't paper over it. Keep NaN
       impossible." A `totalSharesNum > 0` guard in front of a surviving
       `Math.max(1, totalSharesNum)` would satisfy the screen but leave the
       fabrication in the tree for the next reader to copy. */
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "CapTable.tsx"),
      "utf8",
    );
    /* Asserted on the CODE shape, not on any occurrence of the words: the
       explanatory comment above the tiles quotes the old expression on purpose,
       so that the next reader knows what was removed and why. */
    expect(src).not.toContain("/ Math.max(1, totalSharesNum))");
    /* NaN is impossible because every division is gated on `> 0`. */
    const divisions = src.match(/\w+SharesNum \/ totalSharesNum/g) ?? [];
    expect(divisions.length).toBe(3);
    expect((src.match(/securities\.isSuccess && totalSharesNum > 0/g) ?? []).length).toBe(3);
  });
});
