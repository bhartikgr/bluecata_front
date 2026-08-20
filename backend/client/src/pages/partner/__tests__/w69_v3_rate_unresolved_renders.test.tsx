/**
 * WAVE 69 · V-3 (owner ruling R58, row 3) — THE PARTNER 409 REACHES THE DOM, AND
 * THE IMPOSSIBLE ADVICE IS GONE FROM IT.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `commissionPctOrRefuse()` (`server/partnerConsortiumRoutes.ts:144-162`) answers
 * `GET /api/partner/me/billing` with a 409 whose 431-character body names the
 * tier, the exact admin path, the endpoint, and states that nothing has been
 * charged, paid or recorded and no default rate has been assumed.
 *
 * `ReferralCommissionsTab` inspected `error.status === 403` and nothing else, so
 * the 409 fell into the generic branch and the partner read
 *
 *     "Could not load your commission ledger. Please refresh and try again."
 *
 * Refreshing can NEVER fix a missing tier commission rate. It is not transient.
 *
 * ── WHY THE TEST DRIVES THE REAL BOUNDARY ───────────────────────────────────
 * `fetch` is stubbed, not `apiRequest`, so the real `throwIfResNotOk` builds the
 * `ApiError`. That matters here for the same reason as V-1: the 431-character
 * message is ≥ 240 chars, so `queryClient.ts:63` REPLACES `ApiError.message` with
 * "That action conflicts with the current state. Refresh and try again." — the
 * second source of the impossible advice, and the reason the fix must read
 * `payload.message`. `error.code` survives and is what the branch keys on.
 *
 * POLES
 *   A · the 409 renders the server's sentence; "Refresh and try again" is absent.
 *   B · a 500 still renders the ORIGINAL copy, byte-identical (R44: it is true for
 *       a transient failure and was not replaced).
 *   C · a 403 still renders the untouched forbidden branch.
 *   D · a 200 renders the ledger and neither refusal (no silent drop).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerBilling from "../PartnerBilling";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
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
}));

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

/* The real 409 body, shaped exactly as `commissionPctOrRefuse()` emits it. The
   sentence is long ON PURPOSE — it must exceed the 240-character boundary gate,
   which is asserted below rather than assumed. */
const TIER = "gold";
const REFUSAL_MESSAGE =
  `Your commission figures cannot be computed: no commission rate is configured for the "${TIER}" tier. ` +
  `Capavate will not assume a rate, because a commission rate is a payment term and guessing one would ` +
  `create a money figure nobody agreed to. Nothing has been charged, paid or recorded, and no default rate ` +
  `has been assumed. An administrator can set it under Admin \u2192 Fees & Billing \u2192 "Consortium Partner ` +
  `Promotions" \u2192 "Partner commission rates". Until then this ledger cannot be produced.`;

/* The two generic sentences that must NOT appear on the 409. */
const GENERIC_409 = "That action conflicts with the current state. Refresh and try again.";
const OLD_COPY = "Could not load your commission ledger. Please refresh and try again.";

let billingResponse: { status: number; body: unknown } = { status: 200, body: { entries: [] } };

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
      if (u === "/api/partner/me/billing") return res(billingResponse.status, billingResponse.body);
      return res(200, {});
    }),
  );
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerBilling />
    </QueryClientProvider>,
  );
}

describe("WAVE 69 · V-3 — a missing tier commission rate says so, and stops saying \"refresh\"", () => {
  beforeEach(() => {
    billingResponse = { status: 200, body: { entries: [] } };
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE A — the 409 renders the server's own sentence, and the impossible advice is NOT on screen", async () => {
    /* The precondition of the whole wave, measured here: the sentence cannot pass
       the boundary's 240-character gate, so `ApiError.message` cannot carry it. */
    expect(REFUSAL_MESSAGE.length).toBeGreaterThanOrEqual(240);
    billingResponse = {
      status: 409,
      body: { error: "PARTNER_COMMISSION_RATE_UNRESOLVED", tier: TIER, message: REFUSAL_MESSAGE },
    };
    renderPage();

    const node = await screen.findByTestId("partner-billing-rate-unresolved");
    expect(node.getAttribute("role")).toBe("alert");
    expect(node.textContent).toBe(REFUSAL_MESSAGE);
    /* The substance a partner needs, asserted phrase by phrase. */
    expect(node.textContent).toContain("no commission rate is configured for");
    expect(node.textContent).toContain("Partner commission rates");
    expect(node.textContent).toContain("no default rate has been assumed");
    expect(node.textContent).toContain(TIER);
    /* THE ASSERTIONS THAT PROVE THE IMPOSSIBLE ADVICE IS GONE. */
    expect(screen.queryByText(GENERIC_409)).toBeNull();
    expect(screen.queryByText(OLD_COPY)).toBeNull();
    expect(screen.queryByTestId("partner-billing-error")).toBeNull();
    /* Not misrouted into the 403 branch either. */
    expect(screen.queryByTestId("partner-billing-forbidden")).toBeNull();
  });

  it("POLE B — a 500 still renders the ORIGINAL copy, unedited (R44: true for a transient failure)", async () => {
    billingResponse = { status: 500, body: { error: "internal", message: "boom" } };
    renderPage();
    const node = await screen.findByTestId("partner-billing-error");
    expect(node.textContent?.trim()).toBe(OLD_COPY);
    expect(screen.queryByTestId("partner-billing-rate-unresolved")).toBeNull();
  });

  it("POLE C — a 403 still renders the untouched forbidden branch", async () => {
    billingResponse = { status: 403, body: { error: "forbidden", message: "nope" } };
    renderPage();
    await screen.findByTestId("partner-billing-forbidden");
    expect(screen.queryByTestId("partner-billing-error")).toBeNull();
    expect(screen.queryByTestId("partner-billing-rate-unresolved")).toBeNull();
  });

  it("POLE D — a 200 renders the ledger and neither refusal (nothing was dropped)", async () => {
    billingResponse = { status: 200, body: { entries: [] } };
    renderPage();
    await screen.findByTestId("partner-billing-totals");
    expect(screen.queryByTestId("partner-billing-rate-unresolved")).toBeNull();
    expect(screen.queryByTestId("partner-billing-error")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("partner-billing-explainer")).toBeTruthy());
  });
});
