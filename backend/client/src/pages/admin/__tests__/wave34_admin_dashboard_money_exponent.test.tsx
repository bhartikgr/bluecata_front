/**
 * WAVE 34 · TASK 2 — the ADMIN DASHBOARD SPV money tiles, EXECUTED.
 *
 * WHY THIS FILE EXISTS. The exhaustive sweep turned up a sink Wave 33 never
 * named: `client/src/pages/admin/Dashboard.tsx:329`.
 *
 *     const fmtCurrencyMinor = (m: number, ccy: string) =>
 *       (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " " + ccy;
 *
 * These are the "SPV Committed" and "SPV Wired" tiles. They are deliberately
 * MULTI-CURRENCY by construction — the endpoint returns a
 * Record<currency, minorUnits> map and the UI renders one row per currency,
 * precisely so nothing is ever summed across currencies. The currency was
 * therefore not merely in scope, it was the parameter `ccy` — and the divisor
 * was still hardcoded to 100. A ¥250,000,000 SPV commitment rendered as
 * "2,500,000 JPY": the admin's own view of how much money is committed to a
 * vehicle, wrong by a factor of 100, in the one place built to handle
 * many currencies at once.
 *
 * BOTH POLES, in a single render. The fixture puts JPY (exponent 0), USD
 * (exponent 2) and KRW (exponent 0) in the SAME map with the SAME integer minor
 * amount, so one assertion pass covers:
 *   · JPY/KRW poles — pin the fixed rendering (250,000,000 minor → 250,000,000);
 *   · USD pole — pins that a division still happens at all (→ 2,500,000).
 * A mutant restoring `/ 100` fails the JPY/KRW poles. A mutant deleting the
 * conversion fails the USD pole. A USD-only fixture passes against BOTH the
 * defect and the fix and is worthless — which is exactly why this class kept
 * surviving.
 *
 * Assertions read the DOM the admin sees, never what the component consults.
 * Preconditions are established here; `process.env` is never read; the page is
 * imported statically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
/* The tiles carry <HelpTip>, which is a radix Tooltip and throws outside a
 * provider. Supplying it here is a PRECONDITION of rendering the real page —
 * not a shim that changes what the page computes. */
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatMinor, currencyExponent } from "@/lib/currency";
import dashboardSource from "../Dashboard.tsx?raw";

/** The SAME integer minor amount in every currency of the fixture. */
const COMMITTED_MINOR = 250_000_000;
const WIRED_MINOR = 175_000_000;

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useLocation: () => ["/admin", vi.fn()] };
});

import AdminDashboard from "../Dashboard";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const KPIS = {
  summary: {
    totalCompanies: 3,
    totalInvestors: 4,
    totalCommittedSoftCircle: null,
    totalFunded: null,
    momGrowthPct: null,
    churnPct: null,
    nrr: null,
    /* Three currencies, one map — the multi-currency contract the tiles exist
     * to honour. JPY and KRW are exponent 0; USD is exponent 2. */
    totalSpvCommittedMinor: { JPY: COMMITTED_MINOR, USD: COMMITTED_MINOR, KRW: COMMITTED_MINOR },
    totalSpvWiredMinor: { JPY: WIRED_MINOR, USD: WIRED_MINOR },
    totalActiveSpvs: 2,
  },
  queues: {},
  health: {
    capTableReconcile: { runs: 0, success: 0, successRatePct: null },
    closeGateFailures: null,
    dataroomUploadErrors: null,
    messageDelivery: { sent: null, delivered: null, deliveryRatePct: null },
    emailSlaSec: null,
  },
  funnels: { onboarding: [], investor: [] },
  /* The page's other panels read these unconditionally; supplying them is a
   * precondition of rendering the real page, not a change to what the money
   * tiles compute. */
  topCompanies: [],
  topInvestors: [],
  regions: [],
};

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/api/admin/dashboard/kpis")) return jsonResponse(KPIS);
    if (url.includes("/api/admin/dashboard/activity")) return jsonResponse({ items: [] });
    return jsonResponse({});
  });
});

afterEach(() => cleanup());

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <AdminDashboard />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

async function committedTile() {
  const el = await screen.findByTestId("stat-spv-committed-values", undefined, { timeout: 5000 });
  return el;
}

/* ── (F) PRECONDITIONS ───────────────────────────────────────────────────── */

