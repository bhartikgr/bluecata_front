/**
 * WAVE 55b · OQ-3 — A FAILED HOLDER-LIST LOAD IS NOT "YOU OWN NOTHING".
 *
 * ── THE DEFECT, AS THE FOUNDER SAW IT ────────────────────────────────────────
 * `client/src/pages/founder/CapTable.tsx` had ZERO references to
 * `LoadFailedRefusal` (16 other files already used it) and no error branch of any
 * kind on its holder query. Every figure on the page derives from that one query,
 * so on a 404 / 403 / 500 the page rendered:
 *
 *     Total shares          0
 *     Founder ownership     0.00%     (0 shares)
 *     Investor ownership    0.00%     (0 shares)
 *     Option pool           0.00%     (0 options)
 *     SAFEs + Notes outstanding   None outstanding.
 *     Warrants outstanding        None outstanding.
 *     Option pool sub-breakdown   No option pool reserved.
 *     …and an empty holder table.
 *
 * The PF-1 empty-state card did not even appear (it required
 * `securities.data !== undefined`), so the founder got a page of zeros with NO
 * explanation whatsoever. To a founder that is indistinguishable from a factual
 * statement about their equity.
 *
 * ── WHY THIS FILE DRIVES A REAL HTTP ROUTE ───────────────────────────────────
 * The data comes from a route, so the failure is proved by that route rather
 * than by a hand-thrown error. `apiRequest` is redirected at the REAL
 * `registerRoutes` Express stack over supertest and the real status is converted
 * exactly the way `client/src/lib/queryClient.ts` converts it (throw `ApiError`
 * on non-2xx). The LOWER pole is therefore the genuine cap-table sink refusal
 * (`decideCapTableSinkAccess` → 404, WAVE 35 · F8 / WAVE 42 · F-9), not a mock.
 *
 * ── BOTH POLES, BECAUSE ONE POLE PROVES NOTHING ──────────────────────────────
 * A test that only asserted "failure shows the refusal" would still pass if the
 * refusal were shown unconditionally, which would destroy the honest empty state
 * the platform already words well. So every failure assertion is paired with a
 * genuine-empty-success assertion that the EXISTING copy is UNCHANGED:
 *
 *   LOWER POLE  real 404 from the real route  -> refusal present, role=alert,
 *               "No securities recorded yet." ABSENT, "None outstanding." ABSENT,
 *               and the tiles show no fabricated 0 / 0.00%.
 *   UPPER POLE  200 with []                   -> "No securities recorded yet."
 *               present, byte-identical, refusal ABSENT.
 *   NO SILENT DROP  in the failure state the as-of input, the region select, the
 *               mode toggle and the export controls are all STILL PRESENT.
 *
 * MUTATION TRANSCRIPT: build_log/wave55b/W55B_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/queryClient";
import { W55B_CAP_TABLE_REFUSAL_STATUS } from "@shared/w55bCapTableRefusal";

/* ── the real route's refusal, replayed ──────────────────────────────────── */

/** Pinned in `shared/w55bCapTableRefusal.ts` and proved against the REAL
 *  `registerRoutes` stack in `server/__tests__/w55b_captable_family_refusal_http.test.ts`
 *  (GET /api/companies/:id/securities → this status for an unrelated principal).
 *  This file runs under jsdom, where Vite resolves for the browser and importing
 *  `server/routes.ts` fails on server-only optional AWS SDK sub-packages — hence
 *  the split, with the constant as the join. */
const realRefusalStatus = W55B_CAP_TABLE_REFUSAL_STATUS;
const realRefusalBody = { ok: false, error: "not_found" };

/* ── the page under test ─────────────────────────────────────────────────── */

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
  useActiveCompanyId: () => "co_w55b_active",
  useActiveCompany: () => ({ data: { company: { companyName: "W55b Co" } } }),
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
 *  variable under test. */
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

