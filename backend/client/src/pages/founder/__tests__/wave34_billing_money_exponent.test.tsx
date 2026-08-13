/**
 * WAVE 34 — the founder BILLING screen's money-exponent sink, EXECUTED.
 *
 * WHY THIS FILE EXISTS. Wave 33C's re-sweep named
 * `client/src/pages/founder/Billing.tsx:77` and `:79` — the page-local
 * `fmtMoney(minor, currency)` handed the subscription's / invoice's real
 * currency to `Intl` as the CODE and then divided by a hardcoded 100, i.e. an
 * assumed ISO 4217 exponent of 2. Line 77 is the Intl path; line 79 is the
 * Intl-throws fallback. For JPY (exponent 0) the founder's own billing screen
 * under-reported every figure by a factor of 100 — a ¥1,200,000 annual plan
 * rendered as ¥12,000, and a ¥1,050,000 invoice as ¥10,500.
 *
 * BOTH POLES, every case. Each assertion pairs a JPY (exponent 0) fixture with
 * its USD (exponent 2) twin carrying the SAME minor amount:
 *   · the JPY pole pins the fixed rendering (1,200,000 minor → ¥1,200,000);
 *   · the USD pole pins that a division still happens at all
 *     (1,200,000 minor → $12,000.00).
 * A mutant restoring `/ 100` fails the JPY pole. A mutant deleting the
 * conversion fails the USD pole. A USD-only fixture — which is what every
 * pre-existing billing test used — passes against the defect AND the fix, and
 * is therefore worthless.
 *
 * Assertions are on what the page RENDERS (the DOM the founder sees), never on
 * what it consults. The file establishes its own preconditions, never reads
 * `process.env`, and imports the page statically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { formatMinor, currencyExponent } from "@/lib/currency";
import billingSource from "../Billing.tsx?raw";

/* ---- the page's data sources, replaced with explicit test-owned fixtures --- */

const COMPANY_ID = "co_w34_billing";

/** The SAME integer minor amounts in both currencies. */
const ANNUAL_MINOR = 1_200_000;
const INVOICE_TOTAL_MINOR = 1_050_000;

let currency = "JPY";

