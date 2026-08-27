/**
 * WAVE 163 · BLOCKER 3 — THE ADMIN TILE MUST DESCRIBE THE NUMBER IT PRINTS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * Wave 161 moved the "SPV Committed" tile's basis to `status = 'committed'` only
 * (`server/lib/adminKpiDbReads.ts:298-315`), and moved the all-stages sum to its
 * own "Incl. pipeline (all stages)" line (`:317-337`). But the FIRST tooltip under
 * the committed heading was left reading:
 *
 *     "Sum of active (non-withdrawn) SPV commitments, PER CURRENCY."
 *
 * A non-withdrawn population INCLUDES soft-circled, GP-confirmed, under-review and
 * wired-but-not-committed subscriptions. The tile's number excludes all four. So
 * the first sentence an operator reads described a DIFFERENT figure from the one
 * printed beneath it, and wave 161's own correction sat in a SECOND tip that could
 * only contradict the first. The post-build review calls this out directly:
 * *"Correct the wording to match what the number now is."*
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY THESE ASSERTIONS ARE ON OPENED TOOLTIPS AND NOT ON SOURCE TEXT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * R137.1: *"a passing store test is not evidence that a user sees anything."* The
 * same objection applies to a source grep. `HelpTip` is a radix Tooltip, so its
 * content exists in the DOM only once the trigger is focused — every assertion
 * below therefore FOCUSES the real trigger inside the REAL rendered
 * `admin/Dashboard`, then reads the text the operator actually sees. §3 adds two
 * comment-STRIPPED source checks, because ORDER (which tip comes first) is a
 * property of the file and radix does not expose it; those are additional to the
 * DOM evidence, never instead of it.
 *
 * NOTHING IS DROPPED. §2 proves the wave 161 sentence still renders — relocated,
 * verbatim, beside the pipeline figure it genuinely describes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import dashboardSource from "../Dashboard.tsx?raw";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useLocation: () => ["/admin", vi.fn()] };
});

import AdminDashboard from "../Dashboard";

/** The tile's two figures, deliberately DIFFERENT, so a tooltip that describes the
 *  wrong population is describing a visibly different number. */
const COMMITTED_MINOR = 1_100_037; //  $11,000.37 — committed capital
const ALL_STAGES_MINOR = 10_500_108; // $105,001.08 — every non-withdrawn stage

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const KPIS = {
  summary: {
    totalCompanies: 3,
    totalInvestors: 4,
    totalCommittedSoftCircle: null,
    totalFunded: null,
    momGrowthPct: null,
    churnPct: null,
    nrr: null,
    totalSpvCommittedMinor: { USD: COMMITTED_MINOR },
    totalSpvSubscribedAllStagesMinor: { USD: ALL_STAGES_MINOR },
    totalSpvWiredMinor: { USD: 400_000 },
    totalActiveSpvs: 2,
  },
  queues: {},
  health: {
    capTableReconcile: { runs: 0, success: 0, successRatePct: null },
    closeGateFailures: null,
    dataroomUploadErrors: null,
    messageDelivery: { sent: null, delivered: null, deliveryRatePct: null },
    emailSlaSec: null,
  },
  funnels: { onboarding: [], investor: [] },
  topCompanies: [],
  topInvestors: [],
  regions: [],
};

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/api/admin/dashboard/kpis")) return jsonResponse(KPIS);
    if (url.includes("/api/admin/dashboard/activity")) return jsonResponse({ items: [] });
    return jsonResponse({});
  });
});

afterEach(() => cleanup());

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider delayDuration={0}>
          <AdminDashboard />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** Focus the real trigger and return the text the operator sees. */
async function openTip(testid: string): Promise<string> {
  const trigger = await screen.findByTestId(testid, undefined, { timeout: 5000 });
  fireEvent.focus(trigger);
  let text = "";
  await waitFor(() => {
    /* radix renders the content in a portal; role="tooltip" is how a screen reader
       and this test both find it. */
    const tips = Array.from(document.querySelectorAll('[role="tooltip"]'));
    text = tips.map((t) => (t.textContent || "").replace(/\u00a0/g, " ")).join(" | ");
    expect(text.length, `tooltip ${testid} never opened`).toBeGreaterThan(0);
  });
  return text;
}

