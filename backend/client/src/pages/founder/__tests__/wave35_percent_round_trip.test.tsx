/**
 * WAVE 35 · ROW 8 — the percent round-trip, proven END TO END.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The four `pct` fields carry no `minorUnits`. The WRITE path in
 * `Settings.tsx` did `Math.round(n * 100)`; the READ path divides ONLY when
 * `f.minorUnits` is set. So the value re-displayed RAW:
 *
 *     type 42.5 → store 4250 → reopen the form → see 4250 → save → store 425000
 *
 * The error compounds on every save. `spec/PERCENT_POLICY_v2.md` (owner ruling
 * OR-1, "1=1%. 100=100%") is binding: **the stored number IS the percentage**,
 * to 4 decimals — which `Math.round(n*100)` destroys outright.
 *
 * ── WHY THIS TEST DRIVES THE REAL COMPONENT ─────────────────────────────────
 * F10 in this same review is "tests that assert on their own copy of
 * production logic", and it is precisely why the ¥1,200,000 → $12,000 pricing
 * defect survived every prior wave. A test that computed `n * 100` in its own
 * body and compared would have passed against the broken code. So this file
 * renders the REAL `SettingsFinancialsTab`, types into the REAL input, clicks
 * the REAL save button, captures **the bytes actually sent on the wire**, feeds
 * those bytes back as the server's next GET, and asserts what the REAL form
 * re-displays. Nothing about the conversion is restated here.
 *
 * A stub server holds the profile so the round trip is genuinely a round trip:
 * PATCH mutates the fixture, and the component's own cache invalidation causes
 * the re-read. If the write and read conventions ever disagree again — in
 * either direction — these tests fail.
 *
 * Both poles, every case: the value that comes back is asserted EQUAL to what
 * was typed, and separately asserted NOT EQUAL to the ×100 form, so a test that
 * happened to compare a number against itself cannot pass vacuously.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsFinancialsTab } from "../Settings";
import FinancialsFill from "@/pages/FinancialsFill";
import {
  getFieldCopy,
  FINANCIAL_FIELD_COPY,
  AS_WRITTEN_DECIMAL_UNITS,
  AS_WRITTEN_DECIMAL_PLACES,
  AS_WRITTEN_INPUT_STEP,
} from "@/lib/financialFieldCopy";

const COMPANY = "co_w35_row8";

/* ── a stub server that actually stores what it is sent ───────────────────── */
let STORED: Record<string, unknown> = {};
let PATCHES: Record<string, unknown>[] = [];

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

vi.mock("wouter", () => ({
  useParams: () => ({ token: "tok_row8" }),
  Link: (props: any) => <a {...props} />,
  useLocation: () => ["/financials-fill/tok_row8", () => {}],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
  toast: () => {},
}));

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
  STORED = { stage: "series_b" }; // series_b → all 15 fields visible
  PATCHES = [];
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, _url: string) =>
    jsonResponse({ profile: { ...STORED } }),
  );
  // The save path uses bare `fetch`, not apiRequest. Stub it as a real store.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/founder/profile") && init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
        PATCHES.push(patch);
        STORED = { ...STORED, ...patch }; // the server stores EXACTLY what it got
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: true });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsFinancialsTab companyId={COMPANY} />
    </QueryClientProvider>,
  );
}

