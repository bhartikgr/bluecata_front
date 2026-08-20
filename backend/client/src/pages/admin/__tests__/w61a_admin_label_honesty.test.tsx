/**
 * WAVE 61a · R51 — THREE ADMIN LABELS NAMED QUANTITIES THE CODE DOES NOT COMPUTE.
 *
 * ── 1. "Expansion MRR" (client/src/pages/admin/Pricing.tsx) ──────────────────
 * The expression, quoted from source pre-fix:
 *
 *     const expansionMinor = active
 *       .filter(s => s.plan === "founder_scale" || s.plan === "founder_enterprise")
 *       .reduce((sum, s) => sum + s.annualAmountMinor / 12, 0);
 *
 * THE DEMONSTRATION (R44 row 1): there is NO prior-month term, no date, and no
 * second period anywhere in that expression. It sums the CURRENT monthly amount
 * of two plan tiers. "Expansion MRR" has a specific meaning in SaaS finance —
 * incremental recurring revenue from EXISTING customers — so the label names a
 * quantity the arithmetic does not compute, and it is off in BOTH directions: it
 * includes brand-new customers and excludes upgrades within other tiers.
 *   -> REPLACED with "Scale + Enterprise MRR", which is exactly what :660 computes.
 *
 * ── 2. "Churn rate" (same file, same tile array) ─────────────────────────────
 *     const churnRate = subs.length > 0
 *       ? ((cancelled.length / subs.length) * 100).toFixed(1) : "0.0";
 * with the author's own comment: "Churn rate placeholder (would compute from
 * status transitions in production)".
 *
 * A churn rate is cancellations WITHIN A PERIOD over the base at the start of
 * that period. There is no period here. R51 gave two options — "label it for what
 * it computes, or refuse". THE CHOICE MADE HERE IS TO RELABEL, and the reason is
 * that the number is REAL arithmetic on REAL data: refusing would delete a
 * working metric in order to fix a name, which is a silent drop of information
 * the platform genuinely has.
 *   -> REPLACED with "Cancelled share (all-time)". Arithmetic untouched.
 *
 * ── 3. "in the last 30 days" (client/src/pages/admin/Dashboard.tsx) ──────────
 * `server/adminPlatformStore.ts` computes `cancelled / everCount * 100`, where
 * `everCount` is a UNION over the whole of `subscriptions` and
 * `subscriptions_history`. There is no date predicate and no window of any kind.
 *   -> the false CLAUSE is REPLACED with "since the account was created", and one
 *      sentence is APPENDED recording that the figure can never decrease.
 *      THE ARITHMETIC IS NOT TOUCHED — a real 30-day window is its own wave.
 *
 * ── NO SILENT DROP, AND NO ALLOWLIST ENTRY ───────────────────────────────────
 * All six billing tiles still mount, and every value is arithmetically unchanged.
 * `label:` here is an OBJECT PROPERTY, not a JSX attribute, and it renders through
 * `{m.label}` which the guard records as `<expr:>` — so `npm run guard` reports
 * zero copy removals and the frozen allowlist stays at 43. That was VERIFIED by
 * running the guard after each edit, not assumed.
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 *   LOWER  the three false strings are ABSENT from the rendered screens / source
 *   UPPER  every NUMBER is unchanged: one founder_scale at annualAmountMinor
 *          120000 still reads $100.00, and 1-cancelled-of-4 still reads 25.0%
 *   UPPER  the other four tile labels and the loading em-dash are untouched
 *
 * MUTATION TRANSCRIPT: build_log/wave61a/W61A_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import AdminPricing from "../Pricing";

/** The six tiles, by their post-relabel derived testids. All six must mount. */
const TILES = [
  "card-metric-mrr",
  "card-metric-arr",
  "card-metric-scale-+-enterprise-mrr",
  "card-metric-new-revenue-(trial)",
  "card-metric-cancelled-share-(all-time)",
  "card-metric-past-due",
];

/** One founder_scale subscription at annualAmountMinor 120000 => monthly 10000
 *  minor => $100.00 on the Scale + Enterprise tile. Four subscriptions of which
 *  one is cancelled => 25.0% cancelled share. Both are hand-checkable. */
const SUBS = [
  { companyId: "c1", plan: "founder_scale", status: "active", annualAmountMinor: 120000, currency: "USD" },
  { companyId: "c2", plan: "founder_pro", status: "active", annualAmountMinor: 60000, currency: "USD" },
  { companyId: "c3", plan: "founder_free", status: "past_due", annualAmountMinor: 0, currency: "USD" },
  { companyId: "c4", plan: "founder_pro", status: "cancelled", annualAmountMinor: 60000, currency: "USD" },
];

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function renderBillingTab(subs: () => Promise<unknown>) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/api\/admin\/subscriptions$/.test(url)) return jsonResponse(await subs());
    return jsonResponse({});
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: (async () => ({})) as never }, mutations: { retry: false } },
  });
  window.history.pushState({}, "", "/admin/pricing?tab=billing");
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <AdminPricing />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

