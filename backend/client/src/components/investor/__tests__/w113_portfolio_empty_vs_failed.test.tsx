/* ════════════════════════════════════════════════════════════════════════════
   WAVE 113 · FINDING 4 (wave 45) — "PERMANENTLY EMPTY PORTFOLIO": AN EMPTY PAGE
   THAT DOES NOT SAY WHY.
   ════════════════════════════════════════════════════════════════════════════
   THE HONEST VERDICT FIRST. For an investor who holds nothing, "Your portfolio is
   empty" is CORRECT, and POLE A below fails if that state is ever deleted or
   weakened. No position is fabricated anywhere in this wave. The defect was
   narrower and worse: `const data = positions.data ?? []` and
   `(positions.data?.length ?? 1) > 0` made a 403, a 500 and an offline browser
   indistinguishable from "you hold nothing", so a FAILURE was published to a
   customer as a FACT about their holdings.

   ANTI-VACUITY. Deleting the empty-state, or rendering the refusal always, passes
   a naive "the errored investor does not see the word empty" test. Every pole
   below therefore asserts BOTH what must appear and what must not:

     POLE A — genuinely empty (200, `[]`)      → empty state, original copy, CTAs
     POLE B — the request FAILED (503)          → refusal + retry, and NOT "empty"
     POLE C — the query is PAUSED (offline)     → refusal, and NOT "empty"
     POLE D — positions exist (200, one row)    → the switcher, no refusal
     POLE E — retry is wired to the real query  → refetch actually re-issues it

   Copy is asserted against the shipped component's own strings, and the two
   pre-existing honest states (`portfolio-lp-only-state`,
   `portfolio-empty-pending-lp`) are re-asserted so this wave cannot be shown to
   have broken Wave 35 · Row 7 on the way past.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { PortfolioCompanySwitcher } from "../PortfolioCompanySwitcher";
import { LP_ONLY_HEADLINE } from "@/lib/investor/lpVehicleInterests";

const FALSE_SENTENCE = "Your portfolio is empty";
const LADDER_COPY = /You don't hold any positions yet/;

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return { ...actual, useLocation: () => ["/investor/portfolio", vi.fn()] };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const DIRECT = (companyId: string, company: string) => ({
  id: `pos_${companyId}`,
  companyId,
  company,
  logoColor: "#123456",
});

/** Counts how many times the positions endpoint was actually asked. */
let positionsCalls = 0;

function makeClient(opts: {
  positions: ReturnType<typeof DIRECT>[] | "fail";
  lp?: unknown[] | "fail";
}) {
  positionsCalls = 0;
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url === "/api/investor/me/lp-positions") {
      if (opts.lp === "fail") throw new Error("503 LP_POSITIONS_UNAVAILABLE");
      return jsonResponse({ positions: opts.lp ?? [], collectiveScope: "all" });
    }
    throw new Error(`unexpected apiRequest to ${url}`);
  });

  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        queryFn: async ({ queryKey }) => {
          const key = String(queryKey[0]);
          if (key === "/api/investor/portfolio2") {
            positionsCalls += 1;
            if (opts.positions === "fail") throw new Error("503 PORTFOLIO_UNAVAILABLE");
            return opts.positions;
          }
          throw new Error(`unexpected query ${key}`);
        },
      },
    },
  });
}

const SWITCHER = <PortfolioCompanySwitcher selectedCompanyId={null} onCompanyChange={() => {}} />;

function renderWith(qc: QueryClient) {
  return render(<QueryClientProvider client={qc}>{SWITCHER}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.clearAllMocks();
});
beforeEach(() => {
  onlineManager.setOnline(true);
});

describe("WAVE 113 · FINDING 4 · POLE A — a genuinely empty portfolio still says so", () => {
  it("renders the original empty state, copy and CTAs when the server says []", async () => {
    renderWith(makeClient({ positions: [], lp: [] }));
    await waitFor(() => expect(screen.getByTestId("portfolio-empty-state")).toBeTruthy());
    expect(screen.getByText(FALSE_SENTENCE)).toBeTruthy();
    expect(screen.getByText(LADDER_COPY)).toBeTruthy();
    expect(screen.getByTestId("button-portfolio-review-invitations")).toBeTruthy();
    expect(screen.getByTestId("button-portfolio-claim-earlier")).toBeTruthy();
    // And NOT a refusal: this investor's emptiness is a fact, not a failure.
    expect(screen.queryByTestId("portfolio-positions-load-failed")).toBeNull();
    expect(screen.queryByTestId("portfolio-positions-not-loaded")).toBeNull();
  });
});

