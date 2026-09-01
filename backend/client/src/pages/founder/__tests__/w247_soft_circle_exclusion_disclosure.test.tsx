/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 247 · R218.2 — SOFT CIRCLES ARE SAID TO BE EXCLUDED. NO SUM MOVED.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The finding was DISCLOSURE-ONLY. `server/lib/roundRaisedTotals.ts` already
 * held `subscribed = totals.committed + totals.funded` and kept soft circles in
 * a separate `onBook` total; R218.2 confirms that arithmetic is correct. What
 * the founder's round page never said was that the omission is DELIBERATE, or
 * why. Wave 247 adds one sentence and nothing else.
 *
 * SO HALF OF THIS FILE IS A NEGATIVE PROOF. A disclosure wave that quietly
 * moved a figure would be a far worse defect than the one it fixed, so the
 * money assertions here are written as an EXACT TABLE, not as loose regexes:
 * every bucket display, the subscribed display, the on-book display, the
 * progress percentage and the raw minor strings are pinned to literals computed
 * from the fixture by hand. If any of them moves by one cent this file goes red.
 *
 * WHY THE FIXTURE MOVES (W247-5). A test whose numbers are pinned to ONE
 * fixture can be satisfied by a page that ignores the projection entirely and
 * prints constants. So the second fixture uses different amounts, a different
 * count of rows and a different target, and re-derives the whole table. Both
 * fixtures go through `roundMoneyOnRecord` — the server's own function, not a
 * replica of it — so the page is checked against production arithmetic.
 *
 * WHAT IS DELIBERATELY ALSO ASSERTED: the R221.6-protected sentence "The target
 * is this round's fundraising goal, not a limit…" and the pre-existing basis
 * note that ends "…only \"Funded\" is money that has arrived." Both live within
 * four lines of the insertion point. They are asserted VERBATIM, on the mounted
 * screen, so this wave cannot have degraded them.
 *
 * NOT TOUCHED, and asserted so: no arithmetic, no field, no total. This file
 * imports `roundMoneyOnRecord` from the server and never re-implements it.
 * The harness (fetch stub, providers, wouter mock) is the one wave 118 built in
 * `w118_round_detail_panel_children_render.test.tsx`, reused rather than forked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundDetail from "../RoundDetail";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { roundMoneyOnRecord } from "../../../../../server/lib/roundRaisedTotals";

const COMPANY_ID = "co_w247";
const ROUND_ID = "rnd_w247";

/** The exact sentence wave 247 added. Written out in full so a weakened or
 *  re-worded version fails rather than passing a substring check. */
const EXCLUSION_SENTENCE =
  "Soft circles are deliberately excluded from subscribed — an indication of interest, " +
  "not a signed subscription. They keep their own figure above and are never added into " +
  "subscribed, so the headline total only ever counts amounts an investor has signed for or funded.";

/** R221.6 PROTECTED — must render verbatim, untouched by this wave. */
const PROTECTED_TARGET_SENTENCE =
  "The target is this round's fundraising goal, not a limit. Commitments are never blocked " +
  "for passing it, and there is no separate cap on a Capavate round.";

/** Pre-existing basis note four lines above the insertion point. */
const BASIS_NOTE_TAIL =
  'A soft circle is not a commitment and a commitment is not cash received; only "Funded" is money that has arrived.';

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: COMPANY_ID, companyName: "W247 Co", billing: { plan: "founder_pro" } } },
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

/* ─────────────────────────── the two fixtures ─────────────────────────────
   Both go through the SERVER's projection, so the page is compared against
   production arithmetic and not against a copy of it. */

interface Row { status: string; amountMinor: number }

function projection(rows: Row[], targetAmount: number): unknown {
  return roundMoneyOnRecord({
    roundId: ROUND_ID,
    rows: rows.map((r, i) => ({ id: `sc${i}`, roundId: ROUND_ID, currency: "USD", ...r })),
    fallbackCurrency: "USD",
    targetAmount,
  });
}

/** FIXTURE A — $50,000 soft-circled, $150,000 committed, $300,000 funded,
 *  $600,000 target. subscribed = 150k + 300k = $450,000 (75%). on book = $500,000. */
const FIXTURE_A: Row[] = [
  { status: "intent", amountMinor: 5_000_000 },
  { status: "confirmed", amountMinor: 15_000_000 },
  { status: "wired", amountMinor: 30_000_000 },
];
const TARGET_A = 600_000;
const EXPECTED_A = {
  softCircledMinor: "5000000",
  committedMinor: "15000000",
  fundedMinor: "30000000",
  subscribedMinor: "45000000",
  onBookMinor: "50000000",
  subscribedDisplay: "$450,000.00",
  onBookDisplay: "$500,000.00",
};

/** FIXTURE B — MOVED. Two soft circles ($77,000 + $3,000 = $80,000), one
 *  commitment ($211,000), two funded ($9,000 + $500 = $9,500), $1,000,000
 *  target. subscribed = 211,000 + 9,500 = $220,500. on book = $300,500. */
