/**
 * WAVE 169 — THE SIGNED SENTENCE, THE LAUNCH BUTTON AND THE CONFIRMATION MUST
 * NAME THE VEHICLE THE PARTNER IS ACTUALLY CREATING (R77, R111 Q11).
 *
 * THE DEFECT, verified on the shipped tree before this wave:
 *   shared/spvAttestation.ts   ATTESTATION_TEXT_V1 — "…authorized to launch this
 *                              special-purpose vehicle on behalf of…"
 *   PartnerSpvEngine.tsx :1428 rendered that ONE sentence for all five types
 *                        :1448 button read "Launch SPV" for all five types
 *                        :616  toast read "SPV launched" for all five types
 * The wizard's type dropdown offers SPV: Single Deal, Fund, Syndicate,
 * SPV: Multi-Asset / Deal-by-Deal and Rolling Fund. A managing partner creating a
 * FUND therefore electronically signed, under ESIGN/UETA, a sentence naming a
 * special-purpose vehicle, pressed a button offering to launch an SPV, and was
 * told an SPV had launched. The attestation is the evidence of authorization.
 *
 * WHY THIS FILE IS RENDERED-DOM AND NOT A STORE TEST (R137.1). A passing resolver
 * test proves a function returns a string; it does not prove a partner ever sees
 * it. Every assertion here reads `textContent` out of the MOUNTED shipped wizard
 * after driving the real type dropdown with real DOM events, and the toast
 * assertions read the argument the component actually handed to `useToast`.
 *
 * ANTI-VACUITY:
 *  - No expected sentence is retyped here. The expected text is resolved from
 *    `@shared/spvAttestation` — the same authority the SERVER records — so a fix
 *    that changed only the component would fail, and so would one that changed
 *    only the shared module.
 *  - BOTH POLES per type: the rendered sentence must name that type's noun AND
 *    must not name the wrong one.
 *  - v1 IMMUTABILITY is asserted from the DOM as well as from the module: the
 *    single-deal SPV must still render `ATTESTATION_TEXT_V1` byte-for-byte, so
 *    this cannot be "fixed" by rewriting the sentence everybody already signed.
 *
 * FAIL-BEFORE is recorded in build_log/wave169/W169_TESTS.md with the raw run
 * retained under build_log/wave169/artefacts/.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";
import { ATTESTATION_TEXT_V1, attestationTextForType } from "@shared/spvAttestation";
import { SPV_TYPES, SPV_TYPE_LABELS } from "@shared/spvEngine";

/** Every toast the component raised, in order — the confirmation a user sees. */
const toasts: Array<Record<string, unknown>> = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (arg: Record<string, unknown>) => { toasts.push(arg); } }),
}));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_w169",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w169", email: "w169@example.com", name: "W169 Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

const sent: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
/** What the mocked server claims it created — the wizard reads the type off this. */
let createdSpvType: string | null = null;

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (method !== "GET") sent.push({ method, url, body: (body ?? {}) as Record<string, unknown> });
      const payload =
        method === "GET"
          ? { spvs: [] }
          : {
              spv: { id: "spv_w169", spvType: createdSpvType },
              mandate: { id: "m_w169" },
              fee: { id: "f_w169" },
            };
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

/**
 * Open the shipped wizard, SELECT `type` on step 1 through the real dropdown, and
 * fill everything the launch control is gated on. Leaves step 4 (sign-off)
 * mounted, which is where the attestation and the launch button live.
 */
function openWizardWithType(type: string) {
  mount();
  click("spv-engine-new");
  goToStep(0);
  set("spv-w-name", `W169 ${type} vehicle`);
  set("spv-w-type", type);
  /* Prove the selection actually took: an assertion about wording per type is
     worthless if the dropdown silently kept `spv`. */
  expect((screen.getByTestId("spv-w-type") as HTMLSelectElement).value).toBe(type);
  goToStep(2);
  fireEvent.click(
    screen.getByTestId("spv-w-carrybasis-whole_spv").querySelector("input") as HTMLInputElement,
  );
  goToStep(3);
  set("spv-w-target", "5000000");
  set("spv-w-mincheck", "25000");
  goToStep(4);
}

function completeSignoffAndLaunch() {
  click("spv-w-currency-confirm");
  set("spv-signoff-legalname", "Ada Managing Partner");
  click("spv-signoff-accept");
  click("spv-wizard-launch");
}

/** The vehicle noun each type must call itself, read from the shared authority. */
function shownAttestation(): string {
  return screen.getByTestId("spv-attestation-text").textContent ?? "";
}

beforeEach(() => {
  sent.length = 0;
  toasts.length = 0;
  createdSpvType = null;
});
afterEach(() => cleanup());

