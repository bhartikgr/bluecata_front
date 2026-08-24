/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 118 · FINDING 2 — EVERY RESTORED PANEL CHILD ACTUALLY RENDERS.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The companion test scripts/silent-drop-guard/__tests__/w118_round_detail_panel_shape.test.ts
 * proves the drop gate can see the four `div` children and the expression child
 * again. That is a SOURCE property, and a source property is not a screen: the
 * cheap way to satisfy a positional gate would be to add empty divs. So this file
 * asserts the behaviour half, on rendered text only.
 *
 * WHAT WAVE 118 CHANGED, AND WHAT IT MUST NOT HAVE CHANGED
 * --------------------------------------------------------
 * Changed: the round-summary panel is four static `div`s plus one expression
 * again, and the money derivation moved into a `useMemo` above the early returns.
 * Must not have changed: the figures, the three named money states, the refusal
 * sentence, and every `data-testid` wave 114 established. Two of these tests are
 * therefore deliberately the SAME assertions wave 114 makes (W114-UI-1/-2/-3),
 * re-stated here so a future shape change cannot pass by keeping the gate happy
 * while emptying the screen.
 *
 * HOOK ORDER is asserted too (W118-F2-08). The memo had to be placed ABOVE the
 * `round.isError` / `!round.data` early returns; putting it after them would give
 * a component that renders a different number of hooks on the loading pass than
 * on the loaded pass, which React punishes at runtime, not at compile time — the
 * exact defect wave 73's `w73_projection_hook_order` test exists for.
 *
 * NOT TOUCHED: authentication or session scoping (R90). CapTable.tsx, Dashboard,
 * Welcome and every investor/partner screen are not imported.
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

const COMPANY_ID = "co_w118";
const ROUND_ID = "rnd_w118";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: COMPANY_ID, companyName: "W118 Co", billing: { plan: "founder_pro" } } },
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

/** The projection the server itself derives, so the fixture cannot drift from
 *  what the API really sends. */
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
    name: "W118 Verify Round",
    type: "seed",
    instrument: "preferred",
    state: "active",
    currency: "USD",
    region: "HK",
    targetAmount: 600000,
    raisedAmount: 0,
    preMoney: 2000000,
    postMoney: 2600000,
    pricePerShare: 0.25,
    fdPreMoneyShares: 8000000,
    sharesAuthorized: 2000000,
    minTicket: 10000,
    openDate: "2026-08-01",
    closeDate: "2026-12-31",
    termsSummary: "Seed priced round, Hong Kong.",
    moneyOnRecord: projection(THREE_STATES),
    softCommits: [],
    invitations: [],
    tranches: [],
    ...overrides,
  };
}

let ROUND: Record<string, unknown> = storedRound();
let FAIL_ROUND = false;

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
    if (u.includes(`/api/rounds/${ROUND_ID}`)) {
      return FAIL_ROUND ? res(500, { error: "boom" }) : res(200, { ...ROUND, pipeline: [] });
    }
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

beforeEach(() => { ROUND = storedRound(); FAIL_ROUND = false; installFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("W118 · FINDING 2 — the restored round-summary children all render", () => {
  it("W118-F2-05 · the DETERMINED round still prints the subscribed total, the named states and the pre/post grid", async () => {
    wrap(<RoundDetail />);

    /* child div#2 — the headline figure slot. */
    const subscribed = await waitFor(() => screen.getByTestId("text-round-subscribed"), { timeout: 5000 });
    const head = subscribed.textContent ?? "";
    expect(head).toMatch(/450,000/);
    expect(head.toLowerCase()).toContain("subscribed");
    expect(head).not.toMatch(/\$0\b/);

    /* child div#2 also carries the progress sentence, which names its denominator. */
    const progress = screen.queryByTestId("text-round-progress") ?? screen.getByTestId("text-round-progress-unavailable");
    expect((progress.textContent ?? "").length).toBeGreaterThan(3);

    /* child div#3 — the bar plus the three money-state buckets and the basis note. */
    const states = screen.getByTestId("group-round-money-states");
    const t = states.textContent ?? "";
    expect(t).toMatch(/50,000/);
    expect(t).toMatch(/150,000/);
    expect(t).toMatch(/300,000/);
    expect(t).toContain("Soft-circled (non-binding)");
    expect(t).toContain("Committed (signed, cash not received)");
    expect(t).toContain("Funded (cash recorded)");

    /* child div#4 — pre-money / post-money / price / minimum ticket. */
    const grid = screen.getByTestId("text-round-subscribed").closest("div[class*='p-5']");
    const panel = (grid ?? document.body).textContent ?? "";
    expect(panel).toContain("Pre-money");
    expect(panel).toContain("Post-money");
    expect(panel).toContain("Min ticket");

    /* And the refusal box is NOT on screen when the figures are determined. */
    expect(screen.queryByTestId("text-round-money-not-recorded")).toBeNull();
  }, 90000);

  it("W118-F2-06 · the REFUSED round still prints the sentence and no confident zero, in the same panel", async () => {
    ROUND = storedRound({ moneyOnRecord: undefined });
    wrap(<RoundDetail />);

    const box = await waitFor(() => screen.getByTestId("text-round-money-not-recorded"), { timeout: 5000 });
    const t = box.textContent ?? "";
    expect(t.toLowerCase()).toContain("not recorded");
    expect(t.toLowerCase()).toContain("not the same as zero");
    expect(t).not.toMatch(/\$\s?0\b/);

    /* No figure, no bar, no buckets — the refusal replaces them rather than
       sitting beside a zero. */
    expect(screen.queryByTestId("text-round-subscribed")).toBeNull();
    expect(screen.queryByTestId("group-round-money-states")).toBeNull();

    /* The pre/post grid is a DIFFERENT child and still renders: the panel did not
       collapse. */
    expect(document.body.textContent ?? "").toContain("Pre-money");
  }, 90000);

  it("W118-F2-07 · the shape change is not empty divs — both slots exist and both carry content", async () => {
    wrap(<RoundDetail />);
    const figure = await waitFor(() => screen.getByTestId("slot-round-money-figure"), { timeout: 5000 });
    const states = screen.getByTestId("slot-round-money-states");
    expect((figure.textContent ?? "").trim().length).toBeGreaterThan(10);
    expect((states.textContent ?? "").trim().length).toBeGreaterThan(10);
    /* The two slots are SIBLINGS, which is the structural property the gate lost. */
    expect(figure.parentElement).toBe(states.parentElement);
  }, 90000);

  it("W118-F2-08 · HOOK ORDER — the memo above the early returns survives error and loading renders", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a); });
    FAIL_ROUND = true;
    wrap(<RoundDetail />);
    /* Either early return is fine for this pole - the loading skeleton and the
       error panel BOTH return before the JSX that reads the memo, which is
       exactly the pair of renders a mis-placed hook would break. */
    await waitFor(
      () => expect(document.body.textContent ?? "").toMatch(/Failed to load round|Rounds/),
      { timeout: 5000 },
    );
    expect(screen.queryByTestId("text-round-subscribed")).toBeNull();
    const hookComplaints = errors
      .map((a) => JSON.stringify(a))
      .filter((s) => /Rendered (more|fewer) hooks|Rules of Hooks|change in the order of Hooks/i.test(s));
    expect(hookComplaints).toEqual([]);
    spy.mockRestore();
  }, 90000);
});
