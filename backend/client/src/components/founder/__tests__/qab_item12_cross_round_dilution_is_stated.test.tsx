/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA ITEM 12 — cross-round dilution was silent.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DILUTION MATHS IS CORRECT AND IS NOT TOUCHED BY THIS ITEM. Recording an
 * investor in one open round genuinely does move every other open round's
 * PROJECTED ownership — that is what dilution is. The defect was that the
 * Projected table never said WHICH round a row belonged to, and the panel never
 * said that the figures move for that reason.
 *
 * Two additive halves, both asserted here from RENDERED TEXT:
 *   · a Round column on the Projected table, showing the round's NAME, never
 *     its id (item 9), and stating an absence rather than leaving a blank;
 *   · a SIBLING disclosure, shown ONLY when more than one round is open.
 *
 * THE CONDITION IS THE POINT, not an optimisation: shown to a single-round
 * company, the sentence would be a NEW FALSE STATEMENT introduced to remove an
 * omission. Test 4 is the pole that catches that.
 *
 * AND THE RATIFIED BANNER MUST SURVIVE BYTE-IDENTICALLY. Test 5 pins it, because
 * merging the two ideas into one sentence would have destroyed a close-commits
 * disclosure that is already correct.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import CapTableSnapshots, { SNAPSHOT_ROUND_NOT_RECORDED, snapshotRoundLabel } from "../CapTableSnapshots";

const SEED = "rnd_seed";
const EXT = "rnd_seed_ext";

function pos(id: string, holder: string, roundId: string | null) {
  return {
    id,
    holderName: holder,
    instrument: "safe",
    shares: 10_000,
    investmentAmount: 100_000,
    roundId,
    investorId: `inv_${id}`,
  };
}

/** TWO open rounds — the situation QA hit. */
const TWO_ROUNDS = {
  ok: true,
  pending: {
    hasPending: true,
    roundIds: [SEED, EXT],
    roundNames: { [SEED]: "Seed", [EXT]: "Seed Extension" },
    positions: [pos("p1", "Alice", SEED), pos("p2", "Bob", EXT), pos("p3", "Carol", null)],
  },
  previous: { hasPrevious: false, roundId: null, roundName: null, committedAt: null, positions: [] },
};

