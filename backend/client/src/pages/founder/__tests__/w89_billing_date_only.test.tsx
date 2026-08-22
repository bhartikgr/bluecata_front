/**
 * WAVE 89 — the FOUNDER'S OWN BILLING DATES, pinned in three timezones.
 *
 * WHY THIS FILE EXISTS. `client/src/pages/founder/Billing.tsx` is a SACRED file
 * and it rendered four DATE-ONLY values through `new Date(iso).toLocaleDateString()`
 * (its local `fmtDate` at :90-93). `subscriptions.renews_on` is a TEXT column
 * (migrations/0000_numerous_roxanne_simpson.sql:281, shared/schema.ts:551) written
 * as `.toISOString().slice(0, 10)` (server/subscriptionsStore.ts:274, :637) and
 * seeded as `"2026-06-15"` (:254). `new Date("2026-06-15")` is DEFINED by the
 * language to be UTC midnight, so localising it in New York (UTC-4/-5) printed
 * **6/14/2026** — one day EARLY — on the four sentences a paying customer acts on:
 *
 *   :284  "Your subscription will remain active until <DATE>, then cancel."
 *   :411  toast: "Active until <DATE>. Resume any time."
 *   :454  "Subscription cancels on <DATE>."
 *   :500  "Renews on: <DATE>"  /  "Cancels on: <DATE>"
 *
 * Fixed under WAIVER-10 (owner ruling R79) by routing those four sites — and ONLY
 * those four — through `fmtLocaleDate` from `@/lib/format`, which rebuilds a
 * `YYYY-MM-DD` value at LOCAL midnight and hands anything carrying a time to
 * `Date` unchanged.
 *
 * THE LOAD-BEARING PART OF THIS FILE IS THAT IT FAILS WHERE THE BUG LIVED.
 * A UTC-only suite cannot see this defect: in UTC the old and new renderings are
 * byte-identical. So `P1` asserts the DIRECTION of the difference — the defect's
 * rendering must DIFFER from the correct one west of UTC and AGREE elsewhere —
 * and the file is run under TZ=America/New_York, TZ=UTC and TZ=Pacific/Auckland.
 *
 * AND IT PINS THE OTHER HALF: a TIMESTAMP must keep localising. `paymentDate`
 * comes from `payment_ledger.ts` (server/paymentGatewayAdapter.ts:1535) and
 * `issuedAt` from `nowIso()`; both are INSTANTS, both still go through the file's
 * local `fmtDate`, and `T2` fails if a future wave "fixes" them too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { fmtLocaleDate } from "@/lib/format";
import billingSource from "../Billing.tsx?raw";

/* ---------- the calendar day, and the two renderings of it ---------------- */

const COMPANY_ID = "co_w89_billing";
/** The value as it is STORED: a date-only string, exactly as the seed writes it. */
const RENEWS_ON = "2026-06-15";
/** What the customer must read: the calendar day they were told, at local midnight. */
const EXPECTED = new Date(2026, 5, 15).toLocaleDateString();
/** What the DEFECT rendered: UTC midnight, localised. */
const SHIFTED = new Date(RENEWS_ON).toLocaleDateString();
/** True in New York and Los Angeles; false in UTC, London, Tokyo and Auckland. */
const WEST_OF_UTC = new Date(RENEWS_ON).getTimezoneOffset() > 0;

/** A genuine INSTANT — 02:30 UTC, which is the PREVIOUS day in New York. */
const PAYMENT_TS = "2026-06-15T02:30:00.000Z";
const PAYMENT_LOCALISED = new Date(PAYMENT_TS).toLocaleDateString();

let status: "active" | "cancel_at_period_end" = "active";

/* ---------- the page's data sources, replaced with test-owned fixtures ---- */

vi.mock("@/lib/entitlement", () => ({
  useEntitlement: () => ({
    data: { founder: { activeCompanyId: COMPANY_ID } },
    isLoading: false,
  }),
}));

