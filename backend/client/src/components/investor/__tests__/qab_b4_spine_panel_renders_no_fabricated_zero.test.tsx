/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA-B4 — RENDERED-TEXT PROOF. The panel itself, on the screen, no longer
 * prints a dollar figure it does not hold.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The unit test beside this one proves the totalling helpers refuse correctly.
 * THAT IS THE INSTRUMENT, NOT THE PRODUCT. This file mounts the REAL
 * `PortfolioStandingPanel` with a REAL wire-shaped payload and asserts the TEXT
 * an investor would actually read.
 *
 * Four poles, so a lazy fix cannot pass:
 *   A  REAL MONEY IS STILL SHOWN. A funded, single-currency book renders its
 *      true total. Deleting the tile fails here.
 *   B  THE FABRICATED ZERO IS GONE. Current value, which has no mark on this
 *      route, does NOT render $0 — it renders the platform's own refusal, and
 *      the refusal is VISIBLE to the reader rather than swallowed.
 *   C  A MIXED-CURRENCY BOOK IS NOT SUMMED. Nothing is converted.
 *   D  THE ROWS TOO. Each holding's two figures were $0 for the same reason.
 *
 * Harness modelled on wave35_lp_empty_portfolio.test.tsx, which already mounts
 * this exact panel with the spine supplied as a fixture.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortfolioStandingPanel } from "../DashboardSpinePanels";
import { PORTFOLIO_UNKNOWN_COPY } from "@/lib/investor/portfolioPositions";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

let SPINE_FIXTURE: Record<string, unknown> = {};
vi.mock("@/lib/investor/investorSpine", async () => {
  const actual = await vi.importActual<typeof import("@/lib/investor/investorSpine")>(
    "@/lib/investor/investorSpine",
  );
  return { ...actual, useInvestorSpine: () => SPINE_FIXTURE };
});

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useLocation: () => ["/investor/dashboard", vi.fn()],
    Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
      <a href={href} {...rest}>{children}</a>
    ),
  };
});

/** A position in the REAL wire shape this route serves — minor units in a
 *  string, beside an ISO currency, with `currentValueMinor` null. */
function wirePos(over: Record<string, unknown> = {}) {
  return {
    id: "pos_1", companyId: "co_1", company: "Northwind Robotics",
    sector: "Industrials", stage: null, instrument: null,
    lastRoundLabel: null, lastRoundDate: null,
    investedMinor: "25000000", currency: "USD", investedExceedsSafeRange: false,
    currentValueMinor: null, shares: null, ownershipPct: null, vintageYear: null,
    unknown: ["CURRENT_VALUE_NO_MARK_RECORDED"], matchedVia: "canonical",
    ...over,
  };
}

function setSpine(holdings: unknown[]) {
  SPINE_FIXTURE = {
    holdings,
    hasFundedPosition: holdings.length > 0,
    recentActivity: [],
    invitations: [],
    channels: {},
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortfolioStandingPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  /* The LP hook is real and will call this. An empty vehicle list keeps this
     file about B4 and nothing else. */
  apiRequestMock.mockImplementation(async () => ({ json: async () => ({ positions: [] }) }));
});
afterEach(() => cleanup());

const text = (id: string) => (screen.getByTestId(id).textContent ?? "").trim();

describe("QA-B4 · the panel renders real money, or an honest absence — never $0", () => {
  it("A · CONTROL + POLE A — a funded book renders its REAL total, not a placeholder", async () => {
    setSpine([wirePos()]);
    mount();
    await waitFor(() => expect(screen.getByTestId("spine-portfolio-invested")).toBeTruthy(), { timeout: 5000 });
    /* Precondition: the panel really rendered the holdings surface, so the
       assertions below are about a populated screen and not an empty state. */
    expect(text("spine-portfolio-count")).toBe("1");
    /* 25000000 minor USD = $250,000.00. THE OLD CODE PRINTED $0 HERE. */
    expect(text("spine-portfolio-invested")).toContain("250,000");
    expect(text("spine-portfolio-invested")).not.toBe("$0");
  });

  it("B · POLE B — current value REFUSES, and the reason is on the screen", async () => {
    setSpine([wirePos()]);
    mount();
    await waitFor(() => expect(screen.getByTestId("spine-portfolio-value")).toBeTruthy(), { timeout: 5000 });
    const shown = text("spine-portfolio-value");
    /* No mark is on record for any position on this route. The old panel told
       the investor their holdings were worth nothing. */
    expect(shown).not.toBe("$0");
    expect(shown).not.toMatch(/^\$0(\.00)?$/);
    expect(shown).toBe("Not on record");
    /* AND THE EXPLANATION IS RENDERED, not swallowed. */
    expect(text("spine-portfolio-value-why")).toBe(
      PORTFOLIO_UNKNOWN_COPY.CURRENT_VALUE_NO_MARK_RECORDED,
    );
    expect(text("spine-portfolio-value-why")).toContain("This is not a value of zero");
  });

  it("C · POLE C — a mixed-currency book is not summed and nothing is converted", async () => {
    setSpine([
      wirePos({ id: "p1", companyId: "co_1", investedMinor: "25000000", currency: "USD" }),
      wirePos({ id: "p2", companyId: "co_2", company: "Helio SAS", investedMinor: "18000000", currency: "EUR" }),
    ]);
    mount();
    await waitFor(() => expect(text("spine-portfolio-count")).toBe("2"), { timeout: 5000 });
    expect(text("spine-portfolio-invested")).toBe("Not on record");
    expect(text("spine-portfolio-invested-why")).toBe(
      PORTFOLIO_UNKNOWN_COPY.INVESTED_SPANS_CURRENCIES,
    );
    /* Neither side leaked out as if it were the answer. */
    expect(text("spine-portfolio-invested")).not.toContain("250,000");
    expect(text("spine-portfolio-invested")).not.toContain("180,000");
    expect(text("spine-portfolio-invested")).not.toContain("430,000");
  });

  it("D · POLE D — the per-row figures are real too, and carry their own currency", async () => {
    setSpine([
      wirePos({ id: "p1", companyId: "co_1", investedMinor: "25000000", currency: "USD" }),
      wirePos({ id: "p2", companyId: "co_2", company: "Helio SAS", investedMinor: "18000000", currency: "EUR" }),
    ]);
    mount();
    await waitFor(() => expect(screen.getByTestId("spine-holding-invested-co_1")).toBeTruthy(), { timeout: 5000 });
    /* Each row shows ITS OWN amount in ITS OWN currency — the case a single
       bare-dollar formatter renders as unprefixed dollars beside real ones. */
    expect(text("spine-holding-invested-co_1")).toContain("250,000");
    expect(text("spine-holding-invested-co_2")).toContain("180,000");
    expect(text("spine-holding-invested-co_1")).not.toBe("$0 invested");
    /* And the row's current value refuses rather than showing $0. */
    expect(text("spine-holding-value-co_1")).toBe("Not on record");
    expect(text("spine-holding-value-co_2")).toBe("Not on record");
  });
});
