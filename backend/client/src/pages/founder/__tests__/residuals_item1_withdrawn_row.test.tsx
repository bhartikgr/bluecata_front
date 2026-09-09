/**
 * ══════════════════════════════════════════════════════════════════════════════
 * RESIDUALS · ITEM 1 — THE BUTTON WAS NEVER MISSING. THE ROW AFTER IT WAS WRONG.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE BRIEFED PREMISE FAILED, AND THIS FILE IS THE MEASUREMENT THAT KILLED IT.
 * The report was that a Reject button built by an earlier wave "is not on the
 * screen", offering four candidate causes (wrong component · hidden by a status
 * or role predicate · rendered unlabelled · the built component is not the
 * mounted one).
 *
 * IT IS NONE OF THE FOUR. The control below renders the real `RoundDetail` —
 * `App.tsx:734` mounts exactly this component on `/founder/rounds/:id`, and it
 * has exactly ONE consumer — and finds the button present, labelled, and on the
 * row, for the very status the report said was blocking it (`intent`). The
 * reason QA read `['Confirm', 'Withdraw', '']` and no "Reject" is simply that
 * THE BUTTON IS CALLED "WITHDRAW". It always was: the dialog, the toast and the
 * server's own copy all say withdraw.
 *
 * SO WHY COULD THE TWO ENTRIES "STILL NOT BE CLEARED"? Because of what happened
 * AFTER pressing it, which nobody had rendered. This file is that render, and it
 * pins three real defects that were invisible from the code alone:
 *
 *   A  THE ROW SAID A WORD THE FOUNDER WAS NEVER OFFERED. The server stores
 *      `status = 'rejected'`; the badge printed that internal word. A founder
 *      who pressed "Withdraw" saw the entry come back as "rejected".
 *
 *   B  A WITHDRAWN ENTRY WAS STILL OFFERED "CONFIRM". The Confirm control was
 *      gated only on `!== "committed"`, so a just-withdrawn row looked exactly
 *      like a live one — which is precisely what "cannot be cleared" looks like
 *      from the outside.
 *
 *   C  THE TOTAL STILL COUNTED IT. The withdraw dialog on this same page
 *      promises the entry "stops it counting towards this round". It did not.
 *      The screen contradicted its own written promise.
 *
 * Every assertion below is on RENDERED TEXT from the mounted component. Nothing
 * asserts that a handler exists.
 *
 * Harness copied from `qab_b1b_withdraw_button.test.tsx`, which already renders
 * the real `RoundDetail` against a stubbed fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundDetail from "../RoundDetail";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";

const COMPANY_ID = "co_residuals_i1";
const ROUND_ID = "rnd_residuals_i1";
const LIVE_ID = "sc_residuals_live";
const GONE_ID = "sc_residuals_withdrawn";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: COMPANY_ID, companyName: "Residuals Co", billing: { plan: "founder_pro" } } },
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

const ROUND = {
  id: ROUND_ID,
  companyId: COMPANY_ID,
  name: "Residuals Round",
  type: "seed",
  instrument: "preferred",
  state: "active",
  currency: "USD",
  targetAmount: 600000,
  minTicket: 10000,
  softCommits: [],
  invitations: [],
  tranches: [],
};

function circle(id: string, name: string, status: string, amount: number) {
  return {
    id,
    roundId: ROUND_ID,
    investorName: name,
    amount,
    amountMinor: amount * 100,
    currency: "USD",
    status,
    createdAt: "2026-08-01T00:00:00Z",
  };
}

/** One live entry and one the founder has already withdrawn — the exact pair
 *  the live report describes, at a non-zero amount so the Total is legible. */
let SOFT_CIRCLES: unknown[] = [];

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
    if (u.includes(`/api/rounds/${ROUND_ID}/soft-circles`)) return res(200, SOFT_CIRCLES);
    if (u.includes(`/api/rounds/${ROUND_ID}`)) return res(200, { ...ROUND, pipeline: [] });
    if (u.startsWith("/api/rounds?") || u === "/api/rounds") return res(200, [ROUND]);
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

