/**
 * client/src/pages/collective/__tests__/CollectiveSoftCircles.amountProvenance.test.tsx
 *
 * W-COLLECTIVE Wave 1 — v4 §1.3 + v6 §3, the CLIENT half.
 *
 * CONTEXT. `/api/collective/soft-circles` used to invent its numbers: `targetUsd`
 * came from an empty `canonicalRounds` seed array (so it was always `0`), and
 * `softCircledTotal` blended durable rows with a fail-open in-memory cache. The
 * server now returns `number | null` plus `amountsUnavailable`, where `null`
 * means "not provable from durable rows in a single currency".
 *
 * A nullable server contract is only worth anything if the page RENDERS the
 * distinction. Members allocate capital off these figures, so:
 *   • an unprovable amount must read as an em dash, never `$0` (which reads as
 *     "nobody has circled") and never `$NaN`;
 *   • the progress bar must be HIDDEN rather than drawn at 0%;
 *   • the round itself, its name, and its commitment COUNT must still render —
 *     withholding an amount must not silently drop the round from the page.
 *
 * ANTI-VACUITY. On the PRISTINE tree
 * (/home/user/workspace/build/_presnapshot) this page calls
 * `fmtUsd(agg.softCircledTotal)` directly, so a `null` total throws
 * `TypeError: Cannot read properties of null (reading 'toLocaleString')` during
 * render and the whole card fails to mount. The fill-pct case fails differently:
 * pristine gates the bar on `agg.targetUsd > 0` alone and renders
 * `value={agg.fillPct ?? 0}`, so a null fill with a real target draws a 0% bar —
 * `expected element to be null` for `progress-*`. `amountsUnavailable` does not
 * exist on pristine at all, so the notice query returns null.
 * The "provable amounts still render" test passes on pristine and is labelled
 * REGRESSION GUARD — it is there so a fix cannot dash out everything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CollectiveSoftCircles from "../CollectiveSoftCircles";

const AMOUNT_DASH = "—";

interface Agg {
  roundId: string;
  roundName: string;
  companyId: string | null;
  companyName: string;
  targetUsd: number | null;
  softCircledTotal: number | null;
  softCircledCount: number;
  fillPct: number | null;
  amountsUnavailable?: boolean;
  note: string;
}

function agg(over: Partial<Agg> & { roundId: string }): Agg {
  return {
    roundName: "Series Seed",
    companyId: "co_prov",
    companyName: "Northwind Robotics",
    targetUsd: null,
    softCircledTotal: null,
    softCircledCount: 0,
    fillPct: null,
    note: "",
    ...over,
  };
}

let aggregates: Agg[] = [];

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  aggregates = [];
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/collective/soft-circles") {
      return jsonResponse({ aggregates, total: aggregates.length });
    }
    return jsonResponse({});
  });
});

afterEach(() => cleanup());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CollectiveSoftCircles />
    </QueryClientProvider>,
  );
}

/** Render with the currently-staged `aggregates` and wait for the card to mount. */
async function card(roundId: string): Promise<HTMLElement> {
  renderPage();
  await waitFor(() => expect(screen.getByTestId(`card-softcircle-${roundId}`)).toBeTruthy());
  return screen.getByTestId(`card-softcircle-${roundId}`);
}

describe("v6 §3 — an unprovable amount reads as an em dash, never $0 and never $NaN", () => {
  it("a null total renders the dash and no dollar figure at all", async () => {
    aggregates = [agg({ roundId: "r_null_total", softCircledCount: 3, amountsUnavailable: true })];
    await card("r_null_total");
    const total = screen.getByTestId("total-r_null_total");
    expect(total.textContent).toBe(AMOUNT_DASH);
    expect(total.textContent).not.toContain("$");
  });

  it("a MISSING field (older cached response) also renders the dash, not `$undefined`", async () => {
    const partial = agg({ roundId: "r_missing" }) as Partial<Agg>;
    delete partial.softCircledTotal;
    delete partial.targetUsd;
    aggregates = [partial as Agg];
    await card("r_missing");
    expect(screen.getByTestId("total-r_missing").textContent).toBe(AMOUNT_DASH);
  });

  it("a NaN or non-finite amount renders the dash — `$NaN` never reaches a member", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      cleanup();
      aggregates = [agg({ roundId: "r_nan", softCircledTotal: bad })];
      await card("r_nan");
      const text = screen.getByTestId("total-r_nan").textContent ?? "";
      expect(text).toBe(AMOUNT_DASH);
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("Infinity");
    }
  });

  it("`$0` is only ever shown for a PROVABLE zero", async () => {
    // The distinction the whole change exists to make: "nobody has circled yet"
    // and "we cannot tell you" must not look the same.
    aggregates = [
      agg({ roundId: "r_provable_zero", softCircledTotal: 0, softCircledCount: 0 }),
      agg({ roundId: "r_unknown", softCircledTotal: null, amountsUnavailable: true }),
    ];
    await card("r_provable_zero");
    expect(screen.getByTestId("total-r_provable_zero").textContent).toBe("$0");
    expect(screen.getByTestId("total-r_unknown").textContent).toBe(AMOUNT_DASH);
  });
});

