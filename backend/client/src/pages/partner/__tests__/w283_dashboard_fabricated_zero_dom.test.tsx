/**
 * WAVE 283 — THE PARTNER DASHBOARD PRINTED `$0.00` COMMITTED CAPITAL DIRECTLY
 * ABOVE THE PLATFORM'S OWN SENTENCE SAYING A ZERO WOULD BE A LIE.
 *
 * ── THE DEFECT, AND THE TRAP INSIDE IT ──────────────────────────────────────
 * The two money tiles guarded on ONE field and printed ANOTHER.
 *
 *   guard   ·  data.portfolio.totalSpvCommittedMinor == null
 *   printed ·  usdRow ? usdRow.spvCommittedMinor : 0      ← a DIFFERENT field
 *
 * `usdRow` is derived from `data.portfolio.capitalByCurrency`, which the server
 * computes in a try/catch entirely independent of the one that computes the two
 * totals (server/partnerWorkspaceStore.ts — the rollup catch returns
 * `unavailable: true`; the totals catch sets both scalars to `null`). So the
 * rollup can fail while the totals read perfectly well. In that state the guard
 * did not fire, `usdRow` was `null`, and the `: 0` fallback printed
 *
 *     "SPVs committed: $0.00 USD"
 *
 * with `kpi-by-currency-unavailable` rendering immediately beneath it saying
 *
 *     "…That is a stated failure, not an amount of zero."
 *
 * A fix aimed at the TESTED name (`totalSpvCommittedMinor`) would never have
 * touched the RENDERED value. That is why POLE 1 and POLE 2 below assert on the
 * TILE TEXT — the thing a partner actually sees — and not on the guard source.
 *
 * ── EVERY STATE THE TILE CAN BE IN (R257.1 — absent, failed, pending are three
 *    different facts, and the copy must be true in all of them) ──────────────
 *   · PENDING          — POLE 0. The card is inside `{data && !data.empty}`, so
 *                        while the query is pending the tile is NOT MOUNTED and
 *                        `dashboard-loading` renders instead. The "could not
 *                        read" sentence is therefore unreachable while loading
 *                        and cannot be false there. THIS IS ASSERTED, NOT
 *                        ASSUMED.
 *   · TOTALS NULL      — pre-existing behaviour, unchanged.
 *   · ROLLUP FAILED    — POLE 1 / POLE 2. THE DEFECT. Now a stated failure.
 *   · ROLLUP ABSENT    — POLE 4 (deploy skew / stale cached payload). Now a
 *                        stated failure.
 *   · ROLLUP FINE, NO
 *     US-DOLLAR VEHICLE — POLE 3. The zero is TRUE and is PRESERVED. Withholding
 *                        a truthful figure is the same defect pointing the other
 *                        way.
 *
 * ── WHY EACH POLE CANNOT PASS BY ACCIDENT ───────────────────────────────────
 * Every pole asserts its PRECONDITIONS FIRST: that the harness was actually
 * asked for the dashboard (`dashboardRequests > 0`), and that the card mounted.
 * A DOM absence assertion against an empty document is worthless, and this file
 * refuses to make one. Every text assertion is SCOPED to the tile under test —
 * never `document.body` — because an unscoped query matched an unrelated
 * neighbour in the previous wave and failed for the wrong reason.
 *
 * POLE 1P is a POSITIVE CONTROL on the same shape of fixture: it proves the
 * `$0.00` assertions in POLE 1/2 are capable of failing, i.e. that a readable
 * rollup still renders a formatted figure in these tiles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerDashboard from "../PartnerDashboard";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

vi.mock("@/lib/partner/useRequirePartnerRole", async () => {
  const actual = await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  );
  return {
    ...actual,
    useRequirePartnerRole: () => ({
      ready: true,
      error: null,
      identity: {
        partnerId: "ac_consortium_partner_w283",
        tier: "gold",
        subRole: "managing_partner",
        identity: { userId: "u_w283", email: "partner@example.com", name: "W283 Partner" },
      },
    }),
  };
});

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
vi.mock("@/components/comms/MessagesWidget", () => ({ MessagesWidget: () => <div /> }));
vi.mock("@/components/comms/PostsFeed", () => ({ PostsFeed: () => <div /> }));
vi.mock("@/components/collective/widgets/VentureMarketsCard", () => ({ VentureMarketsCard: () => <div /> }));

/* ── FIXTURES ───────────────────────────────────────────────────────────────
   The two scalars are DELIBERATELY READABLE (non-null) in POLE 1, 2 and 3.
   That is the whole point: the old guard branched on them, found them fine, and
   printed the fabricated zero anyway. A fixture in which the totals were null
   could not distinguish the fix from the defect. */
