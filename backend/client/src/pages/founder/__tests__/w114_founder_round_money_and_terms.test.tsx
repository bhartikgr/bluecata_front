/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 114 — WHAT THE FOUNDER ACTUALLY SEES.
 * ══════════════════════════════════════════════════════════════════════════════
 * Both founder round screens are rendered against ONE stubbed round, the way
 * Wave 107's agreement test does, so nothing about the read path is simulated.
 * Every assertion is made on RENDERED TEXT: a screen cannot pass by holding a
 * correct value it does not print.
 *
 * WHY EACH BLOCK FAILS ON THE OLD CODE
 * ------------------------------------
 *  · FINDING 1 — both screens printed `{fmtUSD(r.raisedAmount)} soft-circled`,
 *    and `raisedAmount` has no writer anywhere in the product, so the words
 *    "$0 soft-circled" appeared on every real round. The old code cannot print a
 *    subscribed total, cannot name three states, and prints `$0` exactly where
 *    this test now demands a sentence.
 *  · FINDING 2 — four governance rows were hardcoded literals. The old file
 *    contains "1 founder, 1 investor, 1 mutual", "Quarterly financials + KPI
 *    dashboard", "standard NVCA form" and "majority of preferred"; the
 *    not-recorded assertions fail before and the source-lock fails before.
 *  · FINDING 3 — there was NO control for the participation cap. `getByTestId`
 *    for it throws on the old code.
 *  · FINDING 4 — the toast title was always "Terms saved" and named nothing but
 *    the persisted round, so a dropped field was invisible.
 *
 * NOT TOUCHED: authentication and session scoping (R90) — the stubs here are the
 * same ones Wave 107 already used. `CapTable.tsx`, investor and partner screens
 * and every dataroom file belong to other agents and are not imported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import RoundDetail from "../RoundDetail";
import Rounds, { describeSaveOutcome } from "../Rounds";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { roundMoneyOnRecord } from "../../../../../server/lib/roundRaisedTotals";

const COMPANY_ID = "co_w114";
const ROUND_ID = "rnd_w114";
const SRC_DIR = path.resolve(__dirname, "..");

/** SOURCE LOCK HELPER — the file with every comment removed, so a literal that
 *  survives only inside a Wave 114 explanation of why it was removed does not
 *  make the lock pass or fail for the wrong reason. */
function codeOf(file: string): string {
  const src = fs.readFileSync(path.join(SRC_DIR, file), "utf8");
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")  // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, " ")               // block comments
    .replace(/^\s*\/\/.*$/gm, " ");                    // line comments
}

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: COMPANY_ID, companyName: "W114 Co", billing: { plan: "founder_pro" } } },
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

/** The projection the server attaches, produced by the SERVER'S OWN derivation so
 *  the fixture cannot drift from what the API really sends. */
function projection(rows: Array<{ status: string; amountMinor: number }>): unknown {
  return roundMoneyOnRecord({
    roundId: ROUND_ID,
    rows: rows.map((r, i) => ({ id: `sc${i}`, roundId: ROUND_ID, currency: "USD", ...r })),
    fallbackCurrency: "USD",
    targetAmount: 600000,
  });
}

const THREE_STATES = [
  { status: "intent", amountMinor: 5_000_000 },     // $50,000 soft-circled
  { status: "confirmed", amountMinor: 15_000_000 }, // $150,000 committed
  { status: "wired", amountMinor: 30_000_000 },     // $300,000 funded
];

function storedRound(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROUND_ID,
    companyId: COMPANY_ID,
    name: "W114 Verify Round",
    type: "seed",
    instrument: "preferred",
    state: "active",
    currency: "USD",
    region: "HK",
    targetAmount: 600000,
    raisedAmount: 0, // the column with no writer, still zero, no longer read
    preMoney: 2000000,
    postMoney: 2600000,
    pricePerShare: 0.25,
    fdPreMoneyShares: 8000000,
    sharesAuthorized: 2000000,
    minTicket: 10000,
    openDate: "2026-08-01",
    closeDate: "2026-12-31",
    termsSummary: "Seed priced round, Hong Kong.",
    liquidationPreference: "1x participating",
    capParticipation: "3",
    moneyOnRecord: projection(THREE_STATES),
    softCommits: [],
    invitations: [],
    tranches: [],
    ...overrides,
  };
}

