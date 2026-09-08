/**
 * WAVE 127 · FINDING 2 — AN EMPTY INPUT MUST PRODUCE NO FIGURE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS OBSERVED ON PRODUCTION, ON TWO DIFFERENT VEHICLES.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The SPV Fees tab's "model a commitment" input was verified empty in the live
 * DOM (`.value === ''`) and the page nonetheless displayed a complete breakdown:
 *
 *     Test SPV     Commitment modelled $484.47 · Management fee $33.00 ·
 *                  Platform fee $0.00 · Net deployed to the company $451.47
 *     QUantum SPV  Commitment modelled $100.00 · Management fee $20.00 ·
 *                  Platform fee $0.00 · Net deployed to the company  $80.00
 *
 * $484.47 − $33.00 = $451.47 exactly, so the ARITHMETIC was never wrong. The
 * INPUT was invented: the route substituted the vehicle's `min_check_minor`
 * (48447 and 10000 respectively) whenever the client omitted the parameter, and
 * the client omitted it whenever the box was empty. Real code running on a
 * question nobody asked is worse than a hardcoded placeholder, not better.
 *
 * THIS FILE PROVES THE CLIENT HALF: while the input is empty NO REQUEST IS MADE
 * AT ALL, so no figure can exist to render. The mock server here is deliberately
 * adversarial — it answers ANY fee-breakdown request with the exact live Test SPV
 * numbers — so if the query fired, `$484.47` would appear and these tests would
 * fail. `requestedUrls` is asserted directly, which pins the MECHANISM (`enabled`)
 * and not merely the absence of text.
 *
 * The second test is the other half of the brief: once a REAL amount is entered
 * the figures must appear and be verifiable by hand in minor units.
 *
 * The server half — the removal of the `?? spv.minCheckMinor` substitution and of
 * `Number()` on money — is proved in server/__tests__/w127_fee_breakdown_requires_commitment.test.ts.
 */
/* W6c · D1 · TRIPWIRE UPDATED, NOT REMOVED — STATED REASON.
   This assertion pinned the currency SYMBOL (`$`, `¥`) that the SPV tabs used
   to render. W6c · D1 changed the two money chokepoints behind those tabs
   (`fmt()` in SpvDetailTabs.tsx and `money()` in SpvOperationsPanels.tsx) to
   pass `currencyDisplay: "code"`, because QA could not tell which currency
   `$0.00 / $100,000.00` was on a Canadian-registered vehicle. The FIGURE is
   unchanged in every digit — only the currency label changed from a symbol to
   the ISO code, which is strictly more specific. The assertion is therefore
   RE-POINTED at the new label and keeps testing exactly the property it was
   written to test (the digits did not move, no conversion happened, and no
   other currency appears). It is not weakened and it is not deleted. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvFeeLedgerPanel } from "../SpvOperationsPanels";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const requestedUrls: string[] = [];

/** The live Test SPV figures, in minor units. If any of these reaches the screen
 *  against an empty input, the defect is back. */
const LIVE_PHANTOM = {
  commitmentMinor: 48_447,
  managementFeeMinor: 3_300,
  platformFeeMinor: 0,
  netDeployedMinor: 45_147,
};

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (_method: string, url: string) => {
      requestedUrls.push(url);
      const body = url.includes("/fee-breakdown")
        ? { breakdown: { ...LIVE_PHANTOM } }
        : { obligations: [] };
      return { ok: true, status: 200, json: async () => body, text: async () => "{}" } as unknown as Response;
    },
  };
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpvFeeLedgerPanel spvId="spv_13ac1ceb06eeb6c7" currency="USD" canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
}

const feeUrls = () => requestedUrls.filter((u) => u.includes("/fee-breakdown"));

