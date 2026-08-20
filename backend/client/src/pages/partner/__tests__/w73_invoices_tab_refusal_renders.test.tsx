/**
 * WAVE 73 · ITEM 3 (finishes WAVE 69 · V-3) — THE `Invoices` TAB STOPS SAYING
 * THE LEDGER IS EMPTY WHEN THE SERVER REFUSED TO COMPUTE IT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Wave 69 treated ONE of the eight partner billing tabs (Referral Commissions).
 * On `Invoices` the same 409 from `commissionPctOrRefuse()`
 * (`server/partnerConsortiumRoutes.ts:144-162`) produced
 *
 *     "No invoice line items yet"
 *
 * which is a FALSE STATEMENT, not merely a useless one: there are no rows because
 * the read was refused, not because none exist. A partner reading it concludes
 * they have earned nothing.
 *
 * POLES
 *   A · the 409 renders the server's sentence and the false empty state is GONE.
 *   B · a genuine empty ledger (200, no entries) still renders the empty state,
 *       word for word — the copy was narrowed, not replaced (R44).
 *   C · a 200 with rows renders the rows and neither message (no silent drop).
 *
 * `fetch` is stubbed, not `apiRequest`, so the real `throwIfResNotOk` and its
 * 240-character gate are in the path — the same reason Wave 69 gave.
 *
 * MUTATION TRANSCRIPT: build_log/wave73/W73_TESTS.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerBilling from "../PartnerBilling";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_w73",
      tier: "gold",
      subRole: "managing_partner",
      identity: { userId: "u_w73", email: "partner@example.com", name: "W73 Partner" },
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

const TIER = "gold";
const REFUSAL_MESSAGE =
  `Your commission figures cannot be computed: no commission rate is configured for the "${TIER}" tier. ` +
  `Capavate will not assume a rate, because a commission rate is a payment term and guessing one would ` +
  `create a money figure nobody agreed to. Nothing has been charged, paid or recorded, and no default rate ` +
  `has been assumed. An administrator can set it under Admin \u2192 Fees & Billing \u2192 "Consortium Partner ` +
  `Promotions" \u2192 "Partner commission rates". Until then this ledger cannot be produced.`;

const FALSE_EMPTY = "No invoice line items yet";
const GENERIC_409 = "That action conflicts with the current state. Refresh and try again.";

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
      if (u === "/api/partner/me/spv-fees") return res(200, { entries: [] });
      return res(200, {});
    }),
  );
}

function renderInvoicesTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <PartnerBilling />
    </QueryClientProvider>,
  );
  return utils;
}

async function openInvoices() {
  const tab = await screen.findByTestId("tab-invoices");
  fireEvent.click(tab);
}

beforeEach(() => {
  billingResponse = { status: 200, body: { entries: [] } };
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WAVE 73 · ITEM 3 — the Invoices tab tells the truth about a refused ledger", () => {
  it("POLE A — the 409 renders the server's sentence and the false empty state is absent", async () => {
    expect(REFUSAL_MESSAGE.length).toBeGreaterThanOrEqual(240);
    billingResponse = {
      status: 409,
      body: { error: "PARTNER_COMMISSION_RATE_UNRESOLVED", tier: TIER, message: REFUSAL_MESSAGE },
    };
    renderInvoicesTab();
    await openInvoices();

    const node = await screen.findByTestId("partner-invoices-rate-unresolved");
    expect(node.getAttribute("role")).toBe("alert");
    expect(node.textContent).toBe(REFUSAL_MESSAGE);
    expect(node.textContent ?? "").toContain("no default rate has been assumed");

    /* THE FALSE STATEMENT MUST BE GONE. */
    expect(screen.queryByText(FALSE_EMPTY)).toBeNull();
    /* And the boundary's generic substitute must not be what the partner reads. */
    expect(document.body.textContent ?? "").not.toContain(GENERIC_409);
  });

  it("POLE B — a genuinely empty ledger still renders the empty state, word for word", async () => {
    billingResponse = { status: 200, body: { entries: [] } };
    renderInvoicesTab();
    await openInvoices();
    await waitFor(() => expect(screen.getByText(FALSE_EMPTY)).toBeTruthy());
    expect(screen.queryByTestId("partner-invoices-rate-unresolved")).toBeNull();
  });

  it("POLE C — rows render and neither message appears", async () => {
    billingResponse = {
      status: 200,
      body: {
        entries: [
          { id: "ent_1", date: "2026-07-01", dealId: "deal_1", commissionMinor: 250_000, currency: "USD", status: "pending" },
        ],
      },
    };
    renderInvoicesTab();
    await openInvoices();
    await waitFor(() => expect(screen.getByTestId("partner-invoices-row-ent_1")).toBeTruthy());
    expect(screen.queryByTestId("partner-invoices-rate-unresolved")).toBeNull();
    expect(screen.queryByText(FALSE_EMPTY)).toBeNull();
  });
});
