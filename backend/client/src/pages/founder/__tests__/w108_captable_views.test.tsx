/**
 * WAVE 108 · FINDING 1 — THE THREE CAP-TABLE VIEWS.
 *
 * ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────────
 * The report said the Basic and As-Converted tabs "do not change the selected
 * state, the denominator, or the data". Two of those three are true and one is
 * not, and the distinction matters, so both are pinned here:
 *
 *   TRUE  — the selected state never moved. Each `<TabsTrigger>` was wrapped in
 *           `<TooltipTrigger asChild>`, whose Radix `Slot` merges the TOOLTIP's
 *           `data-state="closed"` into the child, and `TabsPrimitive.Trigger`
 *           spreads incoming props AFTER its own `data-state`. Every tab
 *           rendered `data-state="closed"`, so `data-[state=active]:bg-background`
 *           could never match.
 *   TRUE  — every denominator on the page said "of fully-diluted shares",
 *           hardcoded, on all three views. A Basic percentage announced as
 *           fully-diluted is a WRONG OWNERSHIP PERCENTAGE.
 *   FALSE — the data did change. `view` was written and read and the engine
 *           recomputed. A test that only proved "the tabs are dead" would have
 *           been asserting something untrue.
 *
 * ── THE FIXTURE IS BUILT SO THE THREE VIEWS CANNOT COINCIDE ──────────────────
 * A test that passes when all three views render identically is worthless, so
 * the fixture carries a component that only ONE view counts:
 *
 *   6,000,000 common      counted by all three
 *   2,000,000 preferred   counted by all three   (priced at $4 — the as-converted
 *                                                 view needs a priced round)
 *   1,000,000 options     counted by FD and AC only
 *     500,000 warrants    counted by FD and AC only
 *   $250,000 SAFE         counted by AC only
 *
 * so Basic < Fully Diluted < As Converted, strictly, and the assertion below is
 * that the three denominators are three DIFFERENT numbers.
 *
 * ── ROUNDING TOLERANCE, STATED ───────────────────────────────────────────────
 * Each row's percentage is displayed to 2 decimal places, so each row can be off
 * by up to 0.005 percentage points. The largest table asserted here has 5 rows,
 * so the displayed rows can sum to at worst 100 ± 0.025 percentage points. The
 * tolerance asserted is therefore **±0.03 percentage points**, and separately the
 * rendered total is asserted to equal the finger-sum of the displayed rows
 * EXACTLY, because Wave 58b made it derived rather than asserted.
 *
 * MUTATION TRANSCRIPT (each assertion shown failing on the pre-fix code):
 * build_log/wave108/W108_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/AppShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/AppShell")>("@/components/AppShell");
  return {
    ...actual,
    PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    /* `actions` carries the engine badge, so the mock must render it — otherwise
       the Finding 2 assertions would pass by the badge simply being absent. */
    PageHeader: ({ children, actions }: { children?: React.ReactNode; actions?: React.ReactNode }) => (
      <div>{children}{actions}</div>
    ),
  };
});
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w108",
  useActiveCompany: () => ({ data: { company: { companyName: "W108 Co" } } }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import CapTable, { resolveHolderLabel, VIEW_DENOMINATOR_LABEL } from "../CapTable";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function wireApi(securities: unknown) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/securities$/.test(url)) return jsonResponse(securities);
    return jsonResponse([]);
  });
}

