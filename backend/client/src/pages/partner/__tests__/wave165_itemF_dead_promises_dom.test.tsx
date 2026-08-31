/**
 * WAVE 165 · ITEM F + PART 3 — RENDERED DOM FOR THE DEAD PROMISES.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, IN THREE PLACES A PARTNER ACTUALLY LOOKS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * 1. MONTHLY BILLING was offered by three controls on the Subscription tab while
 *    `POST /api/partner/me/subscribe` refused it with `409
 *    CYCLE_NOT_PURCHASABLE`. R135.5: *"LABEL, do not remove."*
 * 2. THE FEE SCHEDULE advertised the SPV deployment fee as a "one-off" and never
 *    said what triggers it. A partner launched an SPV, was invoiced nothing, and
 *    had no way to tell a pending charge from a bug. R133.2 keeps the trigger
 *    (marked Deployed) and requires the platform to SAY so.
 * 3. FOUR PRIVATE SPELLINGS OF "absent" ("Period not recorded", "Source not
 *    recorded", a raw resolver enum, "unresolved") reached partners on one table
 *    row. R77 / R111 Q13 fix one spelling: "Not on record".
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * · §1 asserts the three monthly controls are STILL PRESENT before asserting they
 *   are labelled. R135.5's failure mode is deletion, so a test that only checked
 *   for the warning would pass on a build that removed the controls entirely —
 *   the exact outcome the ruling forbids.
 * · §2 flips the SERVER'S answer and proves the label follows it in both
 *   directions. A hard-coded sentence would pass a one-directional test and then
 *   lie the day monthly goes on sale.
 * · §3 asserts the raw resolver code `FEE_SCHEDULE_NO_ROW_FOR_TIER` is ABSENT
 *   from the rendered output while the humanised words are present — proving the
 *   information survived rather than the row going silent.
 * · §4 asserts no rendered cell contains "$0.00" for a value the fixture left
 *   null, and that the string "not recorded" appears nowhere on the tab.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerBilling from "../PartnerBilling";
/* WAVE 207 · ITEM A — the corrected basis sentence, from the constant the page renders. */
import { W207_VEHICLE_FEE_WHEN } from "@shared/wave207FeeBasisDimension";

/* The raw code the resolver emits. Asserted ABSENT from the DOM, and present in
   the fixture, so §3 cannot pass by the row rendering nothing at all. */
const RAW_RESOLVER_CODE = "FEE_SCHEDULE_NO_ROW_FOR_TIER";

let unavailableCycles: string[] = ["monthly"];
let purchasableCycles: string[] = ["annual"];

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({
  useRoute: () => [true, {}],
  /* WAVE 207 NOTE — DELIBERATELY NOT REPAIRED HERE.
     Every test in this file already fails before wave 207 touched it: PartnerBilling
     was later refactored to drive its tabs off the URL (`useSearch`/`useLocation`),
     and this mock predates that, so the module mock throws on mount. Adding the two
     missing exports was tried and gets the component to mount, but `openTab()` below
     then cannot change tabs, because the tab now comes from a search string this mock
     cannot make change. Repairing that means rewriting this file's harness, which is
     a pre-existing failure wave 207 was told not to chase. The §3 assertion below was
     still corrected, because it demanded copy R195.1 forbids; it is PROVED instead in
     `client/src/pages/partner/__tests__/wave207_fee_basis_copy_dom.test.tsx`, which
     mounts this same real component with a search string that opens the tab. */
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w165",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w165", email: "gp@example.com", name: "W165 GP" },
    },
  }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (_m: string, url: string) => {
      let payload: unknown = {};
      if (url.includes("/subscription")) {
        payload = {
          subscription: null,
          agreement: { version: "v1", url: null, text: "", finalDocUrl: null, isDraft: false },
          partnerSubscription: {
            id: "psub_w165",
            tierSlug: "builder",
            cycle: "annual",
            status: "active",
            amountMinor: 120_000,
            currency: "USD",
            currentPeriodEnd: "2027-01-01T00:00:00.000Z",
            graceUntil: null,
          },
          partnerSubscriptionEvents: [],
          purchasableCycles,
          unavailableCycles,
        };
      } else if (url.includes("fee-schedule/aggregate")) {
        /* The tab reads `data.aggregate`, not the bare object — a fixture shaped
           like the render code instead of like the ROUTE would have made every
           §3/§4 assertion fail on the fixture rather than on the defect. */
        payload = { sseScope: "", aggregate: {
          revision: 7,
          computedAt: "2026-08-26T00:00:00.000Z",
          commission: { rateFraction: null, via: null, error: null },
          lines: [
            /* An UNRESOLVED line: this is the one that used to print the enum. */
            {
              feeKind: "spv_deployment",
              ok: false,
              amountMinor: null,
              currency: null,
              billingPeriod: null,
              computedVia: null,
              error: RAW_RESOLVER_CODE,
            },
            /* A RESOLVED line whose period and source the server did not record —
               the two cells that carried private absence spellings. */
            {
              feeKind: "subscription_annual",
              ok: true,
              amountMinor: 120_000,
              currency: "USD",
              billingPeriod: null,
              computedVia: null,
              error: null,
            },
          ],
        } };
      }
      return { ok: true, status: 200, json: async () => payload };
    },
  };
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerBilling />
    </QueryClientProvider>,
  );
}