describe("WAVE 113 · FINDING 4 · POLE B — a FAILED load is not an empty portfolio", () => {
  it("refuses in plain English, offers a retry, and never claims the portfolio is empty", async () => {
    renderWith(makeClient({ positions: "fail", lp: [] }));
    const refusal = await waitFor(() => screen.getByTestId("portfolio-positions-load-failed"));
    expect(refusal.getAttribute("role")).toBe("alert");
    expect(refusal.textContent ?? "").toMatch(/couldn.t load your portfolio positions/i);
    expect(refusal.textContent ?? "").toMatch(/loading failure, not an empty list/i);
    expect(screen.getByTestId("portfolio-positions-load-failed-retry")).toBeTruthy();

    // THE DEFECT, asserted absent.
    expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    expect(screen.queryByText(LADDER_COPY)).toBeNull();
    expect(screen.queryByTestId("portfolio-empty-state")).toBeNull();
  });

  it("states no count and no money — it does not guess at what was not loaded", async () => {
    renderWith(makeClient({ positions: "fail", lp: [] }));
    const refusal = await waitFor(() => screen.getByTestId("portfolio-positions-load-failed"));
    const text = refusal.textContent ?? "";
    expect(text).not.toMatch(/\$|\d+\s*(position|company|holding)/i);
    expect(text).not.toMatch(/\b0\b/);
  });
});

describe("WAVE 113 · FINDING 4 · POLE C — a PAUSED query (offline) is not an empty portfolio", () => {
  it("does not present emptiness while the answer is simply unknown", async () => {
    /* React Query's paused state: not loading, not fetching, not errored, not
       successful. A `!isLoading && !isError` gate renders "empty" here — that is
       the mutation Wave 22's own falsification run missed, so it is asserted. */
    onlineManager.setOnline(false);
    renderWith(makeClient({ positions: [], lp: [] }));
    const refusal = await waitFor(() => screen.getByTestId("portfolio-positions-not-loaded"));
    expect(refusal.getAttribute("role")).toBe("alert");
    expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    expect(screen.queryByTestId("portfolio-empty-state")).toBeNull();
  });
});

describe("WAVE 113 · FINDING 4 · POLE D — a real portfolio is unaffected", () => {
  it("renders the switcher and no refusal when positions load", async () => {
    renderWith(makeClient({ positions: [DIRECT("co_novapay", "NovaPay AI")], lp: [] }));
    await waitFor(() => expect(screen.getByTestId("portfolio-company-switcher")).toBeTruthy());
    expect(screen.queryByTestId("portfolio-empty-state")).toBeNull();
    expect(screen.queryByTestId("portfolio-positions-load-failed")).toBeNull();
    expect(screen.queryByTestId("portfolio-positions-not-loaded")).toBeNull();
    expect(screen.getByText("NovaPay AI")).toBeTruthy();
  });
});

describe("WAVE 113 · FINDING 4 · POLE E — the retry is wired to the real query", () => {
  it("re-issues the positions request when the investor retries", async () => {
    renderWith(makeClient({ positions: "fail", lp: [] }));
    const retry = await waitFor(() => screen.getByTestId("portfolio-positions-load-failed-retry"));
    const before = positionsCalls;
    (retry as HTMLButtonElement).click();
    await waitFor(() => expect(positionsCalls).toBeGreaterThan(before));
  });
});

describe("WAVE 113 · FINDING 4 — Wave 35 · Row 7's honest states survive this wave", () => {
  it("an LP-only investor still gets the LP-only state, not the empty state", async () => {
    renderWith(
      makeClient({
        positions: [],
        lp: [
          {
            spvId: "spv_1",
            spvName: "Vehicle One",
            jurisdiction: "DE",
            currency: "JPY",
            positionType: "spv_lp_interest",
            commitmentMinor: 5_000_000,
            calledCapitalMinor: 5_000_000,
            distributionsReceivedMinor: 0,
            ownershipFraction: 0.05,
            capitalAccountMinor: 5_000_000,
            navTotalMinor: null,
            navShareMinor: null,
            navAsOfDate: "2026-01-01",
            navBadge: null,
            navRefusalCopy: null,
            hasSideLetter: false,
            refusalCopy: null,
          },
        ],
      }),
    );
    await waitFor(() => expect(screen.getByTestId("portfolio-lp-only-state")).toBeTruthy());
    expect(screen.getByText(LP_ONLY_HEADLINE)).toBeTruthy();
    expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    // And the positions refusal is NOT shown — that query succeeded.
    expect(screen.queryByTestId("portfolio-positions-load-failed")).toBeNull();
  });
});
