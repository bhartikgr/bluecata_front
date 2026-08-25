/* ════════════════════════════════════════════════════════════════════════════
   WAVE 137 · DEFECT A (A2–A5) — THE ADMIN PRICING CONSOLE QUOTED 100× THE PRICE.
   ════════════════════════════════════════════════════════════════════════════
   `CollectiveSubscriptions.tsx` is rendered inside `AdminFeesConsolidated.tsx`
   (the one pricing console wave 131 told the owner to trust) under the
   `collective-subscriptions` tab, and also at /admin/collective-subscriptions/direct.
   Four of its money renders passed `amountMinor` — TRUE minor units, the same
   integer used at the Airwallex charge boundary — to `fmtUSD`, which formats WHOLE
   units. A $249.00 tier was shown as `$24,900` in the tier picker, the amount
   field, the member preview and the package table.

   These tests RENDER the real page and assert the LITERAL string on screen. They
   never read source text and never assert on an attribute as a proxy for a render.

   FAIL-BEFORE EVIDENCE (captured with `fmtUSD` restored at all four sites):
     POLE 1 → `expected '$24,900 USD/annual' to contain '$249.00'`
     POLE 2 → `expected '$24,900 USD' to be '$249.00 USD'`
     POLE 3 → `expected '$24,900 USD / annual' to contain '$249.00'`
     POLE 4 → the option label contained `$24,900`, not `$249.00`
     POLE 5 → JPY rendered `$25,000` (a dollar sign on a yen price)
   See build_log/wave137/W137_TESTS.md.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import CollectiveSubscriptions from "../CollectiveSubscriptions";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** $249.00 in TRUE minor units — the standard Collective member tier. */
const USD_MINOR = 24_900;
/** ¥25,000 in TRUE minor units. JPY is ISO-4217 exponent 0, so minor === major. */
const JPY_MINOR = 25_000;

function pkg(over: Record<string, unknown> = {}) {
  return {
    id: "csc_1",
    slug: "standard-annual",
    label: "Standard (annual)",
    description: "Standard membership",
    entitlements: ["read"],
    amountMinor: USD_MINOR,
    currency: "USD",
    interval: "annual",
    airwallexTier: "standard",
    airwallexPriceId: "px_standard",
    membershipRole: "member",
    status: "live",
    sortOrder: 0,
    version: 1,
    revisionHash: "h",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

const REFS = [
  {
    tier: "standard",
    priceId: "px_standard",
    amountMinor: USD_MINOR,
    currency: "USD",
    interval: "annual",
    available: true,
  },
];

function mockApi(packages: unknown[], refs: unknown[] = REFS) {
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("airwallex-price-refs")) return jsonResponse({ ok: true, refs });
    if (url.startsWith("/api/admin/collective-subscriptions")) {
      return jsonResponse({ ok: true, packages });
    }
    return jsonResponse({ ok: true });
  });
}

beforeEach(() => {
  apiRequestMock.mockReset();
  mockApi([pkg()]);
});
afterEach(() => cleanup());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <CollectiveSubscriptions />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** Open the create form and select the Airwallex tier, which is the ONLY writer of
 *  `form.amountMinor` on this page (`applyRef`). Returns the amount element. */
async function openFormAndSelectTier(tier = "standard") {
  mount();
  (await screen.findByTestId("button-new-package")).click();
  const select = await screen.findByTestId("select-price-ref");
  await waitFor(() => expect(select.querySelectorAll("option").length).toBeGreaterThan(0));
  fireEvent.change(select, { target: { value: tier } });
  return screen.findByTestId("text-amount");
}

describe("WAVE 137 · DEFECT A — Collective subscription packages render minor units", () => {
  it("POLE 1 — the package table cell renders the LITERAL '$249.00', not '$24,900'", async () => {
    mount();
    const row = await screen.findByTestId("row-package-standard-annual");
    await waitFor(() => expect(row.textContent).toContain("$249.00"));
    expect(row.textContent).not.toContain("$24,900");
    /* The whole cell, exactly as an admin reads it. */
    const priceCell = row.querySelectorAll("td")[3];
    expect(priceCell.textContent).toBe("$249.00 USD/annual");
  });

  it("POLE 2 — the amount field (data-testid=text-amount) renders exactly '$249.00 USD' for what applyRef wrote", async () => {
    /* This is the value `applyRef` puts into `form.amountMinor` — the pre-filled
       default the brief demanded be checked, not a value typed by a human (there
       is no amount input on this page). Selecting the tier is what fires it. */
    const amount = await openFormAndSelectTier();
    await waitFor(() => expect(amount.textContent).toBe("$249.00 USD"));
    expect(amount.textContent).not.toContain("24,900");
  });

  it("POLE 3 — the MEMBER PREVIEW quotes what the member will actually be charged", async () => {
    await openFormAndSelectTier();
    const preview = await screen.findByTestId("card-member-preview");
    await waitFor(() => expect(preview.textContent).toContain("$249.00"));
    expect(preview.textContent).toContain("$249.00 USD / annual");
    expect(preview.textContent).not.toContain("$24,900");
  });

  it("POLE 4 — the Airwallex tier <option> label quotes the tier's real price", async () => {
    mount();
    (await screen.findByTestId("button-new-package")).click();
    const select = await screen.findByTestId("select-price-ref");
    const option = select.querySelector("option") as HTMLOptionElement;
    await waitFor(() => expect(option.textContent).toContain("$249.00"));
    expect(option.textContent).toBe("standard — px_standard ($249.00 USD/annual)");
  });

  it("POLE 5 — a JPY package renders in YEN with exponent 0, not as dollars", async () => {
    /* `fmtUSD` hardcodes USD, so this pole fails twice over before the fix: wrong
       symbol AND wrong exponent. `formatMinor` reads the ISO-4217 exponent, so
       25000 minor JPY is ¥25,000 — minor === major for yen. */
    mockApi([pkg({ id: "csc_2", slug: "jp-annual", amountMinor: JPY_MINOR, currency: "JPY" })]);
    mount();
    const row = await screen.findByTestId("row-package-jp-annual");
    const priceCell = row.querySelectorAll("td")[3];
    await waitFor(() => expect(priceCell.textContent).toBe("¥25,000 JPY/annual"));
    expect(priceCell.textContent).not.toContain("$");
  });

  it("POLE 6 — an unconfigured tier still says so, and no price is invented for it", async () => {
    /* Anti-vacuity: the null branch of the option label must survive the swap. */
    mockApi([pkg()], [
      { tier: "basic", priceId: null, amountMinor: null, currency: null, interval: null, available: false },
    ]);
    mount();
    (await screen.findByTestId("button-new-package")).click();
    const select = await screen.findByTestId("select-price-ref");
    const option = select.querySelector("option") as HTMLOptionElement;
    await waitFor(() => expect(option.textContent).toBe("basic — not configured"));
    expect(option.textContent).not.toContain("$0.00");
  });
});
