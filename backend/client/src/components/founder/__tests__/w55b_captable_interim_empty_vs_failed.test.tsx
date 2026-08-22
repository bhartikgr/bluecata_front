/**
 * WAVE 55b · OQ-3 — CapTableInterim had NO error branch of any kind.
 *
 * Only `interimQ.isLoading` was handled. Every section reads
 * `data?.<kind> ?? []`, so on a 404 / 403 / 500 the component printed
 *
 *     Committed      -> "No committed positions."
 *     Funded         -> "No funded (not committed) positions."
 *     Soft-circle    -> "No soft-circle (confirmed) positions."
 *
 * three fabricated zeros, under an amber banner still asserting what committed
 * ownership is unaffected by. It is mounted for FOUNDERS
 * (`pages/founder/CapTable.tsx:453`) and, read-only, for INVESTORS
 * (`pages/investor/InvitationDetail.tsx:1018`).
 *
 * BOTH POLES. The failure pole asserts the refusal appears AND the three empty
 * strings do not; the success pole asserts the three empty strings are still
 * present and BYTE-IDENTICAL, because a refusal that ate the honest empty state
 * would be a different defect of the same family.
 *
 * The refused status is `W55B_CAP_TABLE_REFUSAL_STATUS`, proved against the real
 * `GET /api/companies/:id/captable/interim` route in
 * `server/__tests__/w55b_captable_family_refusal_http.test.ts`.
 *
 * MUTATION TRANSCRIPT: build_log/wave55b/W55B_TESTS.md.
 */
/* ─────────────────────────────────────────────────────────────────────────────
 * WAVE 90 · ITEM 1 AMENDMENT — WHY TWO CASES BELOW CHANGED STATUS.
 *
 * Wave 55b's subject is "a failed load is not an empty list", and its own header
 * names the statuses it cared about: "on a 404 / 403 / 500". It used 404 for the
 * failure pole because 404 was simply the status the route happened to answer.
 *
 * Wave 90 then established, by driving the real route, that the 404 on this
 * endpoint is not a failure at all: it is `decideCapTableSinkAccess` DELIBERATELY
 * refusing an investor who holds no position (server/lib/capTableSinkScope.ts,
 * reason `no_relationship`; 404 rather than 403 by the F-9 enumeration policy).
 * Reporting that to an investor as "we couldn't load the cap table, try again"
 * was the S0 live defect M-2.
 *
 * So the two cases that used `W55B_CAP_TABLE_REFUSAL_STATUS` for the LOAD-FAILURE
 * pole now use 500 — a status that really is a fault. NOTHING about Wave 55b's
 * contract is weakened: the same assertions run, on the same component, against
 * a genuine failure. The 404 branch is asserted, positively, in
 * `w90_captable_interim_refusal_copy.test.tsx`, which fails if the deliberate
 * refusal is ever again dressed up as a fault.
 * ───────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";
import { W55B_CAP_TABLE_REFUSAL_STATUS } from "@shared/w55bCapTableRefusal";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { CapTableInterim } from "../CapTableInterim";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

/* Exactly as the tree words them today: `No {meta.label.toLowerCase()} positions.` */
const EMPTY_STRINGS = [
  "No committed positions.",
  "No funded (not committed) positions.",
  "No soft-circle (confirmed) positions.",
];

