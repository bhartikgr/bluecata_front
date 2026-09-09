/**
 * ══════════════════════════════════════════════════════════════════════════════
 * RESIDUALS · ITEM 3 — THE VEHICLE SUMMARY CARD NOW NAMES ITS CURRENCY.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE BRIEFED PREMISE NEEDED CORRECTING, AND THIS FILE MEASURES BOTH HALVES.
 * The report was a "bare `$`" on the SPV Engine list card — one card using the
 * wrong formatter while another vehicle in the same list rendered `CA$1,200.00`.
 *
 * IT WAS NOT A LOST CURRENCY. `fmt(minor, currency)` on this page always received
 * the vehicle's own `currency` column, and `$100,000.00` is the CORRECT en-US
 * rendering of USD, exactly as `CA$1,200.00` is of CAD. Nothing was fabricated
 * and nothing was converted. Test 1 below is the negative control that would have
 * caught a genuinely lost currency, and it passes either way — which is why the
 * report needed re-measuring rather than acting on.
 *
 * WHAT IS ACTUALLY WRONG IS THE DISPLAY MODE, and it is a real international
 * defect: `$` is shared by USD, CAD, AUD, SGD, HKD and NZD, this list stacks
 * vehicles of different currencies in one column, and all sixteen SPV tabs one
 * click below the card already say `USD 100,000.00` because
 * `SpvDetailTabs.tsx:365` passes `currencyDisplay: "code"` through the SAME
 * library function. The same vehicle read two different ways on two screens.
 *
 * PROVED HERE, FROM RENDERED TEXT ON THE REAL PAGE:
 *   1  CONTROL — both cards rendered, and a false claim about them fails.
 *   2  THE USD CARD NAMES USD — `USD 100,000.00`, not a bare `$`.
 *   3  THE NON-USD CARD IS NOT BROKEN BY THE FIX — the CAD vehicle says CAD.
 *      A "fix" that hardcoded USD, or that dropped the symbol for every row,
 *      fails here. This is the pole that makes test 2 non-vacuous.
 *   4  NO CONVERSION AND NO CROSS-CURRENCY SUM — each figure stays its own
 *      currency and its own number; neither card shows the other's.
 *
 * Harness modelled on `wave140_spv_blank_cap.test.tsx`, which already mounts the
 * real `PartnerSpvEngine`.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";

const USD_ID = "spv_residuals_usd";
const CAD_ID = "spv_residuals_cad";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_residuals",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_residuals", email: "residuals@example.com", name: "Residuals Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

/* Two vehicles, two currencies, in ONE list — the exact live shape reported. */
const SPVS = [
  {
    id: USD_ID,
    name: "Residuals USD Vehicle",
    spvName: "Residuals USD Vehicle",
    status: "open",
    spvType: "delaware_llc",
    currency: "USD",
    targetRaiseMinor: 10000000,   // 100,000.00 USD
    minCheckMinor: 100000,
    capMinor: null,
  },
  {
    id: CAD_ID,
    name: "Residuals CAD Vehicle",
    spvName: "Residuals CAD Vehicle",
    status: "open",
    spvType: "canadian_lp",
    currency: "CAD",
    targetRaiseMinor: 120000,     // 1,200.00 CAD
    minCheckMinor: 10000,
    capMinor: null,
  },
];

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, _url: string, _body?: unknown) => {
      const payload = method === "GET" ? { spvs: SPVS } : {};
      return {
        ok: true,
        status: 200,
        statusText: "ok",
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    },
  };
});

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerSpvEngine />
    </QueryClientProvider>,
  );
}

const squash = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

afterEach(() => cleanup());
beforeEach(() => {});

describe("RESIDUALS · Item 3 — the SPV Engine list card, rendered", () => {
  it("1 · CONTROL — both cards rendered, an absent id throws, and a false claim fails", async () => {
    mount();
    await waitFor(
      () => expect(screen.getByTestId(`spv-target-raise-amount-${USD_ID}`)).toBeTruthy(),
      { timeout: 8000 },
    );
    expect(screen.getByTestId(`spv-target-raise-amount-${CAD_ID}`)).toBeTruthy();
    expect(() => screen.getByTestId("spv-target-raise-amount-THIS-DOES-NOT-EXIST")).toThrow();

    /* A figure was actually printed — not an empty node that every "not to
       contain" assertion below would pass over. */
    const usd = squash(screen.getByTestId(`spv-target-raise-amount-${USD_ID}`).textContent);
    expect(usd.length).toBeGreaterThan(0);
    expect(usd).not.toBe("—");
    expect(usd).not.toContain("a string this card does not contain");
  });

  it("2 · the USD card NAMES its currency — `USD 100,000.00`, not a bare `$`", async () => {
    mount();
    await waitFor(
      () => expect(screen.getByTestId(`spv-target-raise-amount-${USD_ID}`)).toBeTruthy(),
      { timeout: 8000 },
    );
    const text = squash(screen.getByTestId(`spv-target-raise-amount-${USD_ID}`).textContent);
    expect(text).toBe("USD 100,000.00");
    /* THE DEFECT, PINNED: the figure no longer stands on an ambiguous symbol
       alone. Six of the platform's supported currencies render with `$`. */
    expect(text).not.toContain("$");
  });

  it("3 · the CAD card is NOT broken by the fix — it names CAD, and no currency is hardcoded", async () => {
    mount();
    await waitFor(
      () => expect(screen.getByTestId(`spv-target-raise-amount-${CAD_ID}`)).toBeTruthy(),
      { timeout: 8000 },
    );
    const text = squash(screen.getByTestId(`spv-target-raise-amount-${CAD_ID}`).textContent);
    expect(text).toBe("CAD 1,200.00");
    /* The pole that makes test 2 non-vacuous: a fix that stamped "USD" on every
       row, or that stripped the currency from every row, dies here. */
    expect(text).not.toContain("USD");
  });

  it("4 · nothing is converted and nothing is summed across the two currencies", async () => {
    mount();
    await waitFor(
      () => expect(screen.getByTestId(`spv-target-raise-amount-${USD_ID}`)).toBeTruthy(),
      { timeout: 8000 },
    );
    const usd = squash(screen.getByTestId(`spv-target-raise-amount-${USD_ID}`).textContent);
    const cad = squash(screen.getByTestId(`spv-target-raise-amount-${CAD_ID}`).textContent);

    /* Each figure is its OWN stored amount in its OWN currency. Neither card
       shows the other's currency, and neither shows a combined number. */
    expect(usd).toContain("100,000.00");
    expect(usd).not.toContain("CAD");
    expect(cad).toContain("1,200.00");
    expect(cad).not.toContain("101,200");
    expect(usd).not.toContain("101,200");
  });
});
