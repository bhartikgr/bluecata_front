/**
 * WAVE 141 · BATCH 1 ITEM 3 — THE K-1 PANEL MUST NOT GUESS A TAX YEAR.
 * (The pre-flight names this `batch1_item3_k1_panel_year.test.tsx`; wave-prefixed
 *  here to match the rest of the tree.)
 *
 * WHAT WAS WRONG. The panel opened on `getUTCFullYear() - 1` and asked the server
 * for that year. When the vehicle's confirmed receipts were dated in some other
 * year, the server's in-year sum was `0`, and this panel printed `$0.00` in three
 * capital boxes — directly beneath its own policy line stating that a figure
 * which cannot be derived "is never shown as zero". The screen contradicted
 * itself, on a tax artifact.
 *
 * These tests RENDER the component and read the DOM. No source-text matching
 * stands in for behaviour anywhere in this file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvK1Panel } from "../SpvK1Panel";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** Every request the panel makes, in order, so "which year was asked for" is a fact. */
const asked: string[] = [];
/** Test-controlled wire bodies. `years` is swapped per test; `k1` is per year. */
const wire: {
  years: { years: number[]; suggestedTaxYear: number | null } | (() => Promise<any>);
  statementsByYear: Record<string, any[]>;
} = { years: { years: [], suggestedTaxYear: null }, statementsByYear: {} };

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (_method: string, url: string) => {
      asked.push(url);
      const body = await (async () => {
        if (url.includes("/k1/years")) {
          return typeof wire.years === "function" ? await wire.years() : wire.years;
        }
        const year = new URL(url, "http://t").searchParams.get("taxYear") ?? "";
        if (url.includes("/k1/stored")) return { statements: [] };
        return { taxYear: Number(year), statements: wire.statementsByYear[year] ?? [] };
      })();
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
    },
  };
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpvK1Panel spvId="spv_w141" canWrite={true} />
    </QueryClientProvider>,
  );
}

/** Only the live-derivation requests, so the years lookup is not miscounted. */
function derivationCalls() {
  return asked.filter((u) => u.includes("/k1?taxYear="));
}

beforeEach(() => {
  /* Auto-cleanup is not enabled in this project's vitest config, so an earlier
     test's DOM would otherwise still be mounted and `getByTestId` would match
     two panels. Explicit, so each test reads its own render and nothing else. */
  cleanup();
  asked.length = 0;
  wire.years = { years: [], suggestedTaxYear: null };
  wire.statementsByYear = {};
});

