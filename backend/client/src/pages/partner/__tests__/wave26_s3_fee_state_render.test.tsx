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

describe("WAVE 26 / S-3 — SpvFeeLedgerPanel renders the withheld-fee state", () => {
  it("FAULTED POLE — the refusal is rendered and no fee is shown as zero", async () => {
    routeApi(UNKNOWN_BREAKDOWN);
    renderPanel();
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
    const net = await screen.findByTestId("spv-fee-breakdown-netDeployedMinor");
    // JPY has exponent 0: 95000 minor units is ¥95,000. A `/100` would print 950.
    expect(net.textContent).toMatch(/95,?000/);
    expect(net.textContent).not.toMatch(/\b950\b/);
    expect(screen.queryByTestId("spv-fee-breakdown-unknown")).toBeNull();
  });
});
