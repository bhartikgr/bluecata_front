/**
 * WAVE 26 · S-3 SECOND PATH — the fail-closed fee state must be RENDERED.
 *
 * The server half of this fix stops `feeBreakdown` fabricating zeros and makes
 * the distribution preview refuse outright. That is only half a fix: a
 * fail-closed state that the UI does not show is indistinguishable, to the
 * person looking at the screen, from the defect it replaced.
 *
 * Two surfaces, both asserted at BOTH poles:
 *
 *   SpvFeeLedgerPanel — with `feesUnknown: true` the amounts arrive as null and
 *   the generic row renderer prints "—". Honest, but silent: a GP reads a dash
 *   as "not configured", not as "the fee schedule could not be read". A sibling
 *   refusal element states it. With `feesUnknown: false` that element must be
 *   ABSENT — a banner that is always on is noise, and the next reader learns to
 *   ignore it.
 *
 *   DistributionPreview — the pre-existing `onError` handler showed a toast and
 *   left `split` untouched, so a failed re-preview kept the PREVIOUS run's LP
 *   and GP totals on screen while the toast that announced the failure expired
 *   after a few seconds. Stale money, presented as current. The result is now
 *   cleared and the failure is rendered until a preview succeeds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvFeeLedgerPanel } from "@/components/partner/SpvOperationsPanels";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

/** The exact shape the server now returns when the fee view cannot be trusted. */
const UNKNOWN_BREAKDOWN = {
  commitmentMinor: 100000,
  managementFeeMinor: null,
  platformFeeMinor: null,
  netDeployedMinor: null,
  currency: "JPY", // ISO-4217 exponent 0 — a hardcoded /100 would misrender it.
  managementCarryPct: null,
  platformCarryPct: null,
  feesUnknown: true,
};

const HEALTHY_BREAKDOWN = {
  commitmentMinor: 100000,
  managementFeeMinor: 5000,
  platformFeeMinor: 0,
  netDeployedMinor: 95000,
  currency: "JPY",
  managementCarryPct: null,
  platformCarryPct: 0.05,
  feesUnknown: false,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpvFeeLedgerPanel spvId="spv_w26" currency="JPY" canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
}

function routeApi(breakdown: unknown) {
  apiRequestMock.mockImplementation(async (...args: unknown[]) => {
    /* The URL is located by shape rather than by position: the panel also
       drives a default query function whose argument list differs, and a
       positional read there produced `undefined.includes` — a harness bug that
       would have masked the real assertion. */
    const url = args.find((a) => typeof a === "string" && a.includes("/api/")) as string | undefined;
    if (url?.includes("/fee-breakdown")) return jsonResponse({ breakdown });
    if (url?.includes("/fee-obligations")) return jsonResponse({ obligations: [] });
    return jsonResponse({});
  });
}

beforeEach(() => apiRequestMock.mockReset());
afterEach(() => cleanup());

/**
 * ============================================================================
 * WAVE 128 - AMENDMENT, AND THE REASONING FOR IT (required reading before this
 * file is changed again).
 *
 * BOTH TESTS BELOW BROKE, AND THE TEST WAS THE THING THAT WAS WRONG.
 *
 * Wave 127 - Finding 2 fixed a real defect in `SpvFeeLedgerPanel`: with the
 * commitment box EMPTY the panel queried `/fee-breakdown` with no amount and
 * rendered whatever the server returned for it, so a GP who had typed nothing
 * was shown a management fee, a platform fee and a net-deployed figure for a
 * commitment that did not exist. The panel now holds the query until an amount
 * parses (`enabled: !awaitingCommitmentInput`) and renders a prompt in place of
 * the figures.
 *
 * These two tests rendered the panel and immediately looked for
 * `spv-fee-breakdown-netDeployedMinor` WITHOUT typing an amount. They passed
 * only because the panel used to fetch and render figures for an empty input -
 * that is, they pinned the phantom-figure behaviour wave 127 removed. Wave 127
 * never saw them fail: they are a pre-existing test of the panel it rewrote,
 * they are not among the 20 known pre-existing failures, and nothing in
 * build_log/wave127/ mentions them.
 *
 * THE FIX IS THEREFORE IN THE TEST, and it is the smallest one that preserves
 * every original assertion: each test now TYPES a commitment - which is what a
 * GP must do before any fee figure is legitimate - and then asserts exactly
 * what it asserted before: the refusal banner at the faulted pole, the honest
 * dash instead of a zero, the real 95,000 yen at the healthy pole, and the
 * absence of the banner there. Nothing was weakened: no assertion deleted, no
 * matcher loosened. What changed is the PRECONDITION, because the precondition
 * is now part of the contract. A third test is ADDED for the displaced
 * precondition itself, so the behaviour that broke these two is pinned head-on
 * rather than merely worked around.
 *
 * The amount is typed in WHOLE currency units, per WAVE 128 - FINDING 2: the
 * field no longer asks a client for cents. JPY has ISO-4217 exponent 0, so a
 * typed 1000 is 1,000 yen and reaches the wire as `commitmentMinor=1000`,
 * asserted directly below - so this file now also pins that the conversion did
 * not move the wire format for a zero-decimal currency.
 * ============================================================================
 */