function renderInterim(readOnly = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CapTableInterim companyId="co_w55b" readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W55b · OQ-3 — interim (pro-forma) cap table: failed is not empty", () => {
  it("FIXTURE — the pinned refusal status is 404, which is why 500 is used for the fault pole", () => {
    /* WAVE 90 · ITEM 1 — keeps the pinned constant in this file's dependency
       graph. If the route's deliberate-refusal status ever changes, this fails
       here and the amendment note above has to be re-read. */
    expect(W55B_CAP_TABLE_REFUSAL_STATUS).toBe(404);
  });

  it("LOWER POLE — the refusal renders and NOT the three empty-position strings", async () => {
    apiRequestMock.mockImplementation(async () => {
      /* WAVE 90 · ITEM 1 — a GENUINE fault status. See the amendment note above. */
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderInterim();

    const err = await screen.findByTestId("captable-interim-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn’t load the interim (pro-forma) cap table");

    /* THE defect: pre-fix all three of these were on screen. */
    for (const s of EMPTY_STRINGS) expect(screen.queryByText(s)).toBeNull();

    /* Each section says so in its own table body, so a founder reading one
       section in isolation is not misled either. */
    for (const kind of ["committed", "funded", "soft_circle"]) {
      expect(screen.getByTestId(`interim-not-loaded-${kind}`)).toBeTruthy();
    }
  });

  it("NO SILENT DROP — the banner, all three sections and their tables still mount", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderInterim();
    await screen.findByTestId("captable-interim-error");

    expect(screen.getByTestId("interim-banner")).toBeTruthy();
    for (const kind of ["committed", "funded", "soft_circle"]) {
      expect(screen.getByTestId(`interim-section-${kind}`)).toBeTruthy();
      expect(screen.getByTestId(`interim-table-${kind}`)).toBeTruthy();
    }
    /* Column headers are untouched — the not-loaded row is appended inside the
       same tbody, it does not replace the table. */
    expect(screen.getAllByText("Holder").length).toBe(3);
    expect(screen.getAllByText("Own %").length).toBe(3);
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    apiRequestMock.mockImplementation(async () => {
      calls += 1;
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderInterim();
    await screen.findByTestId("captable-interim-error");
    const before = calls;
    fireEvent.click(screen.getByTestId("captable-interim-error-retry"));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("UPPER POLE — a genuine empty success still shows all three empty strings, unchanged", async () => {
    apiRequestMock.mockImplementation(async () =>
      jsonResponse({
        committed: [],
        funded: [],
        soft_circle: [],
        subtotals: { committed: undefined, funded: undefined, soft_circle: undefined },
      }),
    );
    renderInterim();

    for (const s of EMPTY_STRINGS) expect(await screen.findByText(s)).toBeTruthy();
    expect(screen.queryByTestId("captable-interim-error")).toBeNull();
    for (const kind of ["committed", "funded", "soft_circle"]) {
      expect(screen.queryByTestId(`interim-not-loaded-${kind}`)).toBeNull();
    }
  });

  it("rows render neither the refusal nor any empty string", async () => {
    apiRequestMock.mockImplementation(async () =>
      jsonResponse({
        committed: [
          {
            investorId: "inv_1",
            holderName: "Hydra VC",
            roundId: "r_1",
            roundName: "Seed",
            amount: 250000,
            currency: "USD",
            shares: 1000,
            ownershipPct: 4.5,
            kind: "committed",
          },
        ],
        funded: [],
        soft_circle: [],
        subtotals: { committed: { count: 1, amount: 250000, shares: 1000 } },
      }),
    );
    renderInterim();
    expect(await screen.findByText("Hydra VC")).toBeTruthy();
    expect(screen.queryByText(EMPTY_STRINGS[0])).toBeNull();
    expect(screen.queryByTestId("captable-interim-error")).toBeNull();
  });

  it("the INVESTOR read-only mounting is refused the same way", async () => {
    /* readOnly drops the action columns, so the not-loaded row's colSpan differs;
       the honesty contract must not. */
    apiRequestMock.mockImplementation(async () => {
      /* WAVE 90 · ITEM 1 — a GENUINE fault status. See the amendment note above. */
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderInterim(true);
    await screen.findByTestId("captable-interim-error");
    for (const s of EMPTY_STRINGS) expect(screen.queryByText(s)).toBeNull();
    expect(screen.getByTestId("interim-not-loaded-committed")).toBeTruthy();
  });

  it("the refusal states no count and no money", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderInterim();
    const err = await screen.findByTestId("captable-interim-error");
    const text = err.textContent ?? "";
    for (const forbidden of ["$", "USD", "0.00", "0 positions", "%"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
