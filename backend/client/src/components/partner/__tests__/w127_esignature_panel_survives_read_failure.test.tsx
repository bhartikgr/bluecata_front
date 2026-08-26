/**
 * WAVE 127 · FINDING 1 — THE E-SIGNATURE TAB MUST SURVIVE A FAILED LIST READ.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS OBSERVED, AND WHAT THIS FILE PROVES.
 * ═══════════════════════════════════════════════════════════════════════════════
 * On the live SPV detail panel for `Test SPV` the E-signature tab rendered ONE
 * sentence and nothing else:
 *
 *     "An unexpected error occurred. Please try again."
 *
 * That sentence occurs EXACTLY ONCE in this codebase — it is the default fallback
 * of `sanitizeErrorMessage` (server/lib/sanitize.ts), substituted only under
 * NODE_ENV=production — so the GET of the envelope list answered HTTP 500
 * ESIGN_FAILED, and `throwIfResNotOk` (client/src/lib/queryClient.ts) surfaced the
 * server's human message to this component.
 *
 * E-SIGNATURE IS BUILT. server/lib/esignatureStore.ts is a 900-line engine
 * (createEnvelope / sendEnvelope / recordSignature / declineSignature /
 * voidEnvelope), server/lib/esignatureRoutes.ts is its HTTP surface, and this
 * panel is its UI. The whole-panel blankness was NOT a missing feature: it was an
 * `if (isError) return <div>…</div>` EARLY RETURN in the component, which deleted
 * the signing-method line, the envelope list AND the "Send a document for
 * signature" form — a form that does not depend on the failed read and would have
 * worked.
 *
 * THE FAIL-BEFORE / PASS-AFTER PROOF is the send form under a failing read.
 * Against the pre-wave component `spv-esign-new` is absent, because the early
 * return happened before it; against the fixed component it is present. That is
 * the launch blocker in one assertion: a partner can still get a subscription
 * document signed while the list of past envelopes is unavailable.
 *
 * WHAT THIS FILE ALSO REFUSES TO ACCEPT. A crash that becomes a polite empty
 * panel is still a broken feature, so this test asserts the failure is still
 * ANNOUNCED (`spv-esign-error` present, carrying the server's own message), and
 * that the failed read does NOT fall through to the "No documents have been sent
 * for signature on this vehicle yet" copy — a false statement about a signing
 * record. Nothing is swallowed and nothing is invented.
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvDetailTabs } from "../SpvDetailTabs";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** The exact sentence the live site rendered — sanitize.ts's production fallback. */
const LIVE_SENTENCE = "An unexpected error occurred. Please try again.";

/* Every e-signature read fails the way production failed; every other request
   succeeds, so nothing else in the tab set is under test here. */
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (_method: string, url: string) => {
      if (url.includes("/esignature")) throw new Error(LIVE_SENTENCE);
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" } as unknown as Response;
    },
  };
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const detail: any = {
  spv: {
    status: "open", jurisdiction: "delaware", lpVisibility: "own_only", closeDate: null,
    targetRaiseMinor: 3_000, terms: { vintage: 2026 }, revisionHash: null, updatedAt: null,
  },
  mandate: { mode: "deal_specific", sector: ["Fintech"], geography: ["United States"], stage: ["seed"] },
  fees: [], subscriptions: [], register: [], deployments: [], distributions: [],
  documents: [], transfers: [], capitalAccounts: [], closeSummary: undefined,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Mounts the tab set and OPENS the E-signature tab, exactly as a partner does.
 *
 *  Measured while writing this file: Radix renders all 16 `[role="tabpanel"]`
 *  elements but does NOT mount an inactive panel's CHILDREN (no `forceMount`), so
 *  the trigger must actually be activated or this file would assert against an
 *  empty panel and pass for the wrong reason. Radix activates on mousedown; the
 *  click that follows in a real browser is dispatched too. */
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs spvId="spv_13ac1ceb06eeb6c7" detail={detail} currency="USD" canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
  const trigger = utils.container.querySelector<HTMLElement>('[data-testid="spv-tab-esignature"]');
  expect(trigger, "the E-signature tab trigger must exist").toBeTruthy();
  fireEvent.mouseDown(trigger!);
  fireEvent.click(trigger!);
  return utils;
}

