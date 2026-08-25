/* ════════════════════════════════════════════════════════════════════════════
   WAVE 125 · FINDING 1 (third site) + FINDING 2 — THE CAPITALIZATION JOURNEY.
   ════════════════════════════════════════════════════════════════════════════
   `CapitalizationJourney.tsx:551` was the THIRD place an empty founder set was
   summed to a published zero:

       const founderPct = sumOwnershipPercent(fd.rows.filter(r => r.holderType === "founder"));

   `sumOwnershipPercent([])` returns `0`, not `null`, so the "Founder ownership"
   KPI printed `0%` for `BluePrint Catalyst Limited` — where no founder holding is
   on record at all. This is the same lie the cap table told, in a third voice, on
   the founder's own dashboard.

   FINDING 2 also lands here: the "Cap-table holders" KPI is the figure the journey
   ALREADY derived correctly (`1` for BluePrint) while the surrounding page printed
   a hard-coded `0`. This file pins the derived figure, so the server producer this
   wave added has an authority to agree with.

   POLES:
     A  no founder row, 150 shares  -> the KPI shows `—`, NO `%` character at all,
                                       and states in plain English why. The holders
                                       KPI still shows `1`.
     B  a founder row RECORDING 0   -> `0.00%` is printed, because it is recorded.
     C  NO SILENT DROP              -> both KPIs, and their labels, still mount in
                                       pole A. The `<Kpi>` sibling shape is
                                       untouched (W116 §3.1) — the refusal is
                                       hoisted into the existing `kpis` useMemo.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/* recharts' ResponsiveContainer needs one, and jsdom has none. The chart is not
   under test here; the two KPI cards are. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import CapitalizationJourney from "../CapitalizationJourney";
import { FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT } from "@/lib/captable/founderHoldingOnRecord";

const CID = "co_w125_blueprint";

/** POLE A — production's BluePrint Catalyst Limited. */
const NO_FOUNDER_ROW = [
  { id: "sec_w125_inv", companyId: CID, holderName: "Aster Capital", holderType: "investor", instrument: "common", series: null, shares: 150, pricePerShare: 1, investmentAmount: 150, cap: null, discount: null, issuedAt: "2026-01-01" },
];
/** POLE B — the same register plus a founder row that RECORDS zero. */
const FOUNDER_ROW_RECORDING_ZERO = [
  { id: "sec_w125_f0", companyId: CID, holderName: "Ada Okafor", holderType: "founder", instrument: "common", series: null, shares: 0, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2026-01-01" },
  ...NO_FOUNDER_ROW,
];

function wireFetch(securities: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => securities }) as unknown as Response),
  );
}

/** The journey renders nothing without at least one round of this company, so the
 *  poles need a closed round. Its money is irrelevant to the two KPIs under test. */
const ROUNDS = [
  { id: "rnd_w125_1", companyId: CID, name: "Seed", type: "seed", state: "closed", closeDate: "2026-02-01", preMoney: 4_000_000, postMoney: 5_000_000 },
];

function renderJourney() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => (queryKey[0] === "/api/rounds" ? (ROUNDS as unknown[]) : ([] as unknown[])),
      },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <CapitalizationJourney companyId={CID} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** A `<Kpi>` renders its label, its value and its hint inside one card, so the
 *  label's grandparent carries all three. */
function kpiCard(label: string): HTMLElement {
  const labelNode = screen.getByText(label);
  const card = labelNode.parentElement?.parentElement;
  if (!card) throw new Error(`no card for KPI "${label}"`);
  return card as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("W125 · journey POLE A — 150 shares on record, no founder row", () => {
  it("prints NO founder percentage and says why", async () => {
    wireFetch(NO_FOUNDER_ROW);
    renderJourney();
    await waitFor(() => expect(screen.getByText("Founder ownership")).toBeTruthy());
    await waitFor(() =>
      expect(kpiCard("Founder ownership").textContent ?? "").toContain(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT),
    );

    const card = kpiCard("Founder ownership").textContent ?? "";
    /* THE DEFECT, GONE. `sumOwnershipPercent([])` used to make this read `0%`. */
    expect(card).not.toContain("0%");
    expect(card).not.toMatch(/\d+(\.\d+)?%/);
    expect(card).not.toContain("%");
    expect(card).toContain("—");
  });

  it("the holders KPI still derives 1 — the figure the page used to contradict", async () => {
    wireFetch(NO_FOUNDER_ROW);
    renderJourney();
    await waitFor(() => expect(screen.getByText("Cap-table holders")).toBeTruthy());
    await waitFor(() => expect(kpiCard("Cap-table holders").textContent ?? "").toContain("1"));
    expect(kpiCard("Cap-table holders").textContent ?? "").toContain("founders + investors + pool");
  });

  it("NO SILENT DROP — both KPI cards and their labels still mount", async () => {
    wireFetch(NO_FOUNDER_ROW);
    renderJourney();
    await waitFor(() => expect(screen.getByText("Founder ownership")).toBeTruthy());
    expect(screen.getByText("Cap-table holders")).toBeTruthy();
    expect(screen.getByText("Latest valuation")).toBeTruthy();
  });
});

describe("W125 · journey POLE B — a founder row RECORDING zero shares", () => {
  it("prints 0.00%, because a recorded zero is a fact", async () => {
    wireFetch(FOUNDER_ROW_RECORDING_ZERO);
    renderJourney();
    await waitFor(() => expect(screen.getByText("Founder ownership")).toBeTruthy());
    await waitFor(() => expect(kpiCard("Founder ownership").textContent ?? "").toContain("%"));

    const card = kpiCard("Founder ownership").textContent ?? "";
    expect(card).toMatch(/0(\.00)?%/);
    expect(card).not.toContain(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT);
    expect(card).toContain("of fully-diluted");
  });

  it("POLE A and POLE B render differently from the same zero sum", async () => {
    wireFetch(NO_FOUNDER_ROW);
    renderJourney();
    await waitFor(() =>
      expect(kpiCard("Founder ownership").textContent ?? "").toContain(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT),
    );
    const refused = kpiCard("Founder ownership").textContent ?? "";
    cleanup();
    vi.unstubAllGlobals();

    wireFetch(FOUNDER_ROW_RECORDING_ZERO);
    renderJourney();
    await waitFor(() => expect(kpiCard("Founder ownership").textContent ?? "").toContain("%"));
    const genuineZero = kpiCard("Founder ownership").textContent ?? "";

    expect(refused).not.toBe(genuineZero);
    expect(refused).not.toContain("%");
    expect(genuineZero).toContain("%");
  });
});