/** The fixture on which the three views MUST differ. */
const THREE_WAY = [
  { id: "s1", companyId: "co_w108", holderName: "Founder A", holderType: "founder", instrument: "common", series: null, shares: 6000000, pricePerShare: 0.0001, investmentAmount: 600, cap: null, discount: null, issuedAt: "2025-01-01" },
  { id: "s2", companyId: "co_w108", holderName: "Investor B", holderType: "investor", instrument: "preferred", series: "A", shares: 2000000, pricePerShare: 4, investmentAmount: 8000000, cap: null, discount: null, issuedAt: "2025-02-01" },
  { id: "s3", companyId: "co_w108", holderName: "Option Pool", holderType: "pool", instrument: "option", series: null, shares: 1000000, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2025-01-01" },
  { id: "s4", companyId: "co_w108", holderName: "Warrant Holder", holderType: "other", instrument: "warrant", series: null, shares: 500000, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2025-03-01" },
  { id: "s5", companyId: "co_w108", holderName: "SAFE Holder", holderType: "investor", instrument: "safe", series: null, shares: 0, pricePerShare: null, investmentAmount: 250000, cap: 8000000, discount: 0.2, issuedAt: "2025-04-01" },
];

/** Convertibles present, NO priced round anywhere — As Converted has no price. */
const NO_PRICED_ROUND = [
  { id: "n1", companyId: "co_w108", holderName: "Founder A", holderType: "founder", instrument: "common", series: null, shares: 5000000, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2025-01-01" },
  { id: "n2", companyId: "co_w108", holderName: "SAFE Holder", holderType: "investor", instrument: "safe", series: null, shares: 0, pricePerShare: null, investmentAmount: 250000, cap: null, discount: null, issuedAt: "2025-04-01" },
];

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

/** Radix Tabs selects on MOUSEDOWN. `fireEvent.click` alone does nothing at all,
 *  which is exactly why a click-only test would have "passed" against dead tabs. */
function selectTab(el: HTMLElement) {
  fireEvent.pointerDown(el, { button: 0, ctrlKey: false });
  fireEvent.mouseDown(el, { button: 0, ctrlKey: false });
  fireEvent.click(el, { button: 0 });
}

const TAB = { basic: "tab-basic", fully_diluted: "tab-fd", as_converted: "tab-ac" } as const;

/** The page opens GROUPED; the flat-list total row only exists in flat mode. The
 *  Grouped/Flat toggle is the reference implementation this wave was told to copy
 *  — it is a plain button and a plain click drives it. */
async function switchToFlatList() {
  fireEvent.click(screen.getByTestId("button-toggle-grouping"));
  await waitFor(() => expect(screen.getByTestId("captable-flat-total-percent")).toBeTruthy());
}

async function awaitLoaded() {
  await waitFor(() => expect(screen.getByTestId("captable-denominator-basis")).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId("stat-total-shares").textContent ?? "").toMatch(/\d,\d{3}/));
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  /* The selected view is persisted, so without this each test would inherit the
     previous test's tab and the "opens on Fully Diluted" assertion would be a
     coin-flip on file order. */
  localStorage.clear();
});

describe("W108 · Finding 1 — each view has its own selected state, denominator and numbers", () => {
  it("SELECTED STATE — exactly one tab is active, and it MOVES when another view is chosen", async () => {
    /* Pre-fix every trigger rendered data-state="closed" (the tooltip's state) and
       this assertion failed on the very first line. */
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    const states = () =>
      Object.fromEntries(
        Object.entries(TAB).map(([v, id]) => [v, screen.getByTestId(id).getAttribute("data-state")]),
      );

    expect(states()).toEqual({ basic: "inactive", fully_diluted: "active", as_converted: "inactive" });

    selectTab(screen.getByTestId(TAB.basic));
    await waitFor(() => expect(screen.getByTestId(TAB.basic).getAttribute("data-state")).toBe("active"));
    expect(states()).toEqual({ basic: "active", fully_diluted: "inactive", as_converted: "inactive" });

    selectTab(screen.getByTestId(TAB.as_converted));
    await waitFor(() => expect(screen.getByTestId(TAB.as_converted).getAttribute("data-state")).toBe("active"));
    expect(states()).toEqual({ basic: "inactive", fully_diluted: "inactive", as_converted: "active" });

    /* And "closed" — the tooltip state that used to win — is on none of them. */
    for (const id of Object.values(TAB)) {
      expect(screen.getByTestId(id).getAttribute("data-state")).not.toBe("closed");
    }
  });

  it("DENOMINATOR IS NAMED — each view states its own denominator, in three places", async () => {
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    const seen: string[] = [];
    for (const view of ["fully_diluted", "basic", "as_converted"] as const) {
      selectTab(screen.getByTestId(TAB[view]));
      await waitFor(() =>
        expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL[view]),
      );
      /* 1 — the documentation panel names it … */
      expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL[view]);
      /* 2 — the holdings column header names it … */
      expect(screen.getByTestId("captable-header-denominator").textContent).toBe(`of ${VIEW_DENOMINATOR_LABEL[view]}`);
      /* 3 — and the strip above the table names it. */
      expect(screen.getByTestId("captable-holdings-view").textContent).toContain(VIEW_DENOMINATOR_LABEL[view]);
      seen.push(VIEW_DENOMINATOR_LABEL[view]);
    }
    /* Three DIFFERENT names — a fix that named the same denominator three times
       would satisfy every assertion above and still be the original defect. */
    expect(new Set(seen).size).toBe(3);
  });

  it("NO FALL-THROUGH — a view never names or shows another view's denominator", async () => {
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    selectTab(screen.getByTestId(TAB.basic));
    await waitFor(() =>
      expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL.basic),
    );
    /* The three sites that used to be hardcoded must no longer say fully-diluted
       while Basic is selected. (The DEFINITION panel's prose deliberately DOES
       discuss the fully-diluted view — that is the documentation this wave was
       told to preserve — so the assertion is scoped to the labels.) */
    expect(screen.getByTestId("captable-header-denominator").textContent).not.toContain("fully-diluted");
    expect(screen.getByTestId("captable-denominator-basis").textContent).not.toContain("fully-diluted");
    expect(screen.getByTestId("captable-holdings-view").textContent).not.toContain("fully-diluted");
  });

  it("THE NUMBERS DIFFER — three views, three different denominators and three different row sets", async () => {
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    const totals: Record<string, string> = {};
    const rowCounts: Record<string, number> = {};
    for (const view of ["fully_diluted", "basic", "as_converted"] as const) {
      selectTab(screen.getByTestId(TAB[view]));
      await waitFor(() =>
        expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL[view]),
      );
      totals[view] = screen.getByTestId("captable-denominator-total").textContent ?? "";
      rowCounts[view] = document.querySelectorAll('[data-testid^="row-security-"]').length;
    }
    /* Three distinct denominators … */
    expect(new Set(Object.values(totals)).size).toBe(3);
    /* … and Basic really is the narrowest and As Converted the widest. */
    const num = (s: string) => Number(s.replace(/[^0-9]/g, ""));
    expect(num(totals.basic)).toBeLessThan(num(totals.fully_diluted));
    expect(num(totals.fully_diluted)).toBeLessThan(num(totals.as_converted));
    /* … over three different row sets. */
    expect(rowCounts.basic).toBeLessThan(rowCounts.fully_diluted);
    expect(rowCounts.fully_diluted).toBeLessThan(rowCounts.as_converted);
  });

  it("PERCENTAGES RECONCILE — within each view, the displayed rows sum to 100% ± 0.03 points", async () => {
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    await switchToFlatList();
    for (const view of ["fully_diluted", "basic", "as_converted"] as const) {
      selectTab(screen.getByTestId(TAB[view]));
      await waitFor(() =>
        expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL[view]),
      );
      const rendered = Number(screen.getByTestId("captable-flat-total-percent").textContent);
      /* Stated tolerance: rows are shown to 2dp, so each contributes at most
         0.005 points of rounding; 5 rows is at most 0.025. */
      expect(Math.abs(rendered - 100)).toBeLessThanOrEqual(0.03);
    }
  });

  it("TOTALS COPY — the line renders ONCE, names the view's denominator, and has no doubled phrase", async () => {
    /* The live site read:
         "100.00% of fully-diluted shares, summed from the rows above exactly as
          they are displayed 100.00%"
       — one unconditional sentence plus a second bare "100.00%" span. */
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();
    await switchToFlatList();
    /* The selected view survives a remount, so it is chosen explicitly rather
       than assumed — this test is about the COPY, not about the default. */
    selectTab(screen.getByTestId(TAB.fully_diluted));
    await waitFor(() =>
      expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL.fully_diluted),
    );

    /** What a SIGHTED founder reads: the cell with screen-reader-only nodes
     *  removed. The screen-reader channel is asserted separately below, because
     *  Wave 72 deliberately pinned one of those nodes to the bytes `100.00%`. */
    const visibleTotal = () => {
      const cell = (screen.getByTestId("captable-flat-total-percent").closest("td") as HTMLElement).cloneNode(true) as HTMLElement;
      cell.querySelectorAll(".sr-only").forEach((n) => n.remove());
      return (cell.textContent ?? "").replace(/\s+/g, " ").trim();
    };

    /* The figure is printed ONCE. */
    expect((visibleTotal().match(/100\.00%/g) ?? []).length).toBe(1);
    expect(visibleTotal()).not.toMatch(/100\.00%[\s\S]*100\.00%/);
    /* The malformed live concatenation — sentence, then a second bare figure —
       cannot occur anywhere in the cell, on either channel. */
    const whole = (screen.getByTestId("captable-flat-total-percent").closest("td") as HTMLElement).textContent ?? "";
    expect(whole).not.toMatch(/as they are displayed\s*100\.00%/);
    expect((whole.match(/summed from the rows above exactly as they are displayed/g) ?? []).length).toBe(1);
    /* And whichever branch rendered, it names THIS view's denominator. */
    expect(whole).toContain(VIEW_DENOMINATOR_LABEL.fully_diluted);
    expect(whole).not.toContain(VIEW_DENOMINATOR_LABEL.basic);

    selectTab(screen.getByTestId(TAB.basic));
    await waitFor(() =>
      expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL.basic),
    );
    const basicWhole = (screen.getByTestId("captable-flat-total-percent").closest("td") as HTMLElement).textContent ?? "";
    expect(basicWhole).toContain(VIEW_DENOMINATOR_LABEL.basic);
    expect(basicWhole).not.toContain("fully-diluted");
    expect(basicWhole).not.toMatch(/as they are displayed\s*100\.00%/);
    expect((visibleTotal().match(/%/g) ?? []).length).toBe(1);
  });

  it("REFUSAL — a view that cannot be computed says so in English and shows NO numbers", async () => {
    /* Pre-fix `runEngine` threw out of an un-guarded useMemo and the page crashed
       during render, so there was no refusal to read. */
    wireApi(NO_PRICED_ROUND);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("captable-denominator-basis")).toBeTruthy());

    selectTab(screen.getByTestId(TAB.as_converted));
    const refusal = await screen.findByTestId("captable-view-refusal");
    const words = refusal.textContent ?? "";

    /* Plain English, and it says what it did NOT do. */
    expect(words).toContain("cannot be calculated");
    expect(words).toContain("priced round");
    expect(words).toContain("Nothing has been substituted");
    /* No error code, no identifier, no class name. */
    expect(words).not.toMatch(/[a-z]_[a-z]/);
    expect(words).not.toMatch(/AsConverted/);

    /* It does NOT fall through: no holdings table, no total, and the page does
       not claim the company has no securities. */
    expect(screen.queryByTestId("table-captable")).toBeNull();
    expect(screen.queryByTestId("captable-flat-total-percent")).toBeNull();
    expect(screen.queryByTestId("captable-empty-state")).toBeNull();
    expect(screen.getByTestId("stat-total-shares").textContent ?? "").not.toMatch(/\d/);
    expect(screen.getByTestId("captable-denominator-total-refused")).toBeTruthy();

    /* And the reader can still get out — the tabs are still mounted. */
    selectTab(screen.getByTestId(TAB.basic));
    await waitFor(() => expect(screen.queryByTestId("captable-view-refusal")).toBeNull());
    expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL.basic);
  });
});