/** Type a commitment, because an empty box must model nothing (wave 127). */
async function enterCommitment(whole: string) {
  const input = await screen.findByTestId("spv-fee-breakdown-input");
  fireEvent.change(input, { target: { value: whole } });
  await waitFor(() =>
    expect(
      apiRequestMock.mock.calls.some((c) =>
        c.some((a: unknown) => typeof a === "string" && a.includes("/fee-breakdown?commitmentMinor=")),
      ),
    ).toBe(true),
  );
}

describe("WAVE 26 / S-3 — SpvFeeLedgerPanel renders the withheld-fee state", () => {
  it("WAVE 128 — with NOTHING typed the panel models nothing at all", async () => {
    /* The precondition wave 127 introduced, asserted head-on: no request, no
       figures, and a prompt where the phantom breakdown used to be. */
    routeApi(HEALTHY_BREAKDOWN);
    renderPanel();
    expect(await screen.findByTestId("spv-fee-breakdown-awaiting-input")).toBeTruthy();
    expect(screen.queryByTestId("spv-fee-breakdown-netDeployedMinor")).toBeNull();
    expect(
      apiRequestMock.mock.calls.some((c) =>
        c.some((a: unknown) => typeof a === "string" && a.includes("/fee-breakdown")),
      ),
    ).toBe(false);
  });

  it("FAULTED POLE — the refusal is rendered and no fee is shown as zero", async () => {
    routeApi(UNKNOWN_BREAKDOWN);
    renderPanel();
    await enterCommitment("1000");
    const alert = await screen.findByTestId("spv-fee-breakdown-unknown");
    expect(alert.textContent).toMatch(/could not be read/i);
    expect(alert.textContent).toMatch(/no amount shown here is a zero fee/i);

    // The withheld amounts render as a dash, never as a currency-formatted 0.
    const net = await screen.findByTestId("spv-fee-breakdown-netDeployedMinor");
    expect(net.textContent).toContain("—");
    expect(net.textContent).not.toMatch(/0/);
  });

  it("HEALTHY POLE — the refusal is ABSENT and the real JPY amounts render", async () => {
    routeApi(HEALTHY_BREAKDOWN);
    renderPanel();
    await enterCommitment("1000");
    /* WAVE 128 — 1,000 yen typed in whole units is 1000 on the wire, not
       100000: the converter scales by the currency's own exponent, which is 0. */
    const url = apiRequestMock.mock.calls
      .flat()
      .find((a: unknown) => typeof a === "string" && (a as string).includes("/fee-breakdown?")) as string;
    expect(url).toMatch(/[?&]commitmentMinor=1000(&|$)/);
    const net = await screen.findByTestId("spv-fee-breakdown-netDeployedMinor");
    // JPY has exponent 0: 95000 minor units is ¥95,000. A `/100` would print 950.
    expect(net.textContent).toMatch(/95,?000/);
    expect(net.textContent).not.toMatch(/\b950\b/);
    expect(screen.queryByTestId("spv-fee-breakdown-unknown")).toBeNull();
  });
});
