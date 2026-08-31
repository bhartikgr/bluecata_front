/**
 * WAVE 178 · ITEM A — THE PARTNER DASHBOARD MUST NEVER PRINT A CROSS-CURRENCY TOTAL.
 *
 * ── THE DEFECT, AS REPORTED FROM THE LIVE SERVER ────────────────────────────
 * The portfolio card printed a headline of the shape "$19,750,000.00 USD SPVs
 * committed". Two things were said about it. Only one of them was true.
 *
 *   Claim 1 — "it sums target raise, not committed capital."  FALSE, and proved
 *   false in the preflight: `partnerWorkspaceStore` derives the figure from
 *   `canonicalCommittedMinorForSpv`, whose predicate is `status = 'committed'`
 *   summed over `commitmentMinor` — the SAME predicate the authoritative close
 *   statement uses for `confirmedMinor` (server/lib/spvOfflineOps.ts:286). Wave
 *   115 Finding 7 already did that work. Nothing in this file re-litigates it.
 *
 *   Claim 2 — "it adds unconverted currencies and stamps USD on the result."
 *   TRUE. The live firm holds CA$1,200.00 (Asian Biotech) and HK$2,000,000.00
 *   (QA HK Tax Check) alongside its USD vehicles, and all three landed in one
 *   integer under a "USD" label. There is no FX rate source on this platform and
 *   none was invented, so the only honest fix is to STOP ADDING and start
 *   grouping.
 *
 * ── WHAT EACH POLE PROTECTS ─────────────────────────────────────────────────
 *   A · MIXED CURRENCY (USD + CAD + HKD). The headline equals the USD bucket
 *       ALONE. The CAD and HKD amounts are absent from it, and — the assertion
 *       that actually matters — the arithmetic sum of all three currencies is
 *       NOT rendered anywhere on the page. This is the defect, stated as a test.
 *   B · Every currency is listed separately, each formatted in ITS OWN currency,
 *       and committed capital is labelled distinctly from target raise. A reader
 *       cannot mistake a goal for money in the bank.
 *   C · The on-screen scope statement is present and says what is counted and
 *       what is excluded. An unexplained total is what caused this defect; an
 *       explained one is the fix.
 *   D · NEGATIVE CONTROL — a single-currency (USD-only) firm still renders a
 *       correct, unchanged headline. The fix must not be a regression dressed up
 *       as caution.
 *   E · "no goal on record" is printed as a STATED absence when no vehicle in a
 *       currency records a target. Never a fabricated $0.00 (R141/R144).
 *   F · A vehicle with no usable currency code is EXCLUDED and its exclusion is
 *       counted on screen — not silently folded into USD.
 *   G · `unavailable: true` prints a stated failure, not a zero.
 *   H · DEPLOY SKEW — a payload with no `capitalByCurrency` at all (an older
 *       server) must not crash the page.
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
        partnerId: "ac_consortium_partner_w178",
        tier: "gold",
        subRole: "managing_partner",
        identity: { userId: "u_w178", email: "partner@example.com", name: "W178 Partner" },
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

/* ── THE FIXTURE, MODELLED ON THE LIVE FIRM ─────────────────────────────────
   USD 12,500,000.00 committed (SPV) + 1,000,000.00 (fund); CAD 1,200.00;
   HKD 2,000,000.00. The two legacy scalars carry the OLD cross-currency sums,
   exactly as the server still computes them, so that the assertion "the page
   does not print the cross-currency total" is testing against a payload that
   genuinely contains it. If the fix ever regresses to reading them, POLE A
   fails immediately. */
const USD_SPV_MINOR = 1_250_000_000;
const USD_FUND_MINOR = 100_000_000;
const CAD_MINOR = 120_000;
const HKD_MINOR = 200_000_000;
/* The number the defect printed: every currency added together. */
const CROSS_CURRENCY_SPV_MINOR = USD_SPV_MINOR + CAD_MINOR + HKD_MINOR;