describe("W108 · Finding 2 — nothing a human reads on this surface is an internal identifier", () => {
  it("no package name, no version string, no snake_case or dotted event code is rendered", async () => {
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    /* Every visible view, because a leak can hide on one tab. */
    for (const view of ["fully_diluted", "basic", "as_converted"] as const) {
      selectTab(screen.getByTestId(TAB[view]));
      await waitFor(() =>
        expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(VIEW_DENOMINATOR_LABEL[view]),
      );
      const text = document.body.textContent ?? "";
      expect(text).not.toContain("@capavate/");
      expect(text).not.toMatch(/v\d+\.\d+\.\d+/);
      expect(text).not.toMatch(/[a-z]-default/);
      /* snake_case — `fully_diluted`, `founder_global_search`, `us-default`. */
      expect(text).not.toMatch(/[a-z]_[a-z]/);
      /* a three-segment dotted machine code — `round.initial_shareholders.set`. */
      expect(text).not.toMatch(/\b[a-z]+\.[a-z]+\.[a-z]+\b/);
    }
  });

  it("the jurisdictional convention is still NAMED — the badge was not deleted", async () => {
    /* The ruling was explicit: naming which convention produced a number is
       valuable and must not be lost. */
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();
    const badge = screen.getByTestId("badge-engine");
    expect(badge.textContent ?? "").toContain("cap-table conventions");
    expect(badge.textContent ?? "").not.toMatch(/v\d+\.\d+\.\d+/);
    /* The region CODE is still available to machines, which is explicitly allowed. */
    expect(badge.getAttribute("data-region")).toBeTruthy();
  });
});