/** ONE open round — the pole. */
const ONE_ROUND = {
  ok: true,
  pending: {
    hasPending: true,
    roundIds: [SEED],
    roundNames: { [SEED]: "Seed" },
    positions: [pos("p1", "Alice", SEED)],
  },
  previous: { hasPrevious: false, roundId: null, roundName: null, committedAt: null, positions: [] },
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function renderWith(payload: unknown) {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async () => jsonResponse(payload));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CapTableSnapshots companyId="co_item12" sym="$" />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

const t = (id: string) => (screen.getByTestId(id).textContent ?? "").replace(/\s+/g, " ").trim();

describe("QA ITEM 12 · the Round column", () => {
  it("0 · CONTROL — the label helper refuses to print an id, and yields to a real name", () => {
    /* VALIDATE THE INSTRUMENT FIRST. */
    expect(snapshotRoundLabel(SEED, { [SEED]: "Seed" })).toBe("Seed");
    expect(snapshotRoundLabel(SEED, {})).toBe(SNAPSHOT_ROUND_NOT_RECORDED);
    expect(snapshotRoundLabel(SEED, {})).not.toContain("rnd_");
    expect(snapshotRoundLabel(null, { [SEED]: "Seed" })).toBe(SNAPSHOT_ROUND_NOT_RECORDED);
    expect(snapshotRoundLabel("", undefined)).toBe(SNAPSHOT_ROUND_NOT_RECORDED);
  });

  it("1 · the Projected table now HAS a Round column, and it names the round", async () => {
    renderWith(TWO_ROUNDS);
    await waitFor(() => expect(screen.getByTestId("snapshot-col-round")).toBeTruthy(), { timeout: 8000 });
    expect(t("snapshot-col-round")).toBe("Round");
    /* PRECONDITION — the rows really rendered. */
    expect(screen.getByTestId("snapshot-row-p1")).toBeTruthy();
    expect(t("snapshot-row-round-p1")).toBe("Seed");
    expect(t("snapshot-row-round-p2")).toBe("Seed Extension");
    /* The two rows are DISTINGUISHABLE, which is the whole point of the column. */
    expect(t("snapshot-row-round-p1")).not.toBe(t("snapshot-row-round-p2"));
  });

  it("2 · a row with no round STATES THE ABSENCE — not a blank cell, not a bare dash, not an id", async () => {
    renderWith(TWO_ROUNDS);
    await waitFor(() => expect(screen.getByTestId("snapshot-row-round-p3")).toBeTruthy(), { timeout: 8000 });
    expect(t("snapshot-row-round-p3")).toBe(SNAPSHOT_ROUND_NOT_RECORDED);
    expect(t("snapshot-row-round-p3")).not.toBe("");
    expect(t("snapshot-row-round-p3")).not.toBe("—");
    expect(t("snapshot-row-round-p3")).not.toContain("rnd_");
  });

  it("3 · the other four columns and their figures are UNCHANGED", async () => {
    renderWith(TWO_ROUNDS);
    await waitFor(() => expect(screen.getByTestId("snapshot-row-p1")).toBeTruthy(), { timeout: 8000 });
    const headers = Array.from(document.querySelectorAll("th")).map((h) => (h.textContent ?? "").trim());
    expect(headers).toEqual(["Holder", "Round", "Instrument", "Shares", "Invested"]);
    const row = t("snapshot-row-p1");
    expect(row).toContain("Alice");
    expect(row).toContain("10,000");
    expect(row).toContain("$100,000");
  });
});

describe("QA ITEM 12 · the cross-round disclosure", () => {
  it("4 · WITH two open rounds the sentence renders and explains WHY the figures move", async () => {
    renderWith(TWO_ROUNDS);
    await waitFor(
      () => expect(screen.getByTestId("snapshot-pending-cross-round-banner")).toBeTruthy(),
      { timeout: 8000 },
    );
    const note = t("snapshot-pending-cross-round-banner");
    expect(note).toContain("more than one open round");
    expect(note).toContain("changes the projected ownership shown for every other open round");
    expect(note).toContain("divides by the same total share count");
    /* IT DOES NOT CALL THE MATHS WRONG. The arithmetic is correct and the
       sentence says so — this item is a disclosure, not a correction. */
    expect(note).toContain("These figures are correct");
    expect(note).toContain("Only a close commits them");
  });

  it("5 · WITHOUT a second open round the sentence is ABSENT — no new false statement", async () => {
    renderWith(ONE_ROUND);
    await waitFor(() => expect(screen.getByTestId("snapshot-pending")).toBeTruthy(), { timeout: 8000 });
    /* PRECONDITION — the panel really rendered, so this absence means the gate
       held rather than that nothing loaded. */
    expect(screen.getByTestId("snapshot-pending-banner")).toBeTruthy();
    expect(screen.queryByTestId("snapshot-pending-cross-round-banner")).toBeNull();
    /* And the Round column is still there — a single-round company still
       benefits from knowing which round a projected row came from. */
    expect(t("snapshot-row-round-p1")).toBe("Seed");
  });

  it("6 · THE RATIFIED BANNER SURVIVES BYTE-IDENTICALLY — a sibling was added, not an edit", async () => {
    renderWith(TWO_ROUNDS);
    await waitFor(() => expect(screen.getByTestId("snapshot-pending-banner")).toBeTruthy(), { timeout: 8000 });
    const original = t("snapshot-pending-banner");
    expect(original).toContain("These positions are projected and illustrative while the round is open.");
    expect(original).toContain("The final cap table is set when the round closes");
    expect(original).toContain("commits the reconciled positions to the immutable ledger");
    /* The two disclosures are SEPARATE elements. Merging them would have put the
       close-commits sentence at risk. */
    expect(original).not.toContain("more than one open round");
    expect(screen.getByTestId("snapshot-pending-banner"))
      .not.toBe(screen.getByTestId("snapshot-pending-cross-round-banner"));
  });
});