function esignPanel(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="spv-detail-esignature"]');
  expect(el, "the e-signature panel must be mounted").toBeTruthy();
  return el!;
}

describe("W127 FINDING 1 · e-signature tab under a failing envelope-list read", () => {
  it("THE LAUNCH BLOCKER: the send-for-signature form still renders (fails before this wave)", async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="spv-esign-error"]')).toBeTruthy();
    });
    /* Before this wave the `if (isError) return …` early return removed the whole
       subtree and this assertion failed. A vehicle cannot take money without this
       form, so this is the assertion that decides whether the section can launch. */
    expect(
      esignPanel(container).querySelector('[data-testid="spv-esign-new"]'),
      "the send-for-signature form must survive a failed LIST read",
    ).toBeTruthy();
  });

  it("the failure is still ANNOUNCED, and still carries the server's own message", async () => {
    const { container } = mount();
    await waitFor(() => {
      const banner = container.querySelector('[data-testid="spv-esign-error"]');
      expect(banner).toBeTruthy();
      /* ══════════════════════════════════════════════════════════════════════════
         PIN UPDATED UNDER R98 BY WAVE 148 — the CODE was not reverted, and no
         assertion was removed; two were added.
         ══════════════════════════════════════════════════════════════════════════
         This assertion used to read the server's message out of
         `spv-esign-error-detail`, the line labelled "Reference:". Wave 148
         established that as a confirmed defect: the label promised an identifier
         and delivered prose, while the real reference sat unread on
         `ApiError.payload.incidentCode`. The detail line now carries the opaque
         per-occurrence incident code, and the server's message moved to its own
         sibling line — it was NOT deleted, which is what this pin exists to
         protect. Both facts are asserted below, so the guarantee is stronger than
         before, not weaker. */
      expect(container.querySelector('[data-testid="spv-esign-error-message"]')?.textContent).toContain(LIVE_SENTENCE);
      /* This mock throws a bare Error with no payload, so there is no incident
         code to show; R111 Q13's wording is what must appear — never a dash,
         never an empty label, never the raw internal code. */
      const ref = container.querySelector('[data-testid="spv-esign-error-detail"]')?.textContent ?? "";
      expect(ref).toContain("Reference:");
      expect(ref).toContain("Not on record");
      expect(ref).not.toContain(LIVE_SENTENCE);
    });
    /* Professional and SPECIFIC about what failed and what still works. */
    const banner = container.querySelector('[data-testid="spv-esign-error"]')!;
    const text = banner.textContent ?? "";
    expect(text).toContain("could not be loaded");
    /* R44 / R77: the machine reference stays MACHINE-READABLE (an attribute a
       support operator can read off the DOM or a bug report), and never appears
       in the sentence a paying client reads. The internal-language fence is the
       authority on that distinction and it scans jsx text, not attributes. */
    expect(banner.getAttribute("data-esign-failure-reference")).toBe("ESIGN_LIST_READ");
    expect(text).not.toContain("ESIGN_LIST_READ");
    expect(container.querySelector('[data-testid="spv-esign-retry-btn"]')).toBeTruthy();
  });

  it("a failed read never claims the vehicle has no signing history", async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="spv-esign-error"]')).toBeTruthy();
    });
    /* `envelopes` is [] on a failed read. Before this wave that would have printed
       "No documents have been sent for signature on this vehicle yet" had the panel
       rendered at all — a false statement about a legal record. */
    expect(container.querySelector('[data-testid="spv-esign-empty"]')).toBeNull();
    const unavailable = container.querySelector('[data-testid="spv-esign-list-unavailable"]');
    expect(unavailable).toBeTruthy();
    expect(unavailable!.textContent).toContain("does NOT mean no documents have been sent");
  });

  it("the panel never renders an unhandled error: no ErrorBoundary copy, and the signing method line survives", async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="spv-esign-error"]')).toBeTruthy();
    });
    /* client/src/components/ErrorBoundary.tsx's copy. If it appeared, the panel
       had thrown rather than handled. */
    expect(container.textContent).not.toContain("Something went wrong");
    expect(esignPanel(container).querySelector('[data-testid="spv-esign-provider"]')).toBeTruthy();
  });
});
