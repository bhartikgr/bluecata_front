/**
 * WAVE 306 · PART 3 — THE GP IS NOW TOLD WHAT IS BLOCKING HIM, PROVED IN THE DOM.
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * THE GAP, AND ITS EXACT BOUNDARIES. The Fee ledger panel already rendered the
 * amount and the currency honestly (`money(amt, cur)` refuses `NaN`, wave 147
 * removed the `?? 0`) and already rendered absence as "None". NO FABRICATED ZERO
 * EXISTS AND NONE OF THAT IS TOUCHED. The only gap was that a pending funding
 * obligation SILENTLY blocks every commitment on the vehicle and this panel — the
 * GP's own screen — said nothing about it. He could see a fee he cannot pay (the
 * charge route answers 503 by design, WAIVER-8) with no indication it was the
 * reason his commitments were being refused.
 *
 * WHAT THIS FILE PROVES, AND HOW IT REFUSES TO GO VACUOUSLY GREEN
 *   1. BOTH POLES. The notice appears when a blocking row is present and is
 *      ABSENT when every row is discharged. A banner that is always on is noise
 *      the next reader learns to ignore, so its absence is asserted as hard as
 *      its presence — and asserted against a panel that DID render rows, so the
 *      absence is measured against a live baseline rather than an empty page.
 *   2. THE PRE-EXISTING FIGURES DID NOT MOVE. The old row's exact character
 *      sequences — the money string and the "None" empty text — are asserted as
 *      literals, with no normalising call inside the assertion.
 *   3. THE MARKER IS ON THE RIGHT ROW. With a mixed fixture (one blocking, one
 *      paid, one waived, one carry) the per-row marker is asserted present on
 *      exactly the blocking row and absent from the other three, by SCOPED query
 *      on each row's own testid. An unscoped query would pass on the sibling
 *      notice's copy.
 *   4. THE FIXTURE MOVES. A second fixture with different figures, a different
 *      currency (JPY, ISO-4217 exponent 0, where a hardcoded /100 misrenders) and
 *      a `failed` rather than `pending` state runs the same assertions.
 *   5. THE STRINGS ARE ASSERTED BY TEST, NOT BY THE GUARD. guard's copy counter
 *      is a CONFIRMED DEFECT on appended copy — it does not move — so it is never
 *      treated as confirmation of anything. These assertions are the proof.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvFeeLedgerPanel } from "@/components/partner/SpvOperationsPanels";
import {
  SPV_FEE_OBLIGATION_BLOCKING_MARKER,
  SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION,
} from "@shared/spvFeeObligationRules";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/* The obligation shape `GET /api/partner/me/spv/:id/fee-obligations` really
   returns — the same keys the panel reads. Nothing invented. */
function ob(
  id: string,
  timing: string,
  portion: string,
  state: string,
  amountMinor: number | null,
  currency: string,
) {
  return { id, layer: "management", timing, portion, state, amountMinor, currency, feeType: "fee" };
}

/* ── FIXTURE A. One blocking row plus three that must NOT be marked. ─────── */
const ROWS_A = [
  ob("ob_block_a", "funding", "fixed", "pending", 7000, "USD"),
  ob("ob_paid_a", "funding", "fixed", "paid", 5000, "USD"),
  ob("ob_waived_a", "funding", "fixed", "waived", 4000, "USD"),
  ob("ob_carry_a", "distribution", "carry", "pending", 3000, "USD"),
];
/* ── FIXTURE B. MOVED: different figures, JPY, and `failed` not `pending`.
      `failed` is the state the ADMIN tab's narrower filter misses and the gate
      still blocks on, which is exactly why Part 3 does not reuse that filter. */
const ROWS_B = [
  ob("ob_block_b", "funding", "fixed", "failed", 7, "JPY"),
  ob("ob_paid_b", "funding", "fixed", "paid", 250, "JPY"),
];
/* ── FIXTURE C. Nothing blocking at all: the notice must be gone. ────────── */
const ROWS_C = [
  ob("ob_paid_c", "funding", "fixed", "paid", 5000, "USD"),
  ob("ob_waived_c", "funding", "fixed", "waived", 4000, "USD"),
];

