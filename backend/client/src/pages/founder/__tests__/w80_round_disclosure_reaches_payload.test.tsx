/**
 * WAVE 80 · ITEM 2 — THE FOUR DEAL-DISCLOSURE CONTROLS REACH THE CREATE PAYLOAD.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. `RoundNew.tsx` rendered four controls — "Round narrative for
 * investors", "Use of proceeds", "Round closes in tranches" and the tranche plan
 * — bound them to `form.notes`, `form.useOfProceeds`, `form.tranches` and
 * `form.tranchesPlan`, POSTed, and returned success. None of the four appeared in
 * the `POST /api/rounds` body, so a founder filled in the disclosure an investor
 * reads first, was told it saved, and lost every value.
 *
 * WHAT THIS TEST PROVES, and why it is not a handler test. It asserts the ACTUAL
 * TYPED STRINGS in the ACTUAL REQUEST BODY that leaves the browser — the JSON
 * `fetch` was called with — not that an `onChange` fired and not that a mutation
 * ran. A test that only proved a handler ran is exactly what let this defect
 * survive six waves of green suites.
 *
 * BOTH POLES:
 *   PERSIST pole — four values typed in, four values present in the body, byte
 *                  for byte, including the tranche plan behind its own switch.
 *   EMPTY pole   — nothing typed: all three text keys are `null` (never `""`,
 *                  because a blank field is not a value a founder entered) and
 *                  `tranchesEnabled` is `false`. A blank round cannot be
 *                  mistaken for a recorded one.
 *   SHAPE pole   — the tranche BOOLEAN is NOT sent under `tranches`. That key is
 *                  read elsewhere as an ARRAY of funded tranche events and is
 *                  reduced over; writing `true` into it would be a shape
 *                  collision, not a fix.
 *
 * MUTATION TRANSCRIPT: build_log/wave80/W80_TESTS.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundNew from "../RoundNew";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w80_item2",
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: "co_w80_item2", companyName: "W80 Co", billing: { plan: "founder_pro" } } },
  }),
}));

/** Every body this render POSTed to `/api/rounds`, in order. */
let createBodies: Array<Record<string, unknown>> = [];

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
      if (u === "/api/rounds" && method === "POST") {
        createBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return res(200, { id: "rnd_w80" });
      }
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

/** Steps 1→2: name + an unpriced SAFE, which is the shortest real path here. */
async function toStep2() {
  fireEvent.change(await screen.findByTestId("input-round-name"), { target: { value: "W80 SAFE" } });
  fireEvent.click(screen.getByTestId("round-category-unpriced"));
  fireEvent.click(await screen.findByTestId("instrument-safe_post"));
  fireEvent.click(screen.getByTestId("button-next"));
  return screen.findByTestId("input-cap");
}

/** Step 2→3, stopping ON the step that carries the four controls. */
async function toStep3() {
  fireEvent.change(screen.getByTestId("input-cap"), { target: { value: "8000000" } });
  fireEvent.change(screen.getByTestId("input-target"), { target: { value: "500000" } });
  fireEvent.click(screen.getByTestId("button-next"));
  await screen.findByTestId("input-open");
  fireEvent.change(screen.getByTestId("input-open"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByTestId("input-close"), { target: { value: "2026-12-31" } });
}

/** Step 3→submit. */
async function submit() {
  fireEvent.click(screen.getByTestId("button-next"));
  await screen.findByTestId("step-investors");
  fireEvent.click(screen.getByTestId("button-next"));
  const create = await screen.findByTestId("button-create");
  fireEvent.click(create);
  await waitFor(() => expect(createBodies.length).toBe(1));
  return createBodies[0];
}

const NARRATIVE =
  "We are raising to reach $4M ARR with the design partners already under contract. " +
  "The lead has verbally committed 60% of the round.";
const PROCEEDS = "50% engineering hires (12 FTE / 18mo); 20% compute; 22% GTM; 8% legal";
const PLAN =
  "Tranche 1: $300,000 concurrent with signing. Tranche 2: $200,000 on reaching $2M ARR by 2027-03-31.";

describe("WAVE 80 · ITEM 2 — founder deal disclosure reaches the create payload", () => {
  beforeEach(() => {
    createBodies = [];
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("PERSIST POLE — all four typed values are in the POST body, byte for byte", async () => {
    renderWizard();
    await toStep2();
    await toStep3();

    /* The four controls exist and are the ones the audit named. */
    fireEvent.change(screen.getByTestId("input-notes"), { target: { value: NARRATIVE } });
    fireEvent.change(screen.getByTestId("input-uop"), { target: { value: PROCEEDS } });
    fireEvent.click(screen.getByTestId("switch-tranches"));
    /* The plan textarea only exists once the switch is on — proof the switch's own
       state reached the render, and the only way to type a plan at all. */
    fireEvent.change(await screen.findByTestId("input-tranches-plan"), { target: { value: PLAN } });

    const body = await submit();

    /* THE ACTUAL STRINGS, IN THE ACTUAL REQUEST BODY. */
    expect(body.notes).toBe(NARRATIVE);
    expect(body.useOfProceeds).toBe(PROCEEDS);
    expect(body.tranchesEnabled).toBe(true);
    expect(body.tranchesPlan).toBe(PLAN);

    /* SHAPE POLE — the boolean is NOT written into the structured tranche key. */
    expect(body.tranches).toBeUndefined();
  });

  it("EMPTY POLE — a round with nothing typed sends null, never \"\", and tranches false", async () => {
    renderWizard();
    await toStep2();
    await toStep3();
    const body = await submit();

    expect(body.notes).toBeNull();
    expect(body.useOfProceeds).toBeNull();
    expect(body.tranchesPlan).toBeNull();
    expect(body.tranchesEnabled).toBe(false);
    /* Explicitly not the empty string: a blank field is not a recorded value. */
    expect(body.notes).not.toBe("");
    expect(body.useOfProceeds).not.toBe("");
  });

  it("EMPTY POLE — whitespace only is still nothing, and a plan behind an OFF switch is not sent", async () => {
    renderWizard();
    await toStep2();
    await toStep3();
    fireEvent.change(screen.getByTestId("input-notes"), { target: { value: "   \n  " } });
    fireEvent.change(screen.getByTestId("input-uop"), { target: { value: "\t" } });
    /* Turn tranches ON, type a plan, then turn it back OFF: the founder's final
       answer is "this round does not close in tranches", and the abandoned plan
       must not travel as if it did. */
    fireEvent.click(screen.getByTestId("switch-tranches"));
    fireEvent.change(await screen.findByTestId("input-tranches-plan"), { target: { value: PLAN } });
    fireEvent.click(screen.getByTestId("switch-tranches"));

    const body = await submit();
    expect(body.notes).toBeNull();
    expect(body.useOfProceeds).toBeNull();
    expect(body.tranchesEnabled).toBe(false);
    expect(body.tranchesPlan).toBeNull();
  });
});
