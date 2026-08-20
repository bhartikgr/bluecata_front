/**
 * WAVE 60 · L-6 — SIX FABRICATED ADMIN FIGURES ON A FAILED LOAD.
 *
 * ── THE DEFECT, AS THE ADMIN SAW IT ──────────────────────────────────────────
 * `client/src/pages/admin/Pricing.tsx:613` (pre-fix) destructured only
 * `{ data, isLoading }` — no `isError`, no `isSuccess`. With `?? []` at :617, a
 * failed GET /api/admin/subscriptions rendered, with no error and no retry:
 *
 *     MRR $0.00 · ARR $0.00 · Expansion MRR $0.00 · New Revenue (trial) $0.00
 *     Churn rate 0.0% · Past due 0
 *
 * Four money figures and a percentage, all invented, indistinguishable from
 * "this platform has no subscriptions". Three OTHER tabs in the SAME FILE already
 * consumed isError and mounted LoadFailedRefusal (:151/:303, :460/:561,
 * :703/:775) — the pattern, the import and the precedent were already there.
 *
 * ── NO SILENT DROP ───────────────────────────────────────────────────────────
 * Refusing must NOT blank the row. All six <Card> tiles and the plan-breakdown
 * table still mount on the failure path; the tiles show the em-dash this file
 * already uses as its unknown token. That is asserted below, by testid, one card
 * at a time.
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 *   LOWER  error / paused → refusal, all six tiles "—", `$0.00` and `0.0%` ABSENT
 *   UPPER  success with real subs → today's values, unchanged
 *   UPPER  success with `subscriptions: []` → today's HONEST zeros
 *          ($0.00 / 0.0% / 0) unchanged. This is the pole that stops the fix
 *          eating a true zero: a platform with no subscriptions really does have
 *          $0.00 MRR, and that must still be said.
 *
 * MUTATION TRANSCRIPT: build_log/wave60/W60_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import AdminPricing from "../Pricing";

/* WAVE 61a · R51 — two of these six data-testids MOVED, and nothing else in this
   file changed. The testid is DERIVED from the tile label at Pricing.tsx
   (`card-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`), and R51 ordered
   two labels relabelled because they named quantities the code does not compute:
     "Expansion MRR" -> "Scale + Enterprise MRR"        (no prior-month term exists)
     "Churn rate"    -> "Cancelled share (all-time)"    (no time window exists)
   All six tiles still mount and every assertion in this file is preserved. The
   Wave 60 pre-flight said no test referenced `card-metric`; that was true when it
   was written and is no longer true — THIS file, landed by Wave 60 itself, does. */
const TILES = [
  "card-metric-mrr",
  "card-metric-arr",
  "card-metric-scale-+-enterprise-mrr",
  "card-metric-new-revenue-(trial)",
  "card-metric-cancelled-share-(all-time)",
  "card-metric-past-due",
];

const REAL_SUBS = [
  { companyId: "c1", plan: "founder_pro", status: "active", annualAmountMinor: 120000, currency: "USD" },
  { companyId: "c2", plan: "founder_scale", status: "active", annualAmountMinor: 240000, currency: "USD" },
  { companyId: "c3", plan: "founder_free", status: "past_due", annualAmountMinor: 0, currency: "USD" },
];

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

/** Everything answers empty except /api/admin/subscriptions, the variable. */
function renderBillingTab(subs: () => Promise<unknown>) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/api\/admin\/subscriptions$/.test(url)) return jsonResponse(await subs());
    return jsonResponse({});
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: (async () => ({})) as never }, mutations: { retry: false } },
  });
  window.history.pushState({}, "", "/admin/pricing?tab=billing");
  const r = render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <AdminPricing />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
  return r;
}

/** Clicks the Billing Metrics tab trigger, whatever its label casing. */
async function openBillingTab() {
  const trigger = await screen.findByRole("tab", { name: /billing/i });
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByTestId(TILES[0])).toBeTruthy());
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  onlineManager.setOnline(true);
});