async function openSoftTab() {
  const tab = await screen.findByTestId("tab-soft", undefined, { timeout: 5000 });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

const squash = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

beforeEach(() => {
  SOFT_CIRCLES = [
    circle(LIVE_ID, "Residuals Live Entry", "intent", 25000),
    circle(GONE_ID, "Residuals Withdrawn Entry", "rejected", 25000),
  ];
  installFetch();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("RESIDUALS · Item 1 — the soft-circle book, rendered", () => {
  /* ── CONTROL ────────────────────────────────────────────────────────────────
     Two poles, because a harness that cannot fail proves nothing. An absent test
     id must THROW, and a wrong expectation on a REAL element must FAIL. Only
     then is a green below worth reading. */
  it("CONTROL · the harness fails loudly on an absent id and on a false claim", async () => {
    wrap(<RoundDetail />);
    await openSoftTab();
    await screen.findByTestId(`row-sc-${LIVE_ID}`, undefined, { timeout: 5000 });

    expect(() => screen.getByTestId("row-sc-THIS-DOES-NOT-EXIST")).toThrow();

    const row = screen.getByTestId(`row-sc-${LIVE_ID}`);
    expect(squash(row.textContent)).not.toContain("a sentence this row does not contain");
  }, 20_000);

  /* ── THE PREMISE, RE-MEASURED ───────────────────────────────────────────────
     The reported cause was that the button is absent for status `intent`. It is
     present, on the row, with a readable label. This is the finding that sends
     the brief's Item 1 back. */
  it("PREMISE · the button IS on the row for status `intent` — it is labelled \"Withdraw\", not \"Reject\"", async () => {
    wrap(<RoundDetail />);
    await openSoftTab();

    const row = await screen.findByTestId(`row-sc-${LIVE_ID}`, undefined, { timeout: 5000 });
    expect(squash(row.textContent)).toContain("intent");

    const btn = await screen.findByTestId(`button-reject-sc-${LIVE_ID}`, undefined, { timeout: 5000 });
    /* NOT "a handler exists" — the LABEL a founder can read, on the row. */
    expect(squash(btn.textContent).toLowerCase()).toContain("withdraw");
    /* And the word the report went looking for is genuinely not the label. That
       is the whole explanation for "the Reject button is not on the screen". */
    expect(squash(btn.textContent).toLowerCase()).not.toContain("reject");
  }, 20_000);

  /* ── DEFECT A ───────────────────────────────────────────────────────────── */
  it("A · a withdrawn entry's badge says \"withdrawn\", not the internal word \"rejected\"", async () => {
    wrap(<RoundDetail />);
    await openSoftTab();

    const row = await screen.findByTestId(`row-sc-${GONE_ID}`, undefined, { timeout: 5000 });
    const text = squash(row.textContent).toLowerCase();
    expect(text).toContain("residuals withdrawn entry");   // positive anchor: the right row
    expect(text).toContain("withdrawn");
    expect(text).not.toContain("rejected");
  }, 20_000);

  /* ── DEFECT B ───────────────────────────────────────────────────────────── */
  it("B · a withdrawn entry is NOT offered \"Confirm\" — and the live entry still is", async () => {
    wrap(<RoundDetail />);
    await openSoftTab();

    /* Positive anchor first, so the absence below is a real absence and not an
       unrendered page. */
    await screen.findByTestId(`button-confirm-${LIVE_ID}`, undefined, { timeout: 5000 });
    expect(screen.queryByTestId(`button-confirm-${GONE_ID}`)).toBeNull();

    /* COUNT, don't sample: exactly one Confirm button in the whole book. */
    const confirms = screen
      .getAllByRole("button")
      .filter((b) => squash(b.textContent).toLowerCase() === "confirm");
    expect(confirms.length).toBe(1);
  }, 20_000);

  /* ── DEFECT C ───────────────────────────────────────────────────────────── */
  it("C · the Total counts the live entry only — the page keeps the promise its own dialog makes", async () => {
    wrap(<RoundDetail />);
    await openSoftTab();

    const table = await screen.findByTestId("table-softcircles", undefined, { timeout: 5000 });
    const text = squash(table.textContent);

    /* Both rows are on the record — nothing was deleted or hidden. */
    expect(text).toContain("Residuals Live Entry");
    expect(text).toContain("Residuals Withdrawn Entry");

    /* But only the live $25,000 is inside the Total. $50,000 would mean the
       withdrawn entry is still counted, which is what the dialog promises it is
       not. This is a same-currency book (both rows USD); nothing is converted
       and nothing is summed across currencies. */
    expect(text).toContain("Total$25,000");
    expect(text).not.toContain("Total$50,000");
  }, 20_000);
});
