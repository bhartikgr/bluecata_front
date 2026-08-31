/**
 * WAVE 207 · ITEMS A & B — THE COPY IS THE EVIDENCE, PROVED ON THE REAL COMPONENT.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * The owner's instruction was explicit: every description of the vehicle fee, on every
 * surface, must stop describing a capital basis. A schema fence an administrator cannot
 * read is not a fix; the sentence a partner reads is the deliverable.
 *
 * NEVER PROVE A REPLICA (handbook §8). This mounts the REAL
 * `client/src/pages/partner/PartnerBilling.tsx` — the page the product ships — and the
 * REAL admin explanation component from
 * `client/src/pages/admin/AdminFeesConsolidated.tsx`. The tab is opened the way the
 * product opens it, through the URL search string the page reads with `useSearch()`,
 * rather than by rendering an inner component directly.
 *
 * WHAT IS ASSERTED
 *   §1 · the partner-facing vehicle-fee sentence is the wave-207 sentence, byte-for-byte
 *        from the shared constant, and contains no capital wording in any form.
 *   §2 · ITEM B: the commission promise is now conditional on a MEASURED rate. Both poles
 *        are driven — a measured rate renders the original wave-1 sentence verbatim
 *        (R143.1: the literal survives), an unmeasured rate renders the honest one. No
 *        percentage is hardcoded in either direction (R191.1: a real 0% tier exists).
 *   §3 · ITEM B: the pending and paid totals still read $0.00 — not blank, not absent.
 *   §4 · the admin surface tells the same story from the same constants.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerBilling from "../PartnerBilling";
import { W188FeeRowExplanation } from "@/pages/admin/AdminFeesConsolidated";
import {
  W207_VEHICLE_FEE_WHEN,
  W207_VEHICLE_FEE_BASIS,
  W207_PERMITTED_DIMENSIONS_SENTENCE,
  LEGACY_CAPITAL_BASIS_DIMENSION,
  PERMITTED_FEE_BASIS_DIMENSIONS,
} from "@shared/wave207FeeBasisDimension";

/* Every wording that would DESCRIBE the fee as capital-based, in one place.
   Note what is NOT here: the bare word "capital". The corrected sentences use it to
   DENY the basis ("does not vary with the capital confirmed in the vehicle"), and
   banning the word outright would force vaguer copy that says less to a partner. What
   must be absent is any wording that presents capital as the thing charged on. */
const CAPITAL_WORDINGS = [
  "confirmed capital at that moment",
  "based on confirmed capital",
  "soft-circled",
  "size of the vehicle",
  "stepped size band",
];

/** Flipped per test to drive BOTH poles of the Item B condition. */
let commissionRateFraction: number | null = null;
/** Flipped to prove the ledger-state sentence appears only for an empty ledger. */
let billingEntries: Array<Record<string, unknown>> = [];

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div>
      {title}
      {description}
    </div>
  ),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
/* The page reads its tab from the URL. `useSearch` is mocked to the search string the
   product itself produces when a partner clicks the Fee schedule tab, so the real tab
   renders through the real code path. */
