/**
 * WAVE 73 · ITEM 2 — THE PARTNER SUBSCRIPTION CURRENCY IS READ FROM THE
 * DATABASE, AND AN ABSENT ONE IS REFUSED RATHER THAN GUESSED.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, quoted from the tree as it was:
 *
 *   client/src/pages/admin/AdminPartnerBillingOps.tsx:555  formatMinor(r.listAmountMinor, "USD")
 *   client/src/pages/admin/AdminPartnerBillingOps.tsx:560  formatMinorOrUnavailable(r.discountMinor, "USD")
 *   client/src/pages/admin/AdminPartnerBillingOps.tsx:561  formatMinor(r.amountMinor, "USD")
 *
 * `partner_subscription.currency` is `TEXT NOT NULL`
 * (`migrations/0169_wave13_partner_subscription_shape_reconcile.sql:117`) and is
 * populated — but `server/lib/wave14MoneyRoutes.ts` never SELECTed it, so the
 * screen had nothing to render and hard-coded the symbol. A partner billed in
 * anything other than USD had their money printed in the wrong denomination on the
 * admin ops screen. A wrong currency symbol on a money figure is a money defect,
 * and the standing rule is that everything is db-driven.
 *
 * BOTH POLES, read out of the DOM:
 *   DB-DRIVEN pole — a row stored in EUR renders in EUR (and not in USD).
 *   REFUSAL pole   — a row whose currency is absent renders the platform's own
 *                    em-dash for the money cells. It does NOT fall back to USD,
 *                    and it does not print a bare number with no denomination.
 *                    The row, its partner name, its tier and its container all
 *                    stay on screen: the refusal replaces the VALUE, not the row.
 *
 * MUTATION TRANSCRIPT: build_log/wave73/W73_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import AdminPartnerBillingOps from "../AdminPartnerBillingOps";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

/** One live subscription row, shaped exactly as the reconcile route returns it. */
function liveRow(currency: string | null) {
  return {
    id: "sub_w73",
    partnerId: "ac_partner_w73",
    partnerName: "Nordwind Partners GmbH",
    tierSlug: "gold",
    cycle: "annual",
    status: "active",
    amountMinor: 900_000,
    listAmountMinor: 1_000_000,
    discountMinor: 100_000,
    priceDerivation: "authored_price",
    currency,
  };
}

function wire(currency: string | null) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/roster-reconcile$/.test(url)) {
      return jsonResponse({
        ok: true,
        liveCount: 1,
        live: [liveRow(currency)],
        findings: [],
        reconciled: true,
        coverage: { total: 2, priced: 2, unpriced: 0 },
      });
    }
    return jsonResponse({ ok: true });
  });
}

function renderReconcileTab(currency: string | null) {
  wire(currency);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <AdminPartnerBillingOps />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
  return utils;
}

afterEach(() => { cleanup(); apiRequestMock.mockReset(); });

describe("WAVE 73 · ITEM 2 — the admin ops screen prints the stored currency, not a hardcoded USD", () => {
  it("DB-DRIVEN POLE — a subscription stored in EUR renders in EUR, and no dollar sign appears on the row", async () => {
    const { getByTestId } = renderReconcileTab("EUR");
    /* The Reconcile tab is not the default tab, so it is opened the way an admin
       opens it. */
    (await screen.findByTestId("tab-ops-reconcile")).click();

    const row = await waitFor(() => getByTestId("admin-live-subscription-sub_w73"));
    const text = row.textContent ?? "";
    /* THE STRINGS THAT MUST REACH THE DOM. `formatMinor` is ISO-4217 aware, so
       EUR at exponent 2 gives these three figures. */
    expect(text).toMatch(/€|EUR/);
    expect(text).toContain("10,000");   /* list    1_000_000 minor */
    expect(text).toContain("9,000");    /* charged   900_000 minor */
    /* THE STRING THAT MUST NOT: the hardcoded denomination. */
    expect(text).not.toContain("$");
    expect(text).not.toContain("USD");
    /* NO SILENT DROP — the row and its context are intact. */
    expect(text).toContain("Nordwind Partners GmbH");
    expect(text).toContain("gold");
  });

  it("REFUSAL POLE — a row with NO stored currency refuses with a dash and does NOT default to USD", async () => {
    const { getByTestId } = renderReconcileTab(null);
    (await screen.findByTestId("tab-ops-reconcile")).click();

    const row = await waitFor(() => getByTestId("admin-live-subscription-sub_w73"));
    const text = row.textContent ?? "";
    /* The honest output: no denomination known, so no money figure is asserted. */
    expect(text).toContain("—");
    expect(text).not.toContain("$");
    expect(text).not.toContain("USD");
    /* And specifically NOT the numbers with no currency attached, which would be
       a money figure whose denomination the reader has to guess. */
    expect(text).not.toContain("10,000.00");
    expect(text).not.toContain("9,000.00");
    /* The row itself is still there — the refusal replaced the VALUE only. */
    expect(text).toContain("Nordwind Partners GmbH");
    expect(text).toContain("gold");
    expect(text).toContain("authored_price");
  });

  it("SOURCE — the server SELECTs the column, and the client no longer hardcodes USD on these three cells", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const repo = path.resolve(__dirname, "..", "..", "..", "..", "..");
    const route = fs.readFileSync(path.join(repo, "server/lib/wave14MoneyRoutes.ts"), "utf8");
    expect(route).toContain("s.currency AS currency");
    const page = fs
      .readFileSync(path.join(repo, "client/src/pages/admin/AdminPartnerBillingOps.tsx"), "utf8")
      /* Comments stripped: the fix's comment quotes the hardcode it removed, and
         that quotation is the record of what the screen used to print. */
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(page).not.toContain('formatMinor(r.listAmountMinor, "USD")');
    expect(page).not.toContain('formatMinorOrUnavailable(r.discountMinor, "USD")');
    expect(page).not.toContain('formatMinor(r.amountMinor, "USD")');
    expect((page.match(/r\.currency/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