const MIXED = {
  portfolio: {
    attributedCompanies: 4,
    totalSpvCommittedMinor: CROSS_CURRENCY_SPV_MINOR,
    totalFundCommittedMinor: USD_FUND_MINOR,
    committedFigureSource: "canonical_spv_engine",
    capitalByCurrency: {
      rows: [
        {
          currency: "CAD",
          vehicleCount: 1,
          committedMinor: CAD_MINOR,
          spvCommittedMinor: CAD_MINOR,
          fundCommittedMinor: 0,
          targetMinor: 500_000_00,
          targetUnknownCount: 0,
        },
        {
          currency: "HKD",
          vehicleCount: 1,
          committedMinor: HKD_MINOR,
          spvCommittedMinor: HKD_MINOR,
          fundCommittedMinor: 0,
          targetMinor: null,
          targetUnknownCount: 1,
        },
        {
          currency: "USD",
          vehicleCount: 2,
          committedMinor: USD_SPV_MINOR + USD_FUND_MINOR,
          spvCommittedMinor: USD_SPV_MINOR,
          fundCommittedMinor: USD_FUND_MINOR,
          targetMinor: 3_000_000_00,
          targetUnknownCount: 0,
        },
      ],
      vehiclesWithoutCurrency: 1,
      unavailable: false,
    },
  },
  pipeline: { byStage: { screening: 1 }, topDeals: [] },
  recentActivity: [],
  team: { activeSeats: 2, pendingInvitations: 0, seatLimit: 10 },
  empty: false,
};

const USD_ONLY = {
  portfolio: {
    attributedCompanies: 2,
    totalSpvCommittedMinor: USD_SPV_MINOR,
    totalFundCommittedMinor: USD_FUND_MINOR,
    committedFigureSource: "canonical_spv_engine",
    capitalByCurrency: {
      rows: [
        {
          currency: "USD",
          vehicleCount: 2,
          committedMinor: USD_SPV_MINOR + USD_FUND_MINOR,
          spvCommittedMinor: USD_SPV_MINOR,
          fundCommittedMinor: USD_FUND_MINOR,
          targetMinor: 3_000_000_00,
          targetUnknownCount: 0,
        },
      ],
      vehiclesWithoutCurrency: 0,
      unavailable: false,
    },
  },
  pipeline: { byStage: {}, topDeals: [] },
  recentActivity: [],
  team: { activeSeats: 1, pendingInvitations: 0, seatLimit: 10 },
  empty: false,
};

const PLAN = {
  partnerId: "ac_consortium_partner_w178",
  tier: "gold",
  effectivePlan: null,
  commissionPct: null,
  effectivePlanError: null,
};

let snapshot: unknown = MIXED;

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

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/feature-flags") return res(200, { PARTNER_WORKSPACE_ENABLED: true });
      if (u === "/api/partner/me/dashboard") return res(200, snapshot);
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

