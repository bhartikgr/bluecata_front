/**
 * WAVE 175 · R145.3.3 · R137.1 · R143.1 — THE REAL K-1 TAB SURFACE, MOUNTED.
 *
 * The sibling test proves the notice component says the right thing. It cannot
 * prove a general partner ever SEES it. R137.1 is explicit that a claim about a
 * screen is only verified against the MOUNTED screen, so this file mounts the
 * REAL `SpvK1Panel` — the actual K-1 generation tab — and reads its DOM.
 *
 * TWO THINGS ARE PROVEN HERE, AND THEY PULL IN OPPOSITE DIRECTIONS.
 *
 *  1. THE FIX IS ON THE REAL SURFACE. A Hong Kong vehicle's K-1 tab carries the
 *     jurisdictional correction, ABOVE the panel's own policy line, driven only
 *     by the value passed down from the vehicle.
 *
 *  2. NOTHING WAS REMOVED TO GET THERE (R143.1). The panel's original policy
 *     literal must STILL be on screen, byte-verbatim. Six previous builders
 *     tripped `drop:restyle` by editing or allow-listing an existing literal
 *     instead of appending beside it; this asserts the literal survived intact,
 *     which is the condition `guard` alone does not catch.
 *
 * The generation control is also asserted PRESENT and ENABLED for a non-US
 * vehicle. That is deliberate and is the wave's considered position: a US-taxable
 * investor in a non-US feeder does legitimately receive a US Schedule K-1, so
 * gating the tool by the vehicle's jurisdiction would replace a labelling defect
 * with a functional one. The defect is closed by making the surface tell the
 * truth, not by taking a correct tool away.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvK1Panel } from "../SpvK1Panel";
import {
  SPV_JURISDICTION_LABELS,
  SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE,
  SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE,
} from "@shared/spvEngine";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (_method: string, url: string) => {
      const body = url.includes("/k1/years")
        ? { years: [], suggestedTaxYear: null }
        : url.includes("/k1/stored")
          ? { statements: [] }
          : { taxYear: 0, statements: [] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    },
  };
});

/** The panel's own policy literal, retyped in full ON PURPOSE. This is the R143.1
 *  fence: if a single character of the shipped copy is edited or dropped, this
 *  assertion fails here, in a wave-175 test, rather than surfacing later as a
 *  bare copy drop in `drop:restyle`. */
const POLICY_LITERAL =
  "Schedule K-1 figures are derived only from recorded facts: confirmed capital receipts, recorded distributions and the committed register. A commitment is not a contribution, so a partner with no confirmed receipt shows a blank rather than their committed amount. Any figure that cannot be derived is left blank with its reason stated — it is never shown as zero. These statements are a reporting aid, not tax advice.";

function normalise(s: string | null | undefined) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function mount(jurisdiction?: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpvK1Panel spvId="spv_w175" canWrite={true} jurisdiction={jurisdiction} />
    </QueryClientProvider>,
  );
}

beforeEach(() => cleanup());

