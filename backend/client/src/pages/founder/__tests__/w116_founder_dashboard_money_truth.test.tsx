/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 116 — WHAT THE OWNER SEES ON HIS OWN FRONT PAGE.
 * ══════════════════════════════════════════════════════════════════════════════
 * The screenshot that opened this wave read `RAISED THIS YEAR · $0 · of $53.7M
 * target` on a company with a real book. This file renders the founder dashboard
 * against a stubbed `/api/rounds` and asserts on RENDERED TEXT, the way Wave
 * 114's founder test does: a screen cannot pass by holding a correct value it
 * does not print.
 *
 * WHY EACH BLOCK FAILS ON THE OLD CODE
 * ------------------------------------
 *  · The tile read `company?.kpi?.raisedThisYearUsd ?? 0` and that field has no
 *    writer anywhere in the tree, so it printed `$0` for the book below. The
 *    non-zero assertions fail before.
 *  · The old tile printed ONE scalar, so the three-state assertions fail before:
 *    there was nothing to break out.
 *  · The old empty-company branch printed the same `$0`. The "a sentence and no
 *    figure" assertions fail before.
 *  · The old target summed every round of the company including drafts and
 *    archived ones; the `$53.7M`-shaped total is asserted absent.
 *
 * R90 — the auth/session stubs are the ones Wave 114 already used, unchanged.
 * `CapTable.tsx`, `Round*.tsx`, investor and partner screens are other agents'
 * files and are not imported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import Dashboard from "../Dashboard";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { roundMoneyOnRecord } from "../../../../../server/lib/roundRaisedTotals";
import { COMPANY_MONEY_REFUSAL_STATEMENT } from "@/lib/money/companyMoneyOnRecord";
import { stripComments } from "../../../../../server/__tests__/w116_strip_comments";


/* jsdom implements neither ResizeObserver nor Element.hasPointerCapture; the
   journey chart on this page needs the first. Same stub as
   `wave41_settings_panel_mounts.test.tsx` — copied rather than shared because it
   is three lines of jsdom gap-filling, not platform behaviour. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const COMPANY_ID = "co_w116";
const SRC_DIR = path.resolve(__dirname, "..");

/** SOURCE LOCK HELPER — comments stripped by the wave's ONE stripper, so a literal
 *  that survives only inside a Wave 116 explanation of why it was removed cannot
 *  decide the lock, and a `*\/` inside a string cannot shift the alignment. */
function codeOf(file: string): string {
  return stripComments(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));
}

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { activeCompanyId: COMPANY_ID, company: { id: COMPANY_ID, companyName: "W116 Co", billing: { plan: "founder_pro" } } },
  }),
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useLocation: () => ["/founder/dashboard", () => {}],
    Link: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
  };
});

/* The projection the server really attaches, produced by the SERVER'S derivation
   so the fixture cannot drift from the API. Status vocabulary is Wave 114's
   soft-circle ladder (`intent`/`confirmed`/`wired`) — NOT the round-state ladder
   (R91: the two are not harmonised). */
function projection(roundId: string, rows: Array<{ status: string; amountMinor: number }>, targetAmount: number): unknown {
  return roundMoneyOnRecord({
    roundId,
    rows: rows.map((r, i) => ({ id: `sc_${roundId}_${i}`, roundId, currency: "USD", ...r })),
    fallbackCurrency: "USD",
    targetAmount,
  });
}

/** $50,000 soft-circled · $250,000 committed · $400,000 funded. */
const REAL_BOOK = [
  { status: "intent", amountMinor: 5_000_000 },
  { status: "confirmed", amountMinor: 25_000_000 },
  { status: "wired", amountMinor: 40_000_000 },
];

function round(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = String(overrides.id ?? "rnd_w116");
  const targetAmount = Number(overrides.targetAmount ?? 1_000_000);
  return {
    id,
    companyId: COMPANY_ID,
    name: "W116 Seed",
    type: "seed",
    instrument: "preferred",
    state: "soft_circle_open",
    currency: "USD",
    targetAmount,
    raisedAmount: 0, // the column with no writer
    archivedAt: null,
    openDate: "2026-01-01",
    closeDate: "2026-12-31",
    moneyOnRecord: projection(id, REAL_BOOK, targetAmount),
    softCommits: [],
    invitations: [],
    ...overrides,
  };
}

