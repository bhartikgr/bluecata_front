/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 122 — WHAT THE INVITED INVESTOR ACTUALLY SEES.
 * ══════════════════════════════════════════════════════════════════════════════
 * Reviewer C's finding was not that a server field was wrong in the abstract.
 * It was that BOTH investor-facing screens PRINTED the wrong thing:
 *
 *   Invitations.tsx:307,378,381,385   → "$0 soft-circled of $5M", "0%", a bar at 0%
 *   InvitationDetail.tsx:609,876,879  → "$0 soft-circled · 0%" over a bar at 0%
 *
 * because `rounds.raised_amount` has NO WRITER anywhere in the product
 * (server/roundsStore.ts:278,326 insert the literal 0; server/routes.ts:7773
 * excludes `raisedAmount` from the accepted patch keys) and both payload
 * builders shipped it as `?? 0`.
 *
 * A server test cannot close this finding, because the defect is a RENDERED
 * SENTENCE. So this file renders the two real page components against a stubbed
 * fetch and asserts on text and on the DOM.
 *
 * WHY EVERY BLOCK FAILS ON THE OLD CODE
 * -------------------------------------
 *  · AC-1/AC-2 (a real book prints a NON-ZERO figure): the old cards divided and
 *    printed `raisedAmount`, which is 0 for this fixture — as it is for every
 *    real round. `450,000` appears nowhere in the old output.
 *  · AC-3 (the three states are NAMED): the old screens printed ONE scalar under
 *    the single word "soft-circled", conflating indication of interest, signed
 *    commitment and cash received. There were no per-state figures to find.
 *  · AC-4 (nothing on record → a SENTENCE, no figure, NO BAR): the old screens
 *    printed "$0 … 0%" and drew the bar track anyway. `queryAllByTestId` for the
 *    bar returns one element before, zero after.
 *  · AC-5 (a €2,000,000 round renders in EUR): `Inv` carried no `currency` at
 *    all (old Invitations.tsx:62-66), so `fmtUSD` defaulted to USD and printed
 *    "$2,000,000" for a euro round.
 *  · AC-6 (no currency on record → refuse, do not guess): the old detail builder
 *    sent `currency: round?.currency ?? "USD"`, so a round with no denomination
 *    was silently relabelled as dollars.
 *
 * R90 — NO authentication or session behaviour is touched or asserted here; the
 * auth stub is the shape Wave 116's founder render test already used.
 * R92/R93 — only this wave's own files are imported. No founder, admin or
 * partner screen is mounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Invitations from "../Invitations";
import InvitationDetail from "../InvitationDetail";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { roundMoneyOnRecord } from "../../../../../server/lib/roundRaisedTotals";
import { ROUND_CURRENCY_NOT_RECORDED_STATEMENT } from "@shared/roundCurrencyOnRecordView";

/* jsdom has neither ResizeObserver nor Element.hasPointerCapture. Same three
   lines of gap-filling as w116_founder_dashboard_money_truth.test.tsx. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const INV_ID = "inv_w122";
const ROUND_ID = "rnd_w122";

/* ── stubs ─────────────────────────────────────────────────────────────────── */

vi.mock("@/lib/realtimeSync", () => ({
  useRealtimeSync: () => {},
  realtimeSync: { start: () => {}, stop: () => {} },
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useParams: () => ({ id: INV_ID }),
    useSearch: () => "",
    useLocation: () => ["/investor/invitations", () => {}],
    Link: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
  };
});

/* The spine decides TAB MEMBERSHIP, not money. It is stubbed to place the one
   fixture row in every bucket the list reads so the card renders under the
   default "All" tab; its ladder derivations are left untouched (importActual). */
vi.mock("@/lib/investor/investorSpine", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/investor/investorSpine");
  return {
    ...actual,
    useInvestorSpine: () => ({
      allInvitations: [{ id: INV_ID, stage: "invited", raw: { id: INV_ID, expiresAt: null } }],
      pendingInvitations: [{ id: INV_ID, stage: "invited", raw: { id: INV_ID, expiresAt: null } }],
      softCircledInvitations: [],
      isLoading: false,
      isError: false,
    }),
  };
});

/* ── fixtures ──────────────────────────────────────────────────────────────── */

/** The projection the server really attaches, built by the SERVER'S OWN
 *  derivation (server/lib/roundRaisedTotals.ts) so the fixture cannot drift
 *  from the payload. Wave 114's soft-circle vocabulary: intent / confirmed /
 *  wired. NOT the round-state ladder (R91 — the two are not harmonised). */
function projection(rows: Array<{ status: string; amountMinor: number }>, opts: { currency: string; targetAmount: number | null }): unknown {
  return roundMoneyOnRecord({
    roundId: ROUND_ID,
    rows: rows.map((r, idx) => ({ id: `sc_${idx}`, roundId: ROUND_ID, currency: opts.currency, ...r })),
    fallbackCurrency: opts.currency,
    targetAmount: opts.targetAmount ?? undefined,
  });
}

