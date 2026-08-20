/**
 * WAVE 80 · ITEM 2 — THE RESCUED VALUES REACH THE DOM, IN BOTH SHAPES.
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE IS NOT OPTIONAL. Wave 80 made the founder round wizard actually
 * persist four values it had been discarding. Persisting into a shape nothing
 * reads would be a NEW DEAD PROMISE WEARING A FIX'S CLOTHES, so the brief's rule
 * is that the value must survive the round-trip AND RENDER. This file mounts the
 * real reader components and asserts the founder's own characters are in the DOM.
 *
 * THE SHAPE CONTRADICTION, AND THE DECISION IT PROVES. The wizard collects use of
 * proceeds as ONE FREE-TEXT STRING; Round Detail and the Investor Invitation were
 * typed for an ARRAY of `{category, amount, percent}` rows. Wave 80 KEPT THE FREE
 * TEXT AND WIDENED THE READERS. The alternative — deriving rows from a sentence —
 * would mean Capavate inventing per-bucket percentages and dollar amounts the
 * founder never entered and printing them on the document an investor decides
 * from. This file asserts BOTH shapes render, and asserts that the narrative
 * branch renders NO percentage and NO bar, because that is the actual guarantee.
 *
 * BOTH POLES for every reader:
 *   VALUE pole   — the exact string is in the DOM.
 *   ABSENT pole  — with nothing recorded, the panel renders NOTHING (not a zero,
 *                  not an invented placeholder), and the previously-dead "Add use
 *                  of proceeds" control is present, DISABLED, and explained.
 *
 * MUTATION TRANSCRIPT: build_log/wave80/W80_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { UseOfProceeds, RoundNarrative, TranchePlan } from "../RoundDetail";

const BASE = {
  id: "rnd_w80", companyId: "co_w80", company: "W80 Co", name: "Series A",
  type: "priced_equity", state: "terms_set",
  targetAmount: 10_000_000, raisedAmount: 0, preMoney: 30_000_000, postMoney: 40_000_000,
  pricePerShare: 2.5, minTicket: 50_000, closeDate: "2026-12-31",
  termsSummary: "", currency: "USD", region: "US",
} as never;

function round(extra: Record<string, unknown>) {
  return { ...(BASE as object), ...extra } as never;
}

function mount(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

const PROCEEDS = "50% engineering hires (12 FTE / 18mo); 20% compute; 22% GTM; 8% legal";
const NARRATIVE =
  "We are raising to reach $4M ARR with the design partners already under contract.";
const PLAN = "Tranche 1: $300,000 at signing. Tranche 2: $200,000 on reaching $2M ARR.";

describe("WAVE 80 · ITEM 2 — Founder Round Detail renders the rescued disclosure", () => {
  it("VALUE POLE — free-text use of proceeds renders verbatim, with no invented percentage", () => {
    mount(<UseOfProceeds round={round({ useOfProceeds: PROCEEDS })} />);
    const node = screen.getByTestId("uop-narrative");
    expect(node.textContent ?? "").toContain(PROCEEDS);
    /* The structured branch must NOT have been reached: no per-row bars, and no
       "Total committed" line, because there is no total the founder ever stated. */
    expect(screen.queryByTestId("uop-row-0")).toBeNull();
    expect(screen.queryByText(/Total committed/)).toBeNull();
    /* And the empty state is gone, so the value genuinely replaced it. */
    expect(screen.queryByTestId("button-add-uop")).toBeNull();
  });

  it("SHAPE POLE — structured rows still render exactly as they always did", () => {
    const rows = [
      { category: "Engineering hires", percent: 55, amount: 577_500 },
      { category: "Cloud + compute", percent: 45, amount: 472_500 },
    ];
    mount(<UseOfProceeds round={round({ useOfProceeds: rows })} />);
    expect(screen.getByTestId("uop-row-0").textContent ?? "").toContain("Engineering hires");
    expect(screen.getByTestId("uop-row-1").textContent ?? "").toContain("Cloud + compute");
    /* The narrative branch must not have fired for an array. */
    expect(screen.queryByTestId("uop-narrative")).toBeNull();
  });

  it("ABSENT POLE — nothing recorded: the control is present, DISABLED and explained", () => {
    mount(<UseOfProceeds round={round({ useOfProceeds: null })} />);
    /* NOT DELETED — the vehicle is still there. */
    const btn = screen.getByTestId("button-add-uop");
    expect(btn).toBeTruthy();
    /* But it no longer reports a success it did not earn: it cannot be pressed. */
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    /* And the reason is on the screen, not in a toast that disappears. */
    expect(screen.getByTestId("uop-editor-unavailable").textContent ?? "")
      .toContain("not yet available");
    /* Whitespace-only is treated as nothing, not as a recorded blank narrative. */
    cleanup();
    mount(<UseOfProceeds round={round({ useOfProceeds: "   " })} />);
    expect(screen.queryByTestId("uop-narrative")).toBeNull();
    expect(screen.getByTestId("button-add-uop")).toBeTruthy();
  });

  it("VALUE POLE — the round narrative renders verbatim", () => {
    mount(<RoundNarrative round={round({ notes: NARRATIVE })} />);
    expect(screen.getByTestId("text-round-narrative").textContent).toBe(NARRATIVE);
  });

  it("ABSENT POLE — no narrative renders NOTHING, not an empty card", () => {
    const { container } = mount(<RoundNarrative round={round({ notes: null })} />);
    expect(container.textContent).toBe("");
    cleanup();
    const blank = mount(<RoundNarrative round={round({ notes: "  \n " })} />);
    expect(blank.container.textContent).toBe("");
  });

  it("VALUE POLE — the tranche plan renders, and states the yes/no answer", () => {
    mount(<TranchePlan round={round({ tranchesEnabled: true, tranchesPlan: PLAN })} />);
    expect(screen.getByTestId("text-tranche-plan").textContent).toBe(PLAN);
    expect(screen.getByTestId("text-tranches-enabled").textContent)
      .toBe("This round closes in tranches.");
  });

  it("VALUE POLE — tranches on with no plan says so, rather than showing an empty panel", () => {
    mount(<TranchePlan round={round({ tranchesEnabled: true, tranchesPlan: null })} />);
    expect(screen.getByTestId("text-tranche-plan-empty").textContent ?? "")
      .toContain("No tranche plan was recorded");
  });

  it("ABSENT POLE — tranches off and no plan renders NOTHING at all", () => {
    const { container } = mount(<TranchePlan round={round({ tranchesEnabled: false, tranchesPlan: null })} />);
    expect(container.textContent).toBe("");
    /* And a round created before this wave, which carries neither key, is identical. */
    cleanup();
    const legacy = mount(<TranchePlan round={round({})} />);
    expect(legacy.container.textContent).toBe("");
  });
});
