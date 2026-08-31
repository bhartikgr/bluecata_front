/**
 * WAVE 199 · ITEM A (R173.1) — THE CREATE SCREEN MUST *ASK* FOR A CURRENCY, AND
 * THE ANSWER MUST BELONG TO THE CURRENCY IT WAS GIVEN FOR.
 *
 * THE OWNER'S RULING: "any new vehicle should be asked to choose its primary
 * currency … not a silent default, and not merely a pre-filled editable field",
 * and "Consortium Partners or Capavate companies should be able to pick any
 * currency that they wish. They should not be bound to only a small selection."
 *
 * WHAT WAS ALREADY TRUE ON THE SHIPPED TREE, and is PINNED here rather than
 * changed: the reachable partner create screen (`/collective/partner/spv-engine`)
 * offers the full ISO 4217 list, and the launch control is gated on an explicit
 * confirmation of the currency (`spv-w-currency-confirm`). A1/A2/A3 lock those in,
 * so a later wave cannot narrow the list or drop the confirmation unnoticed.
 *
 * THE ONE REAL HOLE, and the only behaviour this wave changed: the confirmation
 * outlived the currency it was given for. Every Review row carries
 * `onEdit={() => setStep(n)}` and the stepper allows direct jumps, so a partner
 * could confirm one currency, walk back, change it, and launch a vehicle carrying a
 * confirmation of a currency it does not use — for a field that is immutable for
 * the vehicle's entire life. A4/A5 drive exactly that sequence through the real
 * DOM, by both routes the currency can move (the step-3 dropdown and the
 * jurisdiction country, which sets the currency FOR the partner).
 *
 * WHY RENDERED DOM (R137.1). The brief requires proof on "the real create screens".
 * Every assertion below reads the MOUNTED shipped wizard after real DOM events; no
 * assertion inspects source text, and A5 additionally proves the effect at the
 * PAYLOAD — the launch either does not fire, or fires with the currency actually
 * confirmed.
 *
 * ANTI-VACUITY.
 *  - The currency list is compared against `buildCurrencyOptions()` — the shipped
 *    authority — not against a count retyped here, and it is separately asserted to
 *    be large (>100) and to contain currencies no curated shortlist would carry.
 *  - Both poles everywhere: after the currency changes, the launch is blocked; after
 *    the partner re-confirms, it fires. A test that only proved the block would pass
 *    against a wizard that had simply broken.
 *  - The checkbox is asserted to have been genuinely ticked BEFORE the currency is
 *    changed, so the later "unticked" assertion cannot pass on a box that was never
 *    ticked at all.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";
import { buildCurrencyOptions } from "@/lib/currencyOptions";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_w199",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w199", email: "w199@example.com", name: "W199 Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

/** Every non-GET request the wizard issued — the payload proof for A5. */
const sent: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (method !== "GET") sent.push({ method, url, body: (body ?? {}) as Record<string, unknown> });
      const payload =
        method === "GET"
          ? { spvs: [] }
          : { spv: { id: "spv_w199", spvType: "spv" }, mandate: { id: "m_w199" }, fee: { id: "f_w199" } };
      return {
        ok: true,
        status: method === "GET" ? 200 : 201,
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

const set = (testid: string, value: string) =>
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
const click = (testid: string) => fireEvent.click(screen.getByTestId(testid));
const goToStep = (i: number) => click(`spv-wizard-step-tab-${i}`);
const currencySelect = () => screen.getByTestId("spv-w-currency") as HTMLSelectElement;
const confirmBox = () => screen.getByTestId("spv-w-currency-confirm") as HTMLInputElement;
const launchBtn = () => screen.getByTestId("spv-wizard-launch") as HTMLButtonElement;

/** Open the shipped wizard and fill everything the launch control is gated on. */
function openWizard() {
  mount();
  click("spv-engine-new");
  goToStep(0);
  set("spv-w-name", "W199 currency vehicle");
  goToStep(2);
  fireEvent.click(
    screen.getByTestId("spv-w-carrybasis-whole_spv").querySelector("input") as HTMLInputElement,
  );
  goToStep(3);
  set("spv-w-target", "5000000");
  set("spv-w-mincheck", "25000");
}

/** Complete the sign-off block (legal name + acceptance), leaving the launch armed. */
function completeSignoff() {
  set("spv-signoff-legalname", "Ada Managing Partner");
  click("spv-signoff-accept");
}

beforeEach(() => {
  sent.length = 0;
});
afterEach(() => cleanup());

describe("WAVE 199 · ITEM A — the create screen asks for a currency", () => {
  it("A1 — the currency field is present on the real create screen and is a CHOICE, not free text", () => {
    openWizard();
    const sel = currencySelect();
    expect(sel.tagName).toBe("SELECT");
    /* More than a token list of options actually mounted in the DOM. */
    expect(sel.options.length).toBeGreaterThan(100);
  });

  it("A2 — the FULL list is offered: every option the shipped authority publishes, in its order", () => {
    openWizard();
    const authority = buildCurrencyOptions().map((c) => c.code);
    const rendered = Array.from(currencySelect().options).map((o) => o.value);
    /* Compared against the shipped builder, not a number retyped here. */
    expect(rendered).toEqual(authority);
    expect(rendered.length).toBeGreaterThan(100);
    /* Currencies no curated shortlist would carry — the ruling's actual point. */
    for (const code of ["ZMW", "KGS", "PGK", "MVR", "SRD"]) {
      expect(rendered).toContain(code);
    }
  });

  it("A3 — the launch is gated on an EXPLICIT confirmation: unticked blocks, ticked releases (both poles)", () => {
    openWizard();
    goToStep(4);
    completeSignoff();
    /* The jurisdiction default may pre-select a currency, but an unconfirmed
       submission is NOT silently accepted. */
    expect(confirmBox().checked).toBe(false);
    expect(launchBtn().disabled).toBe(true);
    click("spv-w-currency-confirm");
    expect(confirmBox().checked).toBe(true);
    expect(launchBtn().disabled).toBe(false);
  });

  it("A4 — changing the currency AFTER confirming withdraws the confirmation and re-blocks the launch", () => {
    openWizard();
    goToStep(4);
    completeSignoff();
    click("spv-w-currency-confirm");
    /* Anti-vacuity: the box really was ticked and the launch really was armed. */
    expect(confirmBox().checked).toBe(true);
    expect(launchBtn().disabled).toBe(false);

    /* Walk back to step 3 exactly as the stepper allows, and change the currency. */
    goToStep(3);
    const before = currencySelect().value;
    const other = Array.from(currencySelect().options).map((o) => o.value).find((c) => c !== before);
    expect(other).toBeTruthy();
    fireEvent.change(currencySelect(), { target: { value: other as string } });
    expect(currencySelect().value).toBe(other);

    goToStep(4);
    expect(confirmBox().checked).toBe(false);
    expect(launchBtn().disabled).toBe(true);

    /* … and the partner who genuinely means it is not stuck: one more tick arms it. */
    click("spv-w-currency-confirm");
    expect(launchBtn().disabled).toBe(false);
  });

  it("A5 — the same holds when the JURISDICTION moves the currency, and the launched payload carries the confirmed currency", async () => {
    openWizard();
    goToStep(4);
    completeSignoff();
    click("spv-w-currency-confirm");
    expect(launchBtn().disabled).toBe(false);

    /* Step 0 is where the jurisdiction country lives; picking one whose table
       entry is a different currency changes the currency FOR the partner. */
    goToStep(0);
    const countrySel = screen.getByTestId("spv-w-jurisdiction-country") as HTMLSelectElement;
    goToStep(3);
    const startCurrency = currencySelect().value;
    /* Find a country the shipped table maps to a DIFFERENT currency — driven
       through the real dropdown, never by writing state. */
    let moved = false;
    for (const opt of Array.from(countrySel.options).map((o) => o.value)) {
      goToStep(0);
      fireEvent.change(screen.getByTestId("spv-w-jurisdiction-country"), { target: { value: opt } });
      goToStep(3);
      if (currencySelect().value !== startCurrency) {
        moved = true;
        break;
      }
    }
    /* If this fixture cannot move the currency by country, the test must fail
       loudly rather than pass without exercising the path. */
    expect(moved).toBe(true);

    goToStep(4);
    expect(confirmBox().checked).toBe(false);
    expect(launchBtn().disabled).toBe(true);

    /* Re-confirm against the currency actually in force, launch, and read the
       payload the component sent. */
    const confirmedCurrency = (() => {
      goToStep(3);
      const v = currencySelect().value;
      goToStep(4);
      return v;
    })();
    click("spv-w-currency-confirm");
    expect(launchBtn().disabled).toBe(false);
    fireEvent.click(launchBtn());
    /* The launch is three sequential requests; wait for the first to be issued
       rather than assuming it is synchronous. */
    await waitFor(() => expect(sent.some((r) => r.method === "POST")).toBe(true));
    const post = sent.find((r) => r.method === "POST");
    expect(post).toBeTruthy();
    /* THE POINT: the currency in the payload is the one that was confirmed, never
       the stale one the partner originally ticked. */
    expect(String((post as { body: Record<string, unknown> }).body.currency)).toBe(confirmedCurrency);
    expect(confirmedCurrency).not.toBe(startCurrency);
  });
});