function routeApi(rows: unknown[]) {
  apiRequestMock.mockImplementation(async (...args: unknown[]) => {
    /* URL located by SHAPE, not position: the panel also drives a default query
       function whose argument list differs, and a positional read there produced
       `undefined.includes` — a harness bug that masked a real assertion once. */
    const url = args.find((a) => typeof a === "string" && a.includes("/api/")) as
      | string
      | undefined;
    if (url?.includes("/fee-obligations")) return jsonResponse({ obligations: rows });
    if (url?.includes("/fee-breakdown")) return jsonResponse({ breakdown: null });
    return jsonResponse({});
  });
}

function renderPanel(currency: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SpvFeeLedgerPanel spvId="spv_w306_p3" currency={currency} canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiRequestMock.mockReset());
afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════════
   §1 — THE NOTICE APPEARS, AND SAYS THE SHIPPED SENTENCE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W306 P3 §1 — the blocking notice renders when something is blocking", () => {
  it("the sibling notice is present and carries the exact shipped copy", async () => {
    routeApi(ROWS_A);
    const { container } = renderPanel("USD");

    /* PRECONDITION FIRST: the rows actually arrived and rendered. An assertion
       about a notice on an empty panel proves nothing. */
    await waitFor(() => {
      expect(within(container).getByTestId("spv-fee-obligation-ob_block_a")).toBeTruthy();
    });

    const notice = within(container).getByTestId("spv-fee-obligation-blocking-notice");
    /* Byte-for-byte, with no normalising call inside the assertion. */
    expect(notice.textContent).toBe(SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION);
    /* It is an alert, so a screen reader is told too, not only a sighted GP. */
    expect(notice.getAttribute("role")).toBe("alert");
  });

  it("the copy names all three things that are refused, and does not promise collection", async () => {
    routeApi(ROWS_A);
    const { container } = renderPanel("USD");
    await waitFor(() => {
      expect(within(container).getByTestId("spv-fee-obligation-blocking-notice")).toBeTruthy();
    });
    const text = within(container).getByTestId("spv-fee-obligation-blocking-notice").textContent ?? "";
    /* Every clause is TRUE IN EVERY BRANCH THAT CAN REACH IT (R254.3): the notice
       renders only when the gate's own condition holds for a row, and the gate is
       consulted at subscription commit, deployment create/advance and cap-table
       commit. */
    expect(text).toContain("committed");
    expect(text).toContain("deployment");
    expect(text).toContain("cap-table");
    /* And it does NOT claim Capavate will collect the money — the gateway is
       frozen under WAIVER-8 and answers 503 by design. */
    expect(text).toContain("cannot");
    expect(text.toLowerCase()).not.toContain("we will charge");
    /* No figure and no currency in the notice: the row's own honest amount stays
       the single source of the number. */
    expect(/\d/.test(text)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   §2 — THE MARKER IS ON EXACTLY THE RIGHT ROWS.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W306 P3 §2 — the per-row marker discriminates", () => {
  it("marked on the blocking row, absent from paid, waived and carry rows", async () => {
    routeApi(ROWS_A);
    const { container } = renderPanel("USD");
    await waitFor(() => {
      expect(within(container).getByTestId("spv-fee-obligation-ob_block_a")).toBeTruthy();
    });

    /* SCOPED to each row's own testid. An unscoped query would also match the
       sibling notice's copy and pass on every row. */
    const marked = within(
      within(container).getByTestId("spv-fee-obligation-ob_block_a"),
    ).getByTestId("spv-fee-obligation-blocking-ob_block_a");
    expect(marked.textContent).toContain(SPV_FEE_OBLIGATION_BLOCKING_MARKER);

    for (const id of ["ob_paid_a", "ob_waived_a", "ob_carry_a"]) {
      const row = within(container).getByTestId(`spv-fee-obligation-${id}`);
      /* PRECONDITION: the row DID render, so its lack of a marker is a measured
         absence and not an empty query. */
      expect((row.textContent ?? "").length > 0).toBe(true);
      expect(within(row).queryByTestId(`spv-fee-obligation-blocking-${id}`)).toBeNull();
    }
  });

  it("the pre-existing figures did not move: money strings and the state text are unchanged", async () => {
    routeApi(ROWS_A);
    const { container } = renderPanel("USD");
    await waitFor(() => {
      expect(within(container).getByTestId("spv-fee-obligation-ob_block_a")).toBeTruthy();
    });
    /* Literals transcribed from what the row printed BEFORE this wave, so they
       cannot silently track a regression in the expression that produces them. */
    const blocking = within(container).getByTestId("spv-fee-obligation-ob_block_a").textContent ?? "";
    expect(blocking).toContain("$70.00");
    expect(blocking).toContain("pending");
    const paid = within(container).getByTestId("spv-fee-obligation-ob_paid_a").textContent ?? "";
    expect(paid).toContain("$50.00");
    expect(paid).toContain("paid");
    /* NEGATIVE CONTROL — a figure that is NOT in the fixture is absent, so the
       assertions above are not passing on an unconditionally-true predicate. */
    expect(blocking).not.toContain("$99.99");
  });

  it("FIXTURE MOVED — JPY and a `failed` state behave the same way", async () => {
    routeApi(ROWS_B);
    const { container } = renderPanel("JPY");
    await waitFor(() => {
      expect(within(container).getByTestId("spv-fee-obligation-ob_block_b")).toBeTruthy();
    });
    /* The notice is present for a FAILED obligation, which the admin tab's
       `state === "pending"` filter would have missed. */
    expect(
      within(container).getByTestId("spv-fee-obligation-blocking-notice").textContent,
    ).toBe(SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION);
    const row = within(container).getByTestId("spv-fee-obligation-ob_block_b");
    expect(within(row).getByTestId("spv-fee-obligation-blocking-ob_block_b").textContent).toContain(
      SPV_FEE_OBLIGATION_BLOCKING_MARKER,
    );
    /* Zero-exponent currency renders as ¥7, not ¥0.07 — a hardcoded /100 would
       fail here. This is PRE-EXISTING behaviour this wave must not disturb. */
    expect(row.textContent).toContain("¥7");
    const paid = within(container).getByTestId("spv-fee-obligation-ob_paid_b");
    expect(within(paid).queryByTestId("spv-fee-obligation-blocking-ob_paid_b")).toBeNull();
    expect(paid.textContent).toContain("¥250");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   §3 — THE OTHER POLE. Nothing blocking → no notice, no marker, and the panel's
   existing honest rendering is untouched.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W306 P3 §3 — the notice is absent when nothing is blocking", () => {
  it("all rows discharged: no notice and no marker, measured against rendered rows", async () => {
    routeApi(ROWS_C);
    const { container } = renderPanel("USD");
    /* THE LIVE BASELINE, asserted first: rows really rendered. */
    await waitFor(() => {
      expect(within(container).getByTestId("spv-fee-obligation-ob_paid_c")).toBeTruthy();
    });
    expect(within(container).getByTestId("spv-fee-obligation-ob_waived_c")).toBeTruthy();

    /* Only now is the absence meaningful. */
    expect(within(container).queryByTestId("spv-fee-obligation-blocking-notice")).toBeNull();
    expect(within(container).queryByTestId("spv-fee-obligation-blocking-ob_paid_c")).toBeNull();
    expect(within(container).queryByTestId("spv-fee-obligation-blocking-ob_waived_c")).toBeNull();
    /* And the shipped sentence appears nowhere on the panel. */
    expect(container.textContent ?? "").not.toContain(SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION);
  });

  it("NO OBLIGATIONS AT ALL: the pre-existing \"None\" still renders and no notice appears", async () => {
    routeApi([]);
    const { container } = renderPanel("USD");
    /* Wave 306 must not disturb this: absence renders "None", not a zero. */
    await waitFor(() => {
      expect((container.textContent ?? "").includes("None")).toBe(true);
    });
    expect(within(container).queryByTestId("spv-fee-obligation-blocking-notice")).toBeNull();
    /* And no fabricated zero appeared in its place. */
    expect(container.textContent ?? "").not.toContain("$0.00");
  });
});