describe("W127 FINDING 2 · the fee panel with an empty commitment input", () => {
  beforeEach(() => { requestedUrls.length = 0; });

  it("NO fee-breakdown request is issued while the input is empty (fails before this wave)", async () => {
    const { container } = mount();
    /* The obligations query is unrelated and does fire; waiting on it gives the
       fee query every chance to fire too, so this is not a timing artefact. */
    await waitFor(() => expect(requestedUrls.some((u) => u.includes("/fee-obligations"))).toBe(true));
    expect(container.querySelector<HTMLInputElement>('[data-testid="spv-fee-breakdown-input"]')!.value).toBe("");
    expect(feeUrls(), "an empty input must ask the server nothing").toEqual([]);
  });

  it("no money figure of any kind is rendered against an empty input", async () => {
    const { container } = mount();
    await waitFor(() => expect(requestedUrls.some((u) => u.includes("/fee-obligations"))).toBe(true));
    const text = container.textContent ?? "";
    for (const phantom of ["USD 484.47", "USD 451.47", "USD 33.00", "USD 100.00", "USD 80.00"]) {
      expect(text, `an empty input must not render ${phantom}`).not.toContain(phantom);
    }
    /* Nor a zero, which would be an equally false answer: nobody asked. */
    expect(container.querySelector('[data-testid="spv-fee-breakdown-netDeployedMinor"]')).toBeNull();
    expect(container.querySelector('[data-testid="spv-fee-breakdown-managementFeeMinor"]')).toBeNull();
  });

  it("a short prompt is shown instead of a figure", async () => {
    const { container } = mount();
    const prompt = await waitFor(() => {
      const el = container.querySelector('[data-testid="spv-fee-breakdown-awaiting-input"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(prompt.textContent).toContain("Enter a commitment amount");
  });

  it("entering a REAL amount produces the figures, verifiable by hand in minor units", async () => {
    const { container } = mount();
    const input = container.querySelector<HTMLInputElement>('[data-testid="spv-fee-breakdown-input"]')!;
    /* WAVE 128 · FINDING 2 RETARGETED THIS ASSERTION, and it is the same test.

       Wave 127 typed "250000" and expected `commitmentMinor=250000`, because the
       field asked for the currency's SMALLEST unit. Wave 128 re-scaled the field
       to whole currency units, so the client now types the amount they mean —
       $2,500.00, the live commitment on Test SPV — and the WIRE VALUE IS
       UNCHANGED at 250000 minor units. The old assertion also happened to pass
       against the new field by SUBSTRING (`commitmentMinor=25000000` contains
       `commitmentMinor=250000`), which is exactly the kind of false green this
       wave is meant to remove, so the parameter is now matched EXACTLY. */
    fireEvent.change(input, { target: { value: "2,500.00" } });
    await waitFor(() => expect(feeUrls().length).toBeGreaterThan(0));
    /* The parameter is SENT, so the server never has to invent one. */
    expect(feeUrls()[0]).toMatch(/[?&]commitmentMinor=250000(&|$)/);
    /* And the confirmation line states the amount in the client's own unit. */
    expect(container.querySelector('[data-testid="spv-fee-breakdown-input-notice"]')!.textContent)
      .toContain("2,500.00 USD");
    await waitFor(() => {
      expect(container.querySelector('[data-testid="spv-fee-breakdown-netDeployedMinor"]')).toBeTruthy();
    });
    /* Hand arithmetic, in minor units, on the mocked breakdown:
         48447 − 3300 − 0 = 45147  →  $451.47 */
    expect(container.querySelector('[data-testid="spv-fee-breakdown-netDeployedMinor"]')!.textContent)
      .toContain("USD 451.47");
    expect(container.querySelector('[data-testid="spv-fee-breakdown-awaiting-input"]')).toBeNull();
  });

  it("the echo line never uses Number() on money: exponent notation cannot be widened into an amount", async () => {
    const { container } = mount();
    const input = container.querySelector<HTMLInputElement>('[data-testid="spv-fee-breakdown-input"]')!;
    /* WAVE 128 · FINDING 2 STRENGTHENED THIS ASSERTION.

       Wave 127's field stripped every non-digit, so "1e7" landed as "17" and the
       proof available was that the echo agreed with the digits actually held
       ($0.17) rather than with `Number("1e7")` (10,000,000). Wave 128 accepts the
       characters a person types, so the exponent string now reaches the parser —
       and is REFUSED in a sentence naming the field, which is a stronger outcome
       than silently keeping two of its characters. Under the deleted
       `Number(commitmentMinor)` this entry would have modelled 10,000,000 minor
       units. It now models nothing and asks no question of the server. */
    fireEvent.change(input, { target: { value: "1e7" } });
    await waitFor(() => {
      const echo = container.querySelector('[data-testid="spv-fee-breakdown-input-echo"]')!.textContent ?? "";
      expect(echo).toMatch(/not in scientific notation/i);
      expect(echo).not.toContain("100,000.00");
      expect(echo).not.toContain("10,000,000");
    });
    expect(container.querySelector('[data-testid="spv-fee-breakdown-input-notice-refusal"]')).toBeTruthy();
    expect(feeUrls(), "a refused amount must ask the server nothing").toEqual([]);
  });
});
