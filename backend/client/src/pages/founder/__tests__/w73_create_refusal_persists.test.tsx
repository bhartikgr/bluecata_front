/**
 * WAVE 73 · ITEM 3 — THE CREATION REFUSAL IS PERSISTENT COPY, NOT ONLY A TOAST.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAVE 69 LEFT SHORT, in its own words: it measured that a default toast
 * node is GONE ~10 SECONDS after it appears, concluded that "the primary
 * treatment is persistent inline copy" and did exactly that on the round-terms
 * EDIT dialog — but on the round CREATION wizard its only treatment was the
 * toast. That is the surface the corrupt live round came through.
 *
 * THE FIX ADDS; IT DOES NOT REPLACE (R44). The toast still fires, with the same
 * title, the same description and the same 30-second duration. A new sibling
 * block above the wizard's button row holds the same sentence until the founder
 * acts on it.
 *
 * BOTH POLES:
 *   REFUSAL pole    — the server's sentence is in the DOM in a node that is NOT
 *                     the toast (asserted by testid, and asserted to SURVIVE the
 *                     toast's own lifetime by advancing timers past it).
 *   LEGITIMATE pole — a successful creation renders no refusal block at all, and
 *                     a refusal with no server sentence does not invent one.
 *
 * MUTATION TRANSCRIPT: build_log/wave73/W73_TESTS.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundNew from "../RoundNew";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import { validateValuationCap, type TermValueVerdict } from "@shared/roundMathEngineAdapter";

function refusalOf(v: TermValueVerdict): string {
  expect(v.ok).toBe(false);
  if (v.ok) throw new Error("expected a refusal, got an accepted value");
  return v.message;
}

/** The generic substitute `queryClient` installs for a >240-character message. */
const GENERIC_400 = "Some of the information was invalid. Please review and try again.";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w73_item3",
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: "co_w73_item3", companyName: "W73 Co", billing: { plan: "founder_pro" } } },
  }),
}));

let postResult: { status: number; body: unknown } = { status: 200, body: { id: "rnd_new" } };

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

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (u === "/api/rounds" && method === "POST") return res(postResult.status, postResult.body);
      if (u.startsWith("/api/rounds/name-availability")) return res(200, { available: true });
      if (u.includes("/securities")) return res(200, []);
      if (u.includes("investor-crm")) return res(200, { contacts: [] });
      return res(200, {});
    }),
  );
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

async function toStep2() {
  fireEvent.change(await screen.findByTestId("input-round-name"), { target: { value: "W73 SAFE" } });
  fireEvent.click(screen.getByTestId("round-category-unpriced"));
  fireEvent.click(await screen.findByTestId("instrument-safe_post"));
  fireEvent.click(screen.getByTestId("button-next"));
  return screen.findByTestId("input-cap");
}

async function toFinalStep(cap: string) {
  fireEvent.change(screen.getByTestId("input-cap"), { target: { value: cap } });
  fireEvent.change(screen.getByTestId("input-target"), { target: { value: "500000" } });
  fireEvent.click(screen.getByTestId("button-next"));
  fireEvent.change(await screen.findByTestId("input-open"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByTestId("input-close"), { target: { value: "2026-12-31" } });
  fireEvent.click(screen.getByTestId("button-next"));
  await screen.findByTestId("step-investors");
  fireEvent.click(screen.getByTestId("button-next"));
  return screen.findByTestId("button-create");
}

describe("WAVE 73 · ITEM 3 — the creation refusal stays on the screen", () => {
  beforeEach(() => {
    postResult = { status: 200, body: { id: "rnd_new" } };
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("REFUSAL POLE — the server's sentence renders in a PERSISTENT node, not only the toast", async () => {
    const MESSAGE = refusalOf(validateValuationCap(0));
    expect(MESSAGE.length).toBeGreaterThanOrEqual(240);
    postResult = { status: 400, body: { ok: false, error: "invalid_valuationCap", message: MESSAGE } };
    renderWizard();
    await toStep2();
    const create = await toFinalStep("8000000");

    /* Nothing before the refusal — so the pass cannot be vacuous. */
    expect(screen.queryByTestId("create-round-refusal")).toBeNull();

    fireEvent.click(create);

    /* THE NODE THAT IS NOT A TOAST. */
    const inline = await screen.findByTestId("create-round-refusal-message");
    expect(inline.textContent).toBe(MESSAGE);
    expect(screen.getByTestId("create-round-refusal").getAttribute("role")).toBe("alert");
    /* Substance, phrase by phrase, out of the server's own validator. */
    expect(inline.textContent ?? "").toContain("valuation cap");
    /* The generic 240-character substitute must not be what a founder reads. */
    expect(screen.queryByText(GENERIC_400)).toBeNull();
    /* NO SILENT DROP — the wizard's own controls are still there beside it. */
    expect(screen.getByTestId("button-create")).toBeTruthy();
    expect(screen.getByTestId("button-prev")).toBeTruthy();
  });

  it("REFUSAL POLE — the copy OUTLIVES the toast: still in the DOM after the toast's own lifetime", async () => {
    const MESSAGE = refusalOf(validateValuationCap(0));
    postResult = { status: 400, body: { ok: false, error: "invalid_valuationCap", message: MESSAGE } };
    renderWizard();
    await toStep2();
    const create = await toFinalStep("8000000");
    fireEvent.click(create);
    await screen.findByTestId("create-round-refusal-message");

    /* The measurement Wave 69 recorded, exercised rather than quoted: push the
       clock past the toast's 30-second duration and the toast-removal delay. */
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    vi.useRealTimers();

    /* The inline sentence is STILL the founder's explanation. */
    expect(screen.getByTestId("create-round-refusal-message").textContent).toBe(MESSAGE);
  });

  it("LEGITIMATE POLE — a refusal with no server sentence invents nothing, and a success renders no block", async () => {
    /* (a) a failure whose body carries no `message`: the old terminal toast is
       still the treatment and NO inline block is fabricated. */
    postResult = { status: 500, body: { ok: false } };
    renderWizard();
    await toStep2();
    const create = await toFinalStep("8000000");
    fireEvent.click(create);
    await waitFor(() => expect(screen.getAllByText("Failed to create round").length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByTestId("create-round-refusal")).toBeNull();
    cleanup();

    /* (b) the success path is unchanged: no refusal block anywhere. */
    postResult = { status: 200, body: { id: "rnd_new" } };
    renderWizard();
    await toStep2();
    const create2 = await toFinalStep("8000000");
    fireEvent.click(create2);
    await waitFor(() => expect(screen.queryByTestId("create-round-refusal")).toBeNull());
  });
});
