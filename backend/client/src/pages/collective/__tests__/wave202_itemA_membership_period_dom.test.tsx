/**
 * WAVE 202 · ITEM A · R178.1 — THE OWNER'S CHOICE, PROVED IN THE RENDERED DOM,
 * IN BOTH DIRECTIONS.
 * ════════════════════════════════════════════════════════════════════════════════
 * THE OWNER'S WORDS:
 *   "the admin area pricing section should allow me to choose between annual and/or
 *    monthly pricing. Whatever I choose should be dynamically displayed in the
 *    frontend."
 *
 * WAVE 199'S DECLARED GAP, WHICH THIS FILE CLOSES:
 *   wave 199 changed this page so a monthly cadence suffix is withheld unless the
 *   admin offers monthly, but it shipped with NO RENDERED-DOM TEST asserting a
 *   monthly display's absence. It proved the decision function and the source text
 *   and stopped there. This file mounts the REAL `MembershipPage` component in jsdom
 *   and asserts on the REAL text node, in BOTH directions:
 *
 *     A-1  admin chose monthly for this price      → the monthly suffix IS rendered
 *     A-2  admin chose annual only for this price  → the monthly suffix IS ABSENT
 *     A-3  the amount itself survives both ways    → the page is never priceless
 *     A-4  policy unknown / request failed         → FAIL-CLOSED, suffix absent
 *     A-5  no per-price choice recorded            → identical to wave 199's answer
 *     A-6  annual offered but not set              → says so, and NEVER shows $0.00
 *     A-7  the monthly amount is never multiplied by twelve anywhere in the DOM
 *
 * NOT A REPLICA (handbook §8). The component under test is the production
 * `MembershipPage` imported from its production path, not a copy, not a stub, not an
 * extracted sub-function. Only the HTTP boundary is faked, and it is faked with the
 * exact payload shapes the production endpoints return — including the real
 * `/api/collective/member-tier` shape for the Collective membership as it actually
 * stands in the database: `24900 USD monthly`.
 *
 * WHY 24900/USD/monthly APPEARS IN THIS FILE. It is the fixture the server holds,
 * not a compiled-in price (R156.2 governs product code, and a test that asserts on
 * the platform's real recorded figure is the point of the test). No production file
 * gains a literal from this.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ---------- HTTP boundary ---------------------------------------------------- */

type Payload = Record<string, unknown>;
const routes = new Map<string, Payload>();
const apiRequestMock = vi.fn(async (_method: string, url: string) => {
  /* `Array.from` rather than iterating the Map directly: this tree's tsconfig
     target predates for-of over a Map (TS2802), and a new type error is a gate
     failure. */
  for (const [prefix, body] of Array.from(routes.entries())) {
    if (url === prefix || url.startsWith(`${prefix}?`)) {
      return { json: async () => body } as unknown as Response;
    }
  }
  throw new Error(`test: no fixture registered for ${url}`);
});

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return {
    ...actual,
    apiRequest: (method: string, url: string) => apiRequestMock(method, url),
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({
  useLocation: () => ["/collective/membership", vi.fn()],
  Link: ({ children }: { children?: unknown }) => children as never,
}));

import MembershipPage from "@/pages/collective/MembershipPage";
import { platformFeeScope, useMonthlyDisplayAllowed } from "@/lib/priceDisplayPolicy";

/* ---------- fixtures --------------------------------------------------------- */

/** The canonical Collective membership row as the database actually holds it. */
const MEMBER_TIER_KEY = "collective.member_subscription.standard";
const MEMBER_TIER = {
  slug: "standard",
  key: MEMBER_TIER_KEY,
  amountMinor: 24900,
  currency: "USD",
  billingPeriod: "monthly",
  fromDb: true,
};

const MEMBER_TIER_SCOPE = platformFeeScope(MEMBER_TIER_KEY);

/** A per-price offer in the exact shape `resolvePricePeriodOffer()` returns. */
function offer(over: Partial<Record<string, unknown>> = {}): Payload {
  return {
    scopeKey: MEMBER_TIER_SCOPE,
    annualOffered: true,
    monthlyOffered: false,
    source: "per_price",
    annualAmountMinor: null,
    annualCurrency: null,
    annualDerivation: "unset",
    forbidX12Derivation: true,
    updatedAt: "2026-08-28T00:00:00Z",
    updatedBy: "owner",
    notes: null,
    unavailableReason: null,
    ...over,
  };
}