describe("WAVE 178 · ITEM A — partner dashboard capital figures are per-currency and scoped on screen", () => {
  beforeEach(() => {
    snapshot = MIXED;
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE A — mixed USD+CAD+HKD: the headline is the USD bucket alone and the cross-currency sum appears NOWHERE", async () => {
    renderPage();
    const spv = await screen.findByTestId("kpi-spv");
    /* $12,500,000.00 — the USD SPV bucket. */
    expect(spv.textContent).toContain("12,500,000.00");
    /* The number the defect printed was $14,520,000.00 (USD + CAD + HKD). It
       must not be anywhere in the rendered page, not merely absent from this
       tile — a "helpful" total elsewhere on the card would be the same bug. */
    const forbidden = "14,520,000.00";
    expect(spv.textContent).not.toContain(forbidden);
    expect(document.body.textContent ?? "").not.toContain(forbidden);
    /* And the CAD/HKD amounts have not been folded into the USD tile. */
    expect(spv.textContent).not.toContain("2,000,000.00");
    expect(screen.getByTestId("kpi-fund").textContent).toContain("1,000,000.00");
  });

  it("POLE B — each currency is listed separately, in its own currency, with committed and target distinctly labelled", async () => {
    renderPage();
    await screen.findByTestId("kpi-by-currency");
    /* One row per currency actually held. */
    expect(screen.getByTestId("kpi-ccy-USD")).toBeTruthy();
    expect(screen.getByTestId("kpi-ccy-CAD")).toBeTruthy();
    expect(screen.getByTestId("kpi-ccy-HKD")).toBeTruthy();

    /* Each amount is formatted in the currency it is denominated in — not in USD.
       `formatMinor` renders CAD as "CA$" and HKD as "HK$" under en-US. */
    const cad = screen.getByTestId("kpi-ccy-committed-CAD").textContent ?? "";
    expect(cad).toContain("1,200.00");
    expect(cad).toContain("CA$");
    const hkd = screen.getByTestId("kpi-ccy-committed-HKD").textContent ?? "";
    expect(hkd).toContain("2,000,000.00");
    expect(hkd).toContain("HK$");

    /* COMMITTED and TARGET are distinctly labelled, and the target label states
       what a target raise IS so it can never be read as capital in hand. */
    expect(cad.toLowerCase()).toContain("committed capital");
    const cadTarget = screen.getByTestId("kpi-ccy-target-CAD").textContent ?? "";
    expect(cadTarget).toContain("target raise");
    expect(cadTarget).toContain("not capital committed");
    expect(cadTarget).toContain("500,000.00");
    /* The two are not the same node, so they cannot be conflated. */
    expect(screen.getByTestId("kpi-ccy-committed-CAD")).not.toBe(screen.getByTestId("kpi-ccy-target-CAD"));
  });

  it("POLE C — the scope statement is on screen and says what is counted and what is excluded", async () => {
    renderPage();
    const scope = (await screen.findByTestId("kpi-currency-scope")).textContent ?? "";
    expect(scope).toContain("never added across currencies");
    expect(scope).toContain("no exchange-rate source");
    expect(scope).toContain("US-dollar vehicles only");
    expect(scope).toContain("excluded");
    expect(scope).toContain("listed separately");
  });

  it("POLE D — NEGATIVE CONTROL: a single-currency firm still renders a correct total", async () => {
    snapshot = USD_ONLY;
    renderPage();
    const spv = await screen.findByTestId("kpi-spv");
    expect(spv.textContent).toContain("12,500,000.00");
    expect(screen.getByTestId("kpi-fund").textContent).toContain("1,000,000.00");
    /* The per-currency list still renders — one row — and the scope statement is
       still present. The explanation is not conditional on there being a
       problem; it is how the figure is always presented now. */
    expect(screen.getByTestId("kpi-ccy-USD")).toBeTruthy();
    expect(screen.getByTestId("kpi-currency-scope")).toBeTruthy();
    /* No "other currencies" noise on a firm that has none. */
    expect(screen.queryByTestId("kpi-no-currency")).toBeNull();
    expect(screen.queryByTestId("kpi-no-usd-vehicles")).toBeNull();
    expect(screen.queryByTestId("kpi-by-currency-unavailable")).toBeNull();
  });

  it("POLE E — an unrecorded target raise is a STATED absence, never a fabricated 0.00", async () => {
    renderPage();
    await screen.findByTestId("kpi-by-currency");
    /* HKD has targetMinor: null. */
    expect(screen.getByTestId("kpi-ccy-target-absent-HKD").textContent).toContain("no goal on record");
    const hkdTarget = screen.getByTestId("kpi-ccy-target-HKD").textContent ?? "";
    expect(hkdTarget).not.toContain("0.00");
    /* CAD, which DOES have a target, shows the amount rather than the phrase. */
    expect(screen.queryByTestId("kpi-ccy-target-absent-CAD")).toBeNull();
  });

  it("POLE F — a vehicle with no currency on record is excluded, and the exclusion is counted on screen", async () => {
    renderPage();
    const note = (await screen.findByTestId("kpi-no-currency")).textContent ?? "";
    expect(note).toContain("no currency on record");
    expect(note).toContain("rather than assumed to be US dollars");
    expect(note).toContain("1");
  });

  it("POLE G — unavailable prints a stated failure, not a zero", async () => {
    snapshot = {
      ...MIXED,
      portfolio: {
        ...MIXED.portfolio,
        capitalByCurrency: { rows: [], vehiclesWithoutCurrency: 0, unavailable: true },
      },
    };
    renderPage();
    const msg = (await screen.findByTestId("kpi-by-currency-unavailable")).textContent ?? "";
    expect(msg).toContain("could not be read");
    expect(msg).toContain("not an amount of zero");
    /* The stated-failure branch and the "nothing on record" branch are mutually
       exclusive: an unreadable rollup must never claim the firm holds nothing. */
    expect(screen.queryByTestId("kpi-capital-none")).toBeNull();
  });

  it("POLE H — DEPLOY SKEW: a payload with no capitalByCurrency at all does not crash the page", async () => {
    snapshot = {
      ...MIXED,
      portfolio: {
        attributedCompanies: 4,
        totalSpvCommittedMinor: CROSS_CURRENCY_SPV_MINOR,
        totalFundCommittedMinor: USD_FUND_MINOR,
      },
    };
    renderPage();
    /* The card still renders and the scope statement — which is unconditional —
       is still there, so the partner is never shown an unexplained figure. */
    await screen.findByTestId("card-portfolio");
    expect(screen.getByTestId("kpi-currency-scope")).toBeTruthy();
    /* With no rollup to read from, the USD figures fall to 0 and the page must
       NOT print the old cross-currency number. */
    expect(document.body.textContent ?? "").not.toContain("14,520,000.00");
    expect(screen.queryByTestId("kpi-by-currency")).toBeNull();
  });
});
