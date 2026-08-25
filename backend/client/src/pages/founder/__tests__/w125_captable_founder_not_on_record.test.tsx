/**
 * WAVE 125 · FINDING 1 — THE CAP TABLE NO LONGER TELLS A FOUNDER HE OWNS NOTHING.
 *
 * ── THE DEFECT, AS THE FOUNDER SAW IT, LIVE ─────────────────────────────────
 * `BluePrint Catalyst Limited`: 150 total shares, ONE investor holding all 150,
 * NO founder row on record. `/founder/captable` rendered
 *
 *     FOUNDER OWNERSHIP     0.00%
 *                           0 shares
 *
 * while `/founder/dashboard`, from the same data, rendered `—`. Two screens, two
 * answers, and the CAP TABLE's answer was a fabrication: nothing about the
 * founders is on record, so the platform does not know their share. `0.00%` is not
 * a missing number, it is a WRONG one, on the single figure a founder cares about
 * most, and he would reasonably conclude he had been wiped out.
 *
 * `server/lib/founderOwnershipEngine.ts:158-171` already refuses this exact case
 * with the reason `no_founder_holding_on_record`, and its own comment names this
 * screen. The renderer never asked it: `CapTable.tsx` summed the EMPTY founder set
 * to `0n` and published the result.
 *
 * ── THREE POLES, BECAUSE TWO OF THEM SUM TO THE SAME ZERO ───────────────────
 *   A  REFUSAL      150 recorded, no founder row  -> NO percentage, NO share
 *                                                   count, and a plain-English
 *                                                   reason. `stat-total-shares`
 *                                                   still shows 150 (a fact), and
 *                                                   `stat-investors` still shows
 *                                                   100.00% (also a fact).
 *   B  GENUINE ZERO a founder row RECORDING 0 of  -> `0.00%` AND `0 shares`, both
 *                   150                             printed. This is the case the
 *                                                   brief protects, and it is the
 *                                                   reason the fix keys on ROW
 *                                                   PRESENCE and not on the sum.
 *   C  EMPTY        a successful load of []       -> BYTE-IDENTICAL to Wave 61a:
 *                                                   `—` for the percentage, and
 *                                                   `0 shares` still present.
 *                                                   This wave must not widen the
 *                                                   refusal into this state.
 *   D  NO SILENT DROP  all four <Stat> tiles still mount in every pole. A refusal
 *                      replaces a VALUE, never its CONTAINER.
 *
 * FAIL-BEFORE: pole A asserted `0.00%` and `0 shares` before this wave — see the
 * recorded control run in `build_log/wave125/W125_TESTS.md`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  useActiveCompanyId: () => "co_w125_blueprint",
  useActiveCompany: () => ({ data: { company: { companyName: "BluePrint Catalyst Limited" } } }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import CapTable from "../CapTable";
import { FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT } from "@/lib/captable/founderHoldingOnRecord";

const CID = "co_w125_blueprint";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function wireApi(securities: unknown) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/securities$/.test(url)) return jsonResponse(securities);
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

const ALL_TILES = ["stat-total-shares", "stat-founders", "stat-investors", "stat-options"];

/** POLE A — production's BluePrint Catalyst: 150 shares, one investor, no founder. */
const NO_FOUNDER_ROW = [
  { id: "sec_w125_inv", companyId: CID, holderName: "Aster Capital", holderType: "investor", instrument: "common", series: null, shares: 150, pricePerShare: 1, investmentAmount: 150, cap: null, discount: null, issuedAt: "2026-01-01" },
];

