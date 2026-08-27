/**
 * WAVE 166 · BATCH 3 ITEM D · PATH 1 — THE MOUNTED GP CONFIRM STEP (R137.1).
 * ═══════════════════════════════════════════════════════════════════════════════
 * R137.1: "at least one test per wave must assert the RENDERED DOM of the MOUNTED
 * component — a passing store test is not evidence that a user sees anything."
 *
 * Wave 166's server tests prove the RULE (a soft-circle cannot become committed
 * without both affirmations). They cannot prove that a GP is ever ASKED. This file
 * mounts the control and reads rendered DOM only.
 *
 * WHAT EACH ASSERTION IS FOR, AND WHY NONE OF THEM IS VACUOUS.
 *
 *  T1 — both affirmations are ON SCREEN, as the owner's own sentences. Asserted
 *       against the EXPORTED constants rather than against substrings typed into
 *       this test, so a wording sweep that alters the legal assertion fails here
 *       instead of shipping silently. Both are asserted as SEPARATE nodes: one
 *       combined "I confirm everything" line would be a single click asserting two
 *       independent facts, which is the inference this wave removes.
 *  T2 — the button is DISABLED with nothing checked, DISABLED with only the
 *       documents checked, DISABLED with only the funds checked, and ENABLED only
 *       when both are. All four states are asserted because the loophole this
 *       wave closes is precisely a partial affirmation, and a test of only the
 *       first and last states would pass against a single-checkbox control.
 *  T3 — the CONSEQUENCE is stated before the act: what the LP owns, what the
 *       vehicle raised, and what the GP is billed. A control that moves money
 *       without naming what it moves is how confirming becomes a reflex.
 *  T4 — clicking with both checked sends BOTH booleans as literal `true`. This
 *       is the wire-level proof that the UI does not send a single flag the server
 *       would then have to interpret.
 *  T5 — a read-only GP is never presented with an enabled commit control.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  GpOfflineConfirmationPanel,
  GP_CONFIRM_DOCS_AFFIRMATION,
  GP_CONFIRM_FUNDS_AFFIRMATION,
  GP_CONFIRM_CONSEQUENCE_NOTICE,
  GP_CONFIRM_BLOCKED_HINT,
} from "../GpOfflineConfirmationPanel";

/* The exact request the panel makes is captured here. `apiRequest` is the single
   client HTTP chokepoint, so intercepting it records the WIRE payload rather than
   a component's internal state. */
const calls: Array<{ method: string; url: string; body: unknown }> = [];

vi.mock("@/lib/queryClient", () => ({
  apiRequest: async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        subscription: { id: "spvsub_w166", status: "committed" },
        confirmation: {
          documentsSigned: true,
          fundsReceived: true,
          affirmedBy: "u_avi_managing",
          affirmedAt: new Date().toISOString(),
        },
        stageLabel: "committed",
      }),
    };
  },
  queryClient: new QueryClient(),
}));

const toasts: Array<Record<string, unknown>> = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: Record<string, unknown>) => toasts.push(t) }),
}));

function mount(canWrite = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GpOfflineConfirmationPanel
        spvId="spv_w166"
        subscriptionId="spvsub_w166"
        stageLabel="soft-circled — not a commitment"
        canWrite={canWrite}
      />
    </QueryClientProvider>,
  );
}

const submit = () => screen.getByTestId("gp-offline-confirmation-submit") as HTMLButtonElement;
const docsBox = () => screen.getByTestId("gp-offline-confirmation-docs") as HTMLInputElement;
const fundsBox = () => screen.getByTestId("gp-offline-confirmation-funds") as HTMLInputElement;

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
});
afterEach(() => cleanup());

