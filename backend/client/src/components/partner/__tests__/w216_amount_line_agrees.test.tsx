/**
 * WAVE 216 — THE AMOUNT LINE WAVE 226 PINNED, PROVED CLOSED.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * THE DISCREPANCY, IN ONE SENTENCE
 * ════════════════════════════════════════════════════════════════════════════════
 * Wave 226's S-4 recorded that the Amount line the operator READS said one thing
 * ("5000.00 — exactly as you entered it") while the Amount line the ledger STORES
 * said another ("500000 — in the smallest unit of the currency"). Two attestations
 * over the same event, disagreeing about the number. S-4 is a pure unit test on
 * hardcoded literals, so it could pin the divergence but never observe it at a call
 * site, and it says outright that the wave which resolves it must come and change it
 * on purpose. Wave 216 is that wave.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL — IT WAS FOUND MISSING BY A DISARM
 * ════════════════════════════════════════════════════════════════════════════════
 * Two mutations that reverted the fix — putting the typed string and `as_entered`
 * back on both call sites — came back GREEN across every W216 and W226 suite. The
 * whole wave had changed the Amount line with NOTHING asserting the change. S-4
 * still passed because it never touches a call site, and the e-signature proofs have
 * nothing to do with money. That is the third inert-proof mechanism at wave scale: a
 * fixture no mutation of the product can move, because no fixture existed. This file
 * is the missing assertion, and the same two mutations are RED against it.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * WHAT IS ACTUALLY COMPARED, AND WHY IT IS NOT TWO RESTATEMENTS
 * ════════════════════════════════════════════════════════════════════════════════
 * The operator types `5000.00` into the real Record-distribution form on the real
 * `SpvDetailTabs`. Then:
 *
 *   · the figure the SCREEN shows is read OUT OF THE DOM, from the attestation
 *     paragraph the operator actually reads;
 *   · the figure the LEDGER will store is read OFF THE WIRE, out of the body the
 *     component posts as `grossProceedsMinor` — which is the value
 *     `server/spvEngineRoutes.ts:1736` writes into the stored recital.
 *
 * Neither side is retyped by this test and neither is recomputed from the other. The
 * assertion is that the two agree, and there is NO normalising call on either side:
 * `.trim()` or a whitespace collapse would let "5000.00" and "500000" both tidy into
 * something an over-eager comparison could accept, which is exactly the class of
 * error being closed.
 *
 * WHAT THIS FILE DOES NOT PROVE. The capital-call call site lives on
 * `client/src/pages/partner/PartnerSpvDetail.tsx`, a full page with its own routing
 * and query surface; it is fixed the same way, by the same helper, and is NOT mounted
 * here. That gap is stated in `W216_TESTS.md` rather than papered over.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

const posts: Array<{ url: string; body: unknown }> = [];
vi.mock("@/lib/queryClient", () => ({
  apiRequest: async (method: string, url: string, body?: unknown) => {
    if (String(method).toUpperCase() === "POST") posts.push({ url, body });
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  },
  queryClient: { invalidateQueries: () => {}, setQueryData: () => {}, getQueryData: () => undefined },
}));

import { SpvDetailTabs } from "../SpvDetailTabs";
import {
  W211_AMOUNT_UNIT_NOTE_AS_ENTERED,
  W211_AMOUNT_UNIT_NOTE_MINOR,
  W211_RECITAL_LABEL_AMOUNT,
} from "@shared/wave211MoneyEventAttestation";

const SPV_ID = "spv_w216_amount";

/* eslint-disable @typescript-eslint/no-explicit-any */
const detail: any = {
  spv: {
    id: SPV_ID,
    name: "W216 Amount Vehicle",
    status: "deployed",
    currency: "USD",
    jurisdiction: "delaware",
    spvType: "spv",
    distributionScope: "private",
    carryBasis: "whole_spv",
    lpVisibility: "own_only",
  },
  lps: [],
  deployments: [],
  distributions: [],
  fees: [],
  documents: [],
  transfers: [],
  capitalAccounts: [],
  closeSummary: undefined,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs spvId={SPV_ID} detail={detail} currency="USD" canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
  const trigger = utils.container.querySelector<HTMLElement>('[data-testid="spv-tab-distributions"]');
  expect(trigger, "the Distributions tab trigger must exist").toBeTruthy();
  fireEvent.mouseDown(trigger!);
  fireEvent.click(trigger!);
  return utils;
}

async function q(container: HTMLElement, testid: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(
      container.querySelector(`[data-testid="${testid}"]`),
      `[data-testid="${testid}"] must be in the tree`,
    ).toBeTruthy();
  });
  return container.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
}

