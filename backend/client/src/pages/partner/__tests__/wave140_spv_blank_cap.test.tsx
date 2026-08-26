/**
 * WAVE 140 — BATCH 1 · ITEM 1: A BLANK "Cap" MUST MEAN "NO CAP", NOT ZERO.
 *
 * THE DEFECT. `PartnerSpvEngine.tsx` built the launch payload's `capMinor` with
 * `wizardMoneyWire`, whose shared helper substitutes `"0"` for a blank input.
 * A GP who left Cap empty therefore stored `cap_minor = 0`, and
 * `spvEngineStore.subscribe()` gates on `if (s.capMinor != null)` — 0 is not
 * null — so EVERY subscription to that vehicle was refused with `EXCEEDS_CAP`:
 * existing(0) + commitment(anything) > 0. The vehicle launched successfully and
 * then could not accept a single investor.
 *
 * WHAT THIS FILE PINS, AND WHY IT IS NOT VACUOUS.
 *  - It drives the REAL shipped wizard with real DOM events and reads the REAL
 *    request body the component hands to `apiRequest`. Nothing here matches
 *    source text, and nothing asserts a literal it also supplies.
 *  - It asserts BOTH POLES on the same code path, which is what makes the fix
 *    falsifiable in both directions: a BLANK Cap must send `null`, and a TYPED
 *    `0` must still send `0`. A fix that dropped the cap entirely, or that
 *    turned every zero into null, fails the second pole. A fix that special-
 *    cased only the display fails the first.
 *  - It asserts the REVIEW STEP's rendered text, because the review screen is
 *    the partner's last chance to see what they are about to attest to, and
 *    "$0.00" there is a false statement of fact about a limit that does not
 *    exist.
 *  - It pins the two SIBLING amounts (Target raise, Minimum cheque) as
 *    UNCHANGED, so this cannot be "fixed" by widening the shared helper and
 *    silently changing what a blank Target raise means.
 *
 * FAIL-BEFORE is recorded in build_log/wave140/W140_TESTS.md.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_w140",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w140", email: "w140@example.com", name: "W140 Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

/** Every non-GET request the component actually issued, in order. */
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
          : { spv: { id: "spv_w140" }, mandate: { id: "m_w140" }, fee: { id: "f_w140" } };
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
/** The step tabs call `setStep(i)` directly, so a step is reachable for its own assertions. */
const goToStep = (i: number) => click(`spv-wizard-step-tab-${i}`);

/**
 * Open the wizard and fill everything the launch button is gated on EXCEPT the
 * Cap, which each test sets (or deliberately leaves blank) for itself.
 */
function openWizardAndFillRequired(opts: { cap?: string; target?: string; minCheck?: string }) {
  mount();
  click("spv-engine-new");
  goToStep(0);
  set("spv-w-name", "W140 Blank Cap Vehicle");
  goToStep(2);
  // Carry basis is required by both the step-2 gate and the launch button.
  fireEvent.click(
    screen.getByTestId("spv-w-carrybasis-whole_spv").querySelector("input") as HTMLInputElement,
  );
  goToStep(3);
  set("spv-w-target", opts.target ?? "5000000");
  set("spv-w-mincheck", opts.minCheck ?? "25000");
  if (opts.cap !== undefined) set("spv-w-cap", opts.cap);
  /* Read the control back while step 3 is still mounted: this is the state the
     launch and the review then act on, so the "blank" case is proven blank
     rather than assumed. */
  expect((screen.getByTestId("spv-w-cap") as HTMLInputElement).value).toBe(opts.cap ?? "");
  goToStep(4);
}

function completeSignoffAndLaunch() {
  click("spv-w-currency-confirm");
  set("spv-signoff-legalname", "Ada Managing Partner");
  click("spv-signoff-accept");
  click("spv-wizard-launch");
}

/** The body of `POST /api/partner/me/spv` — the request that creates the vehicle. */
function createBody(): Record<string, unknown> {
  const hit = sent.find((s) => s.method === "POST" && s.url === "/api/partner/me/spv");
  if (!hit) throw new Error(`no SPV create request was issued; sent=${JSON.stringify(sent)}`);
  return hit.body;
}

beforeEach(() => {
  sent.length = 0;
});
afterEach(() => cleanup());

describe("WAVE 140 · ITEM 1 — a blank Cap persists as NULL, not as 0", () => {
  it("A1 — a BLANK Cap posts capMinor: null (so the store reads it as 'no cap')", async () => {
    openWizardAndFillRequired({}); // Cap never touched — the real blank case
    completeSignoffAndLaunch();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));

    const body = createBody();
    expect("capMinor" in body).toBe(true); // the key is still sent, not dropped
    expect(body.capMinor).toBeNull();
    // and it is emphatically NOT the old value
    expect(body.capMinor).not.toBe(0);
  });

  it("A2 — a TYPED 0 Cap still posts 0 (a deliberate zero is not rewritten)", async () => {
    openWizardAndFillRequired({ cap: "0" });
    completeSignoffAndLaunch();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));

    const body = createBody();
    expect(body.capMinor).toBe(0);
    expect(body.capMinor).not.toBeNull();
  });

  it("A3 — a real Cap figure is unaffected and still converts to minor units", async () => {
    openWizardAndFillRequired({ cap: "5000000" });
    completeSignoffAndLaunch();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));

    // USD exponent 2: 5,000,000 whole units → 500,000,000 minor. No 100x drift.
    expect(createBody().capMinor).toBe(500000000);
  });

  it("A4 — the two SIBLING amounts keep blank-means-zero, so the shared helper was not widened", async () => {
    openWizardAndFillRequired({ target: "", minCheck: "" });
    completeSignoffAndLaunch();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));

    const body = createBody();
    expect(body.targetRaiseMinor).toBe(0);
    expect(body.minCheckMinor).toBe(0);
    // …while the Cap on the very same payload went to null.
    expect(body.capMinor).toBeNull();
  });
});

describe("WAVE 140 · ITEM 1 — the Review step tells the truth about a blank Cap", () => {
  it("A5 — a blank Cap reviews as an em dash, never as the false fact '$0.00'", () => {
    openWizardAndFillRequired({});
    const row = screen.getByTestId("spv-review-cap");
    expect(row.textContent).toContain("—");
    expect(row.textContent).not.toContain("0.00");
  });

  it("A6 — a TYPED 0 Cap still reviews as 0.00, because that IS the stated limit", () => {
    openWizardAndFillRequired({ cap: "0" });
    const text = screen.getByTestId("spv-review-cap").textContent ?? "";
    expect(text).toContain("0.00 USD");
    expect(text).not.toContain("—");
  });

  it("A7 — a real Cap reviews as the figure the GP typed, in whole units", () => {
    openWizardAndFillRequired({ cap: "5000000" });
    const text = screen.getByTestId("spv-review-cap").textContent ?? "";
    expect(text).toContain("5,000,000.00 USD");
    expect(text).not.toContain("50,000,000");
  });

  it("A8 — Target raise on the SAME review screen still shows 0.00 when blank", () => {
    openWizardAndFillRequired({ target: "" });
    const text = screen.getByTestId("spv-review-target-raise").textContent ?? "";
    expect(text).toContain("0.00 USD");
    expect(text).not.toContain("—");
  });
});