/** Open a named tab on the Billing page. */
async function openTab(testid: string): Promise<void> {
  mount();
  fireEvent.click(await screen.findByTestId(testid));
}

beforeEach(() => {
  unavailableCycles = ["monthly"];
  purchasableCycles = ["annual"];
});
afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — R135.5: ALL THREE CONTROLS SURVIVE, AND ALL THREE ARE MARKED.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §1 — the monthly controls are labelled, not removed", () => {
  it("T165F.D1: the Monthly option is STILL PRESENT and still selectable", async () => {
    await openTab("tab-subscription");
    const select = (await screen.findByTestId("subscribe-cycle")) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values, "R135.6/R135.5 forbid dropping the control").toContain("monthly");
    expect(select.disabled, "the control must remain usable, not be disabled away").toBe(false);
  });

  it("T165F.D2: CONTROL 1 — the quote select carries the unavailability notice", async () => {
    await openTab("tab-subscription");
    const note = (await screen.findByTestId("subscribe-cycle-availability")).textContent ?? "";
    expect(note.toLowerCase()).toContain("not currently available");
    expect(note.toLowerCase()).toContain("monthly");
  });

  it("T165F.D3: CONTROL 2 — the cycle-switch preview carries it too", async () => {
    await openTab("tab-subscription");
    expect(await screen.findByTestId("plan-change-preview-btn")).toBeTruthy();
    const note = (await screen.findByTestId("plan-change-cycle-availability")).textContent ?? "";
    expect(note.toLowerCase()).toContain("monthly");
  });

  it("T165F.D4: the default selection is a cadence that can actually be bought", async () => {
    await openTab("tab-subscription");
    const select = (await screen.findByTestId("subscribe-cycle")) as HTMLSelectElement;
    expect(
      purchasableCycles,
      "the tab must not open pre-set to the one cadence checkout refuses",
    ).toContain(select.value);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — THE LABEL FOLLOWS THE SERVER. Both directions.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §2 — the notice is derived, not baked in", () => {
  it("T165F.D5: when the server sells monthly, the notice goes silent", async () => {
    unavailableCycles = [];
    purchasableCycles = ["annual", "monthly"];
    await openTab("tab-subscription");
    const note = (await screen.findByTestId("subscribe-cycle-availability")).textContent ?? "";
    expect(note.trim(), "a warning about a restriction that no longer exists is a new defect").toBe(
      "",
    );
    /* And the control is still there — the notice going quiet must not take the
       option with it. */
    const select = (await screen.findByTestId("subscribe-cycle")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("monthly");
  });

  it("T165F.D6: when the server refuses ANNUAL instead, the notice names annual", async () => {
    unavailableCycles = ["annual"];
    purchasableCycles = ["monthly"];
    await openTab("tab-subscription");
    const note = ((await screen.findByTestId("subscribe-cycle-availability")).textContent ?? "").toLowerCase();
    expect(note, "the sentence must not be hard-coded to the word 'monthly'").toContain("annual");
    expect(note).not.toContain("monthly");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — R133.2: THE FEE NAMES ITS TRIGGER. R77: NO RAW CODES.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §3 — the fee schedule states when it charges, in words", () => {
  it("T165F.D7: the SPV deployment row names the Deployed trigger", async () => {
    await openTab("tab-fee-schedule");
    const t =
      (await screen.findByTestId("partner-feeschedule-trigger-spv_deployment")).textContent ?? "";
    expect(t.toLowerCase()).toContain("deployed");
    expect(t.toLowerCase(), "'one-off' means once, and the row must say so").toContain("once");
  });

  /* ══════════════════════════════════════════════════════════════════════════
     CORRECTED BY WAVE 207 · ITEM A · R195.1.

     As written, this test REQUIRED the partner-facing schedule to say the vehicle
     fee is based on "confirmed capital". R195.1 rules that basis wrong, so the
     assertion was holding the defect in place. What wave 165 was protecting — that
     the row states a basis in words, rather than leaving a partner to guess from a
     soft-circled total — is preserved and now asserted against the shared constant
     the row renders, plus an explicit refusal of the capital wording.
     ═════════════════════════════════════════════════════════════════════════ */
  it("T165F.D8: and states the basis, so a partner cannot predict from soft circles", async () => {
    await openTab("tab-fee-schedule");
    const t =
      ((await screen.findByTestId("partner-feeschedule-trigger-spv_deployment")).textContent ?? "").toLowerCase();
    expect(t).toBe(W207_VEHICLE_FEE_WHEN.toLowerCase());
    expect(t.length).toBeGreaterThan(60);
    expect(t).not.toContain("confirmed capital");
    expect(t).not.toContain("soft-circled");
  });

  it("T165F.D9: the RAW resolver code never reaches the partner", async () => {
    const { container } = mount();
    fireEvent.click(await screen.findByTestId("tab-fee-schedule"));
    await screen.findByTestId("partner-feeschedule-table");
    expect(
      container.textContent ?? "",
      "R77 forbids a raw enum reaching a user",
    ).not.toContain(RAW_RESOLVER_CODE);
  });

  it("T165F.D10: but the information survives — the reason is rendered in words", async () => {
    const { container } = mount();
    fireEvent.click(await screen.findByTestId("tab-fee-schedule"));
    await screen.findByTestId("partner-feeschedule-table");
    const text = (container.textContent ?? "").toLowerCase();
    /* Humanised from the same code, so the row is not silently emptied — which
       would be the opposite defect (a partner told nothing at all). */
    expect(text).toContain("fee schedule no row for tier");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 — PART 3: ONE SPELLING OF ABSENCE, AND NEVER A FALSE ZERO.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §4 — absent values are named, in the canonical words", () => {
  it("T165F.D11: an unrecorded billing period renders 'Not on record'", async () => {
    await openTab("tab-fee-schedule");
    const cell =
      (await screen.findByTestId("partner-feeschedule-period-subscription_annual")).textContent ?? "";
    expect(cell.trim()).toBe("Not on record");
  });

  it("T165F.D12: no private spelling of absence survives on the tab", async () => {
    const { container } = mount();
    fireEvent.click(await screen.findByTestId("tab-fee-schedule"));
    await screen.findByTestId("partner-feeschedule-table");
    const text = container.textContent ?? "";
    for (const banned of ["Period not recorded", "Source not recorded", "unresolved"]) {
      expect(text, `"${banned}" is a private spelling; R111 Q13 fixes exactly one`).not.toContain(
        banned,
      );
    }
  });

  it("T165F.D13: an unresolved amount is never rendered as a zero", async () => {
    const { container } = mount();
    fireEvent.click(await screen.findByTestId("tab-fee-schedule"));
    await screen.findByTestId("partner-feeschedule-table");
    expect(
      container.textContent ?? "",
      "$0.00 for an amount the resolver could not produce is a false statement about money",
    ).not.toContain("$0.00");
  });
});