/** The Amount paragraph of the rendered attestation, read out of the DOM. */
function paintedAmountLine(container: HTMLElement): string {
  const panel = container.querySelector('[data-testid="w211-text-tabs-distribution"]');
  expect(panel, "the wave 211 attestation panel must be rendered on this form").toBeTruthy();
  const lines = Array.from(panel!.querySelectorAll("*"))
    .map((n) => n.textContent ?? "")
    .filter((t) => t.startsWith(`${W211_RECITAL_LABEL_AMOUNT}: `));
  /* An exact count, not a `find`. Zero matching lines would otherwise satisfy an
     existence check and this whole file would assert nothing. */
  expect(lines.length, `exactly one "${W211_RECITAL_LABEL_AMOUNT}:" line`).toBe(1);
  return lines[0];
}

/** Open the Record-distribution panel and type a gross figure. */
async function openAndType(container: HTMLElement, typed: string) {
  fireEvent.click(await q(container, "spv-distribution-record-open"));
  const gross = await q(container, "spv-distribution-gross");
  fireEvent.change(gross, { target: { value: typed } });
  return gross;
}

beforeEach(() => {
  posts.length = 0;
});

describe("W216 · the Amount line the operator reads is the Amount line the ledger stores", () => {
  it("A-1 ANTI-VACUITY: the form, the panel and the Amount line are really on screen", async () => {
    /* Every assertion below would pass against a form that never rendered. This
       establishes the surface exists FIRST. */
    const { container } = mount();
    await openAndType(container, "5000.00");
    const line = paintedAmountLine(container);
    expect(line.length).toBeGreaterThan(`${W211_RECITAL_LABEL_AMOUNT}: `.length);
  });

  it("A-2 the screen states the WIRE figure and NAMES the unit as the smallest unit", async () => {
    const { container } = mount();
    await openAndType(container, "5000.00");
    await waitFor(() => {
      expect(paintedAmountLine(container)).toBe(
        `${W211_RECITAL_LABEL_AMOUNT}: 500000 — ${W211_AMOUNT_UNIT_NOTE_MINOR}`,
      );
    });
    /* THE DIVERGENCE ITSELF, asserted absent. This is the exact byte sequence wave
       226's S-4 pinned as what the screen used to say. */
    expect(paintedAmountLine(container)).not.toContain(W211_AMOUNT_UNIT_NOTE_AS_ENTERED);
    expect(paintedAmountLine(container)).not.toContain("5000.00");
  });

  it("A-3 THE JOINT: the painted figure and the posted figure are the same figure", async () => {
    const { container } = mount();
    await openAndType(container, "5000.00");
    fireEvent.change(await q(container, "spv-distribution-cost-basis"), { target: { value: "1000.00" } });

    const painted = paintedAmountLine(container);

    /* Drive the real submit so the comparison is against a real request body and not
       against a value this test computed. */
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="spv-distribution-submit"]');
    expect(submit, "the submit button must exist").toBeTruthy();
    fireEvent.click(submit!);
    await waitFor(() => {
      expect(posts.length, "a distribution POST must have been made").toBeGreaterThan(0);
    });

    const body = posts[posts.length - 1].body as Record<string, unknown>;
    const wire = body.grossProceedsMinor;
    expect(wire, "the request must carry a gross figure").toBeDefined();

    /* RAW EQUALITY. The painted line must END with the wire figure and the minor-unit
       note, so a screen showing a different number cannot pass. No `.trim()`, no
       lower-casing, no whitespace collapse: the whole point is bytes. */
    expect(painted).toBe(
      `${W211_RECITAL_LABEL_AMOUNT}: ${String(wire)} — ${W211_AMOUNT_UNIT_NOTE_MINOR}`,
    );
  });

  it("A-4 THE FIXTURE MOVES: a different typed amount moves BOTH sides together", async () => {
    /* A-3 alone is the shape of an inert proof — two constants would satisfy it. Two
       different inputs, each producing its own agreeing pair, is what rules that out. */
    for (const [typed, expectedMinor] of [
      ["5000.00", "500000"],
      ["12", "1200"],
      ["0.07", "7"],
    ] as Array<[string, string]>) {
      posts.length = 0;
      const { container, unmount } = mount();
      await openAndType(container, typed);
      fireEvent.change(await q(container, "spv-distribution-cost-basis"), { target: { value: "1.00" } });
      await waitFor(() => {
        expect(paintedAmountLine(container)).toBe(
          `${W211_RECITAL_LABEL_AMOUNT}: ${expectedMinor} — ${W211_AMOUNT_UNIT_NOTE_MINOR}`,
        );
      });
      fireEvent.click(container.querySelector<HTMLButtonElement>('[data-testid="spv-distribution-submit"]')!);
      await waitFor(() => expect(posts.length).toBeGreaterThan(0));
      const body = posts[posts.length - 1].body as Record<string, unknown>;
      expect(String(body.grossProceedsMinor), `typed ${typed}`).toBe(expectedMinor);
      unmount();
    }
  });

  it("A-5 R201.2 — a claim of minor units is only ever made over a figure that reaches the wire", async () => {
    /* THE NARROW RISK IN RESTATING A CONVERTED FIGURE, and the correct shape of the
       guard against it.
       ═══════════════════════════════════════════════════════════════════════════════
       R201.2: a guard against MISSING data does not guard against INVENTED data, and
       invented data usually arrives as a zero. So the dangerous outcome here is not
       "the line is empty" — it is "the line says `0 — in the smallest unit of the
       currency` over an entry that never became an amount".

       TWO EARLIER DRAFTS OF THIS TEST WERE WRONG, AND BOTH WRONGNESSES ARE RECORDED
       RATHER THAN QUIETLY DELETED, because each taught something about the code:

         · Draft one listed `"5000."`, `"5,000"` and `" 12 "` as non-amounts. RED.
           The existing shared converter is LENIENT and accepts all three (to
           `500000`, `500000` and `1200`). That lenience predates this wave and this
           wave does not change it.

         · Draft two demanded that a typed `"0"` be restated `as entered`. RED, and
           the product was right: `wholeUnitsToWire` on this surface passes
           `allowZero: true`, so `"0"` IS a real amount here, it converts to `0`, and
           the SUBMIT puts `0` on the wire too. Screen and record agree at zero. A
           test that forced the screen to disagree with the wire would have
           reintroduced the exact divergence this wave closes.

       So the invariant is not about any particular input. It is: THE SCREEN MAY CLAIM
       MINOR UNITS ONLY FOR A FIGURE THE SUBMIT ACTUALLY SENDS. That is asserted
       below for every input, converting or not, by driving the real submit. */
    const inputs = ["", ".", "-", "abc", "1e3", "5000.000", "-5", "0", "5000.", "5,000", " 12 "];
    for (const typed of inputs) {
      posts.length = 0;
      const { container, unmount } = mount();
      await openAndType(container, typed);
      fireEvent.change(await q(container, "spv-distribution-cost-basis"), { target: { value: "1.00" } });
      const line = paintedAmountLine(container);
      const claimsMinor = line.includes(W211_AMOUNT_UNIT_NOTE_MINOR);

      fireEvent.click(container.querySelector<HTMLButtonElement>('[data-testid="spv-distribution-submit"]')!);
      /* The submit either posts or refuses. Both are given a fair chance to happen. */
      await new Promise((r) => setTimeout(r, 0));
      const wire =
        posts.length > 0
          ? (posts[posts.length - 1].body as Record<string, unknown>).grossProceedsMinor
          : undefined;

      if (claimsMinor) {
        /* A minor-unit claim MUST be backed by the figure on the wire, byte for byte. */
        expect(wire, `typed ${JSON.stringify(typed)} claims minor units but posted nothing`).toBeDefined();
        expect(line).toBe(`${W211_RECITAL_LABEL_AMOUNT}: ${String(wire)} — ${W211_AMOUNT_UNIT_NOTE_MINOR}`);
      } else {
        /* No minor claim means no conversion happened, and nothing may have reached
           the ledger for the screen to disagree with. */
        expect(wire, `typed ${JSON.stringify(typed)} posted a figure it never showed as minor`).toBeUndefined();
      }
      unmount();
    }
  });

  it("A-5b AN EMPTY BOX NEVER SHOWS A ZERO — the absence is declared, not defaulted", async () => {
    /* The single most dangerous rendering on this form would be a plausible-looking
       `0` standing in for "the operator has not told us yet". Nothing was typed, so
       nothing numeric may appear, in either unit label. */
    const { container } = mount();
    await openAndType(container, "");
    const line = paintedAmountLine(container);
    expect(line).not.toContain(": 0");
    expect(line).not.toContain(W211_AMOUNT_UNIT_NOTE_MINOR);
    /* And the absence is stated in words the operator can read, not left blank. */
    expect(line.slice(`${W211_RECITAL_LABEL_AMOUNT}: `.length).trim().length).toBeGreaterThan(0);
    expect(posts.length, "no request may be made by merely looking at the form").toBe(0);
  });

  it("A-6 a whole-unit entry with no decimal point still agrees on both sides", async () => {
    /* The commonest real entry, and the one where a naive `Number()` and a `bigint`
       converter are most likely to differ silently. */
    const { container } = mount();
    await openAndType(container, "250000");
    fireEvent.change(await q(container, "spv-distribution-cost-basis"), { target: { value: "1.00" } });
    await waitFor(() => {
      expect(paintedAmountLine(container)).toBe(
        `${W211_RECITAL_LABEL_AMOUNT}: 25000000 — ${W211_AMOUNT_UNIT_NOTE_MINOR}`,
      );
    });
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-testid="spv-distribution-submit"]')!);
    await waitFor(() => expect(posts.length).toBeGreaterThan(0));
    expect(String((posts[posts.length - 1].body as Record<string, unknown>).grossProceedsMinor)).toBe(
      "25000000",
    );
  });
});
