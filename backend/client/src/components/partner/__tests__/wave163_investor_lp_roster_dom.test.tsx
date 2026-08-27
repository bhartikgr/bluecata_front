/**
 * WAVE 163 · BLOCKER 1 (R137.1) — THE MOUNTED INVESTOR LP ROSTER.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG. `GET /api/spv/:spvId/lp-roster` returns `entries`
 * (server/spvEngineStore.ts lpRosterForViewer). The mounted investor component
 * `InvestorSpvLpRosterPanel` (client/src/components/partner/SpvOperationsPanels.tsx,
 * mounted at client/src/pages/collective/MyPortfolioPage.tsx) read
 * `subscribers ?? roster`. Neither key exists on that response, so the LP saw an
 * EMPTY roster and NONE of wave 161's stage labelling, capital split or
 * committed-only ownership reached the investor at all.
 *
 * R137.1: "an LP-facing claim is only verified when the MOUNTED component is
 * verified — a passing store test is not evidence that a user sees anything."
 * Every assertion below therefore reads RENDERED DOM of the mounted component,
 * fed the EXACT server payload shape, and never a store return value.
 *
 * ANTI-VACUITY. The fixture is wave 161's own 10.48% case: a fully committed LP
 * of $11,000.37 beside another investor's $94,000.71 non-binding indication. The
 * percentages asserted are DERIVED FROM THE FIXTURE, not substrings of a
 * hardcoded sentence, and the all-stages figure (10.4764%) is asserted to be
 * present ONLY under a label that names its denominator.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InvestorSpvLpRosterPanel } from "../SpvOperationsPanels";

const COMMITTED_MINOR = 1_100_037; //  $11,000.37 — wave 161's committed LP
const SOFT_CIRCLE_MINOR = 9_400_071; // $94,000.71 — 8.5x, non-binding
const ALL_STAGES_MINOR = COMMITTED_MINOR + SOFT_CIRCLE_MINOR; // 10,500,108

const SELF = "u_w163_committed_lp";
const OTHER = "u_w163_indicating_lp";

/** The literal response shape of GET /api/spv/:spvId/lp-roster. Field names and
 *  nesting are copied from `lpRosterForViewer`'s declared return type; if the
 *  server renames a key this fixture must be updated with it, which is the
 *  point — the mismatch this test exists for was exactly a renamed-away key. */
let payload: Record<string, unknown> = {};

function makePayload() {
  return {
    spvId: "spv_w163",
    lpVisibility: "co_investors",
    viewerInvestorId: SELF,
    entries: [
      {
        investorId: SELF,
        commitmentMinor: COMMITTED_MINOR,
        ownershipPct: COMMITTED_MINOR / ALL_STAGES_MINOR,
        isSelf: true,
        stage: "committed",
        stageLabel: "committed",
        isConfirmedCapital: true,
        ownershipPctOfAllStages: COMMITTED_MINOR / ALL_STAGES_MINOR,
        ownershipPctOfConfirmedCapital: 1,
      },
      {
        investorId: OTHER,
        commitmentMinor: SOFT_CIRCLE_MINOR,
        ownershipPct: SOFT_CIRCLE_MINOR / ALL_STAGES_MINOR,
        isSelf: false,
        stage: "soft_circled",
        stageLabel: "soft-circled — not a commitment",
        isConfirmedCapital: false,
        ownershipPctOfAllStages: SOFT_CIRCLE_MINOR / ALL_STAGES_MINOR,
        ownershipPctOfConfirmedCapital: null,
      },
    ],
    split: {
      confirmedCapitalMinor: COMMITTED_MINOR,
      softCircledInterestMinor: SOFT_CIRCLE_MINOR,
      wiredNotCommittedMinor: 0,
      allStagesMinor: ALL_STAGES_MINOR,
      unreadableRows: 0,
      confirmedRows: 1,
      interestedRows: 1,
      wiredNotCommittedRows: 0,
      allStagesRows: 2,
    },
    splitStatement:
      "1 pre-commitment subscription (soft-circled, GP-confirmed or under review) is counted as interest, not as capital.",
    viewerStage: "committed",
    viewerStageLabel: "committed",
    viewerIsConfirmedCapital: true,
    denominatorBasis: "all_stages",
    denominatorLabel:
      "share of every non-withdrawn subscription at any stage — pre-commitment interest is included in this denominator",
    confirmedDenominatorLabel:
      "share of committed capital only — pre-commitment stages are excluded from both the amount and the denominator",
    basisNote: "all stages",
  };
}

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async () =>
      ({
        ok: true,
        status: 200,
        statusText: "ok",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      }) as unknown as Response,
  };
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <InvestorSpvLpRosterPanel spvId="spv_w163" currency="USD" />
    </QueryClientProvider>,
  );
  await screen.findByTestId("investor-spv-lp-roster-panel");
  /* The panel frame exists while the query is in flight, so every assertion below
     would otherwise race the loading state. Wait for the response to land. */
  await waitFor(() => expect(screen.queryByTestId("investor-spv-lp-roster-loading")).toBeNull());
  return r;
}

