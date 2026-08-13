/**
 * WAVE 17 — ORP-039 (DEF-039): the collective member billing surface.
 *
 * ANTI-VACUITY. The three endpoints had zero callers, so the cheap test would be
 * "the card renders". Every assertion here has an opposite pole and the money
 * assertions are chosen so that a hardcoded `/100` FAILS:
 *
 *   1. A JPY line (ISO-4217 exponent 0) must render 12000 minor units as ¥12,000,
 *      not ¥120. That is the one assertion a naive `amountMinor / 100` cannot pass.
 *   2. A USD line renders with cents. Both currencies appear as SEPARATE totals —
 *      a bug that summed across currencies would produce one total and fail.
 *   3. An unpriced line (`resolved: null`, `error: "no_schedule_configured"`)
 *      renders explicit copy and NOT a fabricated zero — asserted both ways.
 *   4. A 409 `tier_unavailable` refusal renders the refusal sentence, and the
 *      priced lines are then absent — the fail-closed pole.
 *   5. Empty entries/invoices render explicit empty copy; populated ones render
 *      rows and per-currency pending/invoiced/paid — opposite poles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemberBillingPanel } from "../MemberBillingPanel";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

let quote: unknown = null;
let quoteStatus = 200;
let entries: unknown = { ok: true, entries: [], byCurrency: {}, total: 0 };
let invoices: unknown = { ok: true, invoices: [], total: 0 };

beforeEach(() => {
  quoteStatus = 200;
  quote = { ok: true, quoteOnly: true, tier: "standard", lines: [], byCurrency: {} };
  entries = { ok: true, entries: [], byCurrency: {}, total: 0 };
  invoices = { ok: true, invoices: [], total: 0 };
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/collective/me/payment-quote") {
      if (quoteStatus >= 400) {
        const { ApiError } = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
        throw new ApiError(quoteStatus, "refused", (quote as { error?: string })?.error ?? null, quote);
      }
      return jsonResponse(200, quote);
    }
    if (url === "/api/collective/me/payment-entries") return jsonResponse(200, entries);
    if (url === "/api/collective/me/invoices") return jsonResponse(200, invoices);
    throw new Error(`unexpected request ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemberBillingPanel />
    </QueryClientProvider>,
  );
}

describe("ORP-039 — collaborator sanity", () => {
  it("actually calls all three previously-uncalled endpoints", async () => {
    renderPanel();
    await waitFor(() => expect(apiRequestMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    const urls = apiRequestMock.mock.calls.map((c) => c[1]);
    expect(urls).toContain("/api/collective/me/payment-quote");
    expect(urls).toContain("/api/collective/me/payment-entries");
    expect(urls).toContain("/api/collective/me/invoices");
  });
});

describe("ORP-039 — the quote, in minor units", () => {
  it("renders a JPY line at exponent 0 and a USD line at exponent 2, totalled per currency", async () => {
    quote = {
      ok: true,
      quoteOnly: true,
      tier: "standard",
      lines: [
        {
          feeKind: "membership_dues",
          resolved: { amountMinor: 12000, currency: "JPY", cadence: "annual", scheduleId: "s1", computedVia: "chapter_override" },
          error: null,
        },
        {
          feeKind: "event_fee",
          resolved: { amountMinor: 2550, currency: "USD", cadence: "per_event", scheduleId: "s2", computedVia: "platform_default" },
          error: null,
        },
      ],
      byCurrency: { JPY: 12000, USD: 2550 },
    };
    renderPanel();

    const jpy = await screen.findByTestId("member-billing-quote-line-membership_dues");
    /* 12000 JPY minor units are 12,000 yen. A hardcoded /100 would print 120. */
    expect(jpy.textContent).toMatch(/12,000/);
    expect(jpy.textContent).not.toMatch(/\b120\b/);

    const usd = screen.getByTestId("member-billing-quote-line-event_fee");
    expect(usd.textContent).toMatch(/25\.50/);

    const totals = screen.getByTestId("member-billing-quote-totals");
    expect(totals.textContent).toMatch(/JPY/);
    expect(totals.textContent).toMatch(/USD/);
    expect(totals.textContent).toMatch(/12,000/);
    expect(totals.textContent).toMatch(/25\.50/);
  });

  it("an unpriced line says so and does NOT fabricate a zero", async () => {
    quote = {
      ok: true,
      quoteOnly: true,
      tier: "standard",
      lines: [{ feeKind: "late_fee", resolved: null, error: "no_schedule_configured" }],
      byCurrency: {},
    };
    renderPanel();
    const line = await screen.findByTestId("member-billing-quote-line-late_fee");
    expect(line.textContent).toMatch(/No fee schedule is configured/i);
    expect(line.textContent).not.toMatch(/\$0/);
    expect(line.textContent).not.toMatch(/0\.00/);
  });

  it("a 409 tier_unavailable renders the refusal and no priced lines (fail-closed pole)", async () => {
    quoteStatus = 409;
    quote = { ok: false, error: "tier_unavailable", message: "Your membership tier could not be determined right now. Please retry shortly." };
    renderPanel();
    const err = await screen.findByTestId("member-billing-quote-error");
    expect(err.textContent).toMatch(/tier could not be determined/i);
    expect(screen.queryByTestId("member-billing-quote-totals")).toBeNull();
  });
});

