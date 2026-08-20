/**
 * WAVE 61a · R47 (closes L-5) — ONE OWNERSHIP PERCENTAGE, ONE PRECISION.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 * The same quantity — a holder's share of a company — was printed at FIVE
 * different precisions across the tree. R47: "three formats imply three
 * calculations. Pick one and apply it everywhere ownership is shown."
 *
 *   BEFORE                                            AFTER
 *   founder/CapTable.tsx  x3          2 dp            2 dp  (unchanged)
 *   founder/Dashboard.tsx x2          1 dp            2 dp  <-- widened
 *   components/CapitalizationJourney  1 dp            2 dp  <-- widened
 *   founder/CRM.tsx                   1 dp            2 dp  <-- widened
 *   founder/Reports.tsx               default (1 dp)  2 dp  <-- widened + explicit
 *   investor/InvitationDetail :935/:956/:969  2 dp     2 dp  (unchanged)
 *   investor/InvitationDetail :1006   3 dp            3 dp  (NOT CHANGED - see below)
 *
 * ── WHY 2 dp, AND WHY EVERY CHANGE IS A WIDENING ─────────────────────────────
 * 2 dp is already the tree's dominant convention (eight of the eleven ownership
 * render sites), it is 0.01% = one basis point of ownership, and it is what the
 * cap table itself — the authoritative surface — already used.
 *
 * Every site this wave touched moved 1 dp -> 2 dp, i.e. a WIDENING. A widening
 * only ever reveals more of the value that was already there; it can never hide
 * a digit or round a number away from the truth. That is what makes this a
 * display change and not a math change (R16). `investor/InvitationDetail.tsx:1006`
 * would have had to move 3 dp -> 2 dp, a NARROWING, which would round a digit
 * away from a number the user can see today. Per the wave brief's own stop rule
 * ("if standardising would change a number's rounding rather than its formatting,
 * STOP and report"), it was LEFT ALONE and referred to the owner. It is also a
 * DIFFERENT quantity: an illustrative what-if projection from a hypothetical
 * commitment, labelled "Example only" on screen.
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 *   UPPER  a real value renders at 2 dp AND the VALUE is unchanged: 0.385 still
 *          means 38.5%, now printed "38.50%". A rescale to 3850% or 0.385% fails.
 *   UPPER  the untouched 3 dp site is still 3 dp and still refuses on null, so a
 *          later "consistency" pass has to argue with a test.
 *   LOWER  no site this wave standardised is left at 1 dp or on the shared
 *          default, asserted from source.
 *
 * MUTATION TRANSCRIPT: build_log/wave61a/W61A_TESTS.md.
 * DECISION + FULL SITE LIST: build_log/wave61a/W61A_PRECISION_DECISION.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fmtPct } from "@/lib/format";
import * as fs from "node:fs";
import * as path from "node:path";

/** The stored fraction under test. `kpi.ownershipPct` is consumed as a FRACTION:
 *  the dashboard renders `fmtPct(pct * 100, …)`. */
let ownershipPct = 0.385;

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/useActiveCompany", async () => {
  const actual = await vi.importActual<typeof import("@/lib/useActiveCompany")>("@/lib/useActiveCompany");
  return {
    ...actual,
    useActiveCompanyId: () => "co_w61a",
    useActiveCompany: () => ({
      data: {
        activeCompanyId: "co_w61a",
        company: {
          companyName: "W61a Co",
          kpi: { capTableHolders: 3, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct },
        },
      },
      isLoading: false,
      isSuccess: true,
    }),
  };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import FounderDashboard from "../Dashboard";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function renderDashboard() {
  apiRequestMock.mockImplementation(async () => jsonResponse([]));
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: (async () => []) as never }, mutations: { retry: false } },
  });
  window.history.pushState({}, "", "/founder/dashboard");
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <FounderDashboard />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  ownershipPct = 0.385;
});

