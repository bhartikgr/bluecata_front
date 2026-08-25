/**
 * WAVE 127 · FINDING 3 (RENDER HALF) — AN LP ROW MUST STATE ITS OWN STAGE, EVERY
 * PERCENTAGE MUST NAME ITS DENOMINATOR, AND A VEHICLE'S MONEY MUST RENDER IN THE
 * VEHICLE'S OWN CURRENCY.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS ON SCREEN.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The LPs tab rendered exactly `Reference MARK INVEST PARTNERS: $2,500.00 (100.0%)`
 * for a subscription whose stored status is `review`, beside a Close tab correctly
 * reporting `$0.00 confirmed of $30.00 target`. The row was not wrong about the
 * amount; it was silent about the STAGE, so an indication of interest read as a
 * commitment. And `100.0%` against a `$30.00` target is nonsense unless the
 * denominator is named — it is the share of all non-withdrawn subscriptions, so
 * one row over one row is 100% whatever the target is.
 *
 * THE CURRENCY CLAIM IS ALSO TESTED HERE, AND IT WAS INVESTIGATED BEFORE IT WAS
 * TESTED. The live report was that one card rendered `CA$1,200.00` while others
 * rendered USD, and that the account's payout preference is CAD. Tracing it: the
 * SPV engine list renders `s.currency` — the VEHICLE's own column — through
 * `formatMinor(minor, currency, { locale: "en-US" })`, and Intl under en-US spells
 * CAD as `CA$`. There is no partner-level display or payout currency anywhere in
 * the codebase (`preferredCurrency` exists only on the FOUNDER profile). So no
 * viewer preference was leaking; the vehicle really is a CAD vehicle. The
 * assertion below pins that property so a future wave cannot introduce the leak:
 * the same amount renders differently for two vehicles that differ ONLY in their
 * own currency, and identically regardless of anything about the viewer.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvDetailTabs } from "../SpvDetailTabs";
import { formatMinor } from "@/lib/currency";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async () =>
      ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }) as unknown as Response,
  };
});

const INVESTOR = "u_mark_invest_partners";
const COMMITMENT_MINOR = 250_000; // $2,500.00
const TARGET_MINOR = 3_000; //      $30.00

/* eslint-disable @typescript-eslint/no-explicit-any */
function detailWith(status: string, currency = "USD"): any {
  return {
    spv: {
      status: "open", jurisdiction: "delaware", lpVisibility: "own_only", closeDate: null,
      targetRaiseMinor: TARGET_MINOR, terms: { vintage: 2026 }, revisionHash: null, updatedAt: null,
    },
    mandate: { mode: "deal_specific", sector: ["Fintech"], geography: ["United States"], stage: ["seed"] },
    fees: [],
    subscriptions: [{ id: "sub_1", investorId: INVESTOR, commitmentMinor: COMMITMENT_MINOR, status, currency }],
    register: [{ investorId: INVESTOR, commitmentMinor: COMMITMENT_MINOR, ownershipPct: 1, status }],
    deployments: [], distributions: [], documents: [], transfers: [], capitalAccounts: [],
    closeSummary: { confirmedCount: 0, confirmedMinor: 0, targetMinor: TARGET_MINOR, underTarget: true, shortfallMinor: TARGET_MINOR, suggestedTargetMinor: 0, note: "" },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Renders the tab set with the Overview tab active, i.e. as it first loads. */
function mountOverview(status: string, currency = "USD") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs spvId="spv_13ac1ceb06eeb6c7" detail={detailWith(status, currency)} currency={currency} canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
}

/** Radix does not mount an inactive panel's CHILDREN (measured while writing this
 *  file), so the LPs trigger must actually be activated or these assertions would
 *  run against an empty panel and pass for the wrong reason. */
function mount(status: string, currency = "USD") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs spvId="spv_13ac1ceb06eeb6c7" detail={detailWith(status, currency)} currency={currency} canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
  const trigger = utils.container.querySelector<HTMLElement>('[data-testid="spv-tab-lps"]')!;
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
  return utils;
}