describe("F — preconditions the fixture depends on", () => {
  it("F1 the three fixture currencies have the exponents this test assumes", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KRW")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
  });

  it("F2 the poles are genuinely distinguishable — same minor, different major", () => {
    expect(formatMinor(COMMITTED_MINOR, "JPY", { locale: "en-US" })).not.toBe(
      formatMinor(COMMITTED_MINOR, "USD", { locale: "en-US" }),
    );
  });
});

/* ── (D) THE RENDERED TILES ──────────────────────────────────────────────── */

describe("D — SPV Committed / Wired tiles honour each row's own currency", () => {
  it("D1 JPY pole: ¥250,000,000 committed renders 250,000,000 — not 2,500,000", async () => {
    renderDashboard();
    const tile = await committedTile();
    await waitFor(() => expect(tile.textContent || "").toMatch(/JPY/));
    const jpyRow = Array.from(tile.querySelectorAll("div")).find((d) =>
      (d.textContent || "").includes("JPY"),
    );
    expect(jpyRow).toBeTruthy();
    const text = (jpyRow!.textContent || "").replace(/\u00a0/g, " ");
    expect(text).toMatch(/250,000,000/);
    // The defect's answer must be ABSENT, not merely un-asserted.
    expect(text).not.toMatch(/2,500,000\b(?!0)/);
  });

  it("D2 USD pole: the SAME minor amount renders 2,500,000 — a division still happens", async () => {
    renderDashboard();
    const tile = await committedTile();
    await waitFor(() => expect(tile.textContent || "").toMatch(/USD/));
    const usdRow = Array.from(tile.querySelectorAll("div")).find((d) =>
      (d.textContent || "").includes("USD"),
    );
    expect(usdRow).toBeTruthy();
    const text = (usdRow!.textContent || "").replace(/\u00a0/g, " ");
    expect(text).toMatch(/2,500,000/);
    expect(text).not.toMatch(/250,000,000/);
  });

  it("D3 KRW proves the exponent is table-driven, not a JPY special case", async () => {
    renderDashboard();
    const tile = await committedTile();
    await waitFor(() => expect(tile.textContent || "").toMatch(/KRW/));
    const krwRow = Array.from(tile.querySelectorAll("div")).find((d) =>
      (d.textContent || "").includes("KRW"),
    );
    expect((krwRow!.textContent || "").replace(/\u00a0/g, " ")).toMatch(/250,000,000/);
  });

  it("D4 the WIRED tile is the second sink of the same helper and is fixed too", async () => {
    renderDashboard();
    const tile = await screen.findByTestId("stat-spv-wired-values", undefined, { timeout: 5000 });
    await waitFor(() => expect(tile.textContent || "").toMatch(/JPY/));
    const rows = Array.from(tile.querySelectorAll("div")).map((d) =>
      (d.textContent || "").replace(/\u00a0/g, " "),
    );
    const jpy = rows.find((t) => t.includes("JPY"))!;
    const usd = rows.find((t) => t.includes("USD"))!;
    expect(jpy).toMatch(/175,000,000/);
    expect(usd).toMatch(/1,750,000/);
  });

  it("D5 the tile stays multi-currency — three rows, never one summed scalar", async () => {
    renderDashboard();
    const tile = await committedTile();
    await waitFor(() => expect(tile.textContent || "").toMatch(/KRW/));
    const text = tile.textContent || "";
    expect(text).toMatch(/JPY/);
    expect(text).toMatch(/USD/);
    expect(text).toMatch(/KRW/);
    expect(within(tile).queryByText("—")).toBeNull();
  });
});

/* ── (S) THE SOURCE ──────────────────────────────────────────────────────── */

describe("S — the shipped page no longer hardcodes an exponent", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("S0 the comment stripper actually strips, and still sees code", () => {
    expect(strip("/* m / 100 */\nconst a = 1;")).not.toMatch(/m \/ 100/);
    expect(strip("// m / 100\nconst a = 1;")).not.toMatch(/m \/ 100/);
    expect(strip("/* c */ const a = m / 100;")).toMatch(/m \/ 100/);
  });

  it("S1 fmtCurrencyMinor delegates to the shared exponent-aware formatter", () => {
    const src = strip(dashboardSource);
    expect(src.length).toBeGreaterThan(1000);
    expect(src).not.toMatch(/\(m \/ 100\)/);
    expect(src).toMatch(/import \{ fromMinor \} from "@\/lib\/currency"/);
    expect(src).toMatch(/fromMinor\(m, ccy\)/);
  });
});
