/**
 * WAVE 72 · DEFECT 2 — `null` OWNERSHIP RENDERS `—`, ON THE REAL PAGE, AND A
 * GENUINE `0` STILL RENDERS `0`.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, as a founder saw it (final review 1 §5, re-executed in
 * `build_log/wave72/scratch/p6_ui_before.mts`). The engine leaf is CORRECT and is
 * not touched: `0 shares / total 0 → ownershipPercent = null`, which the contract
 * (`packages/cap-table-engine/src/types.ts:143`) declares means UNDEFINED, not
 * zero. Three consumers on `/founder/captable` did arithmetic on it first:
 *
 *   · the holder row      `parseFloat(r.ownershipPercent).toFixed(2)` → "NaN"  → `NaN%`
 *   · the group subtotal  `reduce(s + parseFloat(...), 0)`            → NaN    → `NaN%`
 *   · the total cell      `parseFloat(String(r.ownershipPercent ?? "0"))` → 0, and
 *     because rows EXISTED the footer then printed the note
 *     "rows shown to 2dp; exact total is 100%" under a `0.00%` — a false claim
 *     about a total that does not exist. That is precisely the contradiction
 *     Waves 58c/58d removed from the EMPTY branch of the same cell.
 *
 * WHY THIS FILE MOUNTS THE REAL PAGE (R58). A source-text assertion cannot prove
 * a string reaches a screen. This drives the real `CapTable` component with the
 * real engine over a mocked holder-list response, in the same harness
 * `w55b_captable_empty_vs_failed.test.tsx` established, and reads the DOM.
 *
 * BOTH POLES, IN EVERY BLOCK — the distinction IS the fix:
 *   UNDEFINED pole  a populated view whose total shares are 0 → `—`, no `NaN`,
 *                   no `0.00%`, and NO "exact total is 100%" claim.
 *   REAL-ZERO pole  a 0-share holder BESIDE a real holder → that holder still
 *                   renders `0.00%`, the others their real percentages, and the
 *                   footer still reconciles to 100.00%.
 *
 * MUTATION TRANSCRIPT: build_log/wave72/W72_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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
  useActiveCompanyId: () => "co_w72",
  useActiveCompany: () => ({ data: { company: { companyName: "W72 Co" } } }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import CapTable, { displayedOwnershipTotal } from "../CapTable";
import {
  ownershipPercentCellText, sumOwnershipPercent, ownershipPercentForExport,
  ownershipPercentBarWidth,
} from "@/lib/captable/ownershipPercent";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

type Sec = Record<string, unknown>;
function wireSecurities(secs: Sec[]) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/securities$/.test(url)) return jsonResponse(secs);
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

/** A NAMED holder with zero shares — survives the phantom-holder filter, so it
    really does reach the table (`client/src/lib/captable/phantomHolder.ts`
    suppresses only an unnamed/"Other" row with 0 shares and 0 invested). */
const ZERO_SHARE_FOUNDER: Sec = {
  id: "sec_w72_zero", companyId: "co_w72", holderName: "Ada Founder", holderType: "founder",
  instrument: "common", series: null, shares: 0, pricePerShare: null, investmentAmount: null,
  issuedAt: "2024-01-01",
};
const REAL_FOUNDER: Sec = {
  ...ZERO_SHARE_FOUNDER, id: "sec_w72_real", holderName: "Bo Founder", shares: 3_000_000,
};
const REAL_INVESTOR: Sec = {
  id: "sec_w72_inv", companyId: "co_w72", holderName: "Cy Capital", holderType: "investor",
  instrument: "preferred", series: "Series A", shares: 1_000_000, pricePerShare: 1,
  investmentAmount: 1_000_000, issuedAt: "2025-01-01",
};

afterEach(() => { cleanup(); apiRequestMock.mockReset(); });