describe("W61a · R47 / L-5 — ownership is displayed at ONE precision: two decimal places", () => {
  it("UPPER POLE — 0.385 renders '38.50%' on the founder dashboard KPI strip; the VALUE did not move", async () => {
    ownershipPct = 0.385;
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("stat-ownership")).toBeTruthy());
    const text = screen.getByTestId("stat-ownership").textContent ?? "";
    expect(text).toContain("38.50%");
    /* The value, not just the format. A rescale in either direction fails here. */
    expect(text).not.toContain("3850");
    expect(text).not.toContain("0.39%");
    expect(text).not.toContain("0.385%");
    /* And the label + hint are byte-identical — no copy was touched (R44). */
    expect(text).toContain("Founder ownership");
    expect(text).toContain("of fully-diluted");
  });

  it("UPPER POLE — the bento tile on the SAME page agrees, to the same digit", async () => {
    /* Two renders of one quantity on one screen. If they ever disagree again,
       this fails — which was half of what made L-5 worth closing. */
    ownershipPct = 0.385;
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("bento-tile-kpi-ownership")).toBeTruthy());
    expect(screen.getByTestId("bento-tile-kpi-ownership").textContent).toContain("38.50%");
  });

  it("UPPER POLE — a genuine stored zero still says 0.00%, not an em-dash", async () => {
    /* The stored `0` written by the two sibling creation paths is a REAL value,
       not an unknown. Widening its precision must not turn it into a refusal.
       (That the value is a never-recomputed literal is a SEPARATE, still-open
        defect — R45-b / Wave 67. This wave does not touch it.) */
    ownershipPct = 0;
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("stat-ownership")).toBeTruthy());
    const text = screen.getByTestId("stat-ownership").textContent ?? "";
    expect(text).toContain("0.00%");
    expect(text).not.toContain("—");
  });

  it("VALUE PRESERVATION — widening 1 dp -> 2 dp reveals the value, it never rounds it away", () => {
    /* This is the proof that the standardisation is a DISPLAY change (R16).
       For a value the 1 dp render could already show exactly, the two strings
       denote the identical number: */
    expect(fmtPct(0.385 * 100, 1)).toBe("38.5%");
    expect(fmtPct(0.385 * 100, 2)).toBe("38.50%");
    expect(Number("38.50")).toBe(Number("38.5"));
    /* For a value the 1 dp render had to round, the 2 dp render is STRICTLY
       CLOSER to the truth — a widening can only ever add information: */
    const truth = 38.553;
    const oldErr = Math.abs(Number(fmtPct(truth, 1).slice(0, -1)) - truth);
    const newErr = Math.abs(Number(fmtPct(truth, 2).slice(0, -1)) - truth);
    expect(newErr).toBeLessThan(oldErr);
    /* A NARROWING would do the opposite, which is why 3 dp -> 2 dp was refused: */
    const narrowErr = Math.abs(Number(fmtPct(truth, 2).slice(0, -1)) - truth);
    const wideErr = Math.abs(Number(fmtPct(truth, 3).slice(0, -1)) - truth);
    expect(wideErr).toBeLessThan(narrowErr);
  });

  it("SOURCE — every site this wave standardised now passes 2, and none is left on the shared default", () => {
    /* WAVE 73 · ITEM 8 — comments stripped: the Item 8 fix quotes the expression
       it deleted, and that quotation is the record of what the screen used to
       print. Only executable text is asserted on. */
    const dash = read("client/src/pages/founder/Dashboard.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    /* WAVE 73 · ITEM 8 — THIS ASSERTION WAS CORRECTED, AND WHY.
       It used to pin the literal expression
           fmtPct((company?.kpi?.ownershipPct ?? 0) * 100, 2)   × 2
       which pinned the `?? 0` FABRICATION as well as the precision it was
       written to protect. R47/R48 require the coalesce to go (Wave 73 Item 8),
       so the assertion now pins WHAT WAVE 61a ACTUALLY OWNED — that both
       ownership renders on this page pass 2 dp explicitly and neither relies on
       fmtPct's shared default — and additionally forbids the fabrication from
       ever coming back. Wave 61a's own poles (the three render tests above,
       including `a genuine stored zero still says 0.00%`) are UNTOUCHED and
       still the real proof. */
    expect((dash.match(/fmtPct\(ownershipPctDisplay, 2\)/g) ?? []).length).toBe(2);
    expect(dash).not.toContain("fmtPct(ownershipPctDisplay, 1)");
    expect(dash).not.toContain("fmtPct(ownershipPctDisplay)");
    expect(dash).not.toContain("kpi?.ownershipPct ?? 0");
    /* And the single derivation that replaced the two inline expressions. */
    expect(dash).toContain("const ownershipPctDisplay = ownershipPctRaw == null ? null : Number(ownershipPctRaw) * 100;");

    const journey = read("client/src/components/CapitalizationJourney.tsx");
    expect(journey).toContain("fmtPct(kpis.founderPct, 2)");
    expect(journey).not.toContain("fmtPct(kpis.founderPct, 1)");

    const crm = read("client/src/pages/founder/CRM.tsx");
    expect(crm).toContain("fmtPct(c.ownership.pct * 100, 2)");
    expect(crm).not.toContain("fmtPct(c.ownership.pct * 100, 1)");

    const reports = read("client/src/pages/founder/Reports.tsx");
    expect(reports).toContain("fmtPct(h.ownershipPct, 2)");
    /* No ownership site may rely on fmtPct's shared default digits: a change to
       the default must never be able to move an ownership precision silently. */
    expect(reports).not.toContain("fmtPct(h.ownershipPct)");

    const cap = read("client/src/pages/founder/CapTable.tsx");
    expect((cap.match(/\* 100, 2\)/g) ?? []).length).toBe(3);
  });

  it("SOURCE — fmtPct's own default is UNCHANGED: it is used tree-wide and is not ours to move", () => {
    const fmt = read("client/src/lib/format.ts");
    expect(fmt).toContain("export function fmtPct(value: unknown, digits: number = 1): string");
  });

  it("SOURCE — the UNTOUCHED sites stay untouched, and the 3 dp one still refuses on null", () => {
    /* `InvitationDetail.tsx:1006` is an ILLUSTRATIVE projection from a
       hypothetical commitment, not a committed ownership share, and narrowing it
       to 2 dp would round a visible digit away. It is referred to the owner in
       W61A_PRECISION_DECISION.md, and pinned here so that no later pass changes
       it without deciding to. */
    const inv = read("client/src/pages/investor/InvitationDetail.tsx");
    expect(inv).toContain("fmtPct(pos.ownershipPct, 3) : NOT_PROVIDED");
    /* Both invitation-page sites refuse honestly rather than printing a zero —
       which is BETTER than the dashboard does, and must not regress. */
    expect(inv).toContain("fmtPct(myPendingPos.ownershipPct, 2) : NOT_PROVIDED");
    /* The SPV / K-1 4 dp sites are a different quantity in a different unit
       (a fraction of committed capital, an R16-verified exception) and are
       explicitly OUT of the standardised scope. */
    const k1 = read("client/src/components/partner/SpvK1Panel.tsx");
    expect(k1).toContain("toFixed(4)");
  });
});