let ROUND: Record<string, unknown> = storedRound();
let PATCH_RESPONSE: Record<string, unknown> | null = null;
let PATCH_BODIES: Array<Record<string, unknown>> = [];

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
  PATCH_BODIES = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "PATCH" && u.includes(`/api/rounds/${ROUND_ID}/terms`)) {
      PATCH_BODIES.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return res(200, PATCH_RESPONSE ?? { ok: true, round: ROUND, savedFields: [], removedFields: [], notStoredFields: [] });
    }
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

async function openTermsTab() {
  const tab = await screen.findByTestId("tab-terms");
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

async function openEditTerms() {
  const edit = await screen.findByTestId(`button-edit-${ROUND_ID}`);
  fireEvent.click(edit);
}

beforeEach(() => { ROUND = storedRound(); PATCH_RESPONSE = null; installFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/* ════════════════════════════════════════════════════════════ FINDING 1 ════ */

describe("W114 · FINDING 1 — the founder's money figure is named, or not printed at all", () => {
  it("W114-UI-1 — ROUND DETAIL prints the SUBSCRIBED total off zero, and says what it counts", async () => {
    wrap(<RoundDetail />);
    const subscribed = await waitFor(() => screen.getByTestId("text-round-subscribed"), { timeout: 5000 });
    const text = subscribed.textContent ?? "";
    /* $450,000 committed + funded, from the rows — where the old header printed
       `$0 soft-circled` for the same round. */
    expect(text).toMatch(/450,000/);
    expect(text.toLowerCase()).toContain("subscribed");
    expect(text.toLowerCase()).toContain("committed");
    expect(text.toLowerCase()).toContain("funded");
    /* And it is no longer that sentence. */
    expect(text).not.toMatch(/\$0\b/);
  }, 90000);

  it("W114-UI-2 — the three states are shown SEPARATELY, each with its own words", async () => {
    wrap(<RoundDetail />);
    const group = await waitFor(() => screen.getByTestId("group-round-money-states"), { timeout: 5000 });
    const t = group.textContent ?? "";
    expect(t).toMatch(/50,000/);   // soft-circled
    expect(t).toMatch(/150,000/);  // committed
    expect(t).toMatch(/300,000/);  // funded
    expect(t).toContain("Soft-circled (non-binding)");
    expect(t).toContain("Committed (signed, cash not received)");
    expect(t).toContain("Funded (cash recorded)");
    /* A soft circle is never described as raised cash. */
    expect(screen.getByTestId("text-round-money-softCircled").textContent ?? "").toMatch(/50,000/);
    expect(screen.getByTestId("text-round-money-funded").textContent ?? "").toMatch(/300,000/);
  }, 90000);

  it("W114-UI-3 — with NO PROJECTION the screen STATES it does not know, and prints no total", async () => {
    ROUND = storedRound({ moneyOnRecord: undefined });
    wrap(<RoundDetail />);
    const box = await waitFor(() => screen.getByTestId("text-round-money-not-recorded"), { timeout: 5000 });
    const t = box.textContent ?? "";
    expect(t.toLowerCase()).toContain("not recorded");
    expect(t.toLowerCase()).toContain("not the same as zero");
    /* THE WHOLE POINT: no confident zero anywhere near the headline. */
    expect(screen.queryByTestId("text-round-subscribed")).toBeNull();
    expect(t).not.toMatch(/\$\s?0\b/);
  }, 90000);

  it("W114-UI-4 — the ROUNDS LIST card agrees with the detail header, figure and words", async () => {
    const detailView = wrap(<RoundDetail />);
    const detailText = (await waitFor(() => screen.getByTestId("text-round-subscribed"))).textContent ?? "";
    const detailStates = (screen.getByTestId("group-round-money-states").textContent ?? "");
    detailView.unmount();
    cleanup();

    wrap(<Rounds />);
    const card = await waitFor(() => screen.getByTestId(`round-subscribed-${ROUND_ID}`), { timeout: 5000 });
    const cardText = card.textContent ?? "";
    const cardStates = screen.getByTestId(`round-money-states-${ROUND_ID}`).textContent ?? "";
    /* THE AGREEMENT ASSERTION — the same money, the same nouns, on both screens. */
    for (const fragment of ["450,000", "subscribed"]) {
      expect(detailText.toLowerCase()).toContain(fragment.toLowerCase());
      expect(cardText.toLowerCase()).toContain(fragment.toLowerCase());
    }
    for (const label of ["Soft-circled (non-binding)", "Committed (signed, cash not received)", "Funded (cash recorded)"]) {
      expect(detailStates).toContain(label);
      expect(cardStates).toContain(label);
    }
    /* And the list no longer carries the sentence that was wrong on every round. */
    expect(cardText).not.toContain("soft-circled of");
  }, 90000);

  it("W114-UI-5 — the LIST also refuses rather than printing $0 when nothing is on record", async () => {
    ROUND = storedRound({ moneyOnRecord: projection([]) });
    wrap(<Rounds />);
    const box = await waitFor(() => screen.getByTestId(`round-money-not-recorded-${ROUND_ID}`), { timeout: 5000 });
    expect((box.textContent ?? "").toLowerCase()).toContain("not recorded");
    expect(screen.queryByTestId(`round-subscribed-${ROUND_ID}`)).toBeNull();
  }, 90000);

  it("W114-UI-6 — SOURCE LOCK: neither founder round screen reads `raisedAmount` for a headline figure", () => {
    for (const f of ["Rounds.tsx", "RoundDetail.tsx"]) {
      const code = codeOf(f);
      /* The exact expressions that printed the permanent zero on each screen. */
      expect(code).not.toContain("fmtUSD(r.raisedAmount)");
      expect(code).not.toContain("fmtUSD(round.raisedAmount)");
      expect(code).not.toContain("soft-circled of");
      /* And no arithmetic on it either — that was the 0% progress bar. */
      expect(code).not.toMatch(/raisedAmount\s*\//);
    }
  });
});

/* ════════════════════════════════════════════════════════════ FINDING 2 ════ */

describe("W114 · FINDING 2 — an unstored governance term is not printed as though negotiated", () => {
  it("W114-UI-7 — all four rows read NOT RECORDED when nothing is stored", async () => {
    wrap(<RoundDetail />);
    await openTermsTab();
    const panel = await waitFor(() => screen.getByTestId("terms-row-liquidation-preference").closest("div")?.parentElement as HTMLElement, { timeout: 5000 });
    const text = panel.textContent ?? "";
    /* The four literals the panel used to assert about every round. */
    expect(text).not.toContain("1 founder, 1 investor, 1 mutual");
    expect(text).not.toContain("Quarterly financials + KPI dashboard");
    expect(text).not.toContain("standard NVCA form");
    expect(text).not.toContain("majority of preferred");
    /* Replaced by an honest absence, four times over. */
    const notRecorded = (text.match(/Not recorded on this round/g) ?? []).length;
    expect(notRecorded).toBeGreaterThanOrEqual(4);
  }, 90000);

  it("W114-UI-8 — a STORED term is printed verbatim, and the not-recorded sentence is gone for it", async () => {
    ROUND = storedRound({
      boardComposition: "2 founder, 1 investor, 2 independent",
      informationRights: "Monthly management accounts",
      dragAlong: "Yes \u2014 majority of preferred and majority of common",
      rofrCoSale: "No",
    });
    wrap(<RoundDetail />);
    await openTermsTab();
    await waitFor(() => screen.getByTestId("terms-row-liquidation-preference"), { timeout: 5000 });
    const body = document.body.textContent ?? "";
    expect(body).toContain("2 founder, 1 investor, 2 independent");
    expect(body).toContain("Monthly management accounts");
    expect(body).toContain("Yes \u2014 majority of preferred and majority of common");
    /* And still not the invented ones. */
    expect(body).not.toContain("1 founder, 1 investor, 1 mutual");
    expect(body).not.toContain("standard NVCA form");
  }, 90000);

  it("W114-UI-9 — SOURCE LOCK: the four literals are gone from the file, not merely unrendered", () => {
    const code = codeOf("RoundDetail.tsx");
    for (const literal of [
      "1 founder, 1 investor, 1 mutual",
      "Quarterly financials + KPI dashboard",
      "standard NVCA form",
      "majority of preferred",
    ]) {
      expect(code).not.toContain(literal);
    }
    /* And the panel reads the four terms through the ONE shared reader. */
    expect(code).toContain("readGovernanceTerms");
  });
});

/* ════════════════════════════════════════════════════════════ FINDING 3 ════ */

describe("W114 · FINDING 3 — Edit terms has a control for the participation cap", () => {
  it("W114-UI-10 — the control EXISTS and is seeded from what is stored", async () => {
    wrap(<Rounds />);
    await openEditTerms();
    const input = (await screen.findByTestId("edit-participation-cap")) as HTMLInputElement;
    /* On the old code there is no such control at all. */
    expect(input).toBeTruthy();
    expect(String(input.value)).toBe("3");
  }, 90000);

  it("W114-UI-11 — a cap typed here is SENT, and the readback quotes the shared reader's own words", async () => {
    wrap(<Rounds />);
    await openEditTerms();
    const input = (await screen.findByTestId("edit-participation-cap")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2.5" } });
    /* The readback is produced by `shared/liquidationTermsReader`, the same module
       the exit calculation consults — not a sentence assembled here. */
    const readback = await waitFor(() => screen.getByTestId("edit-participation-cap-readback"));
    expect(readback.textContent ?? "").toContain("2.5");

    fireEvent.click(screen.getByTestId("button-save-terms"));
    await waitFor(() => expect(PATCH_BODIES.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(String(PATCH_BODIES[0].capParticipation)).toBe("2.5");
  }, 90000);

  it("W114-UI-12 — an OUT-OF-DOMAIN cap is refused at the control and never sent", async () => {
    wrap(<Rounds />);
    await openEditTerms();
    const input = (await screen.findByTestId("edit-participation-cap")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    const refusal = await waitFor(() => screen.getByTestId("edit-participation-cap-refusal"));
    expect((refusal.textContent ?? "").length).toBeGreaterThan(20);
    const save = screen.getByTestId("button-save-terms") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 50));
    expect(PATCH_BODIES.length).toBe(0);
  }, 90000);

  it("W114-UI-13 — CLEARING the cap sends an explicit removal, not a silent omission", async () => {
    wrap(<Rounds />);
    await openEditTerms();
    const input = (await screen.findByTestId("edit-participation-cap")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("button-save-terms"));
    await waitFor(() => expect(PATCH_BODIES.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(PATCH_BODIES[0].capParticipation).toBeNull();
  }, 90000);
});

/* ════════════════════════════════════════════════════════════ FINDING 4 ════ */

describe("W114 · FINDING 4 — the confirmation names what was saved, and what was not", () => {
  it("W114-UI-14 — `describeSaveOutcome` names saved, cleared and NOT STORED fields in founder words", () => {
    const saved = describeSaveOutcome({ savedFields: ["capParticipation", "liquidationPreference"], removedFields: [], notStoredFields: [] });
    expect(saved?.someNotStored).toBe(false);
    expect(saved?.sentence).toContain("participation cap");
    expect(saved?.sentence).toContain("liquidation preference");
    /* No internal identifiers in rendered copy (R77). */
    expect(saved?.sentence).not.toContain("capParticipation");

    const dropped = describeSaveOutcome({ savedFields: ["liquidationPreference"], removedFields: ["seniority"], notStoredFields: ["boardComposition"] });
    expect(dropped?.someNotStored).toBe(true);
    expect(dropped?.sentence).toContain("NOT STORED");
    expect(dropped?.sentence).toContain("board composition");
    expect(dropped?.sentence).toContain("Cleared seniority rank");

    /* An older server that sends none of the three arrays yields null, so the
       caller keeps Wave 83's sentence rather than inventing a claim. */
    expect(describeSaveOutcome({ ok: true })).toBeNull();
    /* And a save that changed nothing says exactly that. */
    expect(describeSaveOutcome({ savedFields: [], removedFields: [], notStoredFields: [] })?.sentence)
      .toContain("nothing was stored");
  });

  it("W114-UI-15 — the TOAST names the stored field instead of just 'Terms saved'", async () => {
    PATCH_RESPONSE = {
      ok: true,
      round: { ...storedRound(), capParticipation: "2.5" },
      savedFields: ["capParticipation"],
      removedFields: [],
      notStoredFields: [],
    };
    wrap(<Rounds />);
    await openEditTerms();
    fireEvent.change(await screen.findByTestId("edit-participation-cap"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByTestId("button-save-terms"));
    await waitFor(() => expect(document.body.textContent ?? "").toContain("participation cap"), { timeout: 5000 });
    expect(document.body.textContent ?? "").toContain("Saved");
  }, 90000);

  it("W114-UI-16 — a DROPPED field is announced AT THAT MOMENT, in the title, not left to be discovered", async () => {
    PATCH_RESPONSE = {
      ok: true,
      round: storedRound(),
      savedFields: ["liquidationPreference"],
      removedFields: [],
      notStoredFields: ["boardComposition"],
    };
    wrap(<Rounds />);
    await openEditTerms();
    fireEvent.change(await screen.findByTestId("edit-participation-cap"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByTestId("button-save-terms"));
    await waitFor(() => expect(document.body.textContent ?? "").toContain("NOT STORED"), { timeout: 5000 });
    const body = document.body.textContent ?? "";
    /* The title itself, not a sentence buried under a green success heading. */
    expect(body).toContain("Saved \u2014 but some values were NOT stored");
    expect(body).toContain("board composition");
  }, 90000);
});
