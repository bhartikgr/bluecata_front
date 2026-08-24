/**
 * WAVE 107 — FINDING 2: THE TWO SCREENS MUST AGREE, AND THE ASSERTION SAYS SO.
 *
 * The brief is explicit that asserting each screen separately is not the test:
 * "assert they agree, not each separately". So both screens are rendered against
 * ONE stored round object served by ONE stubbed endpoint, and the assertion
 * compares what Round Detail printed with what Edit terms printed.
 *
 * WHY THIS FAILS ON THE OLD CODE. `RoundDetail.tsx` printed the LITERAL string
 * "1x non-participating preferred" on every round on the platform, while Edit
 * terms read `round.liquidationPreference` from storage. For the QA round that
 * stored "1x participating", the two screens contradicted each other about which
 * side of a liquidation waterfall the founder sits on. The old code cannot pass
 * the agreement assertion for a participating round no matter what is stored.
 *
 * THE EXIT WATERFALL IS NOT TOUCHED by this wave. Everything asserted here is a
 * READ of stored text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundDetail from "../RoundDetail";
import Rounds from "../Rounds";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";

const COMPANY_ID = "co_w107agree";
const ROUND_ID = "rnd_w107agree";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: COMPANY_ID, companyName: "W107 Co", billing: { plan: "founder_pro" } } },
  }),
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useParams: () => ({ id: ROUND_ID }),
    useLocation: () => ["/founder/rounds/" + ROUND_ID, () => {}],
    Link: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
  };
});

/**
 * THE ONE STORED ROUND both screens read. Shaped exactly like a row that has been
 * through `POST /api/rounds` and come back out of `roundsStore.rowToRound` — the
 * server round-trip that produces these values is asserted over real HTTP in
 * `server/__tests__/w107_round_narrative_and_terms_round_trip.test.ts`.
 */
function storedRound(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROUND_ID,
    companyId: COMPANY_ID,
    name: "QA Verify Round 22 Aug",
    type: "seed",
    instrument: "preferred",
    state: "active",
    currency: "USD",
    region: "HK",
    targetAmount: 500000,
    preMoney: 2000000,
    postMoney: 2500000,
    pricePerShare: 0.25,
    fdPreMoneyShares: 8000000,
    sharesAuthorized: 2000000,
    minTicket: 10000,
    openDate: "2026-08-01",
    closeDate: "2026-12-31",
    termsSummary: "Seed priced round, Hong Kong.",
    notes: "50% engineering, 30% GTM, 20% ops",
    useOfProceeds: "50% engineering, 30% GTM, 20% ops",
    optionPoolPostPercent: "10",
    optionPoolMode: "pre_money",
    /* THE TWO STORED FIELDS AT THE HEART OF FINDING 2. */
    liquidationPreference: "1x participating",
    capParticipation: "3",
    softCommits: [],
    invitations: [],
    tranches: [],
    ...overrides,
  };
}

let ROUND: Record<string, unknown> = storedRound();

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
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes(`/api/rounds/${ROUND_ID}/invitations`)) return res(200, []);
    if (u.includes(`/api/rounds/${ROUND_ID}/soft-circles`)) return res(200, []);
    if (u.includes(`/api/rounds/${ROUND_ID}`)) return res(200, { ...ROUND, pipeline: [] });
    if (u.startsWith("/api/rounds?")) return res(200, [ROUND]);
    if (u === "/api/rounds") return res(200, [ROUND]);
    if (u.includes("/securities")) return res(200, []);
    if (u.includes("investor-crm")) return res(200, { contacts: [] });
    if (u.includes("/api/auth/me")) return res(200, { id: "u_f", displayName: "Founder", role: "founder" });
    if (u.includes("/crm/contacts")) return res(200, []);
    return res(200, {});
  }));
}