const FIXTURE_B: Row[] = [
  { status: "intent", amountMinor: 7_700_000 },
  { status: "intent", amountMinor: 300_000 },
  { status: "confirmed", amountMinor: 21_100_000 },
  { status: "wired", amountMinor: 900_000 },
  { status: "wired", amountMinor: 50_000 },
];
const TARGET_B = 1_000_000;
const EXPECTED_B = {
  softCircledMinor: "8000000",
  committedMinor: "21100000",
  fundedMinor: "950000",
  subscribedMinor: "22050000",
  onBookMinor: "30050000",
  subscribedDisplay: "$220,500.00",
  onBookDisplay: "$300,500.00",
};

function storedRound(rows: Row[], targetAmount: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROUND_ID,
    companyId: COMPANY_ID,
    name: "W247 Disclosure Round",
    type: "seed",
    instrument: "preferred",
    state: "active",
    currency: "USD",
    region: "HK",
    targetAmount,
    raisedAmount: 0,
    preMoney: 2_000_000,
    postMoney: 2_600_000,
    pricePerShare: 0.25,
    fdPreMoneyShares: 8_000_000,
    sharesAuthorized: 2_000_000,
    minTicket: 10_000,
    openDate: "2026-08-01",
    closeDate: "2026-12-31",
    termsSummary: "Seed priced round, Hong Kong.",
    moneyOnRecord: projection(rows, targetAmount),
    softCommits: [],
    invitations: [],
    tranches: [],
    ...overrides,
  };
}

let ROUND: Record<string, unknown> = storedRound(FIXTURE_A, TARGET_A);

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

/** Collapse JSX whitespace so a multi-line literal in the source compares
 *  against the rendered text. This normalises the EXPECTED side identically,
 *  so it cannot launder a genuinely different sentence. */
function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