async function typeAndSave(fieldKey: string, typed: string) {
  const at = () =>
    screen.getByTestId(`input-financial-${fieldKey}`) as HTMLInputElement;
  await screen.findByTestId(`input-financial-${fieldKey}`);
  // The component re-hydrates its local state from the profile query, so a
  // change typed before that effect lands is silently discarded — and the
  // element is re-created, so a captured reference goes stale. Re-query and
  // re-type until the value is actually held; otherwise the test submits an
  // EMPTY patch and would "pass" against any conversion at all. (This bit the
  // first run of this file: PATCHES[0] came back as `{}`.)
  await waitFor(() => {
    const el = at();
    if (el.value !== typed) fireEvent.change(el, { target: { value: typed } });
    expect(at().value).toBe(typed);
  });
  fireEvent.click(screen.getByTestId("button-save-financials"));
  await waitFor(() => expect(PATCHES.length).toBeGreaterThan(0));
  return at;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* THE ROUND TRIP                                                            */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("ROW 8 · percent round-trip: enter → save → reload → same value", () => {
  const CASES: { key: string; typed: string; stored: number }[] = [
    // the exact figure from the brief
    { key: "grossMarginPct", typed: "42.5", stored: 42.5 },
    // a whole number — proves 1=1%, not 1=100
    { key: "growthRatePct", typed: "15", stored: 15 },
    // the 4-decimal grid the policy binds these onto
    { key: "netMarginPct", typed: "12.3456", stored: 12.3456 },
    // a MULTIPLE, not a percentage
    { key: "ltvCacRatio", typed: "3", stored: 3 },
  ];

  for (const c of CASES) {
    it(`${c.key}: typing ${c.typed} stores ${c.stored} and re-displays ${c.typed}`, async () => {
      renderTab();
      const at = await typeAndSave(c.key, c.typed);

      // 1. WHAT WAS SENT — the bytes on the wire, not a recomputation.
      const sent = PATCHES[0][c.key];
      expect(sent).toBe(c.stored);
      // The ×100 form is explicitly excluded, so this cannot pass by comparing
      // a value against itself.
      expect(sent).not.toBe(Math.round(parseFloat(c.typed) * 100));

      // 2. WHAT COMES BACK — the component re-hydrates from the stub server,
      //    which is holding exactly what the component sent it.
      await waitFor(() => expect(at().value).toBe(c.typed));
    });
  }

  it("COMPOUNDING: saving three times in a row does not inflate the value", async () => {
    // This is the property the defect actually violated. One save looked
    // survivable; the second save is where 4250 became 425000.
    renderTab();
    const at = await typeAndSave("grossMarginPct", "42.5");
    await waitFor(() => expect(at().value).toBe("42.5"));

    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByTestId("button-save-financials"));
      await waitFor(() => expect(PATCHES.length).toBe(i + 2));
      await waitFor(() => expect(at().value).toBe("42.5"));
    }

    // Every patch carried the SAME number. Under the defect these would have
    // been 4250, 425000, 42500000.
    expect(PATCHES.map((p) => p.grossMarginPct)).toEqual([42.5, 42.5, 42.5]);
    expect(STORED.grossMarginPct).toBe(42.5);
  });

  it("POLE: money fields are UNCHANGED — minor units still ×100", async () => {
    // The fix must not spill onto the money path. `usd_minor` fields are
    // integer minor units and MUST still be multiplied. A blanket
    // "stop multiplying by 100" would silently divide every dollar figure by a
    // hundred, and this is the assertion that catches it.
    renderTab();
    const at = await typeAndSave("cashOnHandUsd", "600000");
    expect(PATCHES[0].cashOnHandUsd).toBe(60_000_000);
    await waitFor(() => expect(at().value).toBe("600000"));
  });

  it("POLE: count and month fields still round to integers", async () => {
    renderTab();
    await typeAndSave("runwayMonths", "10.7");
    expect(PATCHES[0].runwayMonths).toBe(11);
  });

  it("a NEGATIVE net margin is saved, not silently dropped", async () => {
    // The field's OWN worked example is "−10% net margin". The shipped save
    // loop did `if (isNaN(n) || n < 0) continue;` — the value vanished, the
    // toast said "Financials saved", and the founder had no way to know. A
    // pre-profit company's net margin is negative by definition.
    renderTab();
    const at = await typeAndSave("netMarginPct", "-10");
    expect(PATCHES[0].netMarginPct).toBe(-10);
    await waitFor(() => expect(at().value).toBe("-10"));
  });

  it("a NEGATIVE growth rate is saved (MRR can contract)", async () => {
    renderTab();
    await typeAndSave("growthRatePct", "-7.25");
    expect(PATCHES[0].growthRatePct).toBe(-7.25);
  });

  it("POLE: a negative is still refused where it is nonsense", async () => {
    // Anti-vacuity: the fix must not become "accept anything anywhere".
    // Negative cash on hand is not a business state, and customerCount cannot
    // be negative.
    renderTab();
    const at = () =>
      screen.getByTestId("input-financial-cashOnHandUsd") as HTMLInputElement;
    await screen.findByTestId("input-financial-cashOnHandUsd");
    await waitFor(() => {
      const el = at();
      if (el.value !== "-5") fireEvent.change(el, { target: { value: "-5" } });
      expect(at().value).toBe("-5");
    });
    fireEvent.click(screen.getByTestId("button-save-financials"));
    await waitFor(() => expect(PATCHES.length).toBe(1));
    expect(PATCHES[0]).not.toHaveProperty("cashOnHandUsd");
    // and the input still fences it at the widget level
    expect(at().getAttribute("min")).toBe("0");
  });

  it("the fields that admit negatives drop the min=0 fence", async () => {
    renderTab();
    const el = (await screen.findByTestId(
      "input-financial-netMarginPct",
    )) as HTMLInputElement;
    expect(el.getAttribute("min")).toBeNull();
  });

  it("the 4-decimal grid is enforced, not merely documented", async () => {
    renderTab();
    // 5 decimals in → rounded onto the grid the policy declares.
    await typeAndSave("grossMarginPct", "12.34567");
    expect(PATCHES[0].grossMarginPct).toBe(12.3457);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* THE UNIT — LTV:CAC is a multiple, not a percentage                        */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("ROW 8 · ltvCacRatio carries a truthful unit", () => {
  it("is no longer declared a percentage", () => {
    const f = getFieldCopy("ltvCacRatio");
    expect(f).toBeTruthy();
    expect(f!.unit).not.toBe("pct");
    expect(f!.unit).toBe("ratio");
  });

  it("renders a MULTIPLE badge and never a % badge", async () => {
    renderTab();
    const card = await screen.findByTestId("card-financial-ltvCacRatio");
    expect(card.textContent).toContain("x (multiple)");
    // The '%' badge must not be anywhere in this card. A founder reading "3"
    // next to a "%" understands 3%, where the business means 3x — a
    // hundred-fold misreading of a headline efficiency metric.
    const badges = Array.from(card.querySelectorAll("*"))
      .map((e) => e.textContent?.trim())
      .filter((t) => t === "%");
    expect(badges).toEqual([]);
  });

  it("POLE: the real percentage fields DO still carry the % badge", async () => {
    // Anti-vacuity for the assertion above: if the badge were deleted for every
    // field, the previous test would pass and this one fails.
    renderTab();
    const card = await screen.findByTestId("card-financial-grossMarginPct");
    const badges = Array.from(card.querySelectorAll("*"))
      .map((e) => e.textContent?.trim())
      .filter((t) => t === "%");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("its worked example says 3x, not 3%", () => {
    expect(getFieldCopy("ltvCacRatio")!.example).toContain("3x");
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* THE SECOND WRITE PATH — the accountant magic-link page                    */
/* ═════════════════════════════════════════════════════════════════════════ */

/**
 * The brief named `FinancialsFill.tsx:81,96` as carrying the same write bug.
 * A fix to `Settings.tsx` alone would leave an accountant filling 42.5 through
 * a magic link still storing 4250 — the same corrupt value arriving by a
 * different door, into the same field, invisible to the founder who requested
 * it. This section drives that page's REAL form and inspects the REAL request
 * body it puts on the wire.
 */
describe("ROW 8 · second write path — FinancialsFill (accountant magic link)", () => {
  let BODIES: Record<string, unknown>[] = [];

  function mountFill(fieldKey: string) {
    BODIES = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          BODIES.push(JSON.parse(String(init.body)));
          return jsonResponse({ ok: true, fieldKey, version: 2 });
        }
        return jsonResponse({
          ok: true,
          companyId: COMPANY,
          companyName: "Row 8 Test Co",
          fieldKey,
          requestId: "req_1",
          expiresAt: "2027-01-01T00:00:00.000Z",
          note: "",
        });
      }),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <FinancialsFill />
      </QueryClientProvider>,
    );
  }

  async function submitFill(typed: string) {
    const input = (await screen.findByTestId(
      "input-fill-value",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: typed } });
    await waitFor(() => expect(input.value).toBe(typed));
    fireEvent.click(screen.getByTestId("button-submit-fill"));
    await waitFor(() => expect(BODIES.length).toBe(1));
  }

  it("a percentage is submitted AS WRITTEN, not ×100", async () => {
    mountFill("grossMarginPct");
    await submitFill("42.5");
    expect(BODIES[0].value).toBe(42.5);
    expect(BODIES[0].value).not.toBe(4250);
  });

  it("a ratio is submitted as a multiple", async () => {
    mountFill("ltvCacRatio");
    await submitFill("3");
    expect(BODIES[0].value).toBe(3);
    expect(BODIES[0].value).not.toBe(300);
  });

  it("POLE: money on this path still converts to minor units", async () => {
    mountFill("cashOnHandUsd");
    await submitFill("600000");
    expect(BODIES[0].value).toBe(60_000_000);
  });

  it("the two write paths agree — same input, same stored number", async () => {
    // The defect existed in two files because each had its own copy of the
    // conversion. They now call the SAME function, and this asserts the
    // observable consequence rather than the implementation detail.
    mountFill("grossMarginPct");
    await submitFill("12.34567");
    const viaMagicLink = BODIES[0].value;
    cleanup();

    // re-establish the founder-settings world for the comparison
    STORED = { stage: "series_b" };
    PATCHES = [];
    apiRequestMock.mockImplementation(async () =>
      jsonResponse({ profile: { ...STORED } }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/api/founder/profile") && init?.method === "PATCH") {
          PATCHES.push(JSON.parse(String(init.body)));
          return jsonResponse({ ok: true });
        }
        return jsonResponse({ ok: true });
      }),
    );
    renderTab();
    await typeAndSave("grossMarginPct", "12.34567");
    expect(PATCHES[0].grossMarginPct).toBe(viaMagicLink);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* FENCES — no surviving ×100 on any percent path                            */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("ROW 8 · fences", () => {
  it("every as-written unit is covered by the shared set (no per-file lists)", () => {
    const asWritten = FINANCIAL_FIELD_COPY.filter((f) =>
      AS_WRITTEN_DECIMAL_UNITS.has(f.unit),
    ).map((f) => f.key);
    expect(asWritten.sort()).toEqual(
      ["grossMarginPct", "growthRatePct", "ltvCacRatio", "netMarginPct"].sort(),
    );
  });

  it("the input step admits every value the policy permits", () => {
    // Found by execution, not by reading: with step="0.01" a browser rejects
    // 12.3456 as a step mismatch, so the accountant magic-link form silently
    // refused a value the binding policy explicitly allows. A 4-decimal policy
    // and a 2-decimal input widget is a check that passes while checking
    // nothing.
    // Not a numeric granularity: any numeric step misfires on float division
    // (42.5 / 0.0001 = 425000.00000000006 → step mismatch). The grid is
    // enforced on write instead, exactly, by toStoredAsWritten.
    expect(AS_WRITTEN_INPUT_STEP).toBe("any");
    expect(AS_WRITTEN_DECIMAL_PLACES).toBe(4);
    for (const f of [
      "client/src/pages/founder/Settings.tsx",
      "client/src/pages/FinancialsFill.tsx",
    ]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/AS_WRITTEN_DECIMAL_UNITS[^\n]*\?\s*"0\.01"/);
      expect(src).toContain("AS_WRITTEN_INPUT_STEP");
    }
  });

  it("THIRD PATH: the deal-room reader no longer divides by 100", () => {
    /* Hunting a second path found a THIRD. `CollectiveDealRoomDetail.tsx`
       was the only reader in the codebase that compensated for the ×100
       write by dividing — which meant that, uniquely, the deal room showed
       the RIGHT number while the founder's own form showed 4250. Fixing the
       write path without this reader would have inverted that: the founder
       correct, the investor-facing deal room showing 0.425%.

       This is a source fence rather than a render test because the assertion
       is about the absence of a conversion, and the surrounding page pulls in
       a large route/query tree. The mutant R8-M7 (restore the ÷100) confirms
       the fence bites. */
    const src = readFileSync(
      resolve(process.cwd(), "client/src/pages/collective/CollectiveDealRoomDetail.tsx"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""); // strip comments first
    for (const key of ["grossMarginPct", "growthRatePct"]) {
      const lines = src.split("\n").filter((l) => l.includes(key));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l).not.toMatch(/\/\s*100/);
    }
  });

  it("no server-side reader or writer re-introduces a ×100 for these fields", () => {
    // companySyncFields / collectiveRoutes pass these through untouched; a
    // conversion appearing there would silently re-open the defect on a path
    // no client test can see.
    for (const f of [
      "server/lib/companySyncFields.ts",
      "server/collectiveRoutes.ts",
    ]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        "",
      );
      for (const line of src.split("\n")) {
        if (/grossMarginPct|growthRatePct|netMarginPct|ltvCacRatio/.test(line)) {
          expect(line).not.toMatch(/[*/]\s*100\b/);
        }
      }
    }
  });

  it("no percent field is marked minorUnits (which would re-introduce ÷100)", () => {
    for (const f of FINANCIAL_FIELD_COPY) {
      if (AS_WRITTEN_DECIMAL_UNITS.has(f.unit)) {
        expect(f.minorUnits).toBeFalsy();
      }
    }
  });
});
