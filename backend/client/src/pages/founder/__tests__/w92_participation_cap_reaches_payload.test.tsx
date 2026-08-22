/**
 * WAVE 92 · ITEM 2 — THE PARTICIPATION CAP REACHES THE CREATE PAYLOAD.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. `RoundNew.tsx` rendered "Participation cap (×)" at `:2155`,
 * bound it to `form.capParticipation`, accepted whatever a founder typed, POSTed,
 * and returned success — and the value appeared NOWHERE in the `POST /api/rounds`
 * body. **Every participation cap ever typed into Capavate was silently
 * discarded.** So were `liqPrefMultiple` (`:2142`) and `participating` (`:2150`),
 * which means it was not possible, through this wizard, to create a preferred
 * class whose exit proceeds the platform could compute at all.
 *
 * It was found BY ACCIDENT by Wave 94, which had just made the platform honour
 * caps correctly: 766 of 4,000 randomised cap tables published a wrong figure
 * while a recorded cap was ignored, 556 of them UNDERPAID THE FOUNDERS, ZERO
 * overpaid them, and the largest single error measured was $32,129,870.13.
 *
 * This is the FIFTH instance of the class Wave 80 found four of, and this file is
 * deliberately built on Wave 80's own harness
 * (`w80_round_disclosure_reaches_payload.test.tsx`) rather than a new one — same
 * method, same poles, so the two are comparable.
 *
 * WHAT THIS TEST PROVES, and why it is not a handler test. It asserts the ACTUAL
 * TYPED VALUE in the ACTUAL REQUEST BODY that leaves the browser. A test that only
 * proved an `onChange` fired is exactly what let four of these survive six waves
 * of green suites.
 *
 * FOUR POLES:
 *   PERSIST pole — a cap typed in appears in the body, AND the liquidation
 *                  preference is composed in the wording the SERVER's one reader
 *                  parses, so the cap is not inert on arrival.
 *   EMPTY pole   — no cap typed: the key is ABSENT, never `""` and never `0`.
 *                  ABSENT and UNREADABLE are different things to the reader, and
 *                  Wave 94 made that distinction the point of three refusals.
 *   GATE pole    — a cap typed and then participation switched OFF is NOT sent: a
 *                  ceiling on a class that does not participate cannot bind, and
 *                  the founder's final answer is "non-participating".
 *   DOMAIN pole  — the client does NOT pre-validate. `50` is out of domain and is
 *                  still SENT, because Wave 94 fenced all three writers with ONE
 *                  imported validator and a second client-side domain check would
 *                  drift from `PARTICIPATION_CAP_MAX` (R21). The server refuses it.
 *
 * MUTATION TRANSCRIPT: `build_log/wave92/W92_TESTS.md`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundNew from "../RoundNew";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w92_item2",
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: "co_w92_item2", companyName: "W92 Co", billing: { plan: "founder_pro" } } },
  }),
}));

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
        return res(200, { id: "rnd_w92" });
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

/** Steps 1→2 on a PRICED PREFERRED round — the only path on which the
 *  liquidation-preference and participation controls are rendered at all. */
async function toPreferredTerms() {
  fireEvent.change(await screen.findByTestId("input-round-name"), { target: { value: "W92 Series A" } });
  fireEvent.click(screen.getByTestId("round-category-priced"));
  fireEvent.click(await screen.findByTestId("instrument-preferred"));
  fireEvent.click(screen.getByTestId("button-next"));
  return screen.findByTestId("switch-participating");
}

