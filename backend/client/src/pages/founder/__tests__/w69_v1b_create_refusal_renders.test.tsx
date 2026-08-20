/**
 * WAVE 69 · V-1b (owner ruling R58, row 1) — THE CREATE WIZARD'S REFUSAL REACHES
 * THE DOM, AND THE R56 WARNING IS BESIDE THE CAP FIELD AS THE FOUNDER TYPES.
 *
 * ── WHY THIS SURFACE MATTERS MORE THAN THE EDIT DIALOG ──────────────────────
 * `POST /api/rounds` (`server/routes.ts:6676`) refuses with the SAME
 * `{ ok:false, error, message }` shape and the SAME 543-character sentence as the
 * PATCH — and `RoundNew.tsx:703`'s terminal `toast({ title: "Failed to create
 * round" })` discarded it. **Creation is where the corrupt live round came from.**
 *
 * ── WHY THIS FILE DRIVES THE REAL WIZARD ────────────────────────────────────
 * Every existing test of `RoundNew.tsx` in the tree reads the file AS TEXT
 * (`w52_round_wizard_disclosure.test.ts`, `w58_round_wizard_pool_percent.test.ts`,
 * and three more). A source-text assertion cannot prove a string REACHES A
 * SCREEN, which is the entire point of R58. So this file mounts the real
 * component, walks the real steps, stubs `global.fetch` (so the real
 * `throwIfResNotOk` and its 240-character gate are in the path) and asserts the
 * rendered text.
 *
 * POLES
 *   A · the create refusal renders VERBATIM through the real <Toaster/>, and the
 *       generic 240-char substitute does not.
 *   B · a date-shaped cap warns beside the field, and does NOT block Continue.
 *   C · the pre-existing `ROUND_NAME_DUPLICATE` branch keeps PRECEDENCE — the new
 *       branch must not swallow it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundNew from "../RoundNew";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  validateValuationCap,
  dateShapedValueWarning,
  type TermValueVerdict,
} from "@shared/roundMathEngineAdapter";

/* `TermValueVerdict` is a discriminated union; `message` lives only on the
   refusal arm. Narrowing it here also asserts the arm. */
function refusalOf(v: TermValueVerdict): string {
  expect(v.ok).toBe(false);
  if (v.ok) throw new Error("expected a refusal, got an accepted value");
  return v.message;
}

const GENERIC_400 = "Some of the information was invalid. Please review and try again.";

/* A PAID plan, so the wizard renders instead of `UpgradeToProInterstitial`
   (`RoundNew.tsx:1720`). Not part of this wave — just the precondition for the
   wizard being on screen at all. */
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w69_v1b",
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: "co_w69_v1b", companyName: "W69 Co", billing: { plan: "founder_pro" } } },
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

/** Step 1 → choose a post-money SAFE and name the round, then advance to Terms. */
async function toStep2() {
  fireEvent.change(await screen.findByTestId("input-round-name"), { target: { value: "W69 SAFE" } });
  fireEvent.click(screen.getByTestId("round-category-unpriced"));
  fireEvent.click(await screen.findByTestId("instrument-safe_post"));
  fireEvent.click(screen.getByTestId("button-next"));
  return screen.findByTestId("input-cap");
}

/** Fill a valid SAFE and walk to the final step where "Create round" lives. */
async function toFinalStep(cap: string) {
  fireEvent.change(screen.getByTestId("input-cap"), { target: { value: cap } });
  fireEvent.change(screen.getByTestId("input-target"), { target: { value: "500000" } });
  fireEvent.click(screen.getByTestId("button-next")); // 2 → 3 (Schedule)
  fireEvent.change(await screen.findByTestId("input-open"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByTestId("input-close"), { target: { value: "2026-12-31" } });
  fireEvent.click(screen.getByTestId("button-next")); // 3 → 4 (Investors)
  await screen.findByTestId("step-investors");
  fireEvent.click(screen.getByTestId("button-next")); // 4 → 5 (Review)
  return screen.findByTestId("button-create");
}

describe("WAVE 69 · V-1b — the CREATE surface renders the refusal and the warning", () => {
  beforeEach(() => {
    postResult = { status: 200, body: { id: "rnd_new" } };
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE B — a date-shaped cap warns beside the field and does NOT block Continue", async () => {
    const EXPECTED = dateShapedValueWarning("valuationCap", 20260707);
    expect(EXPECTED).toBeTruthy();
    renderWizard();
    const cap = await toStep2();
    /* The other required Step-2 field, so `step2Valid` is not held down by an
       unrelated error and the "not a block" assertion below is about R56 only. */
    fireEvent.change(screen.getByTestId("input-target"), { target: { value: "500000" } });
    expect(screen.queryByTestId("warn-valuationCap-date-shape")).toBeNull();
    fireEvent.change(cap, { target: { value: "20260707" } });
    const warn = await screen.findByTestId("warn-valuationCap-date-shape");
    expect(warn.textContent).toBe(EXPECTED);
    /* R56: a warning, never a block. `step2Valid` must be unaffected, so Continue
       stays enabled. If a later wave folds this into `step2Errors`, this fails. */
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(false);
    /* And it is not dressed as an error. */
    expect(screen.queryByTestId("err-valuationCap")).toBeNull();
    /* Narrowness, in the same test so a vacuous pass is impossible. */
    fireEvent.change(cap, { target: { value: "2026070" } });
    expect(screen.queryByTestId("warn-valuationCap-date-shape")).toBeNull();
  });

  it("POLE A — a 400 refusal from POST /api/rounds renders VERBATIM; the generic substitute does not", async () => {
    const MESSAGE = refusalOf(validateValuationCap(0));
    expect(MESSAGE.length).toBeGreaterThanOrEqual(240);
    postResult = { status: 400, body: { ok: false, error: "invalid_valuationCap", message: MESSAGE } };
    renderWizard();
    await toStep2();
    const create = await toFinalStep("8000000");
    fireEvent.click(create);
    /* Rendered by the REAL toast store + REAL <Toaster/>. */
    await waitFor(() => expect(screen.getAllByText(MESSAGE).length).toBeGreaterThanOrEqual(1));
    /* THE ASSERTION THAT PINS THE BOUNDARY DEFECT: `err.message` here is the
       generic sentence, so a fix that read it would show this instead. */
    expect(screen.queryByText(GENERIC_400)).toBeNull();
  });

  it("POLE C — the pre-existing ROUND_NAME_DUPLICATE branch keeps precedence", async () => {
    postResult = {
      status: 409,
      body: { ok: false, error: "ROUND_NAME_DUPLICATE", suggestedName: "W69 SAFE (2)", message: "dup" },
    };
    renderWizard();
    await toStep2();
    const create = await toFinalStep("8000000");
    fireEvent.click(create);
    /* The older, more specific branch returns early — it must not be shadowed. */
    await screen.findByText("Round name already used");
  });
});