let ROUNDS: Array<Record<string, unknown>> = [round()];

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
    if (u === "/api/rounds" || u.startsWith("/api/rounds?")) return res(200, ROUNDS);
    if (u.includes("/api/auth/me")) return res(200, { id: "u_f", displayName: "Founder", role: "founder" });
    if (u.includes("/api/activity")) return res(200, []);
    if (u.includes("/api/founder/profile/completion")) return res(200, { percent: 50, missing: [] });
    if (u.includes("/api/investor/ma/initiatives")) return res(200, []);
    if (u.includes("/api/founder/reports2")) return res(200, []);
    if (u.includes("/api/founder/dataroom/engagement")) return res(200, { topDocs: [], investors: [] });
    if (u.includes("/securities")) return res(200, []);
    if (u.includes("attribution")) return res(200, { attributedPartner: null });
    if (u.includes("/api/founder/captable/ledger")) return res(200, []);
    if (u.includes("/invitations")) return res(200, []);
    if (u.includes("/api/comms")) return res(200, []);
    /* Anything not named above answers an EMPTY LIST rather than an object: every
       remaining consumer on this page is a list reader, and an object would throw
       inside a `.filter` and take the page down for the wrong reason. */
    return res(200, []);
  }));
}

function renderDashboard() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "returnNull" }) },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <Dashboard />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ROUNDS = [round()];
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ── AC-1: a real book shows a NON-ZERO figure ─────────────────────────────── */

describe("W116 · AC-1 — a company with a real book shows a non-zero raised figure", () => {
  it("the money tile prints $650,000, not $0", async () => {
    renderDashboard();
    const tile = await waitFor(() => screen.getByTestId("kpi-money-subscribed"));
    expect(tile.textContent).toMatch(/650,000/);
    expect(tile.textContent).not.toMatch(/^\$0(\.00)?$/);
  });

  it("the 'raised' Stat prints the same figure, from the same reader", async () => {
    renderDashboard();
    const stat = await waitFor(() => screen.getByTestId("stat-raised-figure"));
    expect(stat.textContent).toMatch(/650,000/);
    /* And it does NOT ALSO render the refusal sentence: one or the other. */
    expect(screen.queryByTestId("stat-raised-unavailable")).toBeNull();
  });
});

/* ── AC-3: the three states, labelled distinctly ──────────────────────────── */

describe("W116 · AC-3 — soft-circled, committed and funded are labelled distinctly", () => {
  it("all three states appear, with three different labels and three different figures", async () => {
    renderDashboard();
    await waitFor(() => screen.getByTestId("kpi-money-states"));
    const soft = screen.getByTestId("kpi-money-softCircled").textContent ?? "";
    const committed = screen.getByTestId("kpi-money-committed").textContent ?? "";
    const funded = screen.getByTestId("kpi-money-funded").textContent ?? "";
    expect(soft).toMatch(/50,000/);
    expect(committed).toMatch(/250,000/);
    expect(funded).toMatch(/400,000/);
    /* Three distinct label texts — a reader can tell which is which. */
    const labels = [soft, committed, funded].map((t) => t.replace(/[\d$,.]/g, "").trim());
    expect(new Set(labels).size).toBe(3);
  });

  it("the tile names its own basis, and does not claim a calendar period", async () => {
    renderDashboard();
    const basis = await waitFor(() => screen.getByTestId("kpi-money-basis"));
    expect(basis.textContent).toMatch(/all time/i);
    /* The old tile's words are gone from the file. */
    expect(codeOf("Dashboard.tsx")).not.toMatch(/Raised this year/i);
    expect(codeOf("Dashboard.tsx")).not.toMatch(/raisedThisYearUsd/);
  });
});

/* ── AC-2: nothing on record → a sentence, never $0 ───────────────────────── */