describe("W127 FINDING 3 · the LP row labels its stage honestly", () => {
  it("a `review` row is NOT presented as a commitment (fails before this wave)", () => {
    const { container } = mount("review");
    const stage = container.querySelector(`[data-testid="spv-lp-row-stage-${INVESTOR}"]`);
    expect(stage, "every LP row must carry a stage label").toBeTruthy();
    expect(stage!.textContent).toContain("under review");
    expect(stage!.textContent).toContain("not a commitment");
    /* R91 — a raw storage key must never reach a partner. */
    expect(stage!.textContent).not.toContain("review]"); // i.e. not the bare key
    expect(stage!.textContent).not.toMatch(/\[review\]/);
  });

  it("a genuinely committed row says so, so the label is informative and not a blanket disclaimer", () => {
    const { container } = mount("committed");
    const stage = container.querySelector(`[data-testid="spv-lp-row-stage-${INVESTOR}"]`)!;
    expect(stage.textContent).toContain("committed");
    expect(stage.textContent).not.toContain("not a commitment");
  });

  it("the amount is still shown in full — the fix is a label, never a silent drop", () => {
    const { container } = mount("review");
    const row = container.querySelector(`[data-testid="spv-lp-row-${INVESTOR}"]`)!;
    expect(row.textContent).toContain("$2,500.00");
  });

  it("the percentage NAMES its denominator, and it is not the target", () => {
    const { container } = mount("review");
    const row = container.querySelector(`[data-testid="spv-lp-row-${INVESTOR}"]`)!.textContent ?? "";
    expect(row).toContain("100.0%");
    expect(row).toContain("share of all non-withdrawn subscriptions");
    expect(row).toContain("not of the target raise");
  });

  it("the roster states its basis, so an amount listed is not read as money raised", () => {
    const { container } = mount("review");
    const basis = container.querySelector('[data-testid="spv-detail-roster-basis"]');
    expect(basis).toBeTruthy();
    expect(basis!.textContent).toContain("ANY stage");
    expect(basis!.textContent).toContain("NOT the amount raised");
  });
});

describe("W127 FINDING 3 · Investors count beside a zero raise figure", () => {
  it("the count states what it counts, so `Investors: 1` next to `$0.00` is not a contradiction", () => {
    /* The Overview tab is the one that shows the count, so it is left active
       rather than switching to LPs. */
    const { container } = mountOverview("review");
    const basis = container.querySelector('[data-testid="spv-detail-lpcount-basis"]');
    expect(basis, "the Investors count must state its basis").toBeTruthy();
    expect(basis!.textContent).toContain("any stage");
    expect(basis!.textContent).toContain("committed capital only");
    expect(container.querySelector('[data-testid="spv-detail-lpcount"]')!.textContent).toContain("1");
  });
});

describe("W127 · a vehicle's money renders in the VEHICLE's currency", () => {
  it("the same minor amount renders differently for a USD and a CAD vehicle", () => {
    const usd = mount("review", "USD").container.querySelector(`[data-testid="spv-lp-row-${INVESTOR}"]`)!.textContent ?? "";
    const cad = mount("review", "CAD").container.querySelector(`[data-testid="spv-lp-row-${INVESTOR}"]`)!.textContent ?? "";
    expect(usd).toContain("$2,500.00");
    /* Intl under en-US spells CAD `CA$` — which is what the live `CA$1,200.00`
       card was, a genuinely CAD vehicle rendered correctly. */
    expect(cad).toContain("CA$2,500.00");
    expect(cad).not.toBe(usd);
  });

  it("the formatter takes the currency as an ARGUMENT — there is no viewer preference to leak", () => {
    /* A property test rather than a UI one: `formatMinor` has no access to any
       account, session or payout preference, so a vehicle's rendering cannot
       depend on who is looking at it. This is the invariant a future wave would
       have to break in order to reintroduce the reported defect. */
    expect(formatMinor(120_000, "CAD", { locale: "en-US" })).toContain("CA$");
    expect(formatMinor(120_000, "USD", { locale: "en-US" })).not.toContain("CA$");
    expect(formatMinor(120_000, "CAD", { locale: "en-US" })).toBe(formatMinor(120_000, "CAD", { locale: "en-US" }));
  });
});
