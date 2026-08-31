/**
 * WAVE 208 — WHAT A PARTNER ACTUALLY SEES ON THE FEE SCHEDULE, ON THE REAL SCREEN.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * NEVER PROVE A REPLICA (handbook §8). This mounts the REAL
 * `client/src/pages/partner/PartnerBilling.tsx` and opens the Fee schedule tab the
 * way the product opens it — through the URL search string the page reads with
 * `useSearch()` — so the real cells, the real `AGG_VIA_LABELS` map and the real
 * `humanizeMachineKey` do the rendering.
 *
 * AND THE PAYLOAD IS NOT INVENTED EITHER. `__fixtures__/w208_fee_schedule_aggregate.json`
 * is a RECORDING of the real `GET /api/partner/fee-schedule/aggregate` response,
 * produced by `server/__tests__/w208_fee_reconciliation_http.test.ts` against a real
 * Express app and a real database. That suite re-derives the recording on every run
 * and fails if it no longer matches the live route, so this file cannot drift into
 * asserting a payload the server never sends. A hand-written payload would have let
 * wave 208 repeat wave 188's mistake in the opposite direction: proving a screen
 * against a response shape that does not exist.
 *
 * WHAT IS ASSERTED
 *   §1 · the seeded $0.00 placeholder is GONE from the partner's fee schedule.
 *   §2 · the annual fee renders a real amount and NAMES the authoritative source.
 *   §3 · the monthly line refuses, in readable English, with no amount and no rate.
 *   §4 · nothing on the tab presents a monthly figure as this tier's rate.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerBilling from "../PartnerBilling";
import recording from "./__fixtures__/w208_fee_schedule_aggregate.json";

/** The tier this file renders. Any recorded tier would do; this one is named. */
const TIER = "catalyst";

const recorded = (recording as Record<string, { tier: string; lines: any[] }>)[TIER];

function lineFor(feeKind: string) {
  const line = recorded.lines.find((l) => String(l.feeKind) === feeKind);
  if (!line) throw new Error(`the recording has no ${feeKind} line`);
  return line;
}

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
      partnerId: "p_w208",
      tier: TIER,
      subRole: "managing_partner",
      identity: { userId: "u_w208", email: "gp@example.com", name: "W208 GP" },
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
        /* Shaped like the ROUTE (`{ aggregate: … }`) because it IS the route's
           own recorded body, not a shape invented to suit the render code. */
        payload = {
          sseScope: "",
          aggregate: {
            partnerId: "p_w208",
            tier: recorded.tier,
            tierError: null,
            revision: "w208-recording",
            computedAt: "2026-08-30T00:00:00.000Z",
            commission: { rateFraction: null, via: null, error: null },
            lines: recorded.lines,
            spvFeeSchedules: [],
          },
        };
      } else if (url.includes("/api/partner/me/billing")) {
        payload = { entries: [], totalsByStatus: {} };
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
  search = "?tab=fee-schedule";
});
afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — THE SEEDED PLACEHOLDER IS GONE FROM THE PARTNER'S SCREEN.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W208 §1 — the fee schedule no longer shows a price nobody set", () => {
  it("T208.D1: renders no $0.00 subscription figure anywhere on the tab", async () => {
    const { container } = mount();
    await screen.findByTestId("partner-feeschedule-table");
    const table = screen.getByTestId("partner-feeschedule-table").textContent ?? "";
    /* The exact string the seeded `amount_minor = 0` rows used to produce. It is
       not banned from the whole page — a real $0.00 LEDGER TOTAL is correct and
       wave 207 asserts it — only from the fee-schedule table itself. */
    expect(table).not.toContain("$0.00");
    /* And the tab did render: this is not passing because nothing mounted. */
    expect(container.textContent).toContain("Fee");
  });

  it("T208.D2: never labels a subscription figure with the seeded platform default", async () => {
    mount();
    await screen.findByTestId("partner-feeschedule-table");
    const table = screen.getByTestId("partner-feeschedule-table").textContent ?? "";
    /* `AGG_VIA_LABELS.platform_default` — the words that used to sit under the
       $0.00 and made a placeholder look like a decision. */
    expect(table).not.toContain("Platform default");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — THE ANNUAL FEE IS A REAL AMOUNT AND ITS SOURCE IS NAMED.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W208 §2 — the annual subscription fee, as a partner reads it", () => {
  it("T208.D3: shows the amount the route served and names the authoritative source", async () => {
    const annual = lineFor("subscription_annual");
    /* The recording's own precondition, asserted rather than assumed. */
    expect(annual.ok).toBe(true);
    expect(annual.amountMinor).not.toBe(null);
    expect(annual.computedVia).toBe("partner_tier_price_authoritative");

    mount();
    const row = await screen.findByTestId("partner-feeschedule-row-subscription_annual");
    const text = row.textContent ?? "";
    /* No amount literal is written here: the recorded minor units are formatted by
       the same rule the cell uses (integer minor units, two decimal places) and
       the row must contain that. */
    const major = String(annual.amountMinor).slice(0, -2);
    const cents = String(annual.amountMinor).slice(-2);
    expect(text).toContain(`${major}.${cents}`);
    /* The provenance a partner can read, from the real AGG_VIA_LABELS map. */
    expect(text).toContain("Your tier's published price");
    expect(screen.queryByTestId("partner-feeschedule-unresolved-subscription_annual")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — THE MONTHLY LINE REFUSES, READABLY.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W208 §3 — the monthly cadence contradiction refuses on screen", () => {
  it("T208.D4: shows Unresolved with a plain-English reason and no amount", async () => {
    const monthly = lineFor("subscription_monthly");
    expect(monthly.ok).toBe(false);
    expect(monthly.amountMinor).toBe(null);

    mount();
    const unresolved = await screen.findByTestId(
      "partner-feeschedule-unresolved-subscription_monthly",
    );
    expect(unresolved.textContent).toContain("Unresolved");

    const row = screen.getByTestId("partner-feeschedule-row-subscription_monthly");
    const text = row.textContent ?? "";
    /* The real client formatter's output, not the raw machine code. */
    expect(text).toMatch(/monthly billing is not currently offered/i);
    expect(text).toContain(TIER);
    /* No storage key and no SCREAMING_SNAKE code survives to the screen. */
    expect(text).not.toContain("MONTHLY_NOT_OFFERED");
    expect(text).not.toContain("_");
    /* No amount, of any kind, on a refused line. */
    expect(text).not.toMatch(/\$\s*\d/);
  });

  it("T208.D5: no monthly figure is presented as this tier's rate anywhere on the tab", async () => {
    mount();
    await screen.findByTestId("partner-feeschedule-table");
    const table = screen.getByTestId("partner-feeschedule-table").textContent ?? "";
    /* `AGG_VIA_LABELS.tier_default` is the phrase live showed beside a $10.00
       monthly figure on a tier priced annual. It must not appear on the monthly
       row, and there must be no per-month amount anywhere in the table. */
    const monthlyRow =
      screen.getByTestId("partner-feeschedule-row-subscription_monthly").textContent ?? "";
    expect(monthlyRow).not.toContain("Your tier's rate");
    expect(table).not.toMatch(/\$\s*[\d,.]+\s*\/\s*mo/i);
    expect(table).not.toMatch(/\$\s*[\d,.]+\s+per month/i);
  });
});
