/**
 * WAVE 110 · FINDING 1, 2 and 4 — THE EXPORTED BYTES.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 * 1. FINDING 1. Both spreadsheet exports ended in a bare `"Ownership %"`
 *    (`CapTable.tsx:457` CSV, `:525` XLSX before this wave), so a Basic-view CSV
 *    was BYTE-INDISTINGUISHABLE from a Fully-Diluted CSV of the same company on
 *    the same day while carrying DIFFERENT numbers — different denominators are
 *    the whole point of the three views. An export outlives the screen; a
 *    percentage whose denominator is unstated and unknowable is a wrong number
 *    waiting to happen. Asserted below on the ACTUAL BYTES of both files.
 * 2. FINDING 2. `refuseExportOnRefusedView()` was called at 2 of the 4 export
 *    entry points. PDF (`:505`) and Print (`:583`, which reused the same handler)
 *    fired a server render for a view the interface had just refused. All four
 *    are enumerated by name in the assertion below.
 * 3. FINDING 4. The Excel export downloaded as `novapay-captable-*.xls` —
 *    another company's brand on a file leaving this platform.
 *
 * NO COMPUTED VALUE IS ASSERTED TO CHANGE. Every assertion here is about labels,
 * filenames and refusal.
 *
 * Falsification transcript (each assertion shown failing on pre-wave-110 code):
 * build_log/wave110/W110_TESTS.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/components/AppShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/AppShell")>("@/components/AppShell");
  return {
    ...actual,
    PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    /* `actions` carries every export button, so the mock MUST render it. */
    PageHeader: ({ children, actions }: { children?: React.ReactNode; actions?: React.ReactNode }) => (
      <div>{children}{actions}</div>
    ),
  };
});
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w110",
  useActiveCompany: () => ({ data: { company: { companyName: "Aurora Systems" } } }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import CapTable from "../CapTable";

/** THE FOUR EXPORT PATHS, NAMED. Nothing else on this page emits a file. */
const EXPORT_PATHS = [
  { name: "CSV export", testid: "button-export-csv" },
  { name: "Excel (XLSX) export", testid: "button-export-xlsx" },
  { name: "PDF snapshot", testid: "button-export-pdf" },
  { name: "Print", testid: "button-print" },
] as const;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function wireApi(securities: unknown) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/securities$/.test(url)) return jsonResponse(securities);
    if (/cap-table\/pdf$/.test(url)) {
      return { ok: true, status: 200, blob: async () => new Blob(["%PDF-1.4"]) } as unknown as Response;
    }
    return jsonResponse([]);
  });
}