const USD_SPV_MINOR = 1_250_000_000; // $12,500,000.00
const USD_FUND_MINOR = 100_000_000; //  $1,000,000.00
const CAD_MINOR = 120_000; //           CA$1,200.00

const PORTFOLIO_BASE = {
  attributedCompanies: 4,
  totalSpvCommittedMinor: USD_SPV_MINOR,
  totalFundCommittedMinor: USD_FUND_MINOR,
  committedFigureSource: "canonical_spv_engine",
};

const REST = {
  pipeline: { byStage: {}, topDeals: [] },
  recentActivity: [],
  team: { activeSeats: 1, pendingInvitations: 0, seatLimit: 10 },
  empty: false,
};

/** THE DEFECT STATE: totals read fine, the per-currency rollup refused. */
const ROLLUP_UNAVAILABLE = {
  portfolio: {
    ...PORTFOLIO_BASE,
    capitalByCurrency: { rows: [], vehiclesWithoutCurrency: 0, unavailable: true },
  },
  ...REST,
};

/** POSITIVE CONTROL: the same tiles, a readable rollup, a real US-dollar row. */
const ROLLUP_FINE_WITH_USD = {
  portfolio: {
    ...PORTFOLIO_BASE,
    capitalByCurrency: {
      rows: [
        {
          currency: "USD",
          vehicleCount: 3,
          committedMinor: USD_SPV_MINOR + USD_FUND_MINOR,
          spvCommittedMinor: USD_SPV_MINOR,
          fundCommittedMinor: USD_FUND_MINOR,
          targetMinor: null,
          targetUnknownCount: 3,
        },
      ],
      vehiclesWithoutCurrency: 0,
      unavailable: false,
    },
  },
  ...REST,
};

/** THE TRUTHFUL ZERO: the rollup read fine and the firm holds no USD vehicle. */
const NO_USD_VEHICLES = {
  portfolio: {
    ...PORTFOLIO_BASE,
    capitalByCurrency: {
      rows: [
        {
          currency: "CAD",
          vehicleCount: 1,
          committedMinor: CAD_MINOR,
          spvCommittedMinor: CAD_MINOR,
          fundCommittedMinor: 0,
          targetMinor: null,
          targetUnknownCount: 1,
        },
      ],
      vehiclesWithoutCurrency: 0,
      unavailable: false,
    },
  },
  ...REST,
};

/** DEPLOY SKEW: an older server, or a stale cached payload — no rollup key. */
const NO_ROLLUP_KEY = { portfolio: { ...PORTFOLIO_BASE }, ...REST };

const PLAN = {
  partnerId: "ac_consortium_partner_w283",
  tier: "gold",
  effectivePlan: null,
  commissionPct: null,
  effectivePlanError: null,
};

let snapshot: unknown = ROLLUP_UNAVAILABLE;
let dashboardRequests = 0;
/** POLE 0 only: hold the dashboard response open so the query stays PENDING. */
let holdDashboard = false;

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

/* Every endpoint the page mounts is served. A catch-all `{}` alone is not
   enough: a neighbour panel that dereferences `undefined.length` crashes the
   render, and a crash in a NEIGHBOUR is indistinguishable from the fix failing. */
function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/feature-flags") return res(200, { PARTNER_WORKSPACE_ENABLED: true, COLLECTIVE_ADMIN_APPROVAL_ENABLED: true });
      if (u === "/api/partner/me/dashboard") {
        dashboardRequests += 1;
        if (holdDashboard) return await new Promise<Response>(() => {});
        return res(200, snapshot);
      }
      if (u === "/api/partner/me") return res(200, PLAN);
      return res(200, {});
    }),
  );
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerDashboard />
    </QueryClientProvider>,
  );
}

/** Read a tile's text, having first proved the tile is actually on screen. */
async function tileText(testId: string): Promise<string> {
  const el = await screen.findByTestId(testId);
  expect(el).toBeTruthy();
  return el.textContent ?? "";
}

