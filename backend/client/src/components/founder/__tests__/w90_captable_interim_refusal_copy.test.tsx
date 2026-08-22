/**
 * WAVE 90 · ITEM 1 — M-2: "THE INVESTOR CAP TABLE FAILS TO LOAD".
 *
 * WHAT THE LIVE AUDIT SAW, on both closed-round invitations:
 *   "We couldn't load the interim (pro-forma) cap table. Nothing has been
 *    changed. This is a loading failure, not an empty list."
 *   plus, in all three sub-tables:
 *   "Not loaded — we could not read this section …"
 *
 * WHAT IS ACTUALLY HAPPENING (proved at the route level in
 * `server/__tests__/w90_investor_interim_refusal_status.test.ts`): the endpoint
 * answers 404, and that 404 is `decideCapTableSinkAccess` deliberately refusing
 * an investor who is INVITED to the round but holds no position. Wave 36 · ROW 1
 * removed the `invitedRounds` disjunct on purpose — otherwise a prospect reads
 * every other holder's name, email and amount. The refusal is correct.
 *
 * So the copy was the defect: a permanent authorisation decision was reported as
 * a transient fault with a retry button that can never succeed.
 *
 * ── BOTH POLES, AND THE ONE THAT MATTERS ─────────────────────────────────────
 *   404  -> the honest out-of-scope note; the load-failure copy must NOT appear;
 *           the sub-tables must NOT claim "we could not read this section".
 *   500  -> the load-failure copy STILL appears, unchanged. A fix that silenced
 *           every error by relabelling it "policy" would be strictly worse than
 *           the defect, so this pole is not optional.
 *   200  -> neither branch appears and the sections read exactly as before.
 *
 * MUTATION TRANSCRIPT: build_log/wave90/W90_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

const KINDS = ["committed", "funded", "soft_circle"] as const;
/** The exact wording the live audit quoted, as the component words it today. */
const LOAD_FAILURE_COPY = "couldn’t load the interim (pro-forma) cap table";
const NOT_READ_COPY = "we could not read this section";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function renderInterim(readOnly = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CapTableInterim companyId="co_w90" readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W90 · ITEM 1 — a deliberate refusal is not reported as a loading failure", () => {
  it("FIXTURE — the deliberate-refusal status is the pinned 404, not an invented one", () => {
    expect(W55B_CAP_TABLE_REFUSAL_STATUS).toBe(404);
  });

  it("404 — renders the honest out-of-scope note", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(W55B_CAP_TABLE_REFUSAL_STATUS, "refused", null, { ok: false, error: "not_found" });
    });
    renderInterim();

    const note = await screen.findByTestId("captable-interim-out-of-scope");
    const text = note.textContent ?? "";
    expect(text).toContain("not available to you");
    /* It must say the two things the investor needs: that it is deliberate, and
       that retrying is pointless. */
    expect(text).toContain("deliberate");
    expect(text.toLowerCase()).toContain("refreshing will not");
  });

  it("404 — the LOADING-FAILURE copy is gone from the screen entirely", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(W55B_CAP_TABLE_REFUSAL_STATUS, "refused", null, { ok: false });
    });
    renderInterim();
    await screen.findByTestId("captable-interim-out-of-scope");

    expect(screen.queryByTestId("captable-interim-error")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(LOAD_FAILURE_COPY);
  });

  it("404 — no sub-table claims 'we could not read this section'", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(W55B_CAP_TABLE_REFUSAL_STATUS, "refused", null, { ok: false });
    });
    renderInterim();
    await screen.findByTestId("captable-interim-out-of-scope");

    for (const kind of KINDS) {
      expect(screen.queryByTestId(`interim-not-loaded-${kind}`)).toBeNull();
      /* The section still SAYS something — silence would be the emptiness-as-fact
         defect this register opens with. */
      expect(screen.getByTestId(`interim-refused-${kind}`)).toBeTruthy();
    }
    expect(document.body.textContent ?? "").not.toContain(NOT_READ_COPY);
  });

  it("404 — and it still states NO count and NO money (it does not fabricate a zero)", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(W55B_CAP_TABLE_REFUSAL_STATUS, "refused", null, { ok: false });
    });
    renderInterim();
    const note = await screen.findByTestId("captable-interim-out-of-scope");
    const text = note.textContent ?? "";
    for (const forbidden of ["$", "USD", "0.00", "0 positions"]) {
      expect(text).not.toContain(forbidden);
    }
    for (const empty of [
      "No committed positions.",
      "No funded (not committed) positions.",
      "No soft-circle (confirmed) positions.",
    ]) {
      expect(screen.queryByText(empty)).toBeNull();
    }
  });

  it("500 — THE POLE THAT STOPS THIS FIX BEING A COVER-UP: a real fault still says so", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderInterim();

    const err = await screen.findByTestId("captable-interim-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent ?? "").toContain(LOAD_FAILURE_COPY);
    expect(screen.queryByTestId("captable-interim-out-of-scope")).toBeNull();
    for (const kind of KINDS) {
      expect(screen.getByTestId(`interim-not-loaded-${kind}`)).toBeTruthy();
      expect(screen.queryByTestId(`interim-refused-${kind}`)).toBeNull();
    }
  });

  it("403 — a forbidden that is NOT the pinned refusal is still treated as a fault", async () => {
    /* The scope helper answers 404 by policy. If some other layer ever answers
       403, that is unexplained and must not be presented as normal policy. */
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(403, "forbidden", null, { ok: false });
    });
    renderInterim();
    await screen.findByTestId("captable-interim-error");
    expect(screen.queryByTestId("captable-interim-out-of-scope")).toBeNull();
  });

  it("NO SILENT DROP — on 404 the banner, all three sections and their tables still mount", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(W55B_CAP_TABLE_REFUSAL_STATUS, "refused", null, { ok: false });
    });
    renderInterim();
    await screen.findByTestId("captable-interim-out-of-scope");

    expect(screen.getByTestId("interim-banner")).toBeTruthy();
    for (const kind of KINDS) {
      expect(screen.getByTestId(`interim-section-${kind}`)).toBeTruthy();
      expect(screen.getByTestId(`interim-table-${kind}`)).toBeTruthy();
    }
    expect(screen.getAllByText("Holder").length).toBe(3);
    expect(screen.getAllByText("Own %").length).toBe(3);
  });

  it("200 — neither branch appears and a genuine empty success is unchanged", async () => {
    apiRequestMock.mockImplementation(async () =>
      jsonResponse({
        committed: [],
        funded: [],
        soft_circle: [],
        subtotals: { committed: undefined, funded: undefined, soft_circle: undefined },
      }),
    );
    renderInterim();

    expect(await screen.findByText("No committed positions.")).toBeTruthy();
    expect(screen.queryByTestId("captable-interim-error")).toBeNull();
    expect(screen.queryByTestId("captable-interim-out-of-scope")).toBeNull();
    for (const kind of KINDS) {
      expect(screen.queryByTestId(`interim-refused-${kind}`)).toBeNull();
      expect(screen.queryByTestId(`interim-not-loaded-${kind}`)).toBeNull();
    }
  });
});

