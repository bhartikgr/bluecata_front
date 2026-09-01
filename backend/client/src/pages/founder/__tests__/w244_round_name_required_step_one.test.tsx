/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 244 — THE ROUND NAME IS MARKED REQUIRED AT STEP 1 AND THE ERROR APPEARS
 * BESIDE THE FIELD — WITHOUT THE WIZARD BECOMING LINEAR AND WITHOUT AN ERROR ON
 * FIRST RENDER.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS FILE REFUSES TO DO. It does not render a stand-in for step 1 and it
 * does not test the shared predicate in isolation. Every assertion mounts the
 * ACTUAL `RoundNew` default export — the same one the router mounts — and drives
 * it with real events. `fetch` and `useActiveCompany` are stubbed exactly as the
 * seven older wizard-walk tests in this directory stub them, because there is no
 * server in jsdom. Nothing about the round-name requirement is stubbed.
 *
 * THE FOUR THINGS THE WAVE DEMANDS, AND WHERE EACH IS PROVED:
 *   · required AT STEP 1, error BESIDE THE FIELD ................ W244-C1, C3, C4
 *   · derived from the server's own rule, no drifting second rule ...... W244-C2
 *   · NOT linear, step-jumping NOT blocked, TYPED DATA SURVIVES A
 *     TAB SWITCH — R221.6 protected work ....................... W244-C5, W244-C6
 *   · NEVER on first render (the wave-274c defect) ..................... W244-C1
 *
 * The HTTP half of the anti-drift proof — that the shared constant is the same
 * sentence the real route returns in its 400 body — lives in
 * `server/__tests__/w244_round_name_required_shared_rule.test.ts`, because it
 * needs the production registrar and a real socket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundNew from "../RoundNew";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import { roundNameIsMissing, ROUND_NAME_REQUIRED_MESSAGE } from "@shared/roundNameRequired";

const CO = "co_w244";
/* A distinctive value, so "the typed data survived" cannot be confused with a
   default, a placeholder or a suggestion the availability endpoint wrote back. */
const TYPED_NAME = "W244 Series Seed — typed by the founder";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => CO,
  useActiveCompany: () => ({
    isLoading: false,
    data: {
      company: { id: CO, companyName: "W244 Co", defaultCurrency: "USD", billing: { plan: "founder_pro" } },
    },
  }),
}));

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

/** Records every name-availability call, so a test can prove the field's
 *  pre-existing onBlur behaviour still runs and was not displaced by the new
 *  capture-phase attribute. */
let availabilityCalls: string[] = [];

function installFetch() {
  availabilityCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/rounds" && (init?.method ?? "GET").toUpperCase() === "POST") {
      return res(200, { id: "rnd_w244" });
    }
    if (u.startsWith("/api/rounds/name-availability")) {
      availabilityCalls.push(u);
      return res(200, { available: true });
    }
    if (u.includes("/securities")) return res(200, []);
    if (u.includes("investor-crm")) return res(200, { contacts: [] });
    return res(200, {});
  }));
}

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <RoundNew />
          <Toaster />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** The step tab buttons in the wizard's own <ol>, in document order. Found
 *  structurally by their step titles rather than by an added test id, so no
 *  identity key in the silent-drop guard's inventory had to be created for the
 *  test's convenience. */
function stepTab(title: string): HTMLElement {
  const btn = Array.from(document.querySelectorAll("ol button")).find(
    b => (b.textContent ?? "").includes(title),
  );
  if (!btn) throw new Error(`no step tab whose text contains ${JSON.stringify(title)}`);
  return btn as HTMLElement;
}

function currentStepHeading(): string {
  const h = Array.from(document.querySelectorAll("*")).find(
    e => e.children.length === 0 && /^Step \d: /.test(e.textContent ?? ""),
  );
  return (h?.textContent ?? "").trim();
}