describe("v6 §3 — the progress bar is HIDDEN rather than drawn at 0%", () => {
  it("no target ⇒ no bar, no target line, no percentage", async () => {
    aggregates = [
      agg({ roundId: "r_no_target", softCircledTotal: 250_000, targetUsd: null, fillPct: null }),
    ];
    await card("r_no_target");
    expect(screen.queryByTestId("progress-r_no_target")).toBeNull();
    expect(screen.queryByTestId("fill-pct-r_no_target")).toBeNull();
    // The provable half is still stated.
    expect(screen.getByTestId("total-r_no_target").textContent).toBe("$250K");
  });

  it("a REAL target but an unprovable fill still hides the bar (0% would be a lie)", async () => {
    // Pristine gates on `targetUsd > 0` alone and renders `value={fillPct ?? 0}`,
    // so this drew a full-width empty bar next to a real target.
    aggregates = [
      agg({
        roundId: "r_no_fill",
        targetUsd: 1_000_000,
        softCircledTotal: null,
        fillPct: null,
        amountsUnavailable: true,
      }),
    ];
    await card("r_no_fill");
    expect(screen.queryByTestId("progress-r_no_fill")).toBeNull();
    expect(screen.queryByTestId("fill-pct-r_no_fill")).toBeNull();
  });

  it("a target of 0 is never treated as a target", async () => {
    aggregates = [agg({ roundId: "r_zero_target", targetUsd: 0, fillPct: 0, softCircledTotal: 0 })];
    await card("r_zero_target");
    expect(screen.queryByTestId("progress-r_zero_target")).toBeNull();
  });

  it("REGRESSION GUARD: with both operands provable, bar + target + percentage all render", async () => {
    aggregates = [
      agg({
        roundId: "r_full",
        targetUsd: 1_000_000,
        softCircledTotal: 500_000,
        fillPct: 50,
        softCircledCount: 4,
      }),
    ];
    const el = await card("r_full");
    expect(screen.getByTestId("progress-r_full")).toBeTruthy();
    expect(screen.getByTestId("fill-pct-r_full").textContent).toBe("50%");
    expect(screen.getByTestId("total-r_full").textContent).toBe("$500K");
    expect(el.textContent).toContain("Target: $1.0M");
  });
});

describe("v6 §3 — withholding an amount is DISCLOSED, and drops nothing", () => {
  it("`amountsUnavailable` renders an explicit notice for that round only", async () => {
    aggregates = [
      agg({ roundId: "r_flagged", amountsUnavailable: true }),
      agg({ roundId: "r_clean", softCircledTotal: 10_000, targetUsd: 100_000, fillPct: 10 }),
    ];
    await card("r_flagged");
    expect(screen.getByTestId("amounts-unavailable-r_flagged").textContent).toContain(
      "Amounts unavailable",
    );
    expect(screen.queryByTestId("amounts-unavailable-r_clean")).toBeNull();
  });

  it("the round, its company and its COUNT still render when amounts are withheld", async () => {
    // NO SILENT DROPS: an unprovable amount must not remove the round from the
    // page, or a member would never learn the round exists.
    aggregates = [
      agg({
        roundId: "r_kept",
        roundName: "Series A Extension",
        companyName: "Northwind Robotics",
        softCircledCount: 7,
        amountsUnavailable: true,
      }),
    ];
    const el = await card("r_kept");
    expect(el.textContent).toContain("Series A Extension");
    expect(el.textContent).toContain("Northwind Robotics");
    expect(screen.getByTestId("count-r_kept").textContent).toContain("7 commitments");
    expect(screen.getByTestId("badge-total-rounds").textContent).toContain("1 round");
  });

  it("REGRESSION GUARD: an empty list is still the empty state, not a dashed card", async () => {
    aggregates = [];
    renderPage();
    await waitFor(() => expect(screen.getByTestId("empty-soft-circles")).toBeTruthy());
    expect(screen.queryByText(AMOUNT_DASH)).toBeNull();
  });
});
