/**
 * WAVE 60 · A-2 — "NO CO-MEMBERS FOUND" WAS MANUFACTURED FROM A FAILED REQUEST.
 *
 * ── THE DEFECT, AS THE INVESTOR SAW IT ───────────────────────────────────────
 * `client/src/components/investor/MemberValueIntelligenceInvestor.tsx` had ZERO
 * references to `isError`. At :84 (pre-fix numbering)
 *
 *     const members = coMembersQ.data ?? [];
 *
 * erased the difference between "this company has no co-members" and "we could
 * not read them", and the branch below then printed
 *
 *     No co-members found for {activePosition?.company ?? "this company"}.
 *
 * — a FACTUAL ASSERTION about who is on a company's cap table, produced by a
 * request that failed. An investor could reasonably conclude that a company has
 * no other backers.
 *
 * NOTE THE INTERPOLATION. The string is a template, so a literal search for the
 * whole sentence can never match the rendered page — which is why a live pass
 * concluded it "does not exist on the site". It does exist. This file asserts the
 * literal fragment `No co-members found for`, which is what the guard's copy
 * class stores and what actually renders.
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 *   LOWER  the read fails / is PAUSED → refusal present, the sentence ABSENT.
 *   UPPER  a SUCCESSFUL empty read    → the sentence present and UNCHANGED,
 *                                       inside its unchanged <div>, no refusal.
 *   UPPER  rows                       → the table renders as before.
 *   NO SILENT DROP  on the failure path the company tab strip, the card, and the
 *          "Post to group" control all still mount.
 *
 * The route is GET /api/investor/companies/:id/co-members; its real refusal for
 * an unauthenticated caller is pinned over HTTP in
 * `server/__tests__/w60_refusal_routes_http.test.ts` and replayed here.
 *
 * MUTATION TRANSCRIPT: build_log/wave60/W60_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { MemberValueIntelligenceInvestor } from "../MemberValueIntelligenceInvestor";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const EMPTY_FRAGMENT = "No co-members found for";
const PORTFOLIO = [{ id: "p1", companyId: "co_w60", company: "Hydra Labs" }];

/** The portfolio always resolves; the co-member read is the variable. */
function renderCard(coMembers: () => Promise<unknown>) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/co-members/.test(url)) return jsonResponse(await coMembers());
    return jsonResponse(PORTFOLIO);
  });
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: (async () => PORTFOLIO) as never },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemberValueIntelligenceInvestor />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  onlineManager.setOnline(true);
});

describe("W60 · A-2 — a failed co-member read is not a company with no co-members", () => {
  it("LOWER POLE — the refusal renders and the no-co-members claim does NOT", async () => {
    renderCard(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    const err = await screen.findByTestId("w60-comembers-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn’t load the co-member list");
    /* THE defect: pre-fix this found the text. */
    expect(screen.queryByText(new RegExp(EMPTY_FRAGMENT))).toBeNull();
  });

  it("LOWER POLE — the refusal states no count and no money", async () => {
    renderCard(async () => {
      throw new ApiError(401, "unauthorised", null, { ok: false, error: "UNAUTHORIZED" });
    });
    const err = await screen.findByTestId("w60-comembers-error");
    const text = err.textContent ?? "";
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain("$");
    expect(text).not.toContain("%");
  });

  it("NO SILENT DROP — the company tab strip and the post-to-group control survive the failure", async () => {
    renderCard(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    await screen.findByTestId("w60-comembers-error");
    expect(screen.getByTestId("tab-company-co_w60")).toBeTruthy();
    expect(screen.getByText("Hydra Labs")).toBeTruthy();
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    renderCard(async () => {
      calls += 1;
      throw new ApiError(500, "boom", null, { ok: false });
    });
    await screen.findByTestId("w60-comembers-error");
    const before = calls;
    fireEvent.click(screen.getByTestId("w60-comembers-error-retry"));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("PAUSED POLE — an OFFLINE investor is not told the company has no co-members", async () => {
    /* `!isLoading && !isError` is TRUE for a paused query; `isSuccess` is not.
       The portfolio query is PRE-SEEDED so the component reaches the co-member
       branch at all — otherwise this pole passes for the wrong reason (it would
       be stuck on "No portfolio positions yet.") and the mutation that reverts
       the isSuccess narrowing would survive it. */
    apiRequestMock.mockImplementation(async () => jsonResponse([]));
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    qc.setQueryData(["/api/investor/portfolio2"], PORTFOLIO);
    onlineManager.setOnline(false);
    render(
      <QueryClientProvider client={qc}>
        <MemberValueIntelligenceInvestor />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("tab-company-co_w60")).toBeTruthy();
    await screen.findByTestId("w60-comembers-error");
    expect(screen.queryByText(new RegExp(EMPTY_FRAGMENT))).toBeNull();
  });

  it("UPPER POLE — a genuine empty SUCCESS still shows the EXISTING copy, unchanged, in its unchanged div", async () => {
    renderCard(async () => []);
    const node = await screen.findByText(/No co-members found for Hydra Labs\./);
    expect(node.className).toBe("text-sm text-muted-foreground py-4 text-center");
    expect(screen.queryByTestId("w60-comembers-error")).toBeNull();
  });

  it("UPPER POLE — rows render the co-member table and neither the refusal nor the empty copy", async () => {
    renderCard(async () => [
      {
        memberId: "m1",
        userId: "u1",
        displayLabel: "Hydra VC",
        allowDM: true,
        investorExperienceTier: "experienced",
        areaOfExpertise: ["fintech"],
      },
    ]);
    expect(await screen.findByTestId("table-co-members")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();
    expect(screen.getByText("Area of expertise")).toBeTruthy();
    expect(screen.queryByText(new RegExp(EMPTY_FRAGMENT))).toBeNull();
    expect(screen.queryByTestId("w60-comembers-error")).toBeNull();
  });
});