/**
 * The `/api/price-display-policy` payload. `platformMonthly` is wave 199's
 * platform-wide verdict; `scopes` is wave 202's per-price layer.
 */
function policyPayload(platformMonthly: boolean, scopes: Payload[]): Payload {
  return {
    ok: true,
    policy: {
      monthlyDisplayAllowed: platformMonthly,
      annualOffered: true,
      monthlyOffered: platformMonthly,
      monthlyPurchasable: platformMonthly,
      annualPurchasable: true,
      forbidX12Derivation: true,
      model: "flat_annual",
      updatedAt: "2026-08-14T00:00:00Z",
      unavailableReason: null,
      scopes,
    },
  };
}

/** Registers every endpoint `MembershipPage` calls, with one policy variant. */
function mountWith(policy: Payload | null): void {
  routes.clear();
  routes.set("/api/feature-flags", { COLLECTIVE_ENABLED: true });
  routes.set("/api/me/chapters", { chapters: [{ id: "chap_keiretsu_canada" }] });
  routes.set("/api/collective/member-tier", MEMBER_TIER);
  routes.set("/api/collective/membership/tiers", {
    ok: true,
    source: "env_fallback",
    tiers: [],
  });
  routes.set("/api/collective/membership/me", {
    membership: {
      id: "m_1",
      tier: "standard",
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
  });
  routes.set("/api/collective/membership/detail", {
    membership: { paymentDate: null, currentPeriodEnd: null },
  });
  if (policy !== null) routes.set("/api/price-display-policy", policy);

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MembershipPage />
    </QueryClientProvider>,
  );
}

/** The rendered text of the billing-detail amount node. */
async function amountText(): Promise<string> {
  const el = await waitFor(() => screen.getByTestId("membership-amount"));
  return el.textContent ?? "";
}

beforeEach(() => {
  apiRequestMock.mockClear();
  routes.clear();
});
afterEach(() => cleanup());

/* ============================================================================ */

describe("W202 A — the owner's per-price period choice reaches the rendered DOM", () => {
  it("A-1 PRESENT: when the admin has chosen monthly FOR THIS PRICE, the monthly suffix is rendered", async () => {
    mountWith(policyPayload(false, [offer({ monthlyOffered: true })]));
    const text = await amountText();
    /* The recorded cadence is monthly and the owner chose to show monthly, so the
       cadence must be stated. Note the platform-wide verdict is FALSE here: this
       assertion therefore also proves the per-price choice OVERRIDES the
       platform-wide one, which is the whole of Item A. */
    expect(text).toContain("month");
    expect(text).toContain("249");
  });

  it("A-2 ABSENT: when the admin has chosen annual only FOR THIS PRICE, no monthly suffix is rendered", async () => {
    mountWith(policyPayload(true, [offer({ monthlyOffered: false })]));
    const text = await amountText();
    /* wave 199's declared gap, closed. The platform-wide verdict is TRUE here, so a
       page that ignored the per-price choice would print "month" and fail. */
    expect(text).not.toContain("month");
    expect(text).not.toContain("Month");
    expect(text).not.toContain("/");
  });

  it("A-3 the amount itself is rendered in BOTH directions — the page is never priceless", async () => {
    mountWith(policyPayload(false, [offer({ monthlyOffered: true })]));
    expect(await amountText()).toContain("249");
    cleanup();
    mountWith(policyPayload(true, [offer({ monthlyOffered: false })]));
    expect(await amountText()).toContain("249");
  });

  it("A-4 FAIL-CLOSED: with no policy endpoint answering, the monthly suffix is absent", async () => {
    mountWith(null); /* the request throws — `usePriceDisplayPolicy` returns null */
    const text = await amountText();
    expect(text).not.toContain("month");
    expect(text).toContain("249");
  });

  it("A-5 NO RECORDED CHOICE: the answer is identical to wave 199's platform-wide answer", async () => {
    /* Empty `scopes`. The fallback must reproduce wave 199 exactly, which is what
       makes moving this page onto the scope-aware hook behaviour-identical on the
       day it lands. Platform says monthly is allowed → suffix present. */
    mountWith(policyPayload(true, []));
    expect(await amountText()).toContain("month");
    cleanup();
    /* Platform says monthly is not allowed → suffix absent. */
    mountWith(policyPayload(false, []));
    expect(await amountText()).not.toContain("month");
  });

  it("A-5b a choice recorded for a DIFFERENT price does not leak onto this one", async () => {
    mountWith(
      policyPayload(false, [
        offer({ scopeKey: "platform_fee:founder.capavate_annual", monthlyOffered: true }),
      ]),
    );
    expect(await amountText()).not.toContain("month");
  });

  it("A-6 R143.4: annual offered but not set says so in words, and never shows a zero", async () => {
    mountWith(
      policyPayload(false, [
        offer({ annualOffered: true, annualAmountMinor: null, monthlyOffered: false }),
      ]),
    );
    const note = await waitFor(() =>
      screen.getByTestId("text-membership-annual-not-set"),
    );
    expect(note.textContent ?? "").toContain("has not been set");
    /* The absence is never rendered as a zero total. */
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("$0.00");
    expect(body).not.toContain("0.00");
  });

  it("A-6b when an annual price HAS been set, the not-set sentence disappears", async () => {
    mountWith(
      policyPayload(false, [
        offer({
          annualOffered: true,
          annualAmountMinor: 240000,
          annualCurrency: "USD",
          annualDerivation: "admin_set",
        }),
      ]),
    );
    await amountText();
    expect(screen.queryByTestId("text-membership-annual-not-set")).toBeNull();
  });

  it("A-7 no ×12 derivation appears anywhere in the rendered DOM", async () => {
    mountWith(policyPayload(false, [offer({ annualOffered: true })]));
    await amountText();
    const body = document.body.textContent ?? "";
    /* 24900 × 12 = 298800 → "2,988.00". If any layer ever derived an annual figure
       by multiplication, this is the string it would produce. */
    expect(body).not.toContain("2,988");
    expect(body).not.toContain("298800");
  });
});