const toastCalls: Array<{ title?: string; description?: string }> = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: (arg: { title?: string; description?: string }) => {
      toastCalls.push(arg);
    },
  }),
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
  toastCalls.length = 0;
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (url.startsWith("/api/founder/subscription")) {
      if (method === "PATCH") return jsonResponse({ ok: true });
      return jsonResponse({
        ok: true,
        subscription: {
          companyId: COMPANY_ID,
          status,
          plan: "founder_pro",
          annualAmountMinor: 120_000,
          currency: "USD",
          renewsOn: RENEWS_ON,
          paymentDate: PAYMENT_TS,
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
            id: "inv_w89_1",
            invoiceNumber: "CAP-2026-000089",
            companyId: COMPANY_ID,
            planLabel: "Founder Pro",
            periodStart: "2026-01-01",
            periodEnd: "2026-12-31",
            amountMinor: 120_000,
            currency: "USD",
            taxMinor: 0,
            totalMinor: 120_000,
            status: "paid",
            issuedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        total: 1,
      });
    }
    if (url.startsWith("/api/collective/application-fee")) {
      return jsonResponse({ amountMinor: 0, currency: "USD", source: "test" });
    }
    throw new Error(`unexpected request ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderBilling(s: "active" | "cancel_at_period_end"): Promise<void> {
  status = s;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <FounderBilling />
      </RoleProvider>
    </QueryClientProvider>,
  );
  /* Precondition: the plan card really RESOLVED. Asserting on the card element
     alone passes while the skeleton is still up, which would let every date
     assertion below succeed vacuously. */
  await waitFor(() => expect(screen.getByTestId("card-current-plan")).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId("sub-payment-date")).toBeTruthy());
}

const planCardText = (): string => screen.getByTestId("card-current-plan").textContent ?? "";
const pageText = (): string => document.body.textContent ?? "";

/* ── P — PRECONDITIONS: this test can SEE the defect where the defect was ── */

describe("W89 P — preconditions", () => {
  it("P1 the defect's rendering DIFFERS from the correct one west of UTC and AGREES elsewhere", () => {
    if (WEST_OF_UTC) {
      expect(
        SHIFTED,
        `TZ=${process.env.TZ ?? "(unset)"} is west of UTC, so new Date("${RENEWS_ON}")` +
          ".toLocaleDateString() MUST differ from the calendar day — otherwise this " +
          "test cannot fail on the defect it exists to catch.",
      ).not.toBe(EXPECTED);
    } else {
      expect(
        SHIFTED,
        `TZ=${process.env.TZ ?? "(unset)"} is at or east of UTC, so the two renderings ` +
          "must agree — this is exactly why a UTC-only suite kept four waves green.",
      ).toBe(EXPECTED);
    }
  });

  it("P2 the SAFE formatter is the one imported from @/lib/format, not a local shadow", () => {
    expect(fmtLocaleDate(RENEWS_ON)).toBe(EXPECTED);
    /* And it does NOT freeze an instant: a timestamp keeps localising. */
    expect(fmtLocaleDate(PAYMENT_TS)).toBe(PAYMENT_LOCALISED);
  });
});

/* ── R — THE FOUR RENDERED SITES ─────────────────────────────────────────── */

describe("W89 R — the four date-only sites render the calendar day the customer was given", () => {
  it("R1 (:500) the plan card's \"Renews on\" shows 15 June, not 14 June", async () => {
    await renderBilling("active");
    expect(planCardText()).toContain("Renews on");
    /* Scoped to the renewal LINE. The card also carries "Last payment", which is
       an instant and may legitimately localise to the 14th in New York (T1), so a
       card-wide negative would forbid the correct behaviour of the other pole. */
    const line = screen.getByText(/Renews on:/i).textContent ?? "";
    expect(line).toContain(EXPECTED);
    if (WEST_OF_UTC) expect(line).not.toContain(SHIFTED);
  });

  it("R2 (:454 + :500) the cancellation banner and the card agree on the cancel day", async () => {
    await renderBilling("cancel_at_period_end");
    await waitFor(() => expect(screen.getByTestId("button-resume-subscription-banner")).toBeTruthy());
    const page = pageText();
    expect(page).toContain("Subscription cancels on");
    expect(page).toContain(EXPECTED);
    expect(planCardText()).toContain("Cancels on");
    expect(planCardText()).toContain(EXPECTED);
    /* Scoped to the BANNER: elsewhere on the page "6/14/2026" is a legitimate
       rendering — `paymentDate` is an instant at 02:30 UTC, which really is the
       14th in New York (see T1). A page-wide negative would forbid the correct
       behaviour of the other pole. */
    const banner = screen.getByText(/Subscription cancels on/i).textContent ?? "";
    expect(banner).toContain(EXPECTED);
    if (WEST_OF_UTC) expect(banner).not.toContain(SHIFTED);
  });

  it("R3 (:284) the cancel dialog's \"remain active until\" shows 15 June", async () => {
    await renderBilling("active");
    fireEvent.click(screen.getByTestId("button-cancel-subscription"));
    await waitFor(() => expect(screen.getByTestId("button-confirm-cancel")).toBeTruthy());
    const dialog = await screen.findByText(/remain active until/i);
    const sentence = dialog.textContent ?? "";
    expect(sentence).toContain(EXPECTED);
    expect(sentence).toContain("then cancel");
    if (WEST_OF_UTC) expect(sentence).not.toContain(SHIFTED);
  });

  it("R4 (:411) the \"Active until …\" toast shows 15 June", async () => {
    await renderBilling("active");
    fireEvent.click(screen.getByTestId("button-cancel-subscription"));
    await waitFor(() => expect(screen.getByTestId("button-confirm-cancel")).toBeTruthy());
    const boxes = screen
      .getByTestId("checkbox-confirm-cancel-1")
      .querySelectorAll("input[type=checkbox]");
    fireEvent.click(boxes[0] as HTMLInputElement);
    const boxes2 = screen
      .getByTestId("checkbox-confirm-cancel-2")
      .querySelectorAll("input[type=checkbox]");
    fireEvent.click(boxes2[0] as HTMLInputElement);
    fireEvent.click(screen.getByTestId("button-confirm-cancel"));
    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0));
    const cancelToast = toastCalls.find((t) => t.title === "Subscription set to cancel");
    expect(cancelToast, `toasts seen: ${JSON.stringify(toastCalls)}`).toBeTruthy();
    expect((cancelToast as { description?: string }).description).toBe(
      `Active until ${EXPECTED}. Resume any time.`,
    );
  });
});

/* ── T — THE OTHER POLE: A TIMESTAMP MUST KEEP LOCALISING ────────────────── */

describe("W89 T — instants are NOT frozen (the over-correction pole)", () => {
  it("T1 \"Last payment\" localises a real timestamp, so it may legitimately read 14 June", async () => {
    await renderBilling("active");
    const line = screen.getByTestId("sub-payment-date").textContent ?? "";
    expect(line).toContain("Last payment");
    expect(
      line,
      "paymentDate is payment_ledger.ts — an INSTANT. Localising an instant is " +
        "correct and is NOT in WAIVER-10's scope.",
    ).toContain(PAYMENT_LOCALISED);
  });

  it("T2 the file still uses its local fmtDate for the two timestamp sites", () => {
    expect(billingSource).toMatch(/fmtDate\(sub\.paymentDate\)/);
    expect(billingSource).toMatch(/fmtDate\(inv\.issuedAt\)/);
  });
});

/* ── S — THE SOURCE PIN, which is what makes this MUTATION-DETECTABLE ────── */

describe("W89 S — all four sites, pinned in the source", () => {
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("S1 the safe formatter is IMPORTED from @/lib/format (not shadowed in-file)", () => {
    expect(billingSource).toMatch(
      /import\s*\{[^}]*\bfmtLocaleDate\b[^}]*\}\s*from\s*["']@\/lib\/format["']/,
    );
    /* The local helper is NOT named fmtLocaleDate — a shadow would silently
       re-introduce the shift while every grep above still passed. */
    expect(strip(billingSource)).not.toMatch(/function\s+fmtLocaleDate\s*\(/);
  });

  it("S2 EXACTLY FOUR call sites use it, and every one of them is a renewsOn site", () => {
    const body = strip(billingSource);
    const calls = Array.from(body.matchAll(/fmtLocaleDate\(([^)]*)\)/g), (m) => m[1].trim());
    expect(calls.length, `fmtLocaleDate call sites found: ${JSON.stringify(calls)}`).toBe(4);
    for (const arg of calls) expect(arg).toMatch(/renewsOn/);
  });

  it("S3 NO renewsOn value reaches the unsafe local fmtDate any more", () => {
    const body = strip(billingSource);
    expect(body).not.toMatch(/[^a-zA-Z]fmtDate\([^)]*renewsOn/);
  });
});