describe("WAVE 283 — a committed-capital tile never prints a zero it could not read", () => {
  beforeEach(() => {
    snapshot = ROLLUP_UNAVAILABLE;
    dashboardRequests = 0;
    holdDashboard = false;
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE 0 — PENDING is a third state: while the dashboard query is in flight the tiles are NOT MOUNTED, so the failure sentence cannot be false there", async () => {
    holdDashboard = true;
    renderPage();
    /* PRECONDITION FIRST — the loading branch really is the one on screen. */
    const loading = await screen.findByTestId("dashboard-loading");
    expect(loading.textContent ?? "").toContain("Loading");
    expect(dashboardRequests).toBeGreaterThan(0);
    /* Only now is an absence assertion meaningful. */
    expect(screen.queryByTestId("kpi-spv")).toBeNull();
    expect(screen.queryByTestId("kpi-fund")).toBeNull();
    expect(screen.queryByTestId("kpi-spv-unavailable")).toBeNull();
    expect(screen.queryByTestId("kpi-fund-unavailable")).toBeNull();
  });

  it("POLE 1P — POSITIVE CONTROL: with a readable rollup and a US-dollar row, both tiles still print their figures (so POLE 1 and 2 are capable of failing)", async () => {
    snapshot = ROLLUP_FINE_WITH_USD;
    renderPage();
    const spv = await tileText("kpi-spv");
    const fund = await tileText("kpi-fund");
    expect(dashboardRequests).toBeGreaterThan(0);
    expect(spv).toContain("12,500,000.00");
    expect(fund).toContain("1,000,000.00");
    expect(screen.queryByTestId("kpi-spv-unavailable")).toBeNull();
    expect(screen.queryByTestId("kpi-fund-unavailable")).toBeNull();
  });

  it("POLE 1 — THE DEFECT, SPV TILE: rollup unavailable while the totals read fine — the tile states the failure and prints NO $0.00", async () => {
    snapshot = ROLLUP_UNAVAILABLE;
    renderPage();
    const spv = await tileText("kpi-spv");
    /* PRECONDITIONS: the request happened, the card mounted, and the fixture
       really is the one that used to produce the defect — the totals are
       readable, so the OLD guard would not have fired. */
    expect(dashboardRequests).toBeGreaterThan(0);
    expect(await screen.findByTestId("card-portfolio")).toBeTruthy();
    expect((ROLLUP_UNAVAILABLE.portfolio as { totalSpvCommittedMinor: number | null }).totalSpvCommittedMinor).not.toBeNull();
    /* THE FIX. */
    expect(spv).toContain("could not read the committed total");
    /* THE CONSEQUENCE ASSERTION — this is the one the wave exists for, and it
       cannot be satisfied by any other means than not printing the figure. */
    expect(spv).not.toMatch(/\$?0\.00/);
    /* And the sentence the fabricated zero used to contradict is still there. */
    const sibling = await tileText("kpi-by-currency-unavailable");
    expect(sibling).toContain("not an amount of zero");
  });

  it("POLE 2 — THE DEFECT, FUND TILE: the second tile is pinned independently of the first", async () => {
    snapshot = ROLLUP_UNAVAILABLE;
    renderPage();
    const fund = await tileText("kpi-fund");
    expect(dashboardRequests).toBeGreaterThan(0);
    expect((ROLLUP_UNAVAILABLE.portfolio as { totalFundCommittedMinor: number | null }).totalFundCommittedMinor).not.toBeNull();
    expect(fund).toContain("could not read the committed total");
    expect(fund).not.toMatch(/\$?0\.00/);
  });

  it("POLE 3 — THE TRUTHFUL ZERO IS PRESERVED: a readable rollup with no US-dollar vehicle still prints $0.00, and still explains why", async () => {
    snapshot = NO_USD_VEHICLES;
    renderPage();
    const spv = await tileText("kpi-spv");
    const fund = await tileText("kpi-fund");
    expect(dashboardRequests).toBeGreaterThan(0);
    /* This test exists to stop the fix OVER-REACHING. Folding `usdRow == null`
       into the guard would replace a true zero with a false claim of failure. */
    expect(spv).toContain("0.00");
    expect(fund).toContain("0.00");
    expect(screen.queryByTestId("kpi-spv-unavailable")).toBeNull();
    expect(screen.queryByTestId("kpi-fund-unavailable")).toBeNull();
    const why = await tileText("kpi-no-usd-vehicles");
    expect(why).toContain("no US-dollar vehicles");
    expect(why).toContain("not because a figure was missing");
    /* The CAD row is still shown in its own currency — nothing was withheld. */
    expect(await tileText("kpi-ccy-committed-CAD")).toContain("1,200.00");
  });

  it("POLE 4 — DEPLOY SKEW: a payload with no capitalByCurrency at all states the failure, does not crash, and keeps the scope sentence", async () => {
    snapshot = NO_ROLLUP_KEY;
    renderPage();
    const spv = await tileText("kpi-spv");
    const fund = await tileText("kpi-fund");
    expect(dashboardRequests).toBeGreaterThan(0);
    expect("capitalByCurrency" in NO_ROLLUP_KEY.portfolio).toBe(false);
    expect(spv).toContain("could not read the committed total");
    expect(fund).toContain("could not read the committed total");
    expect(spv).not.toMatch(/\$?0\.00/);
    expect(fund).not.toMatch(/\$?0\.00/);
    /* No crash, and the unconditional scope sentence is never dropped (R242). */
    expect(await screen.findByTestId("card-portfolio")).toBeTruthy();
    expect(await tileText("kpi-currency-scope")).toContain("never added across currencies");
  });
});