describe("W175 / E — the correction is on the REAL K-1 tab", () => {
  it("E1 a Hong Kong vehicle's K-1 tab states that a K-1 is not this vehicle's document", async () => {
    mount("hong_kong");
    /* anti-vacuity: the real panel mounted, and it is the real panel */
    await waitFor(() => expect(screen.getByTestId("spv-k1-panel")).toBeTruthy());
    expect(screen.getByTestId("spv-k1-policy")).toBeTruthy();
    /* the correction is present, identified, and sourced */
    const box = screen.getByTestId("spv-k1-jurisdiction-warning");
    expect(screen.getByTestId("spv-k1-jurisdiction-label").textContent).toContain(
      SPV_JURISDICTION_LABELS.hong_kong,
    );
    expect(screen.getByTestId("spv-k1-jurisdiction-not-this-vehicle").textContent).toBe(
      SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE,
    );
    expect(box.querySelector('a[href*="ird.gov.hk"]')).toBeTruthy();
  });

  it("E2 the correction is rendered ABOVE the panel's policy line, not inside it", async () => {
    mount("hong_kong");
    await waitFor(() => expect(screen.getByTestId("spv-k1-panel")).toBeTruthy());
    const panel = screen.getByTestId("spv-k1-panel");
    const box = screen.getByTestId("spv-k1-jurisdiction-warning");
    const policy = screen.getByTestId("spv-k1-policy");
    /* a SIBLING, not a wrapper and not a child of the existing copy */
    expect(box.parentElement).toBe(panel);
    expect(policy.parentElement).toBe(panel);
    expect(box.contains(policy)).toBe(false);
    expect(policy.contains(box)).toBe(false);
    /* and it comes FIRST, so the GP reads the jurisdiction before the figures */
    expect(box.compareDocumentPosition(policy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("E3 R143.1 — the original policy literal is STILL on screen, byte-verbatim", async () => {
    mount("hong_kong");
    await waitFor(() => expect(screen.getByTestId("spv-k1-panel")).toBeTruthy());
    /* Nothing was replaced, edited or allow-listed to make room for the notice. */
    expect(normalise(screen.getByTestId("spv-k1-policy").textContent)).toBe(POLICY_LITERAL);
  });

  it("E4 a Delaware vehicle sees the plain confirmation and no warning", async () => {
    mount("delaware");
    await waitFor(() => expect(screen.getByTestId("spv-k1-panel")).toBeTruthy());
    expect(screen.getByTestId("spv-k1-jurisdiction-us").textContent).toContain(
      "A Schedule K-1 is this vehicle's investor tax document.",
    );
    expect(screen.queryByTestId("spv-k1-jurisdiction-warning")).toBeNull();
    /* the policy literal is intact on this path too */
    expect(normalise(screen.getByTestId("spv-k1-policy").textContent)).toBe(POLICY_LITERAL);
  });

  it("E5 a panel mounted with NO jurisdiction warns that the jurisdiction is unknown", async () => {
    /* The prop is optional, so every existing mount of this panel keeps working —
       and rather than assuming a US vehicle, an unrecorded jurisdiction produces
       the explicit "confirm before issuing" statement. */
    mount();
    await waitFor(() => expect(screen.getByTestId("spv-k1-panel")).toBeTruthy());
    expect(screen.getByTestId("spv-k1-jurisdiction-unknown").textContent).toBe(
      SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE,
    );
    expect(screen.queryByTestId("spv-k1-jurisdiction-not-this-vehicle")).toBeNull();
  });

  it("E6 generation is LABELLED, not removed — the control is untouched by jurisdiction", async () => {
    /* The considered position of this wave, asserted so it cannot be quietly
       reversed into a gate: a US-taxable investor in a non-US feeder does receive
       a US Schedule K-1, so the tool stays available and the surface tells the
       truth about what it produces.

       The control's `disabled` state is owned by WAVE 141 — it is gated on a
       valid tax year having been entered, and on nothing else. So this asserts
       EQUALITY of that state across a US and a non-US vehicle rather than a bare
       `false`: whatever wave 141 decides, jurisdiction must not change it. */
    mount("hong_kong");
    await waitFor(() => expect(screen.getByTestId("spv-k1-generate")).toBeTruthy());
    const nonUs = screen.getByTestId("spv-k1-generate") as HTMLButtonElement;
    const nonUsDisabled = nonUs.disabled;
    expect(nonUs.textContent).toContain("Generate drafts");
    /* and the warning the GP must read is on the same screen as that control */
    expect(screen.getByTestId("spv-k1-jurisdiction-warning")).toBeTruthy();

    cleanup();
    mount("delaware");
    await waitFor(() => expect(screen.getByTestId("spv-k1-generate")).toBeTruthy());
    const us = screen.getByTestId("spv-k1-generate") as HTMLButtonElement;
    expect(us.disabled).toBe(nonUsDisabled);
    expect(us.textContent).toBe(nonUs.textContent);
  });
});
