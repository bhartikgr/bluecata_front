/**
 * WAVE 225 · ITEM A — WHAT THE INVESTOR'S SCREEN ACTUALLY SAYS.
 *
 * Handbook §8 / R176.2 — NEVER PROVE A REPLICA. This mounts the REAL default
 * export of `client/src/pages/collective/MaIntel.tsx`, the real `CompsTab`, the
 * real tab shell and the real `Methodology` component. Nothing is re-implemented.
 * Only the network boundary is stubbed, at `apiRequest`, so the component's own
 * query, sort, render and export code all execute.
 *
 * ── WHY A DOM PROOF IS NEEDED ON TOP OF THE HTTP PROOF ───────────────────────
 * The server proof shows the payload no longer carries the nine fabricated
 * transactions. That is necessary and not sufficient. The misstatement was never
 * only the numbers — it was the SENTENCES AROUND THEM, and those live only here:
 *
 *   - the empty branch said "No comparable exits available for your scope.",
 *     which blames the reader's scope for an absence that has nothing to do with
 *     scope. Deleting nine unsourced rows and leaving that sentence would have
 *     swapped a false figure for a false reason;
 *   - the methodology footnote described the set as market comparables;
 *   - the page and card describe this as "Institutional-grade aggregation".
 *
 * R143.1 — every pre-existing literal must survive BYTE-FOR-BYTE, with the
 * correction APPENDED as a static sibling. So this file asserts BOTH: that the
 * original sentence is still present, and that the correction sits beside it.
 * A future wave that "cleans up" by rewriting the old literal fails here, and a
 * future wave that drops the correction also fails here.
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 * The refusal pole (zero verified comps, which is today's real state) AND the
 * SOURCED pole, driven with one synthetic row that carries a source and a source
 * date. The sourced pole is what distinguishes "the gate works" from "the tab is
 * permanently blank" — without it, a bug that broke the table entirely would
 * still look green.
 *
 * Ruling R193.2. Owner instruction: "Check the surrounding copy. If the export or
 * any screen describes these as comparables, benchmarks or market data, that text
 * is part of the misstatement."
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import MaIntel from "../MaIntel";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The literal that existed before this wave and must survive byte-for-byte. */
const PRE_EXISTING_EMPTY_COPY = "No comparable exits available for your scope.";

/** The nine fabricated targets, verbatim from `server/lib/maPublicComps.ts`. */
const FABRICATED = [
  "BridgeFX",
  "Quill Pay",
  "Astra Settle",
  "Cordis Bio",
  "MimicLabs",
  "Ardent Care",
  "Vesta Robotics",
  "OnyxAI",
  "Bristle Grid",
];

/** The real refusal payload the server now returns for this view. */
const REFUSAL_PAYLOAD = {
  asOfDate: "",
  totalRecords: 0,
  exits: [],
  compsProvenance: {
    status: "no_verified_comparable_transaction_data",
    verified: 0,
    heldUnsourced: 9,
    statement:
      "Capavate holds no verified comparable-transaction data, so no comparable exits are shown " +
      "or available to export. 9 held rows are withheld for want of a recorded source or source " +
      "date. This is not a limit of your scope, your permissions or the date filter.",
  },
};

/**
 * The SOURCED pole. One row, carrying both provenance fields. It deliberately
 * names no real company and asserts nothing about the world — it is a test input
 * whose only job is to drive the render branch that shows a table.
 */
const SOURCED_PAYLOAD = {
  asOfDate: "2025-06-01",
  totalRecords: 1,
  exits: [
    {
      target: "W225 Test Target",
      acquirer: "W225 Test Acquirer",
      date: "2025-06-01",
      valuationUsd: 1,
      revenueMultiple: null,
      sector: "fintech",
      region: "global",
      sourceAttribution: "Anonymous (sector: fintech)",
      transactionSource: "W225 test source of record",
      transactionSourceDate: "2025-06-01",
    },
  ],
  compsProvenance: {
    status: "verified_sources_only",
    verified: 1,
    heldUnsourced: 9,
    statement:
      "Every comparable transaction shown carries the source it came from and the date that " +
      "source reported it. Rows without both are withheld.",
  },
};

function renderCompsTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MaIntel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The real page reads `?view=` from the URL to pick its default tab, so this is
  // how the production component is asked to open the Comparable Exits tab.
  window.history.replaceState({}, "", "/collective/ma-intel?view=comps");
});

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W225 · Item A — the comps tab at the refusal pole", () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) =>
      url.includes("view=comps") ? jsonResponse(REFUSAL_PAYLOAD) : jsonResponse({}),
    );
  });

  it("renders the refusal branch", async () => {
    renderCompsTab();
    await screen.findByTestId("ma-comps-empty");
  });

  it("shows NONE of the nine fabricated transactions anywhere on the page", async () => {
    renderCompsTab();
    await screen.findByTestId("ma-comps-empty");
    for (const name of FABRICATED) {
      expect(document.body.textContent, `"${name}" reached the screen`).not.toContain(name);
    }
  });

  it("keeps the pre-existing sentence byte-for-byte (R143.1)", async () => {
    renderCompsTab();
    const empty = await screen.findByTestId("ma-comps-empty");
    expect(empty.textContent).toContain(PRE_EXISTING_EMPTY_COPY);
  });

  it("APPENDS the correction that the absence is not about the reader's scope", async () => {
    renderCompsTab();
    const headline = await screen.findByTestId("ma-comps-refusal-headline");
    expect(headline.textContent).toContain("holds no verified comparable-transaction data");

    const detail = await screen.findByTestId("ma-comps-refusal-detail");
    // THE defect this appended text fixes: the surviving literal blames scope.
    expect(detail.textContent).toContain("not a limit of your scope");

    const basis = await screen.findByTestId("ma-comps-refusal-basis");
    expect(basis.textContent).toContain("the source the figure came from");
    expect(basis.textContent).toContain("withheld rather than");
  });

  it("renders the server's own provenance statement, not a client paraphrase", async () => {
    renderCompsTab();
    const s = await screen.findByTestId("ma-comps-provenance-statement");
    expect(s.textContent).toContain(REFUSAL_PAYLOAD.compsProvenance.statement);
  });

  it("offers NO export control at the refusal pole — no file rather than an empty authoritative one", async () => {
    renderCompsTab();
    await screen.findByTestId("ma-comps-empty");
    expect(screen.queryByTestId("ma-comps-export")).toBeNull();
    expect(document.body.textContent).not.toContain("comparable_exits.csv");
  });
});

describe("W225 · Item A — the SOURCED pole (proof the gate is a gate, not a blank tab)", () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) =>
      url.includes("view=comps") ? jsonResponse(SOURCED_PAYLOAD) : jsonResponse({}),
    );
  });

  it("renders the table when a row carries real provenance", async () => {
    renderCompsTab();
    await screen.findByTestId("ma-comps-table");
    expect(screen.queryByTestId("ma-comps-empty")).toBeNull();
  });

  it("shows the transaction source and source date on the row", async () => {
    renderCompsTab();
    await screen.findByTestId("ma-comps-table");
    const src = await screen.findByTestId("ma-comps-txsource-0");
    const date = await screen.findByTestId("ma-comps-txsourcedate-0");
    expect(src.textContent).toContain("W225 test source of record");
    expect(date.textContent).toContain("2025-06-01");
  });

  it("still carries the methodology correction beside the untouched footnote", async () => {
    renderCompsTab();
    await screen.findByTestId("ma-comps-table");
    const note = await screen.findByTestId("ma-comps-provenance-note");
    expect(note.textContent && note.textContent.length).toBeGreaterThan(0);
    // R143.1 — the original `Methodology` text must still be on the page.
    const m = await screen.findByTestId("ma-methodology");
    expect(m.textContent && m.textContent.length).toBeGreaterThan(0);
  });
});