/* ═══════════════════════════════════════════════════════════════════════════
 * A — THE GROUPED VIEW (the default view, and the one the review measured)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W72-A — the grouped cap-table view", () => {
  it("W72-A1 — UNDEFINED POLE: a populated zero-share view renders `—`, never `NaN`", async () => {
    wireSecurities([ZERO_SHARE_FOUNDER]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("table-captable").textContent ?? "").toContain("Ada Founder"));
    const table = screen.getByTestId("table-captable");
    /* THE DEFECT, ASSERTED AS ABSENT. Before this wave this table's text contained
       `NaN%` twice: once on the holder row, once on the Founders subtotal. */
    expect(table.textContent ?? "").not.toContain("NaN");
    /* AND THE HONEST FORM, ASSERTED AS PRESENT — the row and the subtotal. */
    const dashPercents = (table.textContent ?? "").match(/—%/g) ?? [];
    expect(dashPercents.length).toBeGreaterThanOrEqual(2);
    /* The holder is STILL THERE. A refusal replaces a value, never its row. */
    expect(table.textContent ?? "").toContain("Ada Founder");
    /* No fabricated zero anywhere in the ownership column. */
    expect(table.textContent ?? "").not.toContain("0.00%");
  });

  it("W72-A2 — REAL-ZERO POLE: a genuine 0-share holder beside real holders still renders 0.00%", async () => {
    /* THE WHOLE POINT OF THE DISTINCTION. Same 0-share row as A1, but now the
       view HAS a denominator, so the engine returns `\"0\"` and not `null`, and
       `0.00%` is the TRUE figure. If the fix rendered `—` here it would be hiding
       a real number, which is the opposite defect. */
    wireSecurities([ZERO_SHARE_FOUNDER, REAL_FOUNDER, REAL_INVESTOR]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("table-captable").textContent ?? "").toContain("Cy Capital"));
    const text = screen.getByTestId("table-captable").textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).toContain("0.00%");   // Ada, who really does hold 0 of 4,000,000
    expect(text).toContain("75.00%");  // Bo, 3,000,000 / 4,000,000
    expect(text).toContain("25.00%");  // Cy, 1,000,000 / 4,000,000
    expect(text).toContain("Ada Founder");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B — THE FLAT VIEW'S TOTAL CELL: the false "exact total is 100%" claim
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W72-B — the flat view's derived total", () => {
  async function openFlat(secs: Sec[]) {
    wireSecurities(secs);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("table-captable").textContent ?? "").toContain("Founder"));
    /* The page defaults to Grouped (`CapTable.tsx:220`); the total cell lives in
       the flat table, so the real toggle is clicked rather than stubbed. */
    fireEvent.click(screen.getByText(/Grouped|Flat list/));
    await waitFor(() => expect(screen.queryByTestId("captable-flat-total-percent")).toBeTruthy());
  }

  it("W72-B1 — UNDEFINED POLE: the total is `—` and the screen does NOT claim the exact total is 100%", async () => {
    await openFlat([ZERO_SHARE_FOUNDER]);
    expect(screen.getByTestId("captable-flat-total-percent").textContent).toBe("—");
    /* THE FALSE STATEMENT, ASSERTED ABSENT. */
    expect(screen.queryByTestId("captable-flat-total-rounding-note")).toBeNull();
    expect(screen.queryByTestId("captable-flat-total-exact")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("exact total is 100%");
    /* AND THE HONEST STATEMENT, ASSERTED PRESENT — the container is not empty. */
    const note = screen.getByTestId("captable-flat-total-undefined-note");
    expect(note.textContent ?? "").toContain("undefined");
    expect(note.textContent ?? "").toContain("not 0%");
    /* The empty-table branch must NOT have been reused: rows exist here. */
    expect(screen.queryByTestId("captable-flat-total-empty-note")).toBeNull();
  });

  it("W72-B2 — REAL POLE: a reconciling table still says the exact total is 100%", async () => {
    await openFlat([ZERO_SHARE_FOUNDER, REAL_FOUNDER, REAL_INVESTOR]);
    expect(screen.getByTestId("captable-flat-total-percent").textContent).toBe("100.00");
    expect(screen.getByTestId("captable-flat-total-exact").textContent).toBe("100.00%");
    expect(screen.queryByTestId("captable-flat-total-undefined-note")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("NaN");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * C — THE HELPERS, AT EVERY POLE OF THE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W72-C — the one null-aware ownership formatter", () => {
  it("W72-C1 — `null` is `—`; a real `0` is `0.00`; `Infinity`/`NaN` are `—` (R47/R54)", () => {
    expect(ownershipPercentCellText(null)).toBe("—");
    expect(ownershipPercentCellText(undefined)).toBe("—");
    expect(ownershipPercentCellText("0")).toBe("0.00");
    expect(ownershipPercentCellText(0)).toBe("0.00");
    expect(ownershipPercentCellText("33.333333")).toBe("33.33");
    expect(ownershipPercentCellText("100")).toBe("100.00");
    expect(ownershipPercentCellText("Infinity")).toBe("—");
    expect(ownershipPercentCellText(Number.NaN)).toBe("—");
  });

  it("W72-C2 — a subtotal containing ONE undefined member is undefined, not a smaller number", () => {
    expect(sumOwnershipPercent([{ ownershipPercent: "60" }, { ownershipPercent: "40" }])).toBe(100);
    expect(sumOwnershipPercent([{ ownershipPercent: "60" }, { ownershipPercent: null }])).toBeNull();
    expect(sumOwnershipPercent([{ ownershipPercent: "0" }, { ownershipPercent: "0" }])).toBe(0);
    expect(sumOwnershipPercent([])).toBe(0);
  });

  it("W72-C3 — an undefined percentage draws NO bar, and a real one is unchanged", () => {
    expect(ownershipPercentBarWidth(null)).toBe("0%");
    expect(ownershipPercentBarWidth("0")).toBe("0%");
    expect(ownershipPercentBarWidth("42.5")).toBe("42.5%");
    expect(ownershipPercentBarWidth("250")).toBe("100%");
  });

  it("W72-C4 — an export cell states `—` instead of leaving the cell empty, and keeps FULL precision otherwise", () => {
    /* `[null].join(\",\")` wrote an empty cell — indistinguishable from a dropped
       value. The real value is still the engine's exact string, NOT the 2dp
       display value: an export is a record, not a rendering. */
    expect(ownershipPercentForExport(null)).toBe("—");
    expect(ownershipPercentForExport(undefined)).toBe("—");
    expect(ownershipPercentForExport("60.00000150000003750000093750002343750059"))
      .toBe("60.00000150000003750000093750002343750059");
    expect(ownershipPercentForExport("0")).toBe("0");
  });

  it("W72-C5 — `displayedOwnershipTotal` reports THREE distinct states, and `?? \"0\"` is gone", () => {
    /* undefined ≠ empty ≠ a populated table that rounds to 0.00%. */
    const undef = displayedOwnershipTotal([{ ownershipPercent: null }, { ownershipPercent: null }]);
    expect(undef.undefinedTotal).toBe(true);
    expect(undef.sum).toBe("—");
    expect(undef.exact).toBe(false);
    expect(undef.empty).toBe(false);

    const empty = displayedOwnershipTotal([]);
    expect(empty.empty).toBe(true);
    expect(empty.undefinedTotal).toBe(false);
    expect(empty.sum).toBe("0.00");

    const tiny = displayedOwnershipTotal([{ ownershipPercent: "0.001" }, { ownershipPercent: "0.002" }]);
    expect(tiny.undefinedTotal).toBe(false);
    expect(tiny.empty).toBe(false);
    expect(tiny.sum).toBe("0.00");

    const exact = displayedOwnershipTotal([{ ownershipPercent: "60" }, { ownershipPercent: "40" }]);
    expect(exact.exact).toBe(true);
    expect(exact.undefinedTotal).toBe(false);
    expect(exact.sum).toBe("100.00");

    /* ONE undefined row poisons the whole total — it is not skipped, because a
       total that silently omits a holder is a smaller number presented as the
       whole. */
    const mixed = displayedOwnershipTotal([{ ownershipPercent: "60" }, { ownershipPercent: null }]);
    expect(mixed.undefinedTotal).toBe(true);
    expect(mixed.sum).toBe("—");
  });
});