describe("W141 / C — the panel asks for the year the vehicle actually has facts for", () => {
  it("C1 opens on the most recent CLOSED year with activity and derives exactly that year", async () => {
    wire.years = { years: [2026, 2024], suggestedTaxYear: 2024 };
    const { getByTestId } = mount();
    await waitFor(() => expect((getByTestId("spv-k1-year") as HTMLInputElement).value).toBe("2024"));
    // The DERIVATION was requested for 2024 and for no other year.
    await waitFor(() => expect(derivationCalls().length).toBeGreaterThan(0));
    expect(derivationCalls().every((u) => u.includes("taxYear=2024"))).toBe(true);
    // And it says WHY 2024 is on screen, naming the open year it did not pick.
    const note = getByTestId("spv-k1-year-source").textContent ?? "";
    expect(note).toContain("most recent closed tax year");
    expect(note).toContain("2024");
    expect(note).toContain("2026");
  });

  it("C2 with no recorded activity it falls back to last year AND says the absence out loud", async () => {
    wire.years = { years: [], suggestedTaxYear: null };
    const { getByTestId } = mount();
    const lastYear = String(new Date().getUTCFullYear() - 1);
    await waitFor(() => expect((getByTestId("spv-k1-year") as HTMLInputElement).value).toBe(lastYear));
    expect(getByTestId("spv-k1-year-source").textContent).toContain("no recorded activity");
  });

  it("C3 a year the GP TYPED is never overwritten by a late years response", async () => {
    let release: (v: any) => void = () => {};
    wire.years = () => new Promise((r) => { release = r; });
    const { getByTestId } = mount();
    const input = getByTestId("spv-k1-year") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2019" } });
    expect(input.value).toBe("2019");
    release({ years: [2026, 2024], suggestedTaxYear: 2024 });
    await waitFor(() => expect(getByTestId("spv-k1-year-source").textContent).toContain("2024"));
    // The suggestion arrived, the note updated — and the GP's own year stands.
    expect((getByTestId("spv-k1-year") as HTMLInputElement).value).toBe("2019");
    expect(derivationCalls().every((u) => u.includes("taxYear=2019"))).toBe(true);
  });

  it("C4 THE REPRODUCTION — the wrong year printed $0.00; the right year prints the refusal", async () => {
    /* The vehicle's facts are in 2024. The pre-wave panel asked for last year and
       received a statement of zeros with NO refusals — and printed them. The
       fixed panel asks for 2024 and renders the refusal instead. Both bodies are
       on the wire, so which one appears is decided entirely by the component. */
    wire.years = { years: [2024], suggestedTaxYear: 2024 };
    const lastYear = String(new Date().getUTCFullYear() - 1);
    wire.statementsByYear[lastYear] = [{
      investorId: "inv_w141_wrongyear",
      taxYear: Number(lastYear),
      currency: "USD",
      beginningCapitalMinor: 0,
      contributionsMinor: 0,
      distributionsMinor: 0,
      allocatedIncomeMinor: 0,
      carryAllocatedMinor: 0,
      endingCapitalMinor: 0,
      ownershipFraction: 0.5,
      refusals: [],
      sourceIds: [],
    }];
    const copy =
      "Every confirmed capital receipt on record for this partner is dated after this tax year, so there is " +
      "nothing this vehicle can report for the year.";
    wire.statementsByYear["2024"] = [{
      investorId: "inv_w141_b",
      taxYear: 2024,
      currency: "USD",
      beginningCapitalMinor: null,
      contributionsMinor: null,
      distributionsMinor: 0,
      allocatedIncomeMinor: 0,
      carryAllocatedMinor: 0,
      endingCapitalMinor: null,
      ownershipFraction: 0.5,
      refusals: [
        { field: "contributionsMinor", code: "NOT_A_MEMBER_IN_YEAR", copy },
        { field: "beginningCapitalMinor", code: "NOT_A_MEMBER_IN_YEAR", copy },
        { field: "endingCapitalMinor", code: "NOT_A_MEMBER_IN_YEAR", copy },
      ],
      sourceIds: [],
    }];
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid$="-refused"]').length).toBe(3),
    );
    expect(container.textContent).toContain("Not derivable");
    expect(container.textContent).toContain("dated after this tax year");
    /* THE ASSERTION THE WHOLE ITEM EXISTS FOR. Each refused box carries a reason
       and NO money figure — a zero in one of these boxes is the false statement
       this wave removes. Checked per box, because the sibling boxes below hold
       REAL zeros which must keep printing as figures. */
    for (const t of ["spv-k1-box-beginning", "spv-k1-box-contributions", "spv-k1-box-ending"]) {
      const box = container.querySelector(`[data-testid="${t}"]`)!;
      expect(box.textContent).not.toContain("0.00");
      expect(box.querySelector('[data-testid$="-value"]')).toBeNull();
    }
    // The wrong-year statement is not what is on screen.
    expect(container.textContent).toContain("Covers tax year 2024");
    expect(container.textContent).not.toContain(`Covers tax year ${lastYear}`);
    // POLE: the genuinely-zero boxes DO still render a figure, so C4 is not
    // passing because the panel rendered nothing at all.
    const income = container.querySelector('[data-testid="spv-k1-box-income"]')!;
    expect(income.textContent).toContain("0.00");
  });

  it("C5 nothing is derived before a year is chosen — no request for an empty year", async () => {
    let release: (v: any) => void = () => {};
    wire.years = () => new Promise((r) => { release = r; });
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(derivationCalls()).toEqual([]);
    expect(asked.some((u) => u.includes("taxYear=NaN") || u.includes("taxYear=&") || u.endsWith("taxYear="))).toBe(false);
    // POLE: once the suggestion lands, a derivation DOES happen — the panel is
    // not simply inert.
    release({ years: [2024], suggestedTaxYear: 2024 });
    await waitFor(() => expect(derivationCalls().length).toBeGreaterThan(0));
  });
});