describe("WAVE 169 · A — the attestation in the DOM names the selected vehicle", () => {
  it("A1 — the five types render five correct sentences, and none names another product", () => {
    /* The list is the SHIPPED enum, not a list retyped here: adding a sixth type
       without wording fails this test rather than silently mis-naming itself. */
    expect(SPV_TYPES.length).toBe(5);
    const nouns: Record<string, string> = {
      spv: "special-purpose vehicle",
      multi_asset: "multi-asset special-purpose vehicle",
      syndicate: "syndicate",
      fund: "fund",
      rolling_fund: "rolling fund",
    };
    for (const type of SPV_TYPES) {
      openWizardWithType(type);
      const shown = shownAttestation();
      // it is the same bytes the server will record for this type
      expect(shown).toBe(attestationTextForType(type));
      expect(shown.length).toBe(attestationTextForType(type).length);
      // it names THIS vehicle …
      expect(shown).toContain(`authorized to launch this ${nouns[type]} on behalf of this Consortium Partner`);
      // … and it is still a real ESIGN/UETA attestation, not a truncated stub
      expect(shown.startsWith("I certify that I am authorized to launch")).toBe(true);
      expect(shown.endsWith("(ESIGN/UETA).")).toBe(true);
      cleanup();
    }
  });

  it("A2 — a FUND no longer signs the words 'special-purpose vehicle' (the reported defect)", () => {
    openWizardWithType("fund");
    const shown = shownAttestation();
    expect(shown).toContain("authorized to launch this fund on");
    expect(shown).not.toContain("special-purpose vehicle");
    expect(shown).not.toBe(ATTESTATION_TEXT_V1);
    // opposite pole, same mount path: a syndicate is not called a fund either
    cleanup();
    openWizardWithType("syndicate");
    const syn = shownAttestation();
    expect(syn).toContain("authorized to launch this syndicate on");
    expect(syn).not.toContain("special-purpose vehicle");
    expect(syn).not.toContain("this fund on");
    cleanup();
    openWizardWithType("rolling_fund");
    const roll = shownAttestation();
    expect(roll).toContain("authorized to launch this rolling fund on");
    expect(roll).not.toContain("special-purpose vehicle");
  });

  it("A3 — the single-deal SPV still renders ATTESTATION_TEXT_V1 BYTE-FOR-BYTE", () => {
    /* v1 is evidence: every record signed before this wave resolves to these
       bytes, so the sentence itself must not have been edited. */
    openWizardWithType("spv");
    const shown = shownAttestation();
    expect(shown).toBe(ATTESTATION_TEXT_V1);
    expect(shown.length).toBe(ATTESTATION_TEXT_V1.length);
    // and a multi-asset SPV is still an SPV — qualified, never renamed to a fund
    cleanup();
    openWizardWithType("multi_asset");
    const multi = shownAttestation();
    expect(multi).toContain("multi-asset special-purpose vehicle");
    expect(multi).not.toContain("this fund on");
  });
});

describe("WAVE 169 · B — the launch control and its confirmation name the vehicle", () => {
  it("B1 — the launch BUTTON in the DOM reads per type", () => {
    const expected: Record<string, string> = {
      spv: "Launch SPV",
      multi_asset: "Launch SPV",
      syndicate: "Launch syndicate",
      fund: "Launch fund",
      rolling_fund: "Launch rolling fund",
    };
    for (const type of SPV_TYPES) {
      openWizardWithType(type);
      const label = (screen.getByTestId("spv-wizard-launch").textContent ?? "").trim();
      expect(label).toBe(expected[type]);
      cleanup();
    }
    // the dropdown label and the button must agree about what a fund is
    openWizardWithType("fund");
    expect(SPV_TYPE_LABELS.fund).toBe("Fund");
    expect((screen.getByTestId("spv-wizard-launch").textContent ?? "").trim()).toBe("Launch fund");
    expect((screen.getByTestId("spv-wizard-launch").textContent ?? "")).not.toContain("SPV");
  });

  it("B2 — the success TOAST names the vehicle the server says it created", async () => {
    createdSpvType = "fund";
    openWizardWithType("fund");
    completeSignoffAndLaunch();
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const titles = toasts.map((t) => String(t.title ?? ""));
    expect(titles).toContain("Fund launched");
    expect(titles).not.toContain("SPV launched");
    // the payload really was a fund — the toast is not decoration over a wrong write
    const create = sent.find((s) => s.method === "POST" && s.url === "/api/partner/me/spv");
    expect(create).toBeTruthy();
    expect(create!.body.spvType).toBe("fund");
  });

  it("B3 — a single-deal SPV is still told 'SPV launched' (no churn for the correct case)", async () => {
    createdSpvType = "spv";
    openWizardWithType("spv");
    completeSignoffAndLaunch();
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts.map((t) => String(t.title ?? ""))).toContain("SPV launched");
  });

  it("B4 — a syndicate and a rolling fund get their own confirmations", async () => {
    createdSpvType = "syndicate";
    openWizardWithType("syndicate");
    completeSignoffAndLaunch();
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts.map((t) => String(t.title ?? ""))).toContain("Syndicate launched");

    cleanup();
    toasts.length = 0;
    createdSpvType = "rolling_fund";
    openWizardWithType("rolling_fund");
    completeSignoffAndLaunch();
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts.map((t) => String(t.title ?? ""))).toContain("Rolling fund launched");
  });

  it("B5 — an unreadable created type still produces a plain confirmation, never a blank one", async () => {
    /* Defensive pole: the server's echo is not trusted to be a known type. The
       wizard falls back to the type it submitted, and the label table falls back
       again to the single-deal wording. A blank toast title is a bug, not a
       graceful degradation. */
    createdSpvType = null;
    openWizardWithType("fund");
    completeSignoffAndLaunch();
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    const titles = toasts.map((t) => String(t.title ?? "").trim());
    expect(titles.some((t) => t.length > 0)).toBe(true);
    expect(titles).toContain("Fund launched");
  });
});
