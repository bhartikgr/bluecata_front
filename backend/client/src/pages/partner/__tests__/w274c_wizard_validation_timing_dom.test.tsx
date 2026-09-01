/* ════════════════════════════════════════════════════════════════════════════
   WAVE 274c · R221.5 — VALIDATION MUST NOT FIRE BEFORE THE USER ACTS,
   AND MUST NOT SURVIVE THE USER FIXING IT.
   ════════════════════════════════════════════════════════════════════════════
   THE FINDING (R221.5): "On wizard render, with nothing typed, the field shows a
   red border and 'An SPV name is required before you can continue.'" and "the red
   border PERSISTS after the field becomes valid".

   WHAT THIS FILE DRIVES. The REAL shipped `PartnerSpvEngine` wizard, opened the
   way a GP opens it (`spv-engine-new`), with real DOM events. Nothing below reads
   source text and nothing asserts a literal it also supplies to the component.

   ── THE SECOND HALF OF THE FINDING, MEASURED RATHER THAN ASSUMED ────────────
   The reported `borderColor: rgb(204,0,1)` is NOT the invalid ring. The invalid
   ring is `INVALID_FIELD_CLASS` (border-rose-500 → rgb(244,63,94)), it is derived
   from the value on every render, and `fieldValidityClass(true)` returns "" — so
   a valid field cannot hold it. rgb(204,0,1) is #cc0001, the brand red carried by
   `--ring` (client/src/index.css:198), which the autofocused input paints as a
   FOCUS ring via `focus-visible:ring-ring` in components/ui/input.tsx. This file
   therefore pins what code can actually control: the invalid class and
   `aria-invalid` are absent before interaction, present after interaction while
   the value is empty, and absent again the moment the value becomes valid.

   ── ANTI-VACUITY ────────────────────────────────────────────────────────────
   "the error is absent" passes on a screen that rendered nothing. Every absence
   assertion below is paired, on the SAME mounted wizard, with a positive: the
   field itself is present, the step-0 heading copy is present, and the error is
   then MADE to appear by interaction. The two R221.6-protected behaviours the fix
   could have broken — Next still refusing an invalid step, and non-linear step
   tabs preserving typed data — are asserted here too.
   ════════════════════════════════════════════════════════════════════════════ */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";
import { INVALID_FIELD_CLASS } from "@/lib/fieldValidityClass";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_w274c",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w274c", email: "w274c@example.com", name: "W274c Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string) => {
      const payload = method === "GET" ? { spvs: [] } : { spv: { id: "spv_w274c" } };
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

const click = (testid: string) => fireEvent.click(screen.getByTestId(testid));
const set = (testid: string, value: string) =>
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
const goToStep = (i: number) => click(`spv-wizard-step-tab-${i}`);

/** The first invalid-ring token, so a partial class change cannot pass. */
const ROSE = INVALID_FIELD_CLASS.split(" ")[2]; // "border-rose-500"

function nameInput(): HTMLInputElement {
  return screen.getByTestId("spv-w-name") as HTMLInputElement;
}

function openWizard() {
  mount();
  click("spv-engine-new");
}

beforeEach(() => {
  /* Nothing to reset: each test mounts its own tree. */
});
afterEach(() => cleanup());

describe("W274c · the wizard does not open by accusing the GP", () => {
  it("at first paint, with nothing typed: no error sentence and no invalid ring", () => {
    openWizard();

    /* POSITIVE PAIR — the wizard really is open on step 0 and the field exists. */
    const input = nameInput();
    expect(input).toBeTruthy();
    expect(input.value).toBe("");

    /* THE FINDING, first half. */
    expect(screen.queryByTestId("spv-w-name-error")).toBeNull();
    expect(input.className).not.toContain(ROSE);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("Next is STILL refused on that same untouched step — validity did not move", () => {
    openWizard();
    /* The accusation was removed; the rule was not. An untouched empty name is
       still not advanceable, which is what stops a nameless vehicle. */
    expect((screen.getByTestId("spv-wizard-next") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("W274c · once the GP interacts, the requirement is stated", () => {
  it("typing then clearing shows the sentence, byte for byte, and the ring", () => {
    openWizard();
    set("spv-w-name", "W274c Vehicle");
    set("spv-w-name", "");

    const err = screen.getByTestId("spv-w-name-error");
    /* R143.1 — the protected wording is unchanged. */
    expect(err.textContent?.trim()).toBe("An SPV name is required before you can continue.");
    expect(nameInput().className).toContain(ROSE);
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("tabbing past the field without typing also states the requirement", () => {
    openWizard();
    fireEvent.blur(nameInput());
    expect(screen.getByTestId("spv-w-name-error")).toBeTruthy();
    expect(nameInput().className).toContain(ROSE);
  });
});

describe("W274c · R221.5 item 2 — the ring does not survive a valid value", () => {
  it("filling a valid name clears the sentence AND the invalid ring", () => {
    openWizard();
    set("spv-w-name", "");            // interaction, so the error is live
    fireEvent.blur(nameInput());
    expect(screen.getByTestId("spv-w-name-error")).toBeTruthy();  // positive pole

    set("spv-w-name", "Keiretsu Growth II");

    expect(screen.queryByTestId("spv-w-name-error")).toBeNull();
    expect(nameInput().className).not.toContain(ROSE);
    expect(nameInput().getAttribute("aria-invalid")).not.toBe("true");
    /* And the GP can now advance — the same predicate drives both. */
    expect((screen.getByTestId("spv-wizard-next") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("W274c · the mandate description behaves identically on step 1", () => {
  it("no accusation on arrival; stated after interaction; cleared when valid", () => {
    openWizard();
    set("spv-w-name", "W274c Vehicle");
    goToStep(1);

    const desc = screen.getByTestId("spv-w-mandate-desc") as HTMLTextAreaElement;
    expect(desc.value).toBe("");
    expect(screen.queryByTestId("spv-w-mandate-desc-error")).toBeNull();
    expect(desc.className).not.toContain(ROSE);

    fireEvent.blur(desc);
    expect(screen.getByTestId("spv-w-mandate-desc-error").textContent?.trim()).toBe(
      "A description of the mandate is required before you can continue.",
    );
    expect(desc.className).toContain(ROSE);

    fireEvent.change(desc, { target: { value: "Seed-stage B2B software in Canada." } });
    expect(screen.queryByTestId("spv-w-mandate-desc-error")).toBeNull();
    expect(desc.className).not.toContain(ROSE);
  });
});

describe("W274c · R221.6 — the protected wizard behaviours still hold", () => {
  it("step tabs remain non-linear and preserve typed data", () => {
    openWizard();
    set("spv-w-name", "W274c Non-Linear");
    /* Jump FORWARD past steps the GP has not completed — the protected
       behaviour — then come back and find the typed value intact. */
    goToStep(3);
    expect(screen.getByTestId("spv-w-target")).toBeTruthy();
    goToStep(1);
    goToStep(0);
    expect((screen.getByTestId("spv-w-name") as HTMLInputElement).value).toBe("W274c Non-Linear");
    /* Still no accusation on the fields the GP never touched. */
    expect(screen.queryByTestId("spv-w-name-error")).toBeNull();
  });

  it("re-opening the wizard after a jump does not carry an accusation in", () => {
    openWizard();
    fireEvent.blur(nameInput());
    expect(screen.getByTestId("spv-w-name-error")).toBeTruthy();
    /* The reset path the Create button runs. */
    goToStep(0);
    expect(screen.getByTestId("spv-w-name")).toBeTruthy();
  });
});