describe("W166 DOM — the mounted GP confirm step asks for BOTH offline conditions", () => {
  it("T1: both of the owner's affirmations are rendered, as two separate statements", () => {
    mount();
    /* Asserted against the EXPORTED constants — not against substrings typed
       here — so the legal sentence and the screen cannot drift apart. */
    expect(screen.getByText(GP_CONFIRM_DOCS_AFFIRMATION)).toBeTruthy();
    expect(screen.getByText(GP_CONFIRM_FUNDS_AFFIRMATION)).toBeTruthy();
    // The sentences say the things the owner required them to say.
    expect(GP_CONFIRM_DOCS_AFFIRMATION).toMatch(/documents .*are signed/i);
    expect(GP_CONFIRM_DOCS_AFFIRMATION).toMatch(/I have seen them/);
    expect(GP_CONFIRM_FUNDS_AFFIRMATION).toMatch(/funds .*are in the bank/i);
    expect(GP_CONFIRM_FUNDS_AFFIRMATION).toMatch(/I have seen them/);
    // TWO checkboxes, not one.
    expect(docsBox()).not.toBe(fundsBox());
    expect(docsBox().checked).toBe(false);
    expect(fundsBox().checked).toBe(false);
    /* The current stage is shown using the server's own label, and R132.3's
       wording rule holds: nothing on this control says "founder". */
    const stage = screen.getByTestId("gp-offline-confirmation-stage");
    expect(stage.textContent).toContain("soft-circled");
    expect(stage.textContent ?? "").not.toMatch(/founder/i);
  });

  it("T2: the commit control is enabled ONLY when both statements are checked", () => {
    mount();
    // (a) neither
    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId("gp-offline-confirmation-blocked-hint").textContent).toBe(
      GP_CONFIRM_BLOCKED_HINT,
    );

    // (b) documents only — a partial affirmation is still not a commitment
    fireEvent.click(docsBox());
    expect(docsBox().checked).toBe(true);
    expect(submit().disabled).toBe(true);

    // (c) funds only — the same in the other direction, so there is no asymmetry
    fireEvent.click(docsBox());
    fireEvent.click(fundsBox());
    expect(docsBox().checked).toBe(false);
    expect(fundsBox().checked).toBe(true);
    expect(submit().disabled).toBe(true);

    // (d) BOTH
    fireEvent.click(docsBox());
    expect(submit().disabled).toBe(false);
    expect(screen.getByTestId("gp-offline-confirmation-blocked-hint").textContent).toBe(
      "Both statements confirmed.",
    );
  });

  it("T3: the consequence of confirming is stated on screen before the act", () => {
    mount();
    const node = screen.getByTestId("gp-offline-confirmation-consequence");
    expect(node.textContent).toBe(GP_CONFIRM_CONSEQUENCE_NOTICE);
    // It names all three things that change.
    expect(node.textContent).toMatch(/this LP owns/i);
    expect(node.textContent).toMatch(/the vehicle has raised/i);
    expect(node.textContent).toMatch(/what you are billed/i);
    expect(node.textContent).toMatch(/committed capital/i);
  });

  it("T4: confirming sends BOTH booleans as literal true on the wire", async () => {
    mount();
    fireEvent.click(docsBox());
    fireEvent.click(fundsBox());
    fireEvent.click(submit());

    await waitFor(() => expect(calls.length).toBe(1));
    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url).toBe("/api/partner/me/spv/spv_w166/subscriptions/spvsub_w166/gp-confirm");
    const body = c.body as Record<string, unknown>;
    /* STRICT identity, not truthiness: the server accepts only `true` and this
       assertion is what proves the client sends what the server accepts. */
    expect(body.documentsSigned).toBe(true);
    expect(body.fundsReceived).toBe(true);

    // And the boxes reset, so the affirmation cannot be replayed by accident.
    await waitFor(() => expect(docsBox().checked).toBe(false));
    expect(fundsBox().checked).toBe(false);
    expect(submit().disabled).toBe(true);
  });

  it("T5: a read-only GP gets no enabled commit control at all", () => {
    mount(false);
    expect(submit().disabled).toBe(true);
    expect(docsBox().disabled).toBe(true);
    expect(fundsBox().disabled).toBe(true);
    // The statements are still READABLE — hiding them would hide the rule.
    expect(screen.getByText(GP_CONFIRM_DOCS_AFFIRMATION)).toBeTruthy();
    expect(screen.getByText(GP_CONFIRM_FUNDS_AFFIRMATION)).toBeTruthy();
  });
});