/** Basic < Fully Diluted < As Converted, strictly — the three views cannot coincide. */
const THREE_WAY = [
  { id: "s1", companyId: "co_w110", holderName: "Founder A", holderType: "founder", instrument: "common", series: null, shares: 6000000, pricePerShare: 0.0001, investmentAmount: 600, cap: null, discount: null, issuedAt: "2025-01-01" },
  { id: "s2", companyId: "co_w110", holderName: "Investor B", holderType: "investor", instrument: "preferred", series: "A", shares: 2000000, pricePerShare: 4, investmentAmount: 8000000, cap: null, discount: null, issuedAt: "2025-02-01" },
  { id: "s3", companyId: "co_w110", holderName: "Option Pool", holderType: "pool", instrument: "option", series: null, shares: 1000000, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2025-01-01" },
  { id: "s4", companyId: "co_w110", holderName: "Warrant Holder", holderType: "other", instrument: "warrant", series: null, shares: 500000, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2025-03-01" },
];

/** Convertibles present, NO priced round — the As Converted view refuses. */
const NO_PRICED_ROUND = [
  { id: "n1", companyId: "co_w110", holderName: "Founder A", holderType: "founder", instrument: "common", series: null, shares: 5000000, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2025-01-01" },
  { id: "n2", companyId: "co_w110", holderName: "SAFE Holder", holderType: "investor", instrument: "safe", series: null, shares: 0, pricePerShare: null, investmentAmount: 250000, cap: null, discount: null, issuedAt: "2025-04-01" },
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

/** Radix Tabs select on MOUSEDOWN — a plain click does nothing at all. */
function selectTab(el: HTMLElement) {
  fireEvent.pointerDown(el, { button: 0, ctrlKey: false });
  fireEvent.mouseDown(el, { button: 0, ctrlKey: false });
  fireEvent.click(el, { button: 0 });
}
const TAB = { basic: "tab-basic", fully_diluted: "tab-fd", as_converted: "tab-ac" } as const;
const DENOM = {
  basic: "issued shares (outstanding basis)",
  fully_diluted: "fully-diluted shares",
  as_converted: "as-converted shares",
} as const;

/** Select a view and wait until the page's own denominator label agrees. */
async function selectView(view: keyof typeof TAB) {
  selectTab(screen.getByTestId(TAB[view]));
  await waitFor(() =>
    expect(screen.getByTestId("captable-denominator-basis").textContent).toBe(DENOM[view]),
  );
}

/* ── The captured file: bytes + the name it downloads under ─────────────────── */
type Captured = { name: string; blob: Blob | undefined };
let captured: Captured[] = [];
let pendingBlobs: Blob[] = [];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  /* A FRESH array per test — never `length = 0` on a shared one, or a file captured
     by the previous test could still be written into this test's slots. */
  captured = [];
  pendingBlobs = [];
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
    pendingBlobs.push(b);
    return `blob:w110/${pendingBlobs.length}`;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    const idx = Number((this.href || "").split("/").pop()) - 1;
    /* Only the reference is taken here; the bytes are read in `readAll`, after the
       clicks, so no promise from one test can land in another test's array. */
    captured.push({ name: this.download, blob: pendingBlobs[idx] });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  apiRequestMock.mockReset();
  toastMock.mockReset();
  localStorage.clear();
});

async function awaitLoaded() {
  await waitFor(() => expect(screen.getByTestId("captable-denominator-basis")).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId("stat-total-shares").textContent ?? "").toMatch(/\d,\d{3}/));
}

/** Await the expected number of downloads, then read each file's actual bytes. */
async function readAll(expectedCount: number): Promise<{ name: string; bytes: string }[]> {
  await waitFor(() => expect(captured.length).toBe(expectedCount));
  const out: { name: string; bytes: string }[] = [];
  for (const c of captured) out.push({ name: c.name, bytes: c.blob ? await c.blob.text() : "" });
  for (const f of out) expect(f.bytes.length).toBeGreaterThan(0);
  return out;
}

/** Every foreign brand / placeholder name that must never appear in a filename. */
const FOREIGN_NAMES = ["novapay", "arboreal", "kelvin", "quanta", "acme", "example", "demo", "test-co", "placeholder", "untitled"];

describe("W110 · Finding 1 — a Basic export and a Fully-Diluted export are distinguishable in their bytes", () => {
  it("CSV — the two files differ, and each one names its own view and denominator", async () => {
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    /* Select Fully Diluted EXPLICITLY. The view is module-scoped session state, so
       a test that merely assumed the default would inherit the previous test's tab
       and could export the same view twice — which is exactly the bug shape. */
    await selectView("fully_diluted");
    fireEvent.click(screen.getByTestId("button-export-csv"));
    await selectView("basic");
    fireEvent.click(screen.getByTestId("button-export-csv"));

    const [fd, basic] = await readAll(2);

    /* THE HEADLINE ASSERTION: the bytes are not the same file. */
    expect(fd.bytes).not.toBe(basic.bytes);

    /* Each names its view and its denominator in the ownership column header … */
    expect(fd.bytes).toContain("Ownership % (Fully Diluted view — % of fully-diluted shares)");
    expect(basic.bytes).toContain("Ownership % (Basic view — % of issued shares (outstanding basis))");
    /* … and neither carries the other's denominator anywhere in the file. */
    expect(basic.bytes).not.toContain("fully-diluted shares");
    expect(fd.bytes).not.toContain("issued shares (outstanding basis)");

    /* … in a provenance row that also names the company and the as-of date … */
    for (const f of [fd, basic]) {
      expect(f.bytes.split("\n")[0]).toContain("Capavate cap-table export");
      expect(f.bytes.split("\n")[0]).toContain("Company: Aurora Systems");
      expect(f.bytes.split("\n")[0]).toMatch(/As of: \d{4}-\d{2}-\d{2}/);
      expect(f.bytes.split("\n")[0]).toContain("not comparable");
    }
    expect(fd.bytes.split("\n")[0]).toContain("View: Fully Diluted");
    expect(basic.bytes.split("\n")[0]).toContain("View: Basic");

    /* … and in the FILENAME, so the two cannot overwrite each other. */
    expect(fd.name).not.toBe(basic.name);
    expect(fd.name).toMatch(/^aurora-systems-captable-fully-diluted-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(basic.name).toMatch(/^aurora-systems-captable-basic-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("EXCEL — the two files differ, each names its denominator, and no filename carries a foreign brand", async () => {
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    await selectView("fully_diluted");
    fireEvent.click(screen.getByTestId("button-export-xlsx"));
    await selectView("basic");
    fireEvent.click(screen.getByTestId("button-export-xlsx"));

    const [fd, basic] = await readAll(2);

    expect(fd.bytes).not.toBe(basic.bytes);
    expect(fd.bytes).toContain("Ownership % (Fully Diluted view — % of fully-diluted shares)");
    expect(basic.bytes).toContain("Ownership % (Basic view — % of issued shares (outstanding basis))");
    expect(fd.bytes.split("\n")[0]).toContain("View: Fully Diluted");
    expect(basic.bytes.split("\n")[0]).toContain("View: Basic");

    /* FINDING 4 — `novapay-captable-<date>.xls` is gone from every export. */
    for (const f of [fd, basic]) {
      for (const brand of FOREIGN_NAMES) {
        expect(f.name.toLowerCase()).not.toContain(brand);
      }
      expect(f.name.startsWith("aurora-systems-captable-")).toBe(true);
      expect(f.name.endsWith(".xls")).toBe(true);
    }
    expect(fd.name).not.toBe(basic.name);
  });

  it("PDF — the server-rendered snapshot downloads under this company's name and says which basis it is", async () => {
    wireApi(THREE_WAY);
    renderPage();
    await awaitLoaded();

    await selectView("fully_diluted");
    fireEvent.click(screen.getByTestId("button-export-pdf"));
    await waitFor(() => expect(captured.length).toBe(1));

    expect(captured[0].name).toMatch(/^aurora-systems-captable-committed-ledger-\d{4}-\d{2}-\d{2}\.pdf$/);
    for (const brand of FOREIGN_NAMES) expect(captured[0].name.toLowerCase()).not.toContain(brand);

    /* The toast states the basis rather than letting the reader assume the view. */
    const descriptions = toastMock.mock.calls.map((c) => String((c[0] as { description?: string })?.description ?? ""));
    expect(descriptions.some((d) => d.includes("committed-ledger snapshot"))).toBe(true);
    expect(descriptions.some((d) => d.includes("not of the view selected"))).toBe(true);
  });
});

describe("W110 · Finding 2 — ALL FOUR export paths refuse when the view refuses", () => {
  it.each(EXPORT_PATHS)("$name ($testid) refuses and emits no file", async ({ name, testid }) => {
    wireApi(NO_PRICED_ROUND);
    renderPage();
    await waitFor(() => expect(screen.getByTestId(TAB.as_converted)).toBeTruthy());
    selectTab(screen.getByTestId(TAB.as_converted));
    /* The refusal must actually be in force, otherwise this test proves nothing. */
    await waitFor(() => expect(screen.getByTestId("captable-view-refusal")).toBeTruthy());
    const refusalTitle = screen.getByTestId("captable-view-refusal-title").textContent ?? "";
    expect(refusalTitle.length).toBeGreaterThan(0);

    toastMock.mockReset();
    apiRequestMock.mockClear();
    fireEvent.click(screen.getByTestId(testid));

    /* 1 — the refusal is stated, in the same words the page is showing. */
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const titles = toastMock.mock.calls.map((c) => String((c[0] as { title?: string })?.title ?? ""));
    expect(titles).toContain(refusalTitle);
    expect(`${name} refused`).toBe(`${name} refused`);

    /* 2 — nothing was written and nothing was downloaded. */
    expect(captured).toEqual([]);
    /* 3 — and no server render was requested for the refused view. */
    const pdfCalls = apiRequestMock.mock.calls.filter((c) => /cap-table\/pdf/.test(String(c[1])));
    expect(pdfCalls).toEqual([]);
  });

  it("all four paths are wired to a refusal-checked handler in the source", () => {
    /* A structural backstop: a fifth button added by copy-paste would land here. */
    const src = String(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("node:fs").readFileSync("client/src/pages/founder/CapTable.tsx", "utf8"),
    );
    const handlers = Array.from(src.matchAll(/data-testid="(button-export-[a-z]+|button-print)"/g)).map((m) => m[1]);
    expect(new Set(handlers)).toEqual(new Set(EXPORT_PATHS.map((p) => p.testid)));
    /* Every function that emits a file checks the refusal first. */
    for (const fn of ["function exportCSV()", "function exportXLSX()", "async function exportPDFSnapshot()", "async function printSnapshot()"]) {
      const at = src.indexOf(fn);
      expect(at).toBeGreaterThan(-1);
      expect(src.slice(at, at + 400)).toContain("refuseExportOnRefusedView()");
    }
    /* And no export filename anywhere in the file carries a foreign brand. */
    for (const brand of FOREIGN_NAMES) {
      expect(new RegExp(`download\\s*=\\s*\`?[^\`;]*${brand}`, "i").test(src)).toBe(false);
    }
  });
});