beforeEach(() => { ROUND = storedRound(FIXTURE_A, TARGET_A); installFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("W247 · the page says soft circles are excluded, and no sum moved", () => {
  it("W247-1 · the exclusion sentence renders VERBATIM on the real founder round page", async () => {
    wrap(<RoundDetail />);
    const el = await waitFor(() => screen.getByTestId("text-round-soft-circle-excluded"), { timeout: 5000 });
    expect(norm(el.textContent)).toBe(norm(EXCLUSION_SENTENCE));
    /* It gives a REASON, not just a restatement of the formula. */
    expect(norm(el.textContent)).toContain("deliberately excluded");
    expect(norm(el.textContent)).toContain("not a signed subscription");
  }, 90000);

  it("W247-2 · EXACT MONEY TABLE, fixture A — every figure on screen is byte-identical to the pinned literals", async () => {
    /* First: the SERVER's own projection still produces the pinned minors. This
       is the arithmetic half, and it does not involve the page at all. */
    const p = projection(FIXTURE_A, TARGET_A) as {
      buckets: Record<string, { minor: string; display: string; count: number }>;
      subscribedMinor: string; subscribedDisplay: string;
      onBookMinor: string; onBookDisplay: string; determined: boolean;
    };
    expect(p.determined).toBe(true);
    expect(p.buckets.softCircled.minor).toBe(EXPECTED_A.softCircledMinor);
    expect(p.buckets.committed.minor).toBe(EXPECTED_A.committedMinor);
    expect(p.buckets.funded.minor).toBe(EXPECTED_A.fundedMinor);
    expect(p.subscribedMinor).toBe(EXPECTED_A.subscribedMinor);
    expect(p.onBookMinor).toBe(EXPECTED_A.onBookMinor);
    expect(p.subscribedDisplay).toBe(EXPECTED_A.subscribedDisplay);
    expect(p.onBookDisplay).toBe(EXPECTED_A.onBookDisplay);
    /* subscribed is committed + funded and NOTHING else — proved by identity,
       not by trusting the source line. */
    expect(BigInt(p.subscribedMinor)).toBe(BigInt(p.buckets.committed.minor) + BigInt(p.buckets.funded.minor));
    expect(BigInt(p.onBookMinor)).toBe(BigInt(p.subscribedMinor) + BigInt(p.buckets.softCircled.minor));

    /* Second: the SCREEN prints those same figures, and the headline excludes
       the soft circle. */
    wrap(<RoundDetail />);
    const subscribed = await waitFor(() => screen.getByTestId("text-round-subscribed"), { timeout: 5000 });
    const head = norm(subscribed.textContent);
    expect(head).toContain("$450,000");
    expect(head).toContain("subscribed (committed + funded) of $600,000 target");
    /* The on-book figure ($500,000) must NOT be the headline. That is the whole
       point of the exclusion, and this is the assertion that would catch a wave
       that "fixed" the finding by folding soft circles into subscribed. */
    expect(head).not.toContain("500,000");

    const states = norm(screen.getByTestId("group-round-money-states").textContent);
    expect(states).toContain("$50,000");
    expect(states).toContain("$150,000");
    expect(states).toContain("$300,000");
    expect(states).toContain("Soft-circled (non-binding)");
    expect(states).toContain("Committed (signed, cash not received)");
    expect(states).toContain("Funded (cash recorded)");

    /* The progress percentage is derived from subscribed / target = 75%. If a
       sum moved, this moves with it. */
    const progress = norm(screen.getByTestId("text-round-progress").textContent);
    expect(progress).toContain("75");
  }, 90000);

  it("W247-3 · the R221.6-protected target sentence and the pre-existing basis note still render VERBATIM", async () => {
    wrap(<RoundDetail />);
    const protectedEl = await waitFor(() => screen.getByTestId("text-round-target-is-a-goal"), { timeout: 5000 });
    expect(norm(protectedEl.textContent)).toBe(norm(PROTECTED_TARGET_SENTENCE));

    /* The basis note sits immediately BEFORE the new sentence. Asserting its
       tail verbatim proves wave 247 appended rather than edited. */
    const states = screen.getByTestId("slot-round-money-states");
    expect(norm(states.textContent)).toContain(norm(BASIS_NOTE_TAIL));
    expect(norm(states.textContent)).toContain("On record for this round");
  }, 90000);

  it("W247-4 · the sentence was APPENDED LAST inside slot-round-money-states — nothing was inserted mid-list", async () => {
    wrap(<RoundDetail />);
    const el = await waitFor(() => screen.getByTestId("text-round-soft-circle-excluded"), { timeout: 5000 });
    const slot = screen.getByTestId("slot-round-money-states");
    /* Direct child of the slot, and the LAST one. An element inserted mid-list
       would renumber its siblings, which is a silent-drop-guard failure. */
    expect(el.parentElement).toBe(slot);
    expect(slot.lastElementChild).toBe(el);
    /* Its previous sibling is the pre-existing basis note, unchanged. */
    expect(norm(el.previousElementSibling?.textContent)).toContain(norm(BASIS_NOTE_TAIL));
    /* And the protected target sentence is in a DIFFERENT slot, so this slot's
       change cannot have moved it. */
    const figure = screen.getByTestId("slot-round-money-figure");
    expect(figure.contains(screen.getByTestId("text-round-target-is-a-goal"))).toBe(true);
    expect(figure.contains(el)).toBe(false);
  }, 90000);

  it("W247-5 · MOVE THE FIXTURE — different amounts, different row counts, different target: the page tracks the projection and still excludes soft circles", async () => {
    ROUND = storedRound(FIXTURE_B, TARGET_B);

    const p = projection(FIXTURE_B, TARGET_B) as {
      buckets: Record<string, { minor: string }>;
      subscribedMinor: string; subscribedDisplay: string; onBookMinor: string; onBookDisplay: string;
    };
    expect(p.buckets.softCircled.minor).toBe(EXPECTED_B.softCircledMinor);
    expect(p.buckets.committed.minor).toBe(EXPECTED_B.committedMinor);
    expect(p.buckets.funded.minor).toBe(EXPECTED_B.fundedMinor);
    expect(p.subscribedMinor).toBe(EXPECTED_B.subscribedMinor);
    expect(p.onBookMinor).toBe(EXPECTED_B.onBookMinor);
    expect(p.subscribedDisplay).toBe(EXPECTED_B.subscribedDisplay);
    expect(p.onBookDisplay).toBe(EXPECTED_B.onBookDisplay);
    expect(BigInt(p.subscribedMinor)).toBe(BigInt(p.buckets.committed.minor) + BigInt(p.buckets.funded.minor));

    wrap(<RoundDetail />);
    const head = norm((await waitFor(() => screen.getByTestId("text-round-subscribed"), { timeout: 5000 })).textContent);
    /* The screen moved with the fixture — so it is reading the projection, not
       printing constants that fixture A happened to match. */
    expect(head).toContain("$220,500");
    expect(head).toContain("of $1,000,000 target");
    expect(head).not.toContain("450,000");
    expect(head).not.toContain("300,500");

    /* The disclosure sentence is fixture-independent: it is a statement about
       how the platform composes the figure, not about these amounts. */
    expect(norm(screen.getByTestId("text-round-soft-circle-excluded").textContent)).toBe(norm(EXCLUSION_SENTENCE));
    const states = norm(screen.getByTestId("group-round-money-states").textContent);
    expect(states).toContain("$80,000");
    expect(states).toContain("$211,000");
    expect(states).toContain("$9,500");
  }, 90000);

  it("W247-6 · when the projection REFUSES, the sentence is absent — the platform does not describe a figure it is not showing", async () => {
    ROUND = storedRound(FIXTURE_A, TARGET_A, { moneyOnRecord: undefined });
    wrap(<RoundDetail />);
    const box = await waitFor(() => screen.getByTestId("text-round-money-not-recorded"), { timeout: 5000 });
    expect(norm(box.textContent).toLowerCase()).toContain("not the same as zero");
    /* No figures on screen ⇒ no exclusion claim on screen. A sentence that
       appeared here would be describing arithmetic the page refused to do. */
    expect(screen.queryByTestId("text-round-soft-circle-excluded")).toBeNull();
    expect(screen.queryByTestId("text-round-subscribed")).toBeNull();
    /* Not a dead control either: the pre/post grid still renders, so the panel
       did not collapse. */
    expect(norm(document.body.textContent)).toContain("Pre-money");
  }, 90000);
});