/** €50,000 soft-circled · €150,000 committed · €300,000 funded
 *  → €450,000 subscribed (committed + funded) of a €2,000,000 target = 22.5%. */
const REAL_EUR_BOOK = [
  { status: "intent", amountMinor: 5_000_000 },
  { status: "confirmed", amountMinor: 15_000_000 },
  { status: "wired", amountMinor: 30_000_000 },
];

type Row = Record<string, unknown>;

function baseRow(overrides: Row = {}): Row {
  return {
    id: INV_ID,
    company: { id: "co_w122", name: "Helios Robotics", sector: "Industrial", description: "Autonomous inspection." },
    round: { id: ROUND_ID, name: "Series A", type: "series_a" },
    state: "invited",
    receivedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    closeDate: null,
    roundState: "soft_circle_open",
    targetAmount: 2_000_000,
    /* the writer-less column, now honestly null on the wire */
    raisedAmount: null,
    moneyOnRecord: projection(REAL_EUR_BOOK, { currency: "EUR", targetAmount: 2_000_000 }),
    currency: "EUR",
    minTicket: 250_000,
    preMoney: 18_000_000,
    hasProRata: false,
    ...overrides,
  };
}

/** Nothing on the book at all: the refusal case. */
function emptyBookRow(): Row {
  return baseRow({
    currency: "USD",
    moneyOnRecord: projection([], { currency: "USD", targetAmount: 5_000_000 }),
    targetAmount: 5_000_000,
  });
}

/** A round with NO currency recorded: must refuse, not guess USD. */
function noCurrencyRow(): Row {
  return baseRow({ currency: null });
}

let ROW: Row = baseRow();

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
    if (u === `/api/investor/invitations/${INV_ID}`) return res(200, ROW);
    if (u === "/api/investor/invitations" || u.startsWith("/api/investor/invitations?")) return res(200, [ROW]);
    if (u.includes("/api/auth/me")) return res(200, { id: "u_i", displayName: "Investor", role: "investor" });
    if (u.includes("/accreditation")) return res(200, { accredited: true });
    if (u.includes("/api/investor/profile")) return res(200, { id: "ip_1", accredited: true });
    if (u.includes("/wire-instructions")) return res(404, { message: "Not found" });
    if (u.includes("/decision")) return res(200, { record: null });
    if (u.includes("/api/investor/ma/intelligence")) return res(200, { acquirerFitScore: 10 });
    /* Everything unnamed answers an EMPTY LIST, not an object: the remaining
       consumers on these pages are list readers and an object would throw
       inside a `.map` and take the page down for the wrong reason. */
    return res(200, []);
  }));
}

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "returnNull" }) } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>{ui}</TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ROW = baseRow();
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ══ AC-1 · THE LIST SCREEN, REAL BOOK ═════════════════════════════════════ */

describe("W122 · AC-1 — Invitations.tsx prints a NON-ZERO subscribed figure for a real book", () => {
  it("prints €450,000 subscribed, not $0", async () => {
    mount(<Invitations />);
    const line = await waitFor(() => screen.getByTestId(`inv-subscribed-${INV_ID}`));
    expect(line.textContent).toMatch(/450,000/);
    expect(line.textContent).toMatch(/subscribed \(committed \+ funded\)/);
    /* The three states are NOT collapsed under the one word that used to
       describe all of them. */
    expect(line.textContent).not.toMatch(/soft-circled of/);
  });

  it("names the figure's state — the old screen called all three 'soft-circled'", async () => {
    mount(<Invitations />);
    await waitFor(() => screen.getByTestId(`inv-money-states-${INV_ID}`));
    expect(screen.getByTestId(`inv-money-softCircled-${INV_ID}`).textContent).toMatch(/50,000/);
    expect(screen.getByTestId(`inv-money-committed-${INV_ID}`).textContent).toMatch(/150,000/);
    expect(screen.getByTestId(`inv-money-funded-${INV_ID}`).textContent).toMatch(/300,000/);
  });

  it("prints a DERIVED percentage (22%), not the 0% the writer-less column forced", async () => {
    mount(<Invitations />);
    const pct = await waitFor(() => screen.getByTestId(`inv-progress-pct-${INV_ID}`));
    expect(pct.textContent).toMatch(/^2[23]% of target subscribed$/);
    expect(pct.textContent).not.toMatch(/\b0%/);
  });
});

/* ══ AC-2 · THE DETAIL SCREEN, REAL BOOK ═══════════════════════════════════ */

