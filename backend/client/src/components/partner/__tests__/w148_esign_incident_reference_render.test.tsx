/**
 * WAVE 148 — THE LINE LABELLED "Reference:" MUST CARRY A REFERENCE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE CONFIRMED DEFECT, IN ONE SENTENCE.
 * ═══════════════════════════════════════════════════════════════════════════════
 * `SpvDetailTabs.tsx`'s e-signature failure banner tells the partner: "send
 * support the reference below". The line below it was
 * `Reference: {esignReadFailure}`, and `esignReadFailure` is `error.message` —
 * for a 500 that is queryClient's friendly sentence "Something went wrong on our
 * side. Please try again." So the panel printed an APOLOGY where it promised an
 * IDENTIFIER, in a monospace face that made the apology look like one, while the
 * real code sat unread on `ApiError.code` / `ApiError.payload`.
 *
 * WHAT IS ASSERTED HERE IS RENDERED DOM, not source text: the panel is mounted,
 * the E-signature tab is activated exactly as a partner activates it, and the
 * text of `[data-testid="spv-esign-error-detail"]` is read off the tree.
 *
 * FAIL-BEFORE (real output in w148_scratch/fail_before_client_raw.txt):
 *   → expected 'Reference: Something went wrong on our side. Please try again.'
 *     to contain 'ESG-1A2B3C4D'
 *
 * R77 IS THE FENCE ON THE FIX. The internal code (ESIGN_LIST_UNAVAILABLE) is
 * allowed in the payload and in `data-esign-failure-reference`, and is asserted
 * ABSENT from rendered text. What the user reads is the opaque per-occurrence
 * `ESG-XXXXXXXX` minted by server/lib/esignatureRoutes.ts fail(), which names no
 * table, no column and no internal code.
 * R111 Q13 is the fence on the ABSENCE of a code: "Not on record", never a bare
 * dash, never `0`, never the raw code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";
import { SpvDetailTabs } from "../SpvDetailTabs";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** queryClient's own friendly text for any 5xx — the sentence the live panel
 *  printed after the word "Reference:". */
const FRIENDLY_500 = "Something went wrong on our side. Please try again.";
const INCIDENT = "ESG-1A2B3C4D";
const INTERNAL_CODE = "ESIGN_LIST_UNAVAILABLE";

/** What the failing e-signature read throws. Swapped per test. */
let thrown: unknown;

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (_method: string, url: string) => {
      if (url.includes("/esignature")) throw thrown;
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

async function referenceLine(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector('[data-testid="spv-esign-error-detail"]')).toBeTruthy();
  });
  return container.querySelector<HTMLElement>('[data-testid="spv-esign-error-detail"]')!;
}

/** A real 503 from the guarded read, shaped exactly as fail() answers it. */
function guardedFailure(incidentCode: string | undefined): ApiError {
  return new ApiError(
    503,
    FRIENDLY_500,
    INTERNAL_CODE,
    { error: INTERNAL_CODE, message: FRIENDLY_500, ...(incidentCode ? { incidentCode } : {}) },
  );
}

beforeEach(() => {
  thrown = guardedFailure(INCIDENT);
});

describe("W148 · the e-signature failure banner renders an opaque incident reference", () => {
  it("THE DEFECT: the Reference line shows the incident code, and NOT the apology (fails before this wave)", async () => {
    const { container } = mount();
    const line = await referenceLine(container);
    const text = line.textContent ?? "";
    expect(text).toContain(INCIDENT);
    /* The exact pre-wave rendering. If this ever comes back, the label is lying
       again. */
    expect(text).not.toContain(FRIENDLY_500);
    /* The label itself is retained — a partner needs to know what the token is. */
    expect(text.startsWith("Reference:")).toBe(true);
  });

  it("R77: the raw internal code never reaches rendered text, and the attribute still carries it", async () => {
    const { container } = mount();
    await referenceLine(container);
    const banner = container.querySelector<HTMLElement>('[data-testid="spv-esign-error"]')!;
    /* The machine value stays in the attribute R77 explicitly permits. Wave 127
       pinned this and it is unchanged. */
    expect(banner.getAttribute("data-esign-failure-reference")).toBe("ESIGN_LIST_READ");
    const text = banner.textContent ?? "";
    expect(text).not.toContain(INTERNAL_CODE);
    expect(text).not.toContain("ESIGN_LIST_READ");
    expect(text).not.toContain("ESIGN_SCHEMA");
    /* And nothing SQL-shaped escapes either. */
    expect(text).not.toMatch(/no such (column|table)/i);
  });

  it("R111 Q13: with no incident code the Reference reads 'Not on record' — never a dash, never empty, never the code", async () => {
    thrown = guardedFailure(undefined);
    const { container } = mount();
    const line = await referenceLine(container);
    const text = (line.textContent ?? "").trim();
    expect(text).toBe("Reference: Not on record");
    expect(text).not.toContain("—");
    expect(text).not.toContain(INTERNAL_CODE);
  });

  it("a plain Error (no payload at all) still degrades to 'Not on record', not to the message", async () => {
    /* The wave-127 mock shape: a bare Error with a sanitized sentence. The panel
       must not fall back to printing it as a reference again. */
    thrown = new Error("An unexpected error occurred. Please try again.");
    const { container } = mount();
    const line = await referenceLine(container);
    expect((line.textContent ?? "").trim()).toBe("Reference: Not on record");
  });

  it("the wave-127 guarantees survive: the send form, the announcement and the honest empty state", async () => {
    const { container } = mount();
    await referenceLine(container);
    const panel = container.querySelector<HTMLElement>('[data-testid="spv-detail-esignature"]')!;
    /* A partner can still get a document signed while the list is unavailable. */
    expect(panel.querySelector('[data-testid="spv-esign-new"]')).toBeTruthy();
    /* The failure is still announced, and the server's own human message is still
       shown — it moved to its own line, it was not deleted. */
    expect(container.querySelector('[data-testid="spv-esign-error-message"]')?.textContent).toContain(FRIENDLY_500);
    /* A failed read still never claims the vehicle has no signing history. */
    expect(container.querySelector('[data-testid="spv-esign-empty"]')).toBeNull();
    expect(container.querySelector('[data-testid="spv-esign-list-unavailable"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="spv-esign-retry-btn"]')).toBeTruthy();
  });
});
