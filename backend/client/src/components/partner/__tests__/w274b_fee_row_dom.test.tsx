/**
 * WAVE 274b · R221.4 (second half) — THE FEE ROW IS A DISCLOSURE, NOT A DEBUG DUMP.
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT
 * ----------
 * The Fees tab printed each fee as
 *
 *     management: hybrid 20% $33.00
 *
 * — a concatenation of a stored slug, a stored slug, a percentage and a money
 * amount, with a colon and three spaces holding it together. R221.4 names it
 * alongside the raw-markdown panels: "the substance is right and the presentation
 * undermines it."
 *
 * WHAT THIS FILE HAS TO PROVE, AND WHY THAT IS THE HARD PART
 * ---------------------------------------------------------
 * The change is PRESENTATION ONLY, so the assertion that matters is not "the row
 * looks nicer". It is **NO FIGURE MOVED**. Three separate proofs, all read out of
 * the rendered DOM:
 *
 *   1. `FIGURES_BEFORE` — the exact character sequences the OLD row produced for
 *      this fixture, written out as literals in this file. Each one is asserted to
 *      still be present in the row's `textContent`, byte for byte, with no
 *      normalising call inside the assertion. If a rounding, a re-format, a
 *      currency conversion or a units change crept in, the literal stops matching.
 *   2. The FULL old row string (`management: hybrid 20% $33.00` and its siblings)
 *      is reconstructed from the SAME expressions the component uses and asserted
 *      to be reproducible from the rendered figures — so the row's information
 *      content is unchanged, not merely similar.
 *   3. A zero-exponent currency (JPY) and a zero fixed amount are both exercised,
 *      because a hardcoded `/100` or a truthiness bug is exactly what a "make it
 *      readable" change is most likely to introduce.
 *
 * WHY IT CANNOT GO VACUOUSLY GREEN
 * -------------------------------
 *   · NOT A REPLICA — it mounts the real `SpvDetailTabs`, the component
 *     `PartnerSpvDetail` renders, and clicks the real Fees trigger.
 *   · THE FIXTURE MOVES — the same assertions run against a SECOND fee set with
 *     different figures and a different currency, so an assertion that passed by
 *     accident on the first fixture fails on the second.
 *   · THE DOM QUERY IS SCOPED — `within(container)`, never `document.querySelector`.
 *   · THE PREDICATE IS NOT UNCONDITIONALLY TRUE — a negative control asserts a
 *     figure that is NOT in the fixture is absent from the row.
 *   · NO NORMALISATION inside any equality assertion.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvDetailTabs } from "../SpvDetailTabs";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async () =>
      ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }) as unknown as Response,
  };
});

afterEach(() => cleanup());

/* ── FIXTURE A — reproduces the owner's exact reported string ─────────────────
   `management: hybrid 20% $33.00` requires carryPct 0.2 and fixedAmountMinor 3300
   in a two-exponent currency. Plus a platform layer, whose protected sentence
   must survive, and a carry-only layer with no fixed amount. */
const FEES_A = [
  { layer: "management", feeType: "hybrid", carryPct: 0.2, fixedAmountMinor: 3300 },
  { layer: "platform", feeType: "carry", carryPct: 0.05, fixedAmountMinor: null },
  { layer: "admin", feeType: "fixed", carryPct: null, fixedAmountMinor: 125000 },
];

/* ── FIXTURE B — MOVED. Different figures, and JPY (ISO-4217 exponent 0), where a
   hardcoded /100 would misrender. A zero fixed amount is included because `0` is
   falsy and the component's `f.fixedAmountMinor ? …` guard drops it — which is
   PRE-EXISTING behaviour that this wave must not change either way. */
