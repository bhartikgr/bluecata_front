/**
 * WAVE 69 · V-4 (owner ruling R58, row 4) — `effectivePlanError` REACHES THE DOM.
 *
 * ── THE DEFECT: A SILENT DROP BY OMISSION ───────────────────────────────────
 * Wave 56b added `effectivePlanError` to `GET /api/partner/me`
 * (`server/partnerRoutes.ts:761/767-770/832`) so a partner would learn WHY their
 * plan is missing. Then:
 *
 *     grep -rn "effectivePlanError"  →  3 hits, ALL in server/partnerRoutes.ts
 *
 * Zero client consumers. And `effectivePlanError` is non-null in EXACTLY the case
 * `effectivePlan` is null — so the `{planQ.data?.effectivePlan && (…)}` guard was
 * false and the whole "Plan & quota" card VANISHED. The partner saw a dashboard
 * with one card fewer than usual and no explanation anywhere.
 *
 * ── WHAT THE POLES PROTECT ──────────────────────────────────────────────────
 *   A · the reason is on screen, verbatim, with the tier named.
 *   B · the normal case is UNCHANGED: `card-plan` renders and the new card does
 *       not. This is the no-silent-drop assertion.
 *   C · NO percentage figure is printed while the plan is unresolved.
 *       `commissionPct` is `null` in this state and a `0%` commission would be a
 *       false statement about money — the whole reason Wave 56 exists.
 *   D · an older server that omits the field renders exactly what it renders
 *       today (neither card), so the optional field cannot break a deploy skew.
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
        partnerId: "ac_consortium_partner_w69",
        tier: "gold",
        subRole: "managing_partner",
        identity: { userId: "u_w69", email: "partner@example.com", name: "W69 Partner" },
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

/* The widgets below issue their own unrelated feeds; stubbed so this file tests
   one thing. Neither is a Wave 69 surface. */
vi.mock("@/components/comms/MessagesWidget", () => ({ MessagesWidget: () => <div /> }));
vi.mock("@/components/comms/PostsFeed", () => ({ PostsFeed: () => <div /> }));
vi.mock("@/components/collective/widgets/VentureMarketsCard", () => ({ VentureMarketsCard: () => <div /> }));

/* The server's own sentence for this state, long by design. */
const REASON =
  `Your plan could not be resolved: no commission rate is configured for the "gold" tier. ` +
  `Nothing has been charged and no default rate has been assumed. An administrator has to configure ` +
  `the commission rate for this tier before plan and quota figures can be produced.`;

const SNAPSHOT = {
  portfolio: { attributedCompanies: 3, totalSpvCommittedMinor: 100_000, totalFundCommittedMinor: 0 },
  pipeline: { byStage: { screening: 2 }, topDeals: [] },
  recentActivity: [],
  team: { activeSeats: 2, pendingInvitations: 0, seatLimit: 10 },
  empty: false,
};

const PLAN_OK = {
  partnerId: "ac_consortium_partner_w69",
  tier: "gold",
  effectivePlan: {
    effectivePrice: { amountMinor: 24_000, currency: "USD", source: "tier" },
    advertisedPrice: null,
    commission: { rate: 0.1, via: "tier" },
    arrangement: {},
    quotaProgress: {
      metric: "registered_companies",
      registeredThisPeriod: 1,
      threshold: 5,
      period: "month",
      enforcement: "report",
      met: false,
    },
  },
  effectivePlanError: null,
};

let meResponse: unknown = PLAN_OK;

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
      if (u === "/api/partner/me/dashboard") return res(200, SNAPSHOT);
      if (u === "/api/partner/me") return res(200, meResponse);
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

describe("WAVE 69 · V-4 — a vanished plan card now explains itself", () => {
  beforeEach(() => {
    meResponse = PLAN_OK;
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE A — with effectivePlan null, the server's reason is on screen and the tier is named", async () => {
    meResponse = {
      partnerId: "ac_consortium_partner_w69",
      tier: "gold",
      effectivePlan: null,
      commissionPct: null,
      effectivePlanError: { code: "PARTNER_COMMISSION_RATE_UNRESOLVED", tier: "gold", message: REASON },
    };
    renderPage();
    const node = await screen.findByTestId("plan-unavailable-reason");
    expect(node.getAttribute("role")).toBe("alert");
    expect(node.textContent).toBe(REASON);
    expect(screen.getByTestId("card-plan-unavailable")).toBeTruthy();
    expect(screen.getByTestId("plan-unavailable-tier").textContent).toContain("gold");
    /* The card it replaces is genuinely absent — that is the defect being explained. */
    expect(screen.queryByTestId("card-plan")).toBeNull();
  });

  it("POLE B — the normal case is UNCHANGED: card-plan renders, the new card does not", async () => {
    meResponse = PLAN_OK;
    renderPage();
    await screen.findByTestId("card-plan");
    expect(screen.queryByTestId("card-plan-unavailable")).toBeNull();
    expect(screen.queryByTestId("plan-unavailable-reason")).toBeNull();
    /* Nothing else on the page moved. */
    expect(screen.getByTestId("card-recent")).toBeTruthy();
    expect(screen.getByTestId("card-portfolio")).toBeTruthy();
  });

  it("POLE C — NO percentage figure is printed while the plan is unresolved", async () => {
    meResponse = {
      partnerId: "ac_consortium_partner_w69",
      tier: "gold",
      effectivePlan: null,
      commissionPct: null,
      effectivePlanError: { code: "PARTNER_COMMISSION_RATE_UNRESOLVED", tier: "gold", message: REASON },
    };
    const { container } = renderPage();
    await screen.findByTestId("card-plan-unavailable");
    /* A `0%` or `0.00%` commission would be a fabricated money statement. */
    expect(container.textContent ?? "").not.toMatch(/0(\.00)?%/);
    expect(screen.queryByTestId("plan-commission")).toBeNull();
  });

  it("POLE D — an older server that omits the field renders neither card (no deploy-skew break)", async () => {
    meResponse = { partnerId: "ac_consortium_partner_w69", tier: "gold", effectivePlan: null };
    renderPage();
    await screen.findByTestId("card-recent");
    expect(screen.queryByTestId("card-plan")).toBeNull();
    expect(screen.queryByTestId("card-plan-unavailable")).toBeNull();
  });
});
