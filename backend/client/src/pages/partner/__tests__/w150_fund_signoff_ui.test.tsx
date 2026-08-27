/**
 * WAVE 150 — the fund create screen presents the SAME sign-off the server now
 * records, and the managing-partner-only rule is SURFACED, not silent (R111 Q11).
 *
 * These are RENDERED-DOM pins, not source-text greps:
 *   1. the attestation a partner reads is byte-identical to the ONE shared
 *      constant the server writes as `attestationText`;
 *   2. no POST leaves the screen until name + type + legal name + assent exist;
 *   3. BOTH poles of the access removal — an associate sees the control still
 *      there, disabled, with a sentence naming the requirement; a managing
 *      partner with the same form state can submit.
 *
 * ANTI-VACUITY: the attestation text is compared against the shared module (not
 * a literal retyped here); every gate assertion also asserts the opposite pole;
 * and the captured request body is the client's own, read out of the mocked
 * transport rather than described.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ATTESTATION_TEXT_V1, attestationTextForType } from "@shared/spvAttestation";
import PartnerFunds from "../PartnerFunds";

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true;
}

let subRole = "managing_partner";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("wouter", () => ({
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w150",
      tier: "builder",
      subRole,
      identity: { userId: "u_w150", email: "w150@example.com", name: "W150 Partner" },
    },
  }),
}));

const sent: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (method !== "GET") sent.push({ method, url, body: (body ?? {}) as Record<string, unknown> });
      const payload = method === "GET" ? { funds: [] } : { fund: { id: "fund_w150" } };
      return {
        ok: true,
        status: method === "GET" ? 200 : 201,
        statusText: "ok",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      } as unknown as Response;
    },
  };
});

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function setValue(testid: string, value: string) {
  const el = screen.getByTestId(testid) as HTMLInputElement | HTMLSelectElement;
  fireEvent.change(el, { target: { value } });
}

/** Fill everything EXCEPT the sign-off fields. */
function fillFundBasics() {
  fireEvent.click(screen.getByTestId("partner-funds-new-toggle"));
  setValue("partner-fund-name", "W150 Growth Fund I");
  setValue("partner-fund-type", "closed_end");
}

beforeEach(() => {
  subRole = "managing_partner";
  sent.length = 0;
});
afterEach(() => cleanup());

describe("W150 — the fund screen renders the ONE shipped attestation", () => {
  /* ══ WAVE 169 — RE-ARGUED IN PLACE, NOT LOWERED (R98, wave-168 precedent). ══
     WAS: the fund screen's rendered text must equal `ATTESTATION_TEXT_V1`.
     WHY IT CHANGED: v1 names a "special-purpose vehicle", and this screen creates
     a FUND only. The pin was requiring the screen to show a sentence naming a
     product the signer was not creating (R77).
     WHAT IS PINNED INSTEAD: the rendered text is byte-identical to the shared
     authority for the type this screen creates (`attestationTextForType("fund")`)
     — the original anti-divergence property, unchanged — it NAMES a fund, it does
     NOT name a special-purpose vehicle, it is still a real ESIGN/UETA attestation,
     and v1 is still byte-intact for everything already signed. Two assertions
     become six. */
  it("the rendered text is byte-identical to shared/spvAttestation.ts and names a fund", () => {
    mount(<PartnerFunds />);
    fillFundBasics();
    const node = screen.getByTestId("partner-fund-attestation-text");
    const fundText = attestationTextForType("fund");
    expect(node.textContent).toBe(fundText);
    expect((node.textContent ?? "").length).toBe(fundText.length);
    expect(node.textContent).toContain("authorized to launch this fund on behalf of this Consortium Partner");
    expect(node.textContent).not.toContain("special-purpose vehicle");
    // it is a real ESIGN/UETA attestation, not a placeholder
    expect(fundText).toContain("ESIGN/UETA");
    // v1 is evidence for records signed before wave 169 and is untouched
    expect(ATTESTATION_TEXT_V1).toContain("authorized to launch this special-purpose vehicle on behalf of");
  });
});

describe("W150 — no fund is posted without the attestation", () => {
  it("the submit stays disabled and sends nothing until name + assent are given", async () => {
    mount(<PartnerFunds />);
    fillFundBasics();
    // name + type only: the sign-off is missing, so still gated
    expect(isDisabled(screen.getByTestId("partner-funds-create"))).toBe(true);
    fireEvent.click(screen.getByTestId("partner-funds-create"));
    expect(sent.length).toBe(0);

    // typed legal name but no assent → still gated
    setValue("partner-fund-signoff-legalname", "Ada Managing Partner");
    expect(isDisabled(screen.getByTestId("partner-funds-create"))).toBe(true);
    fireEvent.click(screen.getByTestId("partner-funds-create"));
    expect(sent.length).toBe(0);

    // assent given → enabled (opposite pole) and the payload carries both fields
    fireEvent.click(screen.getByTestId("partner-fund-signoff-accept"));
    expect(isDisabled(screen.getByTestId("partner-funds-create"))).toBe(false);
    fireEvent.click(screen.getByTestId("partner-funds-create"));
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0].url).toBe("/api/partner/me/funds");
    expect(sent[0].body.signoffLegalName).toBe("Ada Managing Partner");
    expect(sent[0].body.signoffAccepted).toBe(true);
  });
});

describe("W150 — the access removal is surfaced, not silent", () => {
  it("an associate keeps the control, sees it disabled, and is told why", () => {
    subRole = "associate";
    mount(<PartnerFunds />);
    fillFundBasics();
    setValue("partner-fund-signoff-legalname", "Cy Associate");
    fireEvent.click(screen.getByTestId("partner-fund-signoff-accept"));

    // the control is STILL RENDERED (not deleted) and disabled
    const btn = screen.getByTestId("partner-funds-create");
    expect(btn).toBeTruthy();
    expect(isDisabled(btn)).toBe(true);
    fireEvent.click(btn);
    expect(sent.length).toBe(0);

    // and the reason is a plain sentence naming the requirement
    const note = screen.getByTestId("partner-fund-role-note").textContent ?? "";
    expect(note.length).toBeGreaterThan(0);
    expect(note.toLowerCase()).toContain("managing partner");
    expect(note).not.toMatch(/PARTNER_SUB_ROLE_INSUFFICIENT|managing_partner/);
  });

  it("opposite pole: the same form state from a managing partner posts", async () => {
    subRole = "managing_partner";
    mount(<PartnerFunds />);
    fillFundBasics();
    setValue("partner-fund-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-fund-signoff-accept"));
    expect(isDisabled(screen.getByTestId("partner-funds-create"))).toBe(false);
    fireEvent.click(screen.getByTestId("partner-funds-create"));
    await waitFor(() => expect(sent.length).toBe(1));
  });

  it("the role note is an ALWAYS-rendered sibling (empty for a managing partner)", () => {
    subRole = "managing_partner";
    mount(<PartnerFunds />);
    fillFundBasics();
    // present in the DOM, and empty — the sibling shape does not change by role
    expect(screen.getByTestId("partner-fund-role-note").textContent).toBe("");
  });
});