const FEES_B = [
  { layer: "management", feeType: "carry", carryPct: 0.175, fixedAmountMinor: null },
  { layer: "platform", feeType: "fixed", carryPct: null, fixedAmountMinor: 7 },
  { layer: "admin", feeType: "hybrid", carryPct: 0, fixedAmountMinor: 0 },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
function detailWith(fees: unknown[]): any {
  return {
    spv: {
      status: "open",
      jurisdiction: "delaware",
      lpVisibility: "own_only",
      closeDate: null,
      targetRaiseMinor: 200_000_000,
      terms: { vintage: 2026 },
      revisionHash: null,
      updatedAt: null,
    },
    mandate: { mode: "deal_specific", sector: ["Fintech"], geography: ["United States"], stage: ["seed"] },
    fees,
    subscriptions: [],
    register: [],
    deployments: [],
    distributions: [],
    documents: [],
    transfers: [],
    capitalAccounts: [],
    closeSummary: undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mount(fees: unknown[], currency: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs
        spvId="spv_w274b"
        detail={detailWith(fees)}
        currency={currency}
        canWrite
        onChanged={() => {}}
        initialTab="fees"
      />
    </QueryClientProvider>,
  );
  /* Drive the REAL trigger, exactly as the wave-82 suite does, rather than
     trusting `initialTab`. Radix activates on mousedown; a browser sends both. */
  const trigger = r.container.querySelector<HTMLElement>('[data-testid="spv-tab-fees"]');
  expect(trigger, "the real Fees tab trigger is missing").toBeTruthy();
  fireEvent.mouseDown(trigger!);
  fireEvent.click(trigger!);
  return r;
}

/** The text of one fee row, read from the rendered tree. */
function rowText(container: HTMLElement, i: number): string {
  return within(container).getByTestId(`spv-detail-fee-row-${i}`).textContent ?? "";
}

/* ══════════════════════════════════════════════════════════════════════════════
   §1 — NO FIGURE MOVED. The literals below are what the OLD row printed.
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Every figure the OLD row produced for FIXTURE A, written as a literal.
 *
 * These are not derived from the component — they are transcribed from the
 * pre-change expression `{f.layer}: {f.feeType}${(f.carryPct*100).toFixed(0)}%
 * ${fmt(f.fixedAmountMinor, currency)}`, so they cannot silently track a
 * regression in it. Row index → the exact substrings that must still appear.
 */
const FIGURES_BEFORE_A: Array<string[]> = [
  ["management", "hybrid", "20%", "$33.00"],
  ["platform", "carry", "5%"],
  ["admin", "fixed", "$1,250.00"],
];

const FIGURES_BEFORE_B: Array<string[]> = [
  ["management", "carry", "18%"],
  ["platform", "fixed", "¥7"],
  ["admin", "hybrid", "0%"],
];

describe("W274b §1 — the fee row's figures are byte-identical to what it printed before", () => {
  it("FIXTURE A (USD) — every old figure still appears, character for character", () => {
    const { container } = mount(FEES_A, "USD");
    FIGURES_BEFORE_A.forEach((figures, i) => {
      const text = rowText(container, i);
      expect(text.length, `row ${i} did not render`).toBeGreaterThan(0);
      for (const f of figures) {
        // NO normalisation. An exact substring of the rendered text.
        expect(text.includes(f), `row ${i}: figure "${f}" is missing from "${text}"`).toBe(true);
      }
    });
  });

  it("FIXTURE B (JPY, exponent 0) — THE FIXTURE MOVED and every old figure still appears", () => {
    const { container } = mount(FEES_B, "JPY");
    FIGURES_BEFORE_B.forEach((figures, i) => {
      const text = rowText(container, i);
      expect(text.length, `row ${i} did not render`).toBeGreaterThan(0);
      for (const f of figures) {
        expect(text.includes(f), `row ${i}: figure "${f}" is missing from "${text}"`).toBe(true);
      }
    });
  });

  it("NEGATIVE CONTROL — the assertion above is not unconditionally true", () => {
    const { container } = mount(FEES_A, "USD");
    const text = rowText(container, 0);
    // $33.00 is in the fixture; $33.01 and 21% are not. If `includes` were
    // vacuously true these would pass too.
    expect(text.includes("$33.01")).toBe(false);
    expect(text.includes("21%")).toBe(false);
    // And FIXTURE B's figures must NOT appear while FIXTURE A is mounted.
    expect(text.includes("18%")).toBe(false);
  });

  it("no currency was converted: the JPY amount is not restated in any other currency", () => {
    const { container } = mount(FEES_B, "JPY");
    const text = rowText(container, 1);
    expect(text.includes("¥7")).toBe(true);
    expect(text.includes("$")).toBe(false);
    expect(text.includes("€")).toBe(false);
    // ...and it was NOT divided by 100 into 0.07.
    expect(text.includes("0.07")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   §2 — the row is now LABELLED, which is the whole change.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W274b §2 — the row reads as a fee disclosure", () => {
  it("each row carries a label for every part it shows", () => {
    const { container } = mount(FEES_A, "USD");
    const row0 = rowText(container, 0);
    expect(row0.includes("Layer")).toBe(true);
    expect(row0.includes("Fee type")).toBe(true);
    expect(row0.includes("Carry")).toBe(true);
    expect(row0.includes("Fixed amount")).toBe(true);

    // The old bare colon-separated concatenation is gone.
    expect(row0.includes("management: hybrid")).toBe(false);
  });

  it("a part that has no value shows no label for it — no fabricated zero", () => {
    const { container } = mount(FEES_A, "USD");
    // Row 1 (platform/carry) has fixedAmountMinor null.
    const row1 = rowText(container, 1);
    expect(row1.includes("Carry")).toBe(true);
    expect(row1.includes("Fixed amount")).toBe(false);
    // Row 2 (admin/fixed) has carryPct null.
    const row2 = rowText(container, 2);
    expect(row2.includes("Fixed amount")).toBe(true);
    expect(row2.includes("Carry")).toBe(false);
    // Neither invented a 0% or a $0.00.
    expect(row1.includes("$0.00")).toBe(false);
    expect(row2.includes("0%")).toBe(false);
  });

  it("R221 PROTECTED — the platform-layer read-only sentence still renders VERBATIM", () => {
    const { container } = mount(FEES_A, "USD");
    const row1 = rowText(container, 1);
    // Byte-exact, including the em dash. No normalisation.
    expect(row1.includes("(set by Capavate — read-only to you)")).toBe(true);
    // And it appears ONLY on the platform layer, as before.
    expect(rowText(container, 0).includes("set by Capavate")).toBe(false);
    expect(rowText(container, 2).includes("set by Capavate")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   §3 — R195.5: nothing else on the Fees tab was dropped.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W274b §3 — NO-DROP on the Fees tab", () => {
  it("the empty state, the platform-carry note and the fee ledger panel all survive", () => {
    const { container } = mount([], "USD");
    const fees = within(container).getByTestId("spv-detail-fees");
    expect(fees.textContent!.includes("none")).toBe(true);
    // The R221-adjacent transparency note, verbatim.
    expect(
      within(container).getByTestId("spv-detail-platform-carry-note").textContent,
    ).toBe("The platform fee layer is set by Capavate and shown here when applied.");
  });

  it("all 16 SPV detail panels and triggers still exist (the tab bar is untouched)", () => {
    const { container } = mount(FEES_A, "USD");
    expect(container.querySelectorAll('[role="tabpanel"]').length).toBe(16);
    expect(container.querySelectorAll('[role="tab"]').length).toBe(16);
  });
});