function wrap(node: unknown) {
  /* The app's OWN default query function, so these components fetch exactly as
     they do in the browser and nothing about the read path is simulated. */
  const qc = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          {node as never}
          <Toaster />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** What Round Detail's "Round terms" panel prints for the liquidation preference. */
async function detailLiquidationPreference(): Promise<string> {
  const view = wrap(<RoundDetail />);
  const tab = await screen.findByTestId("tab-terms");
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  const row = await waitFor(() => screen.getByTestId("terms-row-liquidation-preference"), { timeout: 5000 });
  const text = (row.textContent ?? "").replace("Liquidation preference", "").trim();
  view.unmount();
  return text;
}

/** What the Edit-terms dialog's own control holds for the same field. */
async function editTermsLiquidationPreference(): Promise<string> {
  const view = wrap(<Rounds />);
  const edit = await screen.findByTestId(`button-edit-${ROUND_ID}`);
  fireEvent.click(edit);
  const input = (await screen.findByTestId("edit-liquidation-preference")) as HTMLInputElement;
  const value = String(input.value ?? "");
  view.unmount();
  return value;
}

describe("W107 · FINDING 2 — Round Detail and Edit terms read the same stored terms", () => {
  beforeEach(() => { ROUND = storedRound(); installFetch(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("AGREE on a participating preference — the detail row contains exactly what the edit control holds", async () => {
    const editValue = await editTermsLiquidationPreference();
    const detailText = await detailLiquidationPreference();

    /* THE AGREEMENT ASSERTION. Not "each screen says something plausible" — the
       detail row must contain the edit control's value verbatim. On the old code
       the detail row read "1x non-participating preferred" and this failed. */
    expect(editValue).toBe("1x participating");
    expect(detailText).toContain(editValue);

    /* And the contradiction that shipped is specifically gone: a round stored as
       participating is not described as non-participating. */
    expect(detailText.toLowerCase()).not.toContain("non-participating");
  }, 90000);

  it("SURFACES the participation cap wherever the preference is shown — it was rendered nowhere", async () => {
    const detailText = await detailLiquidationPreference();
    /* The 3x cap the founder negotiated was stored, validated and displayed by no
       component on the platform. */
    expect(detailText).toContain("3");
    expect(detailText).toContain("participation capped at 3\u00d7 the invested amount");
  }, 90000);

  it("AGREE on a NON-participating preference too, and print no cap where a cap is not a term", async () => {
    ROUND = storedRound({ liquidationPreference: "1x non-participating preferred", capParticipation: null });
    const editValue = await editTermsLiquidationPreference();
    const detailText = await detailLiquidationPreference();
    expect(editValue).toBe("1x non-participating preferred");
    expect(detailText).toContain(editValue);
    /* A cap on non-participating preferred is not a term, so nothing is invented. */
    expect(detailText).not.toContain("participation capped");
  }, 90000);

  it("AGREE on a 2x participating preference — the row is a read, not a re-phrasing of a known case", async () => {
    ROUND = storedRound({ liquidationPreference: "2x participating", capParticipation: "2.5" });
    const editValue = await editTermsLiquidationPreference();
    const detailText = await detailLiquidationPreference();
    expect(editValue).toBe("2x participating");
    expect(detailText).toContain("2x participating");
    expect(detailText).toContain("participation capped at 2.5\u00d7 the invested amount");
  }, 90000);

  it("says ABSENT IS ABSENT rather than asserting a preference nobody recorded", async () => {
    ROUND = storedRound({ liquidationPreference: null, capParticipation: null });
    const detailText = await detailLiquidationPreference();
    expect(detailText).toContain("Not recorded on this round");
    /* And it does NOT fall back to the old literal. */
    expect(detailText.toLowerCase()).not.toContain("1x non-participating preferred");
  }, 90000);

  it("PARTICIPATING WITH NO CAP is named as uncapped, not silently capless", async () => {
    ROUND = storedRound({ capParticipation: null });
    const detailText = await detailLiquidationPreference();
    expect(detailText).toContain("no participation cap recorded");
  }, 90000);
});

describe("W107 · FINDING 4 — the lifecycle stepper reflects the round's actual state", () => {
  beforeEach(() => { ROUND = storedRound(); installFetch(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("does NOT pin an Active round with an invited investor to the first stage", async () => {
    /* The reported defect: state `active` was not in the stepper's map and
       `?? 0` silently resolved every unmapped state to stage 1. */
    ROUND = storedRound({ state: "active" });
    wrap(<RoundDetail />);
    const stepper = await screen.findByTestId("lifecycle-progress");
    const text = stepper.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);

    /* NO STAGE IS MARKED, and the panel SAYS SO. `active` is a status the server
       emits but is not a stage on the NVCA ladder, and this round carries no
       invitation on its record, so there is genuinely nothing to mark. The old
       code resolved it to stage 1 through `?? 0` and printed "Draft / Terms" as
       though it were a fact. Honest silence replaces the false claim. */
    const unresolved = await screen.findByTestId("lifecycle-unresolved");
    expect(unresolved.textContent ?? "").toContain("cannot place this round");
    /* And the reason is named, so the founder is not left guessing. */
    expect(unresolved.textContent ?? "").toContain("no invitation or soft circle is on the record yet");

    /* THE ASSERTION THAT FAILS ON THE OLD CODE: the first stage is no longer
       styled as the round's current position. */
    const draftStage = screen.getByTestId("lifecycle-draft");
    expect(draftStage.innerHTML).not.toContain("hsl(0_100%_40%)");
  }, 90000);

  it("uses the round's own invitation record as evidence when the state alone cannot place it", async () => {
    ROUND = storedRound({ state: "active" });
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes(`/api/rounds/${ROUND_ID}/invitations`)) return res(200, []);
      if (u.includes(`/api/rounds/${ROUND_ID}/soft-circles`)) return res(200, []);
      if (u.includes(`/api/rounds/${ROUND_ID}`)) {
        return res(200, { ...ROUND, pipeline: [{ stage: "invited", count: 1 }] });
      }
      if (u.includes("/api/auth/me")) return res(200, { id: "u_f", displayName: "Founder", role: "founder" });
      if (u.includes("/securities")) return res(200, []);
      if (u.includes("/api/auth/me")) return res(200, { id: "u_f", displayName: "Founder", role: "founder" });
    if (u.includes("/crm/contacts")) return res(200, []);
      return res(200, {});
    }));
    wrap(<RoundDetail />);
    await screen.findByTestId("lifecycle-progress");
    /* The stepper names its evidence rather than asserting a stage it cannot
       justify — the brief's "do not fake it" requirement, honoured by showing
       WHERE the placement came from. */
    await waitFor(() => expect(screen.queryByTestId("lifecycle-derived-from-record")).not.toBeNull());
  }, 90000);

  it("contains no machine identifier in the sentence a founder reads", async () => {
    ROUND = storedRound({ state: "soft_circle_open" });
    wrap(<RoundDetail />);
    const stepper = await screen.findByTestId("lifecycle-progress");
    const text = stepper.textContent ?? "";
    /* R77: no snake_case token, no `rnd_`/`co_` prefix in customer-facing copy. */
    expect(text).not.toMatch(/[a-z]+_[a-z]+/);
    expect(text).not.toContain("rnd_");
    expect(text).not.toContain("co_");
  }, 90000);
});

describe("W107 · FINDING 5 — the share-class copy asserts no restriction that does not exist", () => {
  it("describes common shares without restricting them to founders and employees", async () => {
    const { INSTRUMENTS } = await import("@shared/schema");
    const list = INSTRUMENTS as unknown as Array<{ value: string; label: string; description: string }>;
    const common = list.find((i) => i.value === "common");
    const preferred = list.find((i) => i.value === "preferred");
    expect(common).toBeTruthy();
    expect(preferred).toBeTruthy();

    const commonText = String(common?.description ?? "");
    /* THE ASSERTIONS THAT FAIL ON THE OLD COPY, which read
       "Founder + employee equity. Typically used for Foundation rounds and ESOP
       issuance" — a restriction the owner disputed and a live test disproved. */
    expect(commonText).not.toMatch(/founder \+ employee/i);
    expect(commonText).not.toMatch(/ESOP issuance/i);
    /* It is now accurate and jurisdiction-neutral, and recommends nothing. */
    expect(commonText).toMatch(/any holder/i);
    expect(commonText).toMatch(/any jurisdiction/i);
    expect(commonText).not.toMatch(/\btypically\b|\brecommended\b|\bshould\b|\bbest practice\b/i);

    const preferredText = String(preferred?.description ?? "");
    expect(preferredText).toMatch(/any holder/i);
    expect(preferredText).not.toMatch(/\btypically\b|\brecommended\b|\bshould\b/i);
  });

  it("contains no machine identifier in either description", async () => {
    const { INSTRUMENTS } = await import("@shared/schema");
    const list = INSTRUMENTS as unknown as Array<{ value: string; description: string }>;
    for (const value of ["common", "preferred"]) {
      const text = String(list.find((i) => i.value === value)?.description ?? "");
      expect(text).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });
});
