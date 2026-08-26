/* ════════════════════════════════════════════════════════════════════════════
   WAVE 142 (BATCH 1 · ITEM 2) — WHAT THE FOUNDER ACTUALLY READS WHEN THE FEE
   IS NOT ON RECORD.                                        R108.2 · R95 · R21
   ════════════════════════════════════════════════════════════════════════════
   The resolver used to answer a missing config row with 30000, so this page had
   only two states: loading, and priced. It now receives a 200 carrying
   `amountMinor: null, source: "missing"`, and R108.2 says the page MUST STILL
   RENDER (no 503, no take-down of the application funnel) while refusing to state
   a price it does not have.

   These tests RENDER the real page and assert the LITERAL text on screen, plus
   the real disabled state of the real submit control. They never read source text
   and never assert an attribute as a proxy for a render.

   FAIL-BEFORE EVIDENCE: with the pre-142 sources restored (reconstructed in
   w142_scratch/before/ and independently confirmed byte-exact against WAVE 139's
   pinned digest of the resolver's stripped logic), every test in the ABSENT
   describe below fails — the page renders the perpetual "Loading application
   fee…" state because `feeAbsent` does not exist. See build_log/wave142/.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import FounderApplyToCollective from "@/pages/founder/ApplyToCollective";

/** $300.00 in TRUE minor units — the canonical fee (R101). */
const PRICED = { ok: true, amountMinor: 30_000, currency: "USD", updatedAt: null, updatedBy: null, source: "db" };
/** The new third state: a 200 that carries no figure at all. */
const MISSING = { ok: true, amountMinor: null, currency: null, updatedAt: null, updatedBy: null, source: "missing" };
const UNREADABLE = { ok: true, amountMinor: null, currency: null, updatedAt: null, updatedBy: null, source: "unreadable" };

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    /* v25.45.4 L-3 gates BOTH apply paths behind an ACTIVE ROUND, so a company
       with no open round renders only the page's outer shell and NEITHER tab's
       content mounts. `/api/rounds` therefore has to answer with an open round or
       every assertion below — including the priced pole — reads the shell.
       Same harness shape as w137_application_fee_minor_render.test.tsx. */
    if (typeof url === "string" && url.startsWith("/api/rounds")) {
      return jsonResponse([{ id: "r_1", state: "open" }]);
    }
    return jsonResponse([]);
  });
});
afterEach(() => cleanup());

function mount(fee: Record<string, unknown>) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const head = String(queryKey[0] ?? "");
          if (head.includes("/collective/application-fee")) return fee;
          if (head.includes("/api/auth/me")) return { id: "u_founder", displayName: "Founder" };
          if (head.includes("active-company")) {
            return { activeCompanyId: "co_1", company: { companyId: "co_1", companyName: "Acme Robotics" } };
          }
          return [];
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <FounderApplyToCollective />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** Path B (the direct company application) is the tab that quotes the fee. */
async function openPathB() {
  const tab = await screen.findByTestId("tab-direct");
  /* Radix activates a tab on pointer-down, not on click. */
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

describe("WAVE 142 · J — the fee IS on record (the pole)", () => {
  it("J1 the page still quotes $300.00 and shows NO absence notice", async () => {
    /* Anti-over-correction: the new third state must not leak into the normal
       priced path. */
    mount(PRICED);
    await openPathB();
    const sentence = await screen.findByText(/A non-refundable application fee of/);
    await waitFor(() => expect(sentence.textContent).toContain("$300.00"));
    expect(screen.queryAllByTestId("fee-not-on-record")).toHaveLength(0);
    const btn = await screen.findByTestId("button-submit-application");
    expect(btn.textContent).toContain("Submit application");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("WAVE 142 · K — the fee is NOT on record (source: 'missing')", () => {
  it("K1 THE RULING — the page RENDERS; the application funnel is not taken down", async () => {
    /* The pre-flight wanted a 503 here. R108.2 overruled it: an unpublished price
       must not remove the founder's ability to see and prepare the application. */
    mount(MISSING);
    await openPathB();
    expect(await screen.findByText(/A non-refundable application fee of/)).toBeTruthy();
    expect(await screen.findByTestId("button-submit-application")).toBeTruthy();
  });

  it("K2 THE REPRODUCTION — it SAYS the fee is not published, and prints no figure", async () => {
    mount(MISSING);
    await openPathB();
    const notices = await screen.findAllByTestId("fee-not-on-record");
    /* Both fee statements on the page state it — the sentence and the
       acknowledgement line. */
    expect(notices.length).toBe(2);
    for (const n of notices) {
      expect(n.textContent).toContain("not currently published");
      expect(n.textContent).toContain("Nothing has been submitted or charged");
      /* No price, no zero, no bare em-dash a founder reads as free. */
      expect(n.textContent).not.toContain("$");
      expect(n.textContent).not.toContain("300");
      expect(n.textContent).not.toContain("240");
      expect(n.textContent?.trim()).not.toBe("—");
    }
  });

  it("K3 R21 — it does NOT sit in a perpetual 'Loading application fee…' state", async () => {
    /* This is precisely what the page did before the wave once the fabricated
       fallback was removed from the server: a spinner that can never resolve. */
    mount(MISSING);
    await openPathB();
    await screen.findAllByTestId("fee-not-on-record");
    expect(screen.queryByText(/Loading application fee/)).toBeNull();
  });

  it("K4 submission stays blocked, and the control SAYS WHY", async () => {
    mount(MISSING);
    await openPathB();
    const btn = await screen.findByTestId("button-submit-application");
    await waitFor(() => expect(btn.textContent).toContain("Fee not published"));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toContain("not published yet");
    expect(btn.getAttribute("title")).toContain("nothing can be submitted or charged");
    /* And it does not claim to still be loading. */
    expect(btn.textContent).not.toContain("Loading");
  });
});

describe("WAVE 142 · L — the row could not be READ (source: 'unreadable')", () => {
  it("L1 an unreadable table produces the same refusal, never a price", async () => {
    /* A dropped/locked table used to yield the same confident 30000. The founder
       sees a refusal; the operator distinction lives on the admin surface. */
    mount(UNREADABLE);
    await openPathB();
    const notices = await screen.findAllByTestId("fee-not-on-record");
    expect(notices.length).toBe(2);
    expect(notices[0].textContent).not.toContain("$");
    const btn = await screen.findByTestId("button-submit-application");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
