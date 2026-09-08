/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA-B3 (client half) — RENDERED-TEXT PROOF. The founder is no longer shown a
 * bare $0 for a live raise, and THE TWO FIGURES ARE STILL DIFFERENT.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The server test beside this one proves the maths and the additive field.
 * THAT IS THE INSTRUMENT, NOT THE PRODUCT. This file mounts the REAL round
 * screen and reads what a founder would read.
 *
 * THE PAYLOAD IS NOT HAND-WRITTEN. `moneyOnRecord` is produced by calling the
 * REAL server function `roundMoneyOnRecord` with the reported fixture — an
 * orphaned $0 book beside a $425,000 ledger. A hand-typed payload would prove
 * the component renders a shape I invented; this proves it renders the shape
 * the server actually sends, and it would break if the two drifted apart.
 *
 * FOUR THINGS PROVED:
 *   1  CONTROL — the money section really rendered, with the real figures.
 *   2  THE HEADLINE NAMES ITS SCOPE. It says the total is subscribed THROUGH
 *      THIS ROUND'S BOOK, so a narrow figure no longer reads as a wrong one.
 *   3  THE DISCLOSURE IS ON SCREEN, naming the $425,000 and where it came from.
 *   4  NO FIGURE WAS MADE EQUAL TO ANOTHER. $0 and $425,000 are both still
 *      there, the disagreement banner still fires, and the ledger tile is
 *      OUTSIDE the three-bucket grid so nobody adds it in as a fourth.
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

const COMPANY_ID = "co_qab_b3";
const ROUND_ID = "rnd_qab_b3";

vi.mock("@/hooks/use-toast", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/hooks/use-toast");
  return actual;
});

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: COMPANY_ID, companyName: "QAB B3 Co", billing: { plan: "founder_pro" } } },
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

/** THE REPORTED SITUATION, produced by the REAL server projection function. */
const MONEY = roundMoneyOnRecord({
  roundId: ROUND_ID,
  rows: [
    { id: "sc_a", roundId: ROUND_ID, status: "intent", amountMinor: 0, currency: "USD" },
    { id: "sc_b", roundId: ROUND_ID, status: "intent", amountMinor: 0, currency: "USD" },
  ],
  ledger: [{ roundId: ROUND_ID, amount: "425000.00", currency: "USD", state: "funded" }],
  targetAmount: 600000,
});

const ROUND = {
  id: ROUND_ID,
  companyId: COMPANY_ID,
  name: "QAB B3 Round",
  type: "seed",
  instrument: "preferred",
  state: "active",
  currency: "USD",
  targetAmount: 600000,
  minTicket: 10000,
  softCommits: [],
  invitations: [],
  tranches: [],
  moneyOnRecord: MONEY,
};

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
    if (u.startsWith("/api/rounds?") || u === "/api/rounds") return res(200, [ROUND]);
    if (u.includes("/securities")) return res(200, []);
    if (u.includes("investor-crm")) return res(200, { contacts: [] });
    if (u.includes("/api/auth/me")) return res(200, { id: "u_f", displayName: "Founder", role: "founder" });
    if (u.includes("/crm/contacts")) return res(200, []);
    return res(200, {});
  }));
}

function mount() {
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
          <RoundDetail />
          <Toaster />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => installFetch());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const t = (id: string) => (screen.getByTestId(id).textContent ?? "").replace(/\s+/g, " ").trim();

describe("QA-B3 · the headline states what it counts, and the two figures stay apart", () => {
  it("1 · CONTROL — the money section really rendered the real projection", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("text-round-subscribed")).toBeTruthy(), { timeout: 8000 });
    /* Precondition: the server projection actually determined figures for this
       fixture, so the screen is showing money and not a refusal state. */
    expect(MONEY.determined).toBe(true);
    expect(MONEY.ledgerFunded.ledgerOnlyDisplay).toContain("425,000");
  });

  it("2 · THE HEADLINE NAMES ITS SCOPE — a narrow figure no longer reads as a wrong one", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("text-round-subscribed")).toBeTruthy(), { timeout: 8000 });
    const headline = t("text-round-subscribed");
    /* The defect: "subscribed (committed + funded) of $600,000 target" beside a
       $0, with nothing saying which book it counted. */
    expect(headline).toContain("through this round");
    expect(headline).toContain("book");
    expect(headline).toContain("committed + funded");
    /* The figure itself is UNCHANGED. This item is presentation only. */
    expect(headline).toContain(MONEY.subscribedDisplay);
  });

  it("3 · THE DISCLOSURE IS ON SCREEN and names the money and its origin", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("text-round-ledger-only-excluded")).toBeTruthy(), { timeout: 8000 });
    const note = t("text-round-ledger-only-excluded");
    expect(note).toContain("425,000");
    expect(note).toContain("hash-chained cap-table ledger");
    expect(note).toContain("Record existing investors");
    expect(note).toContain("not counted in subscribed");
    expect(note).toContain("Both figures are shown because both are true");
    /* Its sibling — the soft-circle exclusion — is untouched and still there. */
    expect(t("text-round-soft-circle-excluded")).toContain("Soft circles are deliberately excluded");
  });

  it("4 · NO FIGURE WAS MADE EQUAL TO ANOTHER, and the tile is not a fourth bucket", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("card-round-money-ledger-only")).toBeTruthy(), { timeout: 8000 });

    /* Both figures are still on the screen, and they are still different. */
    expect(t("text-round-subscribed")).toContain("$0");
    expect(t("text-round-money-ledger-only")).toContain("425,000");
    expect(t("text-round-money-ledger-only")).not.toBe(t("text-round-subscribed"));

    /* The disagreement banner the platform already shipped still fires. */
    expect(t("text-round-money-disagreement")).toContain("showing both rather than choosing one");

    /* AND THE TILE IS OUTSIDE THE THREE-BUCKET GRID. If it were inside, a reader
       would add all four and double-count. Measured from the DOM, not assumed
       from the source. */
    const grid = screen.getByTestId("group-round-money-states");
    const ledgerTile = screen.getByTestId("card-round-money-ledger-only");
    expect(grid.contains(ledgerTile)).toBe(false);
    /* The grid still holds exactly the three original buckets. */
    expect(grid.querySelectorAll("[data-testid^='card-round-money-']").length).toBe(3);
  });
});