/** POLE B — the SAME cap table with a founder row that RECORDS ZERO shares. */
const FOUNDER_ROW_RECORDING_ZERO = [
  { id: "sec_w125_f0", companyId: CID, holderName: "Ada Okafor", holderType: "founder", instrument: "common", series: null, shares: 0, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2026-01-01" },
  ...NO_FOUNDER_ROW,
];

async function awaitTotal(text: string) {
  await waitFor(() => expect(screen.getByTestId("stat-total-shares").textContent ?? "").toContain(text));
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W125 · FINDING 1 — POLE A: 150 shares on record and no founder row", () => {
  it("publishes NO founder percentage and NO founder share count", async () => {
    wireApi(NO_FOUNDER_ROW);
    renderPage();
    await awaitTotal("150");

    const founders = screen.getByTestId("stat-founders").textContent ?? "";
    /* THE DEFECT, GONE: neither of the two figures this tile used to publish. */
    expect(founders).not.toContain("0.00%");
    expect(founders).not.toContain("0 shares");
    expect(founders).not.toMatch(/\d+(\.\d+)?%/);
    /* THE REFUSAL, PRESENT: the em dash and the reason, in plain English. */
    expect(founders).toContain("—");
    expect(founders).toContain(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT);
  });

  it("still publishes every figure that IS on record", async () => {
    wireApi(NO_FOUNDER_ROW);
    renderPage();
    await awaitTotal("150");
    /* A share count of zero is a fact and 150 is a fact (R47/W61a). */
    expect(screen.getByTestId("stat-total-shares").textContent ?? "").toContain("150");
    /* The investor genuinely holds all of it. Refusing this too would be a silent
       drop of a true number. */
    expect(screen.getByTestId("stat-investors").textContent ?? "").toContain("100.00%");
    expect(screen.getByTestId("stat-investors").textContent ?? "").toContain("150 shares");
  });

  it("NO SILENT DROP — all four tiles still mount", async () => {
    wireApi(NO_FOUNDER_ROW);
    renderPage();
    await awaitTotal("150");
    for (const id of ALL_TILES) expect(screen.getByTestId(id)).toBeTruthy();
  });
});

describe("W125 · FINDING 1 — POLE B: a founder row RECORDING zero shares", () => {
  it("still shows 0.00% and 0 shares, because that is a recorded fact", async () => {
    wireApi(FOUNDER_ROW_RECORDING_ZERO);
    renderPage();
    await awaitTotal("150");

    const founders = screen.getByTestId("stat-founders").textContent ?? "";
    expect(founders).toContain("0.00%");
    expect(founders).toContain("0 shares");
    expect(founders).not.toContain(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT);
  });

  it("POLE A and POLE B are the same SUM and a different RENDER", async () => {
    /* Both cap tables total 150 shares and both have founder shares summing to
       zero. If the fix had been built on the sum, these two poles would be
       indistinguishable — which is exactly why it is built on row presence. */
    wireApi(NO_FOUNDER_ROW);
    renderPage();
    await awaitTotal("150");
    const refused = screen.getByTestId("stat-founders").textContent ?? "";
    cleanup();

    apiRequestMock.mockReset();
    wireApi(FOUNDER_ROW_RECORDING_ZERO);
    renderPage();
    await awaitTotal("150");
    const genuineZero = screen.getByTestId("stat-founders").textContent ?? "";

    expect(refused).not.toBe(genuineZero);
    expect(genuineZero).toContain("0.00%");
    expect(refused).not.toContain("0.00%");
  });
});

describe("W125 · FINDING 1 — POLE C: an empty register is untouched (Wave 61a)", () => {
  it("keeps the em-dashed percentage AND the `0 shares` hint w61a pins", async () => {
    wireApi([]);
    renderPage();
    await screen.findByText("No securities recorded yet.");
    const founders = screen.getByTestId("stat-founders").textContent ?? "";
    expect(founders).toContain("—");
    expect(founders).not.toMatch(/\d+(\.\d+)?%/);
    /* w61a pins this hint. Widening the refusal into the empty state would have
       broken the very test that protects the genuine zero. */
    expect(founders).toContain("0 shares");
    expect(founders).not.toContain(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT);
    expect(screen.getByTestId("stat-options").textContent ?? "").toContain("0 options");
    expect(screen.getByTestId("stat-total-shares").textContent ?? "").toContain("0");
  });
});
