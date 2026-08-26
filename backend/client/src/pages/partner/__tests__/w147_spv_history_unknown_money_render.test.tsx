/* ════════════════════════════════════════════════════════════════════════════
   WAVE 147 · R111 Q13 — THE RENDERED PROOF, ON A REAL PARTNER SCREEN.
   ════════════════════════════════════════════════════════════════════════════
   This test RENDERS `client/src/pages/partner/SpvPerformance.tsx` and reads the
   text of the History table's cells. Nothing here matches source text.

   The three columns are the three states this wave is about, side by side in one
   row set:
     • contributed / distributed absent  → the `?? 0` sites (:645/:648 before the
       fix) that published `$0.00` for a figure the server never recorded;
     • residual value absent             → a site that already refused, but with
       a bare em dash a reader cannot tell from a layout artefact;
     • a snapshot whose figures are genuinely 0 → must STILL read `$0.00`.

   FAIL-BEFORE EVIDENCE (captured with `?? 0` and `"—"` restored — see
   build_log/wave147/W147_TESTS.md):
     ROW 1 contributed → expected '$0.00' to be 'Not on record'
     ROW 1 residual    → expected '—' to be 'Not on record'
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SpvPerformance from "@/pages/partner/SpvPerformance";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** Two snapshot points: one with NOTHING on record, one that is a genuine zero. */
const SNAPSHOTS = {
  ok: true,
  total: 2,
  chartable: false,
  minPointsForChart: 3,
  points: [
    {
      id: "snap_unknown",
      periodStart: "2026-01-01",
      /* The server did not record these at all. */
      contributedMinor: null,
      distributedMinor: undefined,
      residualValueMinor: null,
      currency: "USD",
    },
    {
      id: "snap_real_zero",
      periodStart: "2026-02-01",
      /* A month in which the SPV really did contribute and distribute nothing,
         and whose residual value really is zero. */
      contributedMinor: 0,
      distributedMinor: 0,
      residualValueMinor: 0,
      currency: "USD",
    },
  ],
};

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url.includes("/snapshots")) return jsonResponse(SNAPSHOTS);
    if (url.includes("/metrics")) return jsonResponse({ ok: true, metrics: {} });
    if (url.includes("/cashflows")) return jsonResponse({ ok: true, rows: [], total: 0 });
    return jsonResponse({ ok: true });
  });
});
afterEach(() => cleanup());

function renderHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <SpvPerformance vehicleKind="spv" vehicleId="spv_w147" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId("tab-history"));
  return view;
}

/** The four cells of a rendered snapshot row, by month label. */
async function rowCells(month: string): Promise<string[]> {
  const table = await waitFor(() => screen.getByTestId("spv-history-table"));
  const row = Array.from(table.querySelectorAll("tbody tr")).find((tr) =>
    (tr.querySelector("td")?.textContent ?? "").includes(month),
  );
  expect(row, `no rendered row for ${month}`).toBeTruthy();
  return Array.from(row!.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim());
}

describe("WAVE 147 · R111 Q13 — a figure not on record says so, on the screen", () => {
  it("prints 'Not on record' — never $0.00, never a bare dash — for absent figures", async () => {
    renderHistory();
    const cells = await rowCells("2026-01-01");
    /* [month, contributed, distributed, residual] */
    expect(cells[1]).toBe("Not on record");
    expect(cells[2]).toBe("Not on record");
    expect(cells[3]).toBe("Not on record");
    expect(cells[1]).not.toBe("$0.00");
    expect(cells[3]).not.toBe("—");
  });

  it("still prints $0.00 for a month whose figures really are zero", async () => {
    renderHistory();
    const cells = await rowCells("2026-02-01");
    expect(cells[1]).toBe("$0.00");
    expect(cells[2]).toBe("$0.00");
    expect(cells[3]).toBe("$0.00");
    expect(cells[1]).not.toBe("Not on record");
  });

  it("keeps the two states distinguishable in the SAME rendered table", async () => {
    renderHistory();
    const unknown = await rowCells("2026-01-01");
    const zero = await rowCells("2026-02-01");
    /* The whole point of the ruling: these two rows must not read alike. */
    expect(unknown[1]).not.toBe(zero[1]);
    expect(unknown[2]).not.toBe(zero[2]);
    expect(unknown[3]).not.toBe(zero[3]);
  });
});