let search = "";
vi.mock("wouter", () => ({
  useRoute: () => [true, {}],
  useSearch: () => search,
  useLocation: () => ["/partner/billing", () => {}],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w207",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w207", email: "gp@example.com", name: "W207 GP" },
    },
  }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (_m: string, url: string) => {
      let payload: unknown = {};
      if (url.includes("fee-schedule/aggregate")) {
        /* Shaped like the ROUTE (`{ aggregate: … }`), not like the render code. */
        payload = {
          sseScope: "",
          aggregate: {
            partnerId: "p_w207",
            tier: "builder",
            tierError: null,
            revision: "r7",
            computedAt: "2026-08-30T00:00:00.000Z",
            commission: { rateFraction: commissionRateFraction, via: commissionRateFraction === null ? null : "db", error: null },
            lines: [
              {
                feeKind: "spv_deployment",
                ok: true,
                amountMinor: 24_000,
                currency: "USD",
                billingPeriod: "one_off",
                computedVia: "platform_default",
                error: null,
              },
            ],
            spvFeeSchedules: [],
          },
        };
      } else if (url.includes("/api/partner/me/billing")) {
        payload = { entries: billingEntries, totalsByStatus: {} };
      } else if (url.includes("/subscription")) {
        payload = {
          subscription: null,
          agreement: { version: "v1", url: null, text: "", finalDocUrl: null, isDraft: false },
          partnerSubscription: null,
          partnerSubscriptionEvents: [],
          purchasableCycles: ["annual"],
          unavailableCycles: ["monthly"],
        };
      }
      return { ok: true, status: 200, json: async () => payload };
    },
  };
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerBilling />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  search = "";
  commissionRateFraction = null;
  billingEntries = [];
});
afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — ITEM A: THE PARTNER-FACING SENTENCE NO LONGER DESCRIBES A CAPITAL BASIS.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §1 — the vehicle fee, as a partner reads it", () => {
  it("T207.F1: the fee-schedule row states the corrected basis, from the shared constant", async () => {
    search = "?tab=fee-schedule";
    mount();
    const trigger = await screen.findByTestId("partner-feeschedule-trigger-spv_deployment");
    expect(trigger.textContent).toBe(W207_VEHICLE_FEE_WHEN);
    /* Not merely different — free of the capital basis in any wording. */
    for (const w of CAPITAL_WORDINGS) {
      expect(trigger.textContent!.toLowerCase(), `still describes basis as "${w}"`).not.toContain(w);
    }
    /* …and it still does the job wave 165 gave it: it names the trigger. */
    expect(trigger.textContent!.toLowerCase()).toContain("deployed");
    expect(trigger.textContent!.toLowerCase()).toContain("once");
  });

  it("T207.F2: no capital wording survives ANYWHERE on the rendered fee-schedule tab", async () => {
    search = "?tab=fee-schedule";
    const { container } = mount();
    await screen.findByTestId("partner-feeschedule-trigger-spv_deployment");
    const text = (container.textContent ?? "").toLowerCase();
    for (const w of ["confirmed capital", "soft-circled", "size of the vehicle"]) {
      expect(text, `the tab still says "${w}"`).not.toContain(w);
    }
    /* The amount is still rendered — the sweep did not blank the screen. */
    expect(container.textContent).toMatch(/240|24,000|\$240\.00/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — ITEM B: THE COMMISSION PROMISE IS MEASURED, NOT ASSERTED.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §2 — the dead commission promise", () => {
  it("T207.G1: with NO rate measured, the page says so instead of promising earnings", async () => {
    commissionRateFraction = null;
    mount();
    const p = await screen.findByTestId("partner-billing-commission-promise-unbacked");
    expect(p.textContent).toContain("No commission rate is configured for your tier");
    expect(p.textContent).toContain("no rate has been assumed");
    /* R-ASSERT / R191.1 — no percentage may be invented, in either direction. */
    expect(p.textContent).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(screen.queryByTestId("partner-billing-commission-rate")).toBeNull();
    /* The promise sentence must be absent while nothing backs it. */
    const explainer = await screen.findByTestId("partner-billing-explainer");
    expect(explainer.textContent).not.toContain("Consortium Partners earn commissions on referred founders.");
  });

  it("T207.G2: BOTH POLES — with a rate measured, the original sentence renders verbatim (R143.1)", async () => {
    commissionRateFraction = 0.03;
    mount();
    /* Await the MEASURED value first: while the rate request is in flight the page
       says it is checking, and asserting before then would test the loading state. */
    const rate = await screen.findByTestId("partner-billing-commission-rate");
    const explainer = await screen.findByTestId("partner-billing-explainer");
    expect(explainer.textContent).toContain("Consortium Partners earn commissions on referred founders.");
    /* The percentage shown is FORMATTED FROM THE MEASURED FRACTION, never hardcoded. */
    expect(rate.textContent).toContain("3%");
    expect(screen.queryByTestId("partner-billing-commission-promise-unbacked")).toBeNull();
  });

  it("T207.G3: a measured 0% is a REAL rate and is reported as one, not as 'unconfigured'", async () => {
    /* R191.1 — a 0% tier exists on the live platform. Treating 0 as \"missing\" would
       tell a live partner their rate is unconfigured when it is configured at zero. */
    commissionRateFraction = 0;
    mount();
    const rate = await screen.findByTestId("partner-billing-commission-rate");
    expect(rate.textContent).toContain("0%");
    expect(screen.queryByTestId("partner-billing-commission-promise-unbacked")).toBeNull();
  });

  it("T207.G4: the ledger's emptiness is stated, and only while it is actually empty", async () => {
    billingEntries = [];
    mount();
    const state = await screen.findByTestId("partner-billing-commission-ledger-state");
    expect(state.textContent).toContain("no entries yet");
    expect(state.textContent).toContain("$0.00");
    cleanup();
    /* With an entry present the sentence must disappear — a claim of emptiness that
       survives a non-empty ledger is a false statement, not a helpful one. */
    billingEntries = [{ id: "e1", currency: "USD", commissionMinor: 5000, status: "pending" }];
    mount();
    await screen.findByTestId("partner-billing-explainer");
    expect(screen.queryByTestId("partner-billing-commission-ledger-state")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — ITEM B: THE ZEROES STAY. \"not blank, not absent.\"
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §3 — the totals still read $0.00", () => {
  it("T207.H1: pending and paid both render $0.00 with an empty ledger", async () => {
    billingEntries = [];
    mount();
    const pending = await screen.findByTestId("partner-billing-total-pending");
    const paid = await screen.findByTestId("partner-billing-total-paid");
    expect(pending.textContent).toBe("$0.00");
    expect(paid.textContent).toBe("$0.00");
    expect(pending.textContent!.trim()).not.toBe("");
    expect(paid.textContent!.trim()).not.toBe("");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 — ITEM A: THE ADMIN SURFACE TELLS THE SAME STORY.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §4 — admin and partner are told one story", () => {
  it("T207.I1: the admin explanation renders the same corrected sentences", () => {
    render(<W188FeeRowExplanation feeKind="spv_deployment" tier={null} testId="adm" />);
    expect(screen.getByTestId("adm-when-flat").textContent).toBe(W207_VEHICLE_FEE_WHEN);
    expect(screen.getByTestId("adm-basis-flat").textContent).toBe(W207_VEHICLE_FEE_BASIS);
    /* R180.3 / the owner's flexibility requirement: the permitted set is NAMED on the
       screen, so an administrator can see what a fee may be based on in future. */
    const permitted = screen.getByTestId("adm-permitted-dimensions").textContent ?? "";
    expect(permitted).toBe(W207_PERMITTED_DIMENSIONS_SENTENCE);
    /* Each permitted dimension must be described in words a human reads, so the
       mapping is asserted explicitly rather than by guessing at the machine key —
       "duration" is written as "how long the vehicle is administered". A dimension
       added to the permitted set without a plain-language phrase fails here. */
    const PHRASES: Record<string, string> = {
      flat_per_vehicle: "bands may be read against",
      investor_count: "number of investors",
      jurisdiction_complexity: "jurisdictions involved",
      document_count: "number of documents",
      duration: "how long the vehicle is administered",
    };
    for (const d of PERMITTED_FEE_BASIS_DIMENSIONS) {
      expect(PHRASES[d], `no plain-language phrase declared for ${d}`).toBeTruthy();
      expect(permitted.toLowerCase(), `permitted set must describe ${d}`).toContain(PHRASES[d]);
    }
    expect(permitted.toLowerCase()).toContain("capital is not a permitted basis");
  });

  it("T207.I2: the wave-188 capital sentences are RETAINED and reachable (R143.1, nothing deleted)", () => {
    render(
      <W188FeeRowExplanation
        feeKind="spv_deployment"
        tier={null}
        testId="legacy"
        basisDimension={LEGACY_CAPITAL_BASIS_DIMENSION}
      />,
    );
    expect(screen.getByTestId("legacy-when").textContent).toContain("confirmed capital");
    expect(screen.getByTestId("legacy-basis").textContent).toContain("size of the vehicle");
  });

  it("T207.I3: fee kinds that never named capital are UNTOUCHED", () => {
    for (const kind of ["subscription_annual", "subscription_monthly", "spv_management_per_lp_quarter", "spv_closing_bonus"]) {
      cleanup();
      render(<W188FeeRowExplanation feeKind={kind} tier={null} testId={`u-${kind}`} />);
      /* The wave-188 sentences still render for these kinds, on the original testids. */
      expect(screen.getByTestId(`u-${kind}-when`).textContent!.length).toBeGreaterThan(20);
      expect(screen.getByTestId(`u-${kind}-basis`).textContent!.length).toBeGreaterThan(20);
      expect(screen.queryByTestId(`u-${kind}-when-flat`)).toBeNull();
    }
  });
});