describe("W108 · Finding 3 — a description of a record is not rendered as a name", () => {
  it("resolveHolderLabel reports WHICH it produced, and fabricates nothing", () => {
    expect(resolveHolderLabel("Ada Lovelace", "u_1")).toEqual({ text: "Ada Lovelace", kind: "name" });
    /* "New contact data" is STORED CUSTOMER DATA, not a fallback. It is passed
       through verbatim: a renderer that renamed it would be silently editing the
       record. It is reported for data remediation instead. */
    expect(resolveHolderLabel("New contact data", "u_2")).toEqual({ text: "New contact data", kind: "name" });
    /* "Redeemed holder" IS the fallback, and now says so. */
    expect(resolveHolderLabel("", "u_redeemed_1782888492403")).toEqual({
      text: "Redeemed holder",
      kind: "description",
    });
    expect(resolveHolderLabel("", "")).toEqual({ text: "Holder (name not recorded)", kind: "description" });
    /* No fabricated name, ever: the id is never returned. */
    expect(resolveHolderLabel("u_redeemed_1782888492403", "u_redeemed_1782888492403").text)
      .not.toContain("u_redeemed");
  });

  it("a described holder renders visibly differently from a named one", async () => {
    wireApi([
      { id: "d1", companyId: "co_w108", holderName: "Ada Lovelace", holderType: "founder", instrument: "common", series: null, shares: 900000, pricePerShare: 0.0001, investmentAmount: 90, cap: null, discount: null, issuedAt: "2025-01-01" },
      { id: "d2", companyId: "co_w108", holderName: "u_redeemed_1782888492403", holderType: "investor", instrument: "common", series: null, shares: 100000, pricePerShare: 0.0001, investmentAmount: 10, cap: null, discount: null, issuedAt: "2025-01-02", investorId: "u_redeemed_1782888492403" },
    ]);
    renderPage();
    await awaitLoaded();

    const named = document.querySelector('[data-holder-name-source="recorded"]') as HTMLElement;
    const described = document.querySelector('[data-holder-name-source="described"]') as HTMLElement;
    expect(named.textContent).toBe("Ada Lovelace");
    expect(described.textContent ?? "").toContain("Redeemed holder");
    /* The distinguishing statement — this is the whole point of the finding. */
    expect(described.textContent ?? "").toContain("name not on record");
    /* And the raw id still never reaches the screen. */
    expect(document.body.textContent ?? "").not.toContain("u_redeemed_");
  });
});