async function openBillingTab() {
  const trigger = await screen.findByRole("tab", { name: /billing/i });
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByTestId(TILES[0])).toBeTruthy());
}

const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W61a · R51 — an admin label must name what the arithmetic actually computes", () => {
  it("LOWER POLE — 'Expansion MRR' is gone from the screen and from the source", async () => {
    renderBillingTab(async () => ({ subscriptions: SUBS }));
    await openBillingTab();
    expect(screen.queryByText("Expansion MRR")).toBeNull();
    expect(read("client/src/pages/admin/Pricing.tsx")).not.toContain('label: "Expansion MRR"');
    /* And the honest replacement IS on screen. */
    expect(screen.getByText("Scale + Enterprise MRR")).toBeTruthy();
  });

  it("LOWER POLE — 'Churn rate' no longer presents as a real churn rate", async () => {
    renderBillingTab(async () => ({ subscriptions: SUBS }));
    await openBillingTab();
    expect(screen.queryByText("Churn rate")).toBeNull();
    expect(read("client/src/pages/admin/Pricing.tsx")).not.toContain('label: "Churn rate"');
    expect(screen.getByText("Cancelled share (all-time)")).toBeTruthy();
  });

  it("UPPER POLE — the Scale + Enterprise VALUE is arithmetically unchanged: $100.00", async () => {
    /* 120000 minor annual / 12 = 10000 minor monthly = $100.00. The founder_pro
       and founder_free rows must NOT be included — this proves the relabel did
       not quietly redefine the filter. */
    renderBillingTab(async () => ({ subscriptions: SUBS }));
    await openBillingTab();
    await waitFor(() =>
      expect(screen.getByTestId("card-metric-scale-+-enterprise-mrr").textContent).toContain("100.00"),
    );
    expect(screen.getByTestId("card-metric-scale-+-enterprise-mrr").textContent).toContain("$100.00");
  });

  it("UPPER POLE — the cancelled-share VALUE is arithmetically unchanged: 25.0%", async () => {
    /* 1 cancelled of 4 subscriptions. Note the precision is 1 dp and DELIBERATELY
       NOT touched: this is not an ownership percentage, so R47's 2 dp
       standardisation does not reach it. */
    renderBillingTab(async () => ({ subscriptions: SUBS }));
    await openBillingTab();
    await waitFor(() =>
      expect(screen.getByTestId("card-metric-cancelled-share-(all-time)").textContent).toContain("25.0%"),
    );
  });

  it("NO SILENT DROP — all six tiles still mount, and the four untouched labels are byte-identical", async () => {
    renderBillingTab(async () => ({ subscriptions: SUBS }));
    await openBillingTab();
    for (const id of TILES) expect(screen.getByTestId(id)).toBeTruthy();
    for (const label of ["MRR", "ARR", "New Revenue (trial)", "Past due"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    /* The plan-breakdown table beneath the tiles is still there too. */
    expect(screen.getByText(/Founder Scale/)).toBeTruthy();
  });

  it("SOURCE — the false comment that produced the label is corrected too", () => {
    /* A comment is not tracked copy, but it is where the next reader would
       re-introduce the label from. "vs prior month" was the source of the claim. */
    const src = read("client/src/pages/admin/Pricing.tsx");
    expect(src).not.toContain("Expansion revenue = scale + enterprise vs prior month");
    expect(src).toContain('label: "Scale + Enterprise MRR"');
    expect(src).toContain('label: "Cancelled share (all-time)"');
    /* The ARITHMETIC is untouched, asserted character for character. */
    expect(src).toContain('const expansionMinor = active.filter(s => s.plan === "founder_scale" || s.plan === "founder_enterprise").reduce((sum, s) => sum + s.annualAmountMinor / 12, 0);');
    expect(src).toContain('const churnRate = subs.length > 0 ? ((cancelled.length / subs.length) * 100).toFixed(1) : "0.0";');
  });

  it("LOWER POLE — 'in the last 30 days' is gone from the admin dashboard help text", () => {
    const src = read("client/src/pages/admin/Dashboard.tsx");
    /* The clause was demonstrably false: there is no date predicate in the
       computation. It must not survive anywhere in this file. */
    expect(src).not.toContain("downgraded or cancelled in the last 30 days");
    expect(src).toContain("downgraded or cancelled since the account was created");
    /* The APPENDED sentence R51 asked for. */
    expect(src).toContain("this figure can never decrease over time");
  });

  it("UPPER POLE — the churn ARITHMETIC and the honest-absence branch are untouched", () => {
    /* R51: the arithmetic is NOT touched. And `Churn —` is honest absence that
       the pre-flight's DO-NOT-TOUCH list names by name. */
    const store = read("server/adminPlatformStore.ts");
    expect(store).toContain("const churnPct = everCount > 0 ? Number(((cancelled / everCount) * 100).toFixed(2)) : null;");
    /* The two deliberate refusals two lines below it are exemplary and stay. */
    expect(store).toContain("momGrowthPct");
    expect(store).toContain("nrr");

    const dash = read("client/src/pages/admin/Dashboard.tsx");
    expect(dash).toContain('"Churn —"');
  });
});