describe("W90 · ITEM 3 — the interim rows never print an identifier as a name", () => {
  it("a holder name that is itself a raw id is DESCRIBED, not printed", async () => {
    apiRequestMock.mockImplementation(async () =>
      jsonResponse({
        committed: [
          {
            investorId: "u_redeemed_9f2a",
            /* The exact live defect class: the name field carrying an id. */
            holderName: "u_redeemed_9f2a",
            roundId: "rnd_w90_abcdef",
            roundName: "",
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

    expect(await screen.findByText("Unnamed holder")).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("u_redeemed_9f2a");
    /* R77 — the machine value is still on the element for tooling. */
    expect(screen.getByTestId("interim-row-committed-0")).toBeTruthy();
  });

  it("a real name is rendered VERBATIM — the describer must not eat good data", async () => {
    apiRequestMock.mockImplementation(async () =>
      jsonResponse({
        committed: [
          {
            investorId: "u_1",
            holderName: "Hydra Capital — Aisha Rahman",
            roundId: "rnd_1",
            roundName: "Seed Extension",
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
    expect(await screen.findByText("Hydra Capital — Aisha Rahman")).toBeTruthy();
    expect(screen.getByText("Seed Extension")).toBeTruthy();
    expect(screen.queryByText("Unnamed holder")).toBeNull();
  });
});