function textOf(testid: string): string {
  return screen.getByTestId(testid).textContent ?? "";
}

beforeEach(() => {
  payload = makePayload();
});
afterEach(() => cleanup());

describe("WAVE 163 · BLOCKER 1 — the investor's own LP roster, in rendered DOM", () => {
  it("T163.1: the roster is NOT empty for a valid current server response", async () => {
    await mount();
    /* THE DEFECT, IN ONE ASSERTION. The component read `subscribers ?? roster`;
       the server sends `entries`, so this empty state was ALWAYS reached. */
    await screen.findByTestId(`investor-spv-lp-${SELF}`);
    expect(screen.queryByTestId("investor-spv-lp-roster-empty")).toBeNull();
    expect(screen.getAllByTestId(/^investor-spv-lp-u_w163/).length).toBe(2);
  });

  it("T163.2: the investor sees THEIR OWN ownership of committed capital (100%), not the diluted 10.48% (10.4764% of all stages)", async () => {
    await mount();
    const own = await screen.findByTestId(`investor-spv-lp-ownership-confirmed-${SELF}`);
    const shown = own.textContent ?? "";
    /* Derived from the fixture: this LP holds ALL of the capital actually
       committed to this vehicle. 1,100,037 / 1,100,037 = 1. */
    expect(shown).toContain("100%");
    /* And the denominator is NAMED on the same surface, so 100% cannot be read
       as "100% of the vehicle". */
    expect(textOf("investor-spv-lp-roster-panel")).toContain("committed capital only");
    /* The blended 10.4764% is not gone — it is LABELLED. It must never be the
       figure presented as this LP's ownership without its denominator. */
    const allStages = screen.getByTestId(`investor-spv-lp-ownership-all-stages-${SELF}`);
    expect(allStages.textContent ?? "").toContain("10.4764%");
    expect(allStages.textContent ?? "").toMatch(/any stage|all stages|non-withdrawn/i);
    expect(shown).not.toContain("10.4764%");
  });

  it("T163.3: every entry renders its STAGE in words, and a non-commitment claims no committed share", async () => {
    await mount();
    const selfRow = await screen.findByTestId(`investor-spv-lp-${SELF}`);
    expect(selfRow.textContent ?? "").toContain("committed");

    const otherRow = screen.getByTestId(`investor-spv-lp-${OTHER}`);
    expect(otherRow.textContent ?? "").toContain("soft-circled — not a commitment");
    /* R111 Q13 — absence is reported, never invented as 0.0%, which would read
       as "committed, and tiny". */
    const otherConfirmed = screen.getByTestId(`investor-spv-lp-ownership-confirmed-${OTHER}`);
    expect(otherConfirmed.textContent ?? "").toMatch(/no share of committed capital/i);
    expect(otherConfirmed.textContent ?? "").not.toMatch(/\d%/);
  });

  it("T163.4: the confirmed-vs-soft-circled SPLIT is rendered, separately labelled", async () => {
    await mount();
    const split = await screen.findByTestId("investor-spv-lp-roster-split");
    const t = split.textContent ?? "";
    /* Five figures the LP is entitled to, each beside its own words. Amounts are
       formatted from the fixture, not matched against a canned sentence. */
    expect(t).toContain("11,000.37"); // confirmed capital
    expect(t).toContain("94,000.71"); // soft-circled interest
    expect(t).toMatch(/committed capital/i);
    expect(t).toMatch(/soft-circled|interest/i);
    /* The two must not be added together and shown as one "committed" number. */
    expect(t).not.toMatch(/committed[^.]{0,40}105,001\.08/i);
    /* The server's own one-sentence disclosure reaches the LP verbatim. */
    expect(t).toContain("counted as interest, not as capital");
  });

  it("T163.5: the viewer is told plainly whether THEIR OWN row is a commitment", async () => {
    await mount();
    expect(textOf("investor-spv-lp-roster-viewer-stage")).toMatch(/committed/i);

    cleanup();
    payload = {
      ...makePayload(),
      viewerStage: "soft_circled",
      viewerStageLabel: "soft-circled — not a commitment",
      viewerIsConfirmedCapital: false,
    };
    await mount();
    const line = await screen.findByTestId("investor-spv-lp-roster-viewer-stage");
    expect(line.textContent ?? "").toContain("soft-circled — not a commitment");
  });

  it("T163.6: the legacy `subscribers` shape still renders (no consumer is dropped)", async () => {
    /* R44/drop-gate posture: `entries` is ADDED as the read key, the historical
       keys are not removed, so any other producer of this query keeps working. */
    payload = {
      subscribers: [{ investorId: "legacy_lp", commitmentMinor: 500_000, name: "Legacy Lp" }],
    };
    await mount();
    const row = await screen.findByTestId("investor-spv-lp-legacy_lp");
    expect(row.textContent ?? "").toContain("Legacy Lp");
    expect(row.textContent ?? "").toContain("5,000.00");
  });
});