/** Fill step 2's required priced-round economics and walk to the schedule step. */
async function toSchedule() {
  fireEvent.change(screen.getByTestId("input-pre"), { target: { value: "30000000" } });
  fireEvent.change(screen.getByTestId("input-target"), { target: { value: "10000000" } });
  fireEvent.change(screen.getByTestId("input-shares"), { target: { value: "4000000" } });
  /* A post-formation PRICED round derives its price per share from pre-money / FD
     pre-money shares, so Step 2 will not advance without the FD count (Wave C
     v26.5.0, Shadie Finding 1a). */
  fireEvent.change(screen.getByTestId("input-fd-pre-money-shares"), { target: { value: "13000000" } });
  fireEvent.click(screen.getByTestId("button-next"));
  await screen.findByTestId("input-open");
  fireEvent.change(screen.getByTestId("input-open"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByTestId("input-close"), { target: { value: "2026-12-31" } });
}

async function submit() {
  fireEvent.click(screen.getByTestId("button-next"));
  await screen.findByTestId("step-investors");
  fireEvent.click(screen.getByTestId("button-next"));
  const create = await screen.findByTestId("button-create");
  fireEvent.click(create);
  await waitFor(() => expect(createBodies.length).toBe(1));
  return createBodies[0];
}

describe("WAVE 92 · ITEM 2 — the participation cap reaches the create payload", () => {
  beforeEach(() => {
    createBodies = [];
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("W92-DC-01 · PERSIST POLE — a typed cap is in the POST body, and the class is participating so it can bind", async () => {
    renderWizard();
    await toPreferredTerms();
    /* Participation ON is what reveals the cap control at all — proof the switch's
       own state reaches the render, and the only way to type a cap. */
    fireEvent.click(screen.getByTestId("switch-participating"));
    fireEvent.change(await screen.findByTestId("input-cap-part"), { target: { value: "2" } });
    await toSchedule();
    const body = await submit();

    /* THE ACTUAL TYPED VALUE, IN THE ACTUAL REQUEST BODY. */
    expect(body.capParticipation).toBe("2");
    /* AND THE TERM THAT MAKES IT BINDABLE, in the wording the server's single
       stored-terms reader parses. Without this the cap arrives INERT. */
    expect(body.liquidationPreference).toBe("1x participating");
  });

  it("W92-DC-02 · EMPTY POLE — no cap typed means the key is ABSENT, never \"\" and never 0", async () => {
    renderWizard();
    await toPreferredTerms();
    fireEvent.click(screen.getByTestId("switch-participating"));
    await toSchedule();
    const body = await submit();

    /* ABSENT, not present-and-empty. `absent` means "uncapped"; `""` would be an
       unreadable value, which the waterfall refuses BY NAME. */
    expect("capParticipation" in body).toBe(false);
    expect(body.capParticipation).toBeUndefined();
    /* The participating flag still travels, because the founder DID answer that. */
    expect(body.liquidationPreference).toBe("1x participating");
  });

  it("W92-DC-03 · GATE POLE — a cap typed and then participation switched OFF is not sent", async () => {
    renderWizard();
    await toPreferredTerms();
    fireEvent.click(screen.getByTestId("switch-participating"));
    fireEvent.change(await screen.findByTestId("input-cap-part"), { target: { value: "3" } });
    /* The founder changes their mind. Their final answer is non-participating, and
       a ceiling on a class that does not participate can never bind. */
    fireEvent.click(screen.getByTestId("switch-participating"));
    await toSchedule();
    const body = await submit();

    expect("capParticipation" in body).toBe(false);
    expect(body.liquidationPreference).toBe("1x non-participating");
  });

  it("W92-DC-04 · DOMAIN POLE — an out-of-domain cap is still SENT, for the server's one validator to refuse", async () => {
    renderWizard();
    await toPreferredTerms();
    fireEvent.click(screen.getByTestId("switch-participating"));
    fireEvent.change(await screen.findByTestId("input-cap-part"), { target: { value: "50" } });
    await toSchedule();
    const body = await submit();

    /* `50` is outside `PARTICIPATION_CAP_MAX` and `POST /api/rounds` refuses it with
       HTTP 400 and one imported sentence (Wave 94). The CLIENT does not second-guess
       that: a duplicate domain check here would be a second source of truth that
       drifts from the server's constant the first time it changes (R21). Sending it
       is correct; swallowing it silently would be the defect this wave is fixing. */
    expect(body.capParticipation).toBe("50");
  });
});