describe("W116 · AC-2 — a company with nothing on record shows a sentence and no figure", () => {
  it("no rounds at all: the statement is rendered and no money figure is", async () => {
    ROUNDS = [];
    renderDashboard();
    const unavailable = await waitFor(() => screen.getByTestId("kpi-money-unavailable"));
    expect(unavailable.textContent).toBe(COMPANY_MONEY_REFUSAL_STATEMENT.no_rounds_on_record);
    expect(screen.queryByTestId("kpi-money-subscribed")).toBeNull();
    /* NOT `$0` anywhere in the statement. */
    expect(unavailable.textContent).not.toMatch(/\$\s?0/);
  });

  it("rounds present but nothing subscribed: a DIFFERENT sentence, still no figure", async () => {
    ROUNDS = [round({ id: "rnd_empty", moneyOnRecord: projection("rnd_empty", [], 1_000_000) })];
    renderDashboard();
    /* NOTE the shape of this wait. The first paint happens before `/api/rounds`
       resolves, and at that moment the company has no rounds in hand, so the
       "no round on record" sentence is briefly correct. Waiting merely for the
       testid would assert against that first paint and pass for the wrong reason.
       Wait for the sentence to become the one this fixture is about. */
    await waitFor(() => {
      const el = screen.getByTestId("kpi-money-unavailable");
      expect(el.textContent).toBe(COMPANY_MONEY_REFUSAL_STATEMENT.not_determined_on_some_rounds);
    });
    expect(screen.queryByTestId("kpi-money-subscribed")).toBeNull();
  });

  it("the Stat refuses too, rather than falling back to zero", async () => {
    ROUNDS = [];
    renderDashboard();
    await waitFor(() => screen.getByTestId("stat-raised-unavailable"));
    expect(screen.queryByTestId("stat-raised-figure")).toBeNull();
  });
});

/* ── AC-4: the target ─────────────────────────────────────────────────────── */

describe("W116 · AC-4 — the target excludes drafts and archived rounds and says so", () => {
  it("a $40M draft and a $10M archived round are not added to the $1M live target", async () => {
    ROUNDS = [
      round({ id: "rnd_live", targetAmount: 1_000_000 }),
      round({ id: "rnd_draft", state: "draft", targetAmount: 40_000_000 }),
      round({ id: "rnd_arch", targetAmount: 10_000_000, archivedAt: "2025-01-01" }),
    ];
    renderDashboard();
    const target = await waitFor(() => screen.getByTestId("kpi-money-target"));
    expect(target.textContent).toMatch(/1,000,000/);
    expect(target.textContent).not.toMatch(/51,000,000|41,000,000|11,000,000/);
    /* And the tile states which rounds it counted. */
    expect(target.textContent).toMatch(/drafts and archived rounds excluded/i);
  });

  it("no target recorded: a sentence, not $0", async () => {
    ROUNDS = [round({ id: "rnd_nt", targetAmount: null })];
    renderDashboard();
    const target = await waitFor(() => screen.getByTestId("kpi-money-target"));
    expect(target.textContent).not.toMatch(/\$\s?0\b/);
    expect((target.textContent ?? "").length).toBeGreaterThan(20);
  });
});

/* ── source locks ─────────────────────────────────────────────────────────── */

describe("W116 · source locks — the dead columns are not read by these screens", () => {
  it("Dashboard.tsx reads neither raisedAmount nor raisedThisYearUsd", () => {
    const code = codeOf("Dashboard.tsx");
    /* The wire TYPE may still DECLARE the column — the server still sends it, and
       lying about the payload shape would be its own defect. What must be gone is
       every READ of it. */
    expect(code).not.toMatch(/\.\s*raisedAmount\b/);
    expect(code).not.toMatch(/\braisedThisYearUsd\b/);
  });

  it("Welcome.tsx no longer sums raisedAmount and no longer contains a literal $0", () => {
    const code = codeOf("Welcome.tsx");
    expect(code).not.toMatch(/\.\s*raisedAmount\b/);
    expect(code).not.toMatch(/"\$0"/);
  });

  it("both screens read the figure through the SHARED reader, not a second derivation", () => {
    for (const f of ["Dashboard.tsx", "Welcome.tsx"]) {
      expect(codeOf(f), f).toMatch(/readCompanyMoneyOnRecord/);
    }
  });
});