/* ============================================================================ */
/**
 * WAVE 199'S PLATFORM-WIDE HOOK, GUARDED BY RENDER.
 *
 * WHY THIS BLOCK EXISTS — A DISARM CAME BACK GREEN AND WAS INVESTIGATED.
 *   The wave 202 disarm harness mutated `useMonthlyDisplayAllowed()` to
 *   `return true` — breaking wave 199's fail-closed platform-wide hook — and the
 *   MembershipPage tests above STILL PASSED. That was investigated rather than
 *   accepted. The cause is not a test passing for the wrong reason: MembershipPage
 *   no longer calls that hook (it calls the scope-aware one), so the mutation is
 *   genuinely outside those tests' reach. But it IS still called by three live
 *   surfaces — `client/src/pages/partner/PartnerSubscribe.tsx`,
 *   `client/src/pages/founder/Settings.tsx` and `client/src/pages/founder/Subscribe.tsx`
 *   (twice) — and after wave 202 nothing rendered asserted on it at all. That is a
 *   real gap this wave opened by moving one surface off the hook, and it is closed
 *   here rather than declared.
 *
 * NOT A REPLICA. `Probe` calls the REAL exported hook. Its answer is put in the DOM
 * so the assertion is on rendered output, not on a return value.
 */
function Probe(): JSX.Element {
  const allowed = useMonthlyDisplayAllowed();
  return <span data-testid="probe-monthly">{allowed ? "monthly-allowed" : "monthly-withheld"}</span>;
}

function renderProbe(policy: Payload | null): void {
  routes.clear();
  if (policy !== null) routes.set("/api/price-display-policy", policy);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe("W202 A-8 — wave 199's platform-wide hook is not regressed", () => {
  it("A-8a platform allows monthly → the hook says allowed", async () => {
    renderProbe(policyPayload(true, []));
    await waitFor(() =>
      expect(screen.getByTestId("probe-monthly").textContent).toBe("monthly-allowed"),
    );
  });

  it("A-8b platform withholds monthly → the hook says withheld", async () => {
    renderProbe(policyPayload(false, []));
    await waitFor(() =>
      expect(screen.getByTestId("probe-monthly").textContent).toBe("monthly-withheld"),
    );
  });

  it("A-8c FAIL-CLOSED: no policy at all → withheld, never allowed", async () => {
    renderProbe(null);
    await waitFor(() =>
      expect(screen.getByTestId("probe-monthly").textContent).toBe("monthly-withheld"),
    );
  });
});