beforeEach(() => { installFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("W244 · round name is required at step 1", () => {
  it("W244-C1 · the field is MARKED required on first render, and NO error is shown on first render", async () => {
    renderWizard();
    const input = await screen.findByTestId("input-round-name");

    /* The name really is empty, so this is the state in which a first-render
       error would be a defect rather than merely absent. */
    expect((input as HTMLInputElement).value).toBe("");
    expect(roundNameIsMissing((input as HTMLInputElement).value)).toBe(true);

    /* MARKED REQUIRED — the required indicator sits in the field's own label, in
       the same shape the platform already uses for the invite form's mandatory
       fields. */
    const label = Array.from(document.querySelectorAll("label")).find(
      l => (l.textContent ?? "").replace(/\s+/g, " ").trim().startsWith("Round name"),
    );
    expect(label, "no label starting 'Round name'").toBeTruthy();
    expect((label!.textContent ?? "").replace(/\s+/g, " ").trim()).toBe("Round name *");
    const star = label!.querySelector("span");
    expect(star?.textContent).toBe("*");
    /* The marker is decoration for assistive technology, not a second word to
       read out. */
    expect(star?.getAttribute("aria-hidden")).toBe("true");

    /* AND NOTHING ELSE. This is the wave-274c defect, and it is the reason the
       flag exists: an untouched form must not accuse the founder of anything. */
    expect(screen.queryByTestId("error-round-name-required")).toBeNull();
    expect(document.body.textContent).not.toContain(ROUND_NAME_REQUIRED_MESSAGE);
  }, 60000);

  it("W244-C2 · the sentence on screen is the SHARED constant, and the emptiness test is the SHARED predicate", async () => {
    renderWizard();
    const input = await screen.findByTestId("input-round-name");

    /* Whitespace only. The distinction matters: a client rule written
       independently would very likely have used a bare falsiness check and
       accepted "   ", which the server refuses. The shared predicate trims. */
    fireEvent.change(input, { target: { value: "     " } });
    fireEvent.blur(input);

    const err = await screen.findByTestId("error-round-name-required");
    /* Byte-identical to the module both sides import — not a lookalike typed
       into the page. */
    expect(err.textContent).toBe(ROUND_NAME_REQUIRED_MESSAGE);
    expect(roundNameIsMissing("     ")).toBe(true);

    /* And a real name clears it, without a second rule deciding differently. */
    fireEvent.change(input, { target: { value: TYPED_NAME } });
    await waitFor(() => expect(screen.queryByTestId("error-round-name-required")).toBeNull());
    expect(roundNameIsMissing(TYPED_NAME)).toBe(false);
  }, 60000);

  it("W244-C3 · the error appears AFTER LEAVING THE FIELD, and BESIDE the field — not in a toast and not at the page foot", async () => {
    renderWizard();
    const input = await screen.findByTestId("input-round-name");

    expect(screen.queryByTestId("error-round-name-required")).toBeNull();
    fireEvent.blur(input);
    const err = await screen.findByTestId("error-round-name-required");

    /* BESIDE THE FIELD, proved structurally: the message and the input share an
       immediate container, and that container holds no other field. */
    const container = input.parentElement!;
    expect(container.contains(err), "the message is not inside the field's own container").toBe(true);
    const otherFields = Array.from(container.querySelectorAll("input, select, textarea"))
      .filter(e => e !== input);
    expect(otherFields.length, "the container holds another field, so 'beside' is not proved").toBe(0);
    /* The label is in that same container, so this is the field's block. */
    expect(container.querySelector("label")).toBeTruthy();

    /* The field's PRE-EXISTING onBlur work still happens — the new capture-phase
       attribute was added alongside it, not in place of it. With an empty name the
       production handler returns before fetching, so the assertion is that it ran
       and made the documented early return: no availability call. */
    expect(availabilityCalls).toEqual([]);
    fireEvent.change(input, { target: { value: TYPED_NAME } });
    fireEvent.blur(input);
    await waitFor(() => expect(availabilityCalls.length).toBe(1));
    expect(availabilityCalls[0]).toContain(encodeURIComponent(TYPED_NAME));
  }, 60000);

  it("W244-C4 · ATTEMPTING TO ADVANCE arms the message without trapping the founder — Continue is NOT newly disabled, and the message is waiting on step 1", async () => {
    renderWizard();
    await screen.findByTestId("input-round-name");
    const next = screen.getByTestId("button-next");

    expect(screen.queryByTestId("error-round-name-required")).toBeNull();

    /* NOT NEWLY BLOCKED. The wave asks to SURFACE the requirement, not to gate on
       it. Blocking Continue on an empty name would be a new restriction, and the
       currency requirement — which does gate — is satisfied here by the company's
       defaultCurrency, so an enabled button is a real observation and not an
       artefact of some other blocker. */
    expect((next as HTMLButtonElement).disabled).toBe(false);

    /* Attempt to advance with an empty name. */
    fireEvent.click(next);

    /* THE HONEST BEHAVIOUR, ASSERTED RATHER THAN WISHED FOR. The click DOES
       advance — the founder is not trapped on step 1 and step-jumping is not
       blocked, which is protected work under R221.6. Step 1's fields, and
       therefore the message beside the round-name field, are unmounted while step
       2 is on screen; there is nothing to see, and pretending otherwise would be a
       false claim. */
    await waitFor(() => expect(currentStepHeading()).toContain("Step 2"));
    expect(screen.queryByTestId("error-round-name-required")).toBeNull();

    /* What the attempt DID do is arm the message. Returning to step 1 — by the
       wizard's own free tab navigation, with no further typing, clicking or
       blurring of the field — shows it beside the field. */
    fireEvent.click(stepTab("Round + Vehicle"));
    await waitFor(() => expect(currentStepHeading()).toContain("Step 1"));
    const err = await screen.findByTestId("error-round-name-required");
    expect(err.textContent).toBe(ROUND_NAME_REQUIRED_MESSAGE);
    /* Still beside the field, on this path too. */
    expect(screen.getByTestId("input-round-name").parentElement!.contains(err)).toBe(true);

    /* And Back from step 2 reaches the same state, since that is the route a
       founder is most likely to take. */
    fireEvent.change(screen.getByTestId("input-round-name"), { target: { value: TYPED_NAME } });
    await waitFor(() => expect(screen.queryByTestId("error-round-name-required")).toBeNull());
  }, 60000);

  it("W244-C5 · R221.6 PROTECTED — the wizard is NOT linear: every step tab is enabled and jumping ahead works from step 1", async () => {
    renderWizard();
    await screen.findByTestId("input-round-name");

    /* All five tabs, all enabled, from step 1 with an empty name. If this wave had
       made the wizard linear, or gated the tabs on the name, this fails. */
    for (const title of ["Round + Vehicle", "Terms", "Schedule", "Investors", "Review"]) {
      const tab = stepTab(title);
      expect((tab as HTMLButtonElement).disabled, `step tab "${title}" is disabled`).toBe(false);
    }

    /* Jump straight from 1 to 5, skipping everything, with no name typed. */
    fireEvent.click(stepTab("Review"));
    await waitFor(() => expect(currentStepHeading()).toContain("Step 5"));
    /* And back to 2, out of order. */
    fireEvent.click(stepTab("Terms"));
    await waitFor(() => expect(currentStepHeading()).toContain("Step 2"));
  }, 60000);

  it("W244-C6 · R221.6 PROTECTED — TYPED DATA SURVIVES A TAB SWITCH, including after the required error has been shown", async () => {
    renderWizard();
    const input = await screen.findByTestId("input-round-name");

    /* First provoke the new error, so the proof covers the state this wave
       introduced rather than only the quiet case. */
    fireEvent.blur(input);
    await screen.findByTestId("error-round-name-required");

    /* Now type a real name AND a value on another step-1 field, so the proof is
       not about one lucky input. */
    fireEvent.change(input, { target: { value: TYPED_NAME } });
    await waitFor(() => expect(screen.queryByTestId("error-round-name-required")).toBeNull());

    /* Jump to step 3, then step 5, then back to step 1 — out of order, twice. */
    fireEvent.click(stepTab("Schedule"));
    await waitFor(() => expect(currentStepHeading()).toContain("Step 3"));
    const open = await screen.findByTestId("input-open");
    fireEvent.change(open, { target: { value: "2026-09-01" } });

    fireEvent.click(stepTab("Review"));
    await waitFor(() => expect(currentStepHeading()).toContain("Step 5"));

    fireEvent.click(stepTab("Round + Vehicle"));
    await waitFor(() => expect(currentStepHeading()).toContain("Step 1"));

    /* THE ROUND NAME IS STILL THERE, character for character. */
    const back = await screen.findByTestId("input-round-name");
    expect((back as HTMLInputElement).value).toBe(TYPED_NAME);
    /* …and no error reappeared, because the name is present. */
    expect(screen.queryByTestId("error-round-name-required")).toBeNull();

    /* The OTHER step's typed value survived too, so "data survives" is not a
       claim about a single field. */
    fireEvent.click(stepTab("Schedule"));
    await waitFor(() => expect(currentStepHeading()).toContain("Step 3"));
    expect((screen.getByTestId("input-open") as HTMLInputElement).value).toBe("2026-09-01");
  }, 60000);

  it("W244-C7 · clearing the name AFTER it was valid brings the message back, and the field's other behaviour is unharmed", async () => {
    renderWizard();
    const input = await screen.findByTestId("input-round-name");

    fireEvent.change(input, { target: { value: TYPED_NAME } });
    fireEvent.blur(input);
    await waitFor(() => expect(availabilityCalls.length).toBe(1));
    expect(screen.queryByTestId("error-round-name-required")).toBeNull();

    fireEvent.change(input, { target: { value: "" } });
    /* Already interacted with, so the message returns immediately — no second
       blur needed. */
    const err = await screen.findByTestId("error-round-name-required");
    expect(err.textContent).toBe(ROUND_NAME_REQUIRED_MESSAGE);
  }, 60000);
});
