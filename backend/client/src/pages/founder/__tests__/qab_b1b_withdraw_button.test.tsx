/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA BLOCKER 1b (client half) — THE FIX IS A BUTTON, NOT A FEATURE.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `POST /api/rounds/:id/soft-circle/:scId/reject` was already complete on the
 * server (registered at server/track1Routes.ts:4768) and had ZERO CLIENT
 * CALLERS. Two orphaned $0 soft-circle entries therefore sat on a live round
 * with no way for the founder to clear them.
 *
 * This file proves, from RENDERED TEXT and a REAL captured request:
 *
 *   1  CONTROL — the harness can tell a rendered button from an absent one.
 *   2  THE BUTTON IS THERE, on the soft-circle row, for a rejectable entry.
 *   3  IT SAYS WHAT IT DOES — the dialog states the entry is MARKED withdrawn
 *      and NOT deleted, in the founder's own words, and demands a reason.
 *   4  IT CALLS THE ROUTE THAT ALREADY EXISTED — the captured request is a POST
 *      to the exact `/reject` path with the founder's reason in the body. It is
 *      NOT a DELETE, and it does not touch any `archive` or `deleted` path.
 *   5  IT IS NOT OFFERED WHERE THE SERVER WOULD REFUSE IT — the button is absent
 *      for a status outside REJECTABLE_STATUSES (track1Routes.ts:4434), so the
 *      founder is never shown an action that answers 422.
 *
 * Harness modelled on w114_founder_round_money_and_terms.test.tsx, which already
 * renders the REAL `RoundDetail` against a stubbed fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundDetail from "../RoundDetail";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";

const COMPANY_ID = "co_qab_b1b";
const ROUND_ID = "rnd_qab_b1b";
const SC_ID = "sc_qab_orphan_1";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: COMPANY_ID, companyName: "QAB Co", billing: { plan: "founder_pro" } } },
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
  name: "QAB Round",
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

/** The orphan QA found: zero amount, status 'intent', nothing the founder could do. */
function orphan(status: string) {
  return {
    id: SC_ID,
    roundId: ROUND_ID,
    investorName: "QAB Orphaned Entry",
    amount: 0,
    amountMinor: 0,
    currency: "USD",
    status,
    createdAt: "2026-08-01T00:00:00Z",
  };
}

let SOFT_CIRCLES: unknown[] = [];
let REQUESTS: Array<{ method: string; url: string; body: string }> = [];

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
  REQUESTS = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    REQUESTS.push({ method, url: u, body: String(init?.body ?? "") });
    if (u.includes("/soft-circle/") && u.endsWith("/reject")) {
      return res(200, { ok: true, scId: SC_ID, status: "rejected", rejectedAt: "2026-09-07T00:00:00Z" });
    }
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

/** The soft-circle book lives on its own tab; open it the way the founder does. */
async function openSoftTab() {
  const tab = await screen.findByTestId("tab-soft", undefined, { timeout: 5000 });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

beforeEach(() => { SOFT_CIRCLES = [orphan("intent")]; installFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("QA-B1b · the founder can clear an orphaned soft circle, and the screen says so", () => {
  it("1 · CONTROL — this harness reports an ABSENT test id rather than passing over it", async () => {
    wrap(<RoundDetail />);
    await openSoftTab();
    await screen.findByTestId(`button-reject-sc-${SC_ID}`, undefined, { timeout: 5000 });
    /* If a missing element silently resolved, every assertion in this file would
       be worthless. It must throw. */
    expect(() => screen.getByTestId("button-reject-sc-THIS-DOES-NOT-EXIST")).toThrow();
  }, 20_000);

  it("2-4 · the button is on the row, the dialog is honest, and it POSTs the existing /reject route", async () => {
    wrap(<RoundDetail />);
    await openSoftTab();

    const btn = await screen.findByTestId(`button-reject-sc-${SC_ID}`, undefined, { timeout: 5000 });
    expect((btn.textContent ?? "").toLowerCase()).toContain("withdraw");

    fireEvent.click(btn);

    // ── 3 · THE DIALOG SAYS WHAT ACTUALLY HAPPENS ──
    const explain = await screen.findByTestId("text-reject-sc-explain");
    const said = (explain.textContent ?? "").replace(/\s+/g, " ");
    expect(said).toContain("withdrawn");
    expect(said).toContain("nothing is deleted");
    expect(said).toContain("QAB Orphaned Entry");

    // A reason is required — the submit control is disabled until one is typed.
    const submit = await screen.findByTestId("button-reject-sc-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(await screen.findByTestId("input-reject-sc-reason"), {
      target: { value: "Investor withdrew; entry created in error" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);

    // ── 4 · THE CAPTURED REQUEST ──
    await waitFor(() => {
      expect(REQUESTS.some((r) => r.url.endsWith(`/soft-circle/${SC_ID}/reject`))).toBe(true);
    }, { timeout: 5000 });

    const sent = REQUESTS.filter((r) => r.url.endsWith(`/soft-circle/${SC_ID}/reject`));
    expect(sent.length).toBe(1);                                   // exactly one call
    expect(sent[0].method).toBe("POST");                           // NOT DELETE
    expect(sent[0].url).toBe(`/api/rounds/${ROUND_ID}/soft-circle/${SC_ID}/reject`);
    expect(JSON.parse(sent[0].body).reason).toBe("Investor withdrew; entry created in error");

    /* NOTHING DESTRUCTIVE WAS ASKED FOR. No DELETE went out at all, and no
       request touched an archive/soft-delete path — `deleted_at` is expressly
       NOT the mechanism here. */
    expect(REQUESTS.filter((r) => r.method === "DELETE").length).toBe(0);
    expect(REQUESTS.filter((r) => /archive|deleted/i.test(r.url)).length).toBe(0);
  }, 25_000);

  it("5 · the button is NOT offered for a status the server would refuse", async () => {
    SOFT_CIRCLES = [orphan("committed")];
    wrap(<RoundDetail />);
    await openSoftTab();
    /* Positive anchor first: the row itself rendered, so the absence below is a
       real absence and not an unrendered page. */
    await screen.findByTestId(`row-sc-${SC_ID}`, undefined, { timeout: 5000 });
    expect(screen.queryByTestId(`button-reject-sc-${SC_ID}`)).toBeNull();
  }, 20_000);
});