describe("W122 · AC-2 — InvitationDetail.tsx prints the same non-zero figure", () => {
  it("prints €450,000 subscribed with the state named, and a derived percentage", async () => {
    mount(<InvitationDetail />);
    const line = await waitFor(() => screen.getByTestId("text-round-subscribed"));
    expect(line.textContent).toMatch(/450,000/);
    expect(line.textContent).toMatch(/subscribed \(committed \+ funded\)/);
    expect(line.textContent).toMatch(/2[23]% of target/);
    expect(line.textContent).not.toMatch(/soft-circled ·/);
  });

  it("breaks the three states out separately on the detail card too", async () => {
    mount(<InvitationDetail />);
    await waitFor(() => screen.getByTestId("round-money-states"));
    expect(screen.getByTestId("round-money-softCircled").textContent).toMatch(/50,000/);
    expect(screen.getByTestId("round-money-committed").textContent).toMatch(/150,000/);
    expect(screen.getByTestId("round-money-funded").textContent).toMatch(/300,000/);
  });

  it("DRAWS the progress bar when the ratio is real", async () => {
    mount(<InvitationDetail />);
    await waitFor(() => screen.getByTestId("bar-round-progress"));
    expect(screen.getAllByTestId("bar-round-progress")).toHaveLength(1);
  });
});

/* ══ AC-3 · NOTHING ON RECORD → A SENTENCE, NO FIGURE, NO BAR ══════════════ */

describe("W122 · AC-3 — an empty book yields a sentence, no number and NO progress bar", () => {
  beforeEach(() => {
    ROW = emptyBookRow();
    installFetch();
  });

  it("the list card states the position instead of printing a figure", async () => {
    mount(<Invitations />);
    const box = await waitFor(() => screen.getByTestId(`inv-money-not-recorded-${INV_ID}`));
    expect(box.textContent).toMatch(/no figure and no progress bar are shown/);
    expect(box.textContent).toMatch(/not the same as zero/);
    /* NO FIGURE AT ALL — not "$0", not "0%". */
    expect(box.textContent).not.toMatch(/\$\s?0\b/);
    expect(box.textContent).not.toMatch(/\b0%/);
    expect(screen.queryByTestId(`inv-subscribed-${INV_ID}`)).toBeNull();
    expect(screen.queryByTestId(`inv-progress-pct-${INV_ID}`)).toBeNull();
  });

  it("the detail card renders NO bar element whatsoever", async () => {
    mount(<InvitationDetail />);
    await waitFor(() => screen.getByTestId("text-round-money-not-recorded"));
    /* THE POINT OF THE WAVE: an empty bar is a false statement drawn as a
       picture, so the element must be ABSENT — not present at width 0%. */
    expect(screen.queryAllByTestId("bar-round-progress")).toHaveLength(0);
    expect(screen.queryByTestId("text-round-subscribed")).toBeNull();
    /* …and the panel STRUCTURE is intact: the money line and the progress
       region are both still rendered as the card's 3rd and 4th children
       (Wave 116's remedy for positional panel-child drops). */
    expect(screen.getByTestId("text-round-money-line")).toBeTruthy();
    expect(screen.getByTestId("round-money-progress-region")).toBeTruthy();
    expect(screen.getByTestId("text-round-progress-unavailable").textContent).toBeTruthy();
  });
});

/* ══ AC-4 · CURRENCY (FINDING 2) ═══════════════════════════════════════════ */

describe("W122 · AC-4 — a €2,000,000 round is rendered in EUROS, not dollars", () => {
  it("the detail target card denominates in EUR and never prints a dollar sign", async () => {
    mount(<InvitationDetail />);
    const target = await waitFor(() => screen.getByTestId("text-round-target"));
    /* The tile renders compactly, so the euro round reads "€2.0M". The defect
       was the SYMBOL, not the notation: this exact tile printed "$2.0M" before. */
    expect(target.textContent).toMatch(/^€2\.0M$/);
    expect(target.textContent).not.toMatch(/\$/);
    expect(screen.getByTestId("text-round-currency-note").textContent).toMatch(/Amounts shown in EUR/);
  });

  it("the list card denominates in EUR as well (the type carried no currency before)", async () => {
    mount(<Invitations />);
    const line = await waitFor(() => screen.getByTestId(`inv-subscribed-${INV_ID}`));
    expect(line.textContent).not.toMatch(/\$/);
  });

  it("keeps the pro-rata caption that the drop guard insisted on", async () => {
    mount(<InvitationDetail />);
    await waitFor(() => screen.getByTestId("text-round-currency-note"));
    expect(screen.getByText("Pro-rata for $250k+ investors")).toBeTruthy();
  });
});

describe("W122 · AC-5 — no currency on record: refuse, do not guess USD", () => {
  beforeEach(() => {
    ROW = noCurrencyRow();
    installFetch();
  });

  it("states that the denomination is unknown instead of labelling it dollars", async () => {
    mount(<InvitationDetail />);
    const note = await waitFor(() => screen.getByTestId("text-round-currency-note"));
    expect(note.textContent).toBe(ROUND_CURRENCY_NOT_RECORDED_STATEMENT);
    expect(screen.getByTestId("text-round-target").textContent).not.toMatch(/\$/);
    expect(screen.getByTestId("text-round-target").textContent).toMatch(/no currency on record/i);
  });
});