describe("W60 · L-6 — six admin billing tiles must not invent figures on a failed load", () => {
  it("LOWER POLE — the refusal mounts and no tile prints a fabricated figure", async () => {
    renderBillingTab(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    await openBillingTab();
    const err = await screen.findByTestId("w60-billing-metrics-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn’t load the billing metrics");
    /* THE defect: pre-fix each of these was on screen. */
    for (const id of TILES) {
      const tile = screen.getByTestId(id);
      expect(tile.textContent).not.toContain("$0.00");
      expect(tile.textContent).not.toContain("0.0%");
      expect(tile.textContent).toContain("—");
    }
  });

  it("NO SILENT DROP — all six tiles AND the plan-breakdown table still mount on the failure path", async () => {
    renderBillingTab(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    await openBillingTab();
    await screen.findByTestId("w60-billing-metrics-error");
    for (const id of TILES) expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getByTestId("table-plan-breakdown")).toBeTruthy();
    /* All four plan rows survive too. */
    for (const plan of ["Founder Free", "Founder Pro", "Founder Scale", "Founder Enterprise"]) {
      expect(screen.getByTestId(`row-plan-${plan}`)).toBeTruthy();
    }
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    renderBillingTab(async () => {
      calls += 1;
      throw new ApiError(500, "boom", null, { ok: false });
    });
    await openBillingTab();
    await screen.findByTestId("w60-billing-metrics-error");
    const before = calls;
    fireEvent.click(screen.getByTestId("w60-billing-metrics-error-retry"));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("PAUSED POLE — an OFFLINE admin sees em-dashes, not zeros", async () => {
    /* `isLoading ? "—" : m.value` was FALSE for a paused query, so an offline
       admin got the fabricated zeros. `!isSuccess` is the paused-safe form. */
    onlineManager.setOnline(false);
    renderBillingTab(async () => ({ subscriptions: REAL_SUBS }));
    await openBillingTab();
    for (const id of TILES) {
      expect(screen.getByTestId(id).textContent).toContain("—");
      expect(screen.getByTestId(id).textContent).not.toContain("$0.00");
    }
  });

  it("UPPER POLE — a successful load with real subscriptions prints real values, not em-dashes", async () => {
    renderBillingTab(async () => ({ subscriptions: REAL_SUBS }));
    await openBillingTab();
    await waitFor(() =>
      expect(screen.getByTestId("card-metric-mrr").textContent).not.toContain("—"),
    );
    /* ARR = 120000 + 240000 minor = $3,600.00; MRR = ARR/12 = $300.00. */
    expect(screen.getByTestId("card-metric-arr").textContent).toContain("3,600.00");
    expect(screen.getByTestId("card-metric-mrr").textContent).toContain("300.00");
    expect(screen.getByTestId("card-metric-past-due").textContent).toContain("1");
    expect(screen.queryByTestId("w60-billing-metrics-error")).toBeNull();
  });

  it("UPPER POLE — GENUINE EMPTINESS: a SUCCESSFUL empty load still prints today's honest zeros", async () => {
    /* The pole that stops the refusal eating a true zero. A platform with no
       subscriptions really does have $0.00 MRR and 0 past due, and the screen
       must still say so. */
    renderBillingTab(async () => ({ subscriptions: [] }));
    await openBillingTab();
    await waitFor(() =>
      expect(screen.getByTestId("card-metric-mrr").textContent).toContain("$0.00"),
    );
    expect(screen.getByTestId("card-metric-arr").textContent).toContain("$0.00");
    expect(screen.getByTestId("card-metric-cancelled-share-(all-time)").textContent).toContain("0.0%");
    expect(screen.getByTestId("card-metric-past-due").textContent).toContain("0");
    expect(screen.queryByTestId("w60-billing-metrics-error")).toBeNull();
  });
});