describe("ORP-039 — entries and invoices", () => {
  it("renders charges with per-currency pending/invoiced/paid", async () => {
    entries = {
      ok: true,
      entries: [
        {
          id: "e1", entryKind: "membership_dues", amountMinor: 15000, currency: "USD", status: "pending",
          invoiceId: null, description: "2026 dues", period: "2026", createdAt: "2026-01-05T00:00:00.000Z", paidAt: null,
        },
        {
          id: "e2", entryKind: "event_fee", amountMinor: 5000, currency: "JPY", status: "paid",
          invoiceId: "inv1", description: null, period: null, createdAt: "2026-02-05T00:00:00.000Z", paidAt: "2026-02-06T00:00:00.000Z",
        },
      ],
      byCurrency: { USD: { pending: 15000, paid: 0, invoiced: 0 }, JPY: { pending: 0, paid: 5000, invoiced: 0 } },
      total: 2,
    };
    renderPanel();
    const e1 = await screen.findByTestId("member-billing-entry-e1");
    expect(e1.textContent).toMatch(/2026 dues/);
    expect(e1.textContent).toMatch(/150\.00/);
    expect(e1.textContent).toMatch(/pending/);
    const e2 = screen.getByTestId("member-billing-entry-e2");
    /* JPY again: 5000 minor units is 5,000 yen, not 50. */
    expect(e2.textContent).toMatch(/5,000/);
    expect(screen.queryByTestId("member-billing-entries-empty")).toBeNull();
    const totals = screen.getByTestId("member-billing-entry-totals");
    expect(totals.textContent).toMatch(/150\.00/);
    expect(totals.textContent).toMatch(/5,000/);
  });

  it("says explicitly when there are no charges and no invoices (opposite pole)", async () => {
    renderPanel();
    expect((await screen.findByTestId("member-billing-entries-empty")).textContent).toMatch(/no charges/i);
    expect(screen.getByTestId("member-billing-invoices-empty").textContent).toMatch(/No invoices/i);
    expect(screen.queryByTestId("member-billing-entry-totals")).toBeNull();
  });

  it("renders invoices with number, status and total", async () => {
    invoices = {
      ok: true,
      invoices: [
        {
          id: "inv1", number: "CI-2026-001", status: "invoiced", totalMinor: 20000, currency: "USD",
          issuedAt: "2026-03-01T00:00:00.000Z", dueAt: "2026-03-31T00:00:00.000Z", paidAt: null,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
        /* A JPY invoice is the assertion a hardcoded /100 cannot pass: 30000
           minor units is ¥30,000, not ¥300. The USD row above would look
           identical under either implementation, which is exactly why this row
           exists — falsification caught the gap and this closes it. */
        {
          id: "inv2", number: "CI-2026-002", status: "paid", totalMinor: 30000, currency: "JPY",
          issuedAt: "2026-04-01T00:00:00.000Z", dueAt: null, paidAt: "2026-04-02T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      total: 2,
    };
    renderPanel();
    const row = await screen.findByTestId("member-billing-invoice-inv1");
    expect(row.textContent).toMatch(/CI-2026-001/);
    expect(row.textContent).toMatch(/200\.00/);
    expect(row.textContent).toMatch(/invoiced/);
    const jpyRow = screen.getByTestId("member-billing-invoice-inv2");
    expect(jpyRow.textContent).toMatch(/30,000/);
    expect(jpyRow.textContent).not.toMatch(/\b300\b/);
    expect(screen.queryByTestId("member-billing-invoices-empty")).toBeNull();
  });
});