/* ══════════════════════════════════════════════════════════════════════════
 * §0 — THE FIXTURE IS NOT VACUOUS: THE TWO FIGURES ARE VISIBLY DIFFERENT.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 B3 §0 — committed and pipeline are different numbers on screen", () => {
  /* The tile renders whole major units (`fmtCurrencyMinor` uses
     maximumFractionDigits: 0), so $11,000.37 reaches the screen as "11,000 USD".
     Asserted as the screen shows it, not as one might wish it showed it. */
  it("T163B3.0: the tile prints 11,000 USD committed and 105,001 USD pipeline", async () => {
    renderDashboard();
    const committed = await screen.findByTestId("stat-spv-committed-values", undefined, { timeout: 5000 });
    const pipeline = await screen.findByTestId("stat-spv-all-stages-values", undefined, { timeout: 5000 });
    await waitFor(() => expect((committed.textContent || "").replace(/\u00a0/g, " ")).toMatch(/11,000 USD/));
    expect((pipeline.textContent || "").replace(/\u00a0/g, " ")).toMatch(/105,001 USD/);
    /* If these were the same number the wording defect would be harmless; they are
       not, which is why a wrong description misleads. */
    expect(COMMITTED_MINOR).not.toBe(ALL_STAGES_MINOR);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — THE COMMITTED TILE'S OWN TOOLTIP DESCRIBES COMMITTED CAPITAL.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 B3 §1 — the committed heading no longer claims a non-withdrawn basis", () => {
  it("T163B3.1: the tip a reader opens on the committed heading says committed capital ONLY", async () => {
    renderDashboard();
    const text = await openTip("admin-spv-committed-tooltip");
    expect(text, "the tile must state its own basis in the words the operator reads").toMatch(
      /Committed capital ONLY/,
    );
    /* THE DEFECT'S SENTENCE MUST BE ABSENT FROM THIS TOOLTIP, not merely
       un-asserted. Its presence here was the whole finding. */
    expect(text, "a committed-only figure must not be described as non-withdrawn").not.toMatch(
      /Sum of active \(non-withdrawn\) SPV commitments/,
    );
    expect(text, "and must not be described as 'active' commitments at all").not.toMatch(/active \(non-withdrawn\)/);
  });

  it("T163B3.2: it names what is excluded, so the reader is not left to infer it", async () => {
    renderDashboard();
    const text = await openTip("admin-spv-committed-tooltip");
    expect(text).toMatch(/Soft-circled/);
    expect(text).toMatch(/under-review/);
    expect(text).toMatch(/funds received without a committed subscription/);
    /* The per-currency guarantee is a real property of the figure and must survive
       the rewording (wave 34's multi-currency contract). */
    expect(text).toMatch(/PER CURRENCY/);
    expect(text).toMatch(/Never a scalar sum across mixed currencies/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — NO COPY WAS DROPPED: THE WAVE 161 SENTENCE STILL RENDERS.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 B3 §2 — the baselined sentence is relocated, not deleted", () => {
  it("T163B3.3: the pipeline heading renders the wave 161 sentence verbatim", async () => {
    renderDashboard();
    const text = await openTip("admin-spv-pipeline-legacy-tooltip");
    expect(text, "the baselined string must still reach a user, beside the figure it describes").toMatch(
      /Sum of active \(non-withdrawn\) SPV commitments, PER CURRENCY\. Never a scalar sum across mixed currencies\./,
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — ORDER. Radix cannot show it; the file can. Comments STRIPPED first.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 B3 §3 — the committed tip comes FIRST under the committed heading", () => {
  const stripped = dashboardSource
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("T163B3.4: the first HelpTip after 'SPV Committed' states the committed-only basis", () => {
    const headingAt = stripped.indexOf("SPV Committed");
    expect(headingAt, "the heading must exist, or this test measures nothing").toBeGreaterThan(-1);
    const after = stripped.slice(headingAt);
    const firstTip = after.indexOf("<HelpTip");
    expect(firstTip).toBeGreaterThan(-1);
    const firstTipText = after.slice(firstTip, firstTip + 400);
    expect(firstTipText, "the tile's own basis must be the FIRST thing described").toContain(
      "Committed capital ONLY",
    );
    expect(firstTipText, "and the all-stages sentence must not be the first thing described").not.toContain(
      "Sum of active (non-withdrawn) SPV commitments",
    );
  });

  it("T163B3.5: the all-stages sentence appears only after the pipeline heading", () => {
    const legacyAt = stripped.indexOf("Sum of active (non-withdrawn) SPV commitments");
    const committedHeadingAt = stripped.indexOf("SPV Committed");
    const pipelineHeadingAt = stripped.indexOf("Incl. pipeline (all stages)");
    expect(legacyAt).toBeGreaterThan(-1);
    expect(committedHeadingAt).toBeGreaterThan(-1);
    expect(pipelineHeadingAt).toBeGreaterThan(-1);
    /* The sentence is a LITERAL text node (a `const` made the silent-drop guard
       report it as removed copy), so its position in the file IS its position on
       the tile. It must sit after the pipeline heading and before nothing else. */
    expect(legacyAt, "the baselined sentence must now sit under the pipeline heading").toBeGreaterThan(
      pipelineHeadingAt,
    );
    expect(
      stripped.split("Sum of active (non-withdrawn) SPV commitments").length - 1,
      "exactly one occurrence — it was moved, not duplicated",
    ).toBe(1);
  });
});