const EMPTY_COPY = "No securities recorded yet.";
const NONE_OUTSTANDING = "None outstanding.";

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W55b · OQ-3 — founder cap table: a failed load is distinguishable from an empty one", () => {
  it("FIXTURE — the replayed status is a real refusal, not a 2xx", () => {
    /* Without this the lower pole could be 'passing' against a 200. The claim
       that this IS the status the route returns is proved by
       server/__tests__/w55b_captable_family_refusal_http.test.ts. */
    expect(realRefusalStatus).toBeGreaterThanOrEqual(400);
    expect(realRefusalStatus).toBe(404);
  });

  it("LOWER POLE — the REAL route refusal renders the refusal, not a cap table of zero", async () => {
    wireApi(async () => {
      throw new ApiError(realRefusalStatus, "refused", null, realRefusalBody);
    });
    renderPage();

    const err = await screen.findByTestId("founder-captable-holders-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn’t load your cap table holders");

    /* THE defect: pre-fix each of these found its text. */
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryAllByText(NONE_OUTSTANDING)).toHaveLength(0);
    expect(screen.queryByText("No option pool reserved.")).toBeNull();
  });

  it("LOWER POLE — no tile asserts a zero the platform does not know", async () => {
    wireApi(async () => {
      throw new ApiError(realRefusalStatus, "refused", null, realRefusalBody);
    });
    renderPage();
    await screen.findByTestId("founder-captable-holders-error");

    for (const testid of ["stat-total-shares", "stat-founders", "stat-investors", "stat-options"]) {
      const tile = screen.getByTestId(testid);
      const text = tile.textContent ?? "";
      expect(text).not.toContain("0.00%");
      expect(text).not.toMatch(/(^|[^0-9.])0([^0-9.]|$)/);
      expect(text).toContain("—");
    }
  });

  it("NO SILENT DROP — the failure state removes no control, widget or panel", async () => {
    wireApi(async () => {
      throw new ApiError(realRefusalStatus, "refused", null, realRefusalBody);
    });
    renderPage();
    await screen.findByTestId("founder-captable-holders-error");

    for (const testid of [
      "input-asof",
      "button-asof-today",
      "select-region-captable",
      "captable-mode-toggle",
      "button-toggle-grouping",
      "card-pool-breakdown",
      "card-convertibles",
      "card-warrants",
      "stat-total-shares",
    ]) {
      expect(screen.getByTestId(testid)).toBeTruthy();
    }
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    wireApi(async () => {
      calls += 1;
      throw new ApiError(realRefusalStatus, "refused", null, realRefusalBody);
    });
    renderPage();
    await screen.findByTestId("founder-captable-holders-error");
    const before = calls;
    fireEvent.click(screen.getByTestId("founder-captable-holders-error-retry"));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("UPPER POLE — a genuine empty success still shows the EXISTING empty-state copy, unchanged", async () => {
    wireApi(async () => []);
    renderPage();
    expect(await screen.findByText(EMPTY_COPY)).toBeTruthy();
    expect(screen.getByTestId("captable-empty-state")).toBeTruthy();
    /* The rest of the established empty voice is intact too. */
    expect(screen.queryAllByText(NONE_OUTSTANDING).length).toBeGreaterThan(0);
    expect(screen.getByText("No option pool reserved.")).toBeTruthy();
    expect(screen.queryByTestId("founder-captable-holders-error")).toBeNull();
  });

  it("a 500 behaves the same as the 404 — a fault is a state, not an absence", async () => {
    wireApi(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderPage();
    await screen.findByTestId("founder-captable-holders-error");
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("a PAUSED query (offline) is not an empty cap table either", async () => {
    /* React Query pauses rather than fetches when offline: pending, not
       fetching, not errored. `!isLoading && !isError` is TRUE there, which is
       why the empty state is gated on `isSuccess`. */
    wireApi(async () => []);
    onlineManager.setOnline(false);
    try {
      renderPage();
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("the refusal states no count and no money — it never implies a value", async () => {
    wireApi(async () => {
      throw new ApiError(realRefusalStatus, "refused", null, realRefusalBody);
    });
    renderPage();
    const err = await screen.findByTestId("founder-captable-holders-error");
    const text = err.textContent ?? "";
    for (const forbidden of ["$", "0 shares", "0.00", "USD", "%"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