vi.mock("@/lib/entitlement", () => ({
  useEntitlement: () => ({
    data: { founder: { activeCompanyId: COMPANY_ID } },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useLocation: () => ["/founder/billing", vi.fn()] };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import FounderBilling from "../Billing";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.startsWith("/api/founder/subscription")) {
      return jsonResponse({
        ok: true,
        subscription: {
          companyId: COMPANY_ID,
          status: "active",
          plan: "growth_annual",
          annualAmountMinor: ANNUAL_MINOR,
          currency,
          renewsOn: "2027-01-01",
          cardLast4: "4242",
          cardExpiry: "12/30",
          invoicesCount: 1,
        },
      });
    }
    if (url.startsWith("/api/founder/invoices")) {
      return jsonResponse({
        ok: true,
        invoices: [
          {
            id: "inv_w34_1",
            invoiceNumber: "CAP-2026-000001",
            companyId: COMPANY_ID,
            planLabel: "Growth Annual",
            periodStart: "2026-01-01",
            periodEnd: "2026-12-31",
            amountMinor: 1_000_000,
            currency,
            taxMinor: 50_000,
            totalMinor: INVOICE_TOTAL_MINOR,
            status: "paid",
            issuedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        total: 1,
      });
    }
    if (url.startsWith("/api/collective/application-fee")) {
      return jsonResponse({ amountMinor: 0, currency, source: "test" });
    }
    throw new Error(`unexpected request ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderBilling(cur: string) {
  currency = cur;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <FounderBilling />
      </RoleProvider>
    </QueryClientProvider>,
  );
  // Precondition: the plan card actually resolved. Without this the money
  // assertions below could pass vacuously against a loading skeleton.
  await waitFor(() => expect(screen.getByTestId("card-current-plan")).toBeTruthy());
  await waitFor(() =>
    expect(screen.getByTestId("row-invoice-inv_w34_1")).toBeTruthy(),
  );
}

function planCardText(): string {
  return screen.getByTestId("card-current-plan").textContent ?? "";
}

function invoiceRowAmount(): string {
  const row = screen.getByTestId("row-invoice-inv_w34_1");
  const cells = within(row).getAllByRole("cell");
  // column order: number | period | AMOUNT | status | issued | actions
  return cells[2].textContent ?? "";
}

/* ── (F) PRECONDITIONS ───────────────────────────────────────────────────── */

describe("F — preconditions", () => {
  it("F1 JPY is exponent 0 and USD is exponent 2 in the client's table", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
  });

  it("F2 the shared client helper is the reference answer at both poles", () => {
    expect(formatMinor(ANNUAL_MINOR, "JPY", { locale: "en-US" })).toBe("¥1,200,000");
    expect(formatMinor(ANNUAL_MINOR, "USD", { locale: "en-US" })).toBe("$12,000.00");
  });
});

/* ── (B) THE PLAN CARD ───────────────────────────────────────────────────── */

describe("B — the current-plan price", () => {
  it("B1 JPY: 1,200,000 minor units RENDER as ¥1,200,000, not ¥12,000", async () => {
    await renderBilling("JPY");
    const text = planCardText();
    expect(text).toContain("¥1,200,000");
    // The defect's answer must be absent, not merely un-asserted.
    expect(text).not.toContain("¥12,000.00");
  });

  it("B2 USD: the SAME minor amount RENDERS as $12,000.00", async () => {
    await renderBilling("USD");
    const text = planCardText();
    expect(text).toContain("$12,000.00");
    // A deleted conversion would render $1,200,000.00.
    expect(text).not.toContain("$1,200,000.00");
  });
});

/* ── (I) THE INVOICE TABLE ───────────────────────────────────────────────── */

describe("I — the invoice table amount column", () => {
  it("I1 JPY: a ¥1,050,000 invoice RENDERS as ¥1,050,000, not ¥10,500", async () => {
    await renderBilling("JPY");
    const amount = invoiceRowAmount();
    expect(amount).toBe("¥1,050,000");
    expect(amount).not.toContain("¥10,500.00");
  });

  it("I2 USD: the SAME minor amount RENDERS as $10,500.00", async () => {
    await renderBilling("USD");
    expect(invoiceRowAmount()).toBe("$10,500.00");
  });

  it("I3 KRW proves the exponent is table-driven, not a JPY special case", async () => {
    expect(currencyExponent("KRW")).toBe(0);
    await renderBilling("KRW");
    expect(invoiceRowAmount()).toBe("₩1,050,000");
  });
});

/* ── (S) THE SOURCE NO LONGER HOLDS A HARDCODED EXPONENT ─────────────────── */

describe("S — the two sites are gone from the source", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  /* Read via a static `?raw` import so this group cannot silently pass on a
   * path that does not exist — a wrong path is a build-time failure, not an
   * empty string that satisfies every `not.toMatch`. */

  it("S0 the comment stripper actually strips, and still sees code", () => {
    expect(strip("/* minor / 100 */\nconst a = 1;")).not.toMatch(/minor \/ 100/);
    expect(strip("// minor / 100\nconst a = 1;")).not.toMatch(/minor \/ 100/);
    expect(strip("/* c */ const a = minor / 100;")).toMatch(/minor \/ 100/);
  });

  it("S1 Billing.tsx performs no hardcoded /100 in live code and delegates to formatMinor", () => {
    const src = strip(billingSource);
    expect(src.length).toBeGreaterThan(1000); // the import actually returned the page
    expect(src).not.toMatch(/minor \/ 100/);
    expect(src).not.toMatch(/\/ 100\b/);
    expect(src).toMatch(/import \{[^}]*formatMinor[^}]*\} from "@\/lib\/currency"/);
    expect(src).toMatch(/return formatMinor\(minor, currency, \{ locale: "en-US" \}\)/);
  });
});
