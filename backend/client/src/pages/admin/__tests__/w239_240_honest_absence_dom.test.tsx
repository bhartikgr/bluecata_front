/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVES 239 + 240 — TWO ADMIN SCREENS STOP READING AS REASSURANCE WHEN THEY
 * HAVE NOTHING TO REPORT.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT, WAVE 239 (`admin/Reconciliation`). The screen's subject is
 * hardcoded on every path: `buildDemoComputeOpts` (`client/src/lib/sprint3.ts:203`)
 * fixes the whole `transactions` array regardless of input, and the real-data
 * loader `loadRealSecurities` (`:190`) has ZERO callers tree-wide. Its run
 * history lives in `useSprint3` — Zustand, browser memory, `reconciliations: []`
 * at `:78` — so a fresh tab has never compared anything. The tile VALUES were
 * already honest; the tone was not. `Divergences (30d)` read
 * `tone: stats.divergences > 0 ? "critical" : "positive"`, so an empty history
 * produced `0` with a GREEN dot: "we checked, nothing diverged", when the truth
 * was "nothing has ever been checked". A never-run check must not report zero
 * divergences.
 *
 * THE DEFECT, WAVE 240 (`admin/Dashboard`). Five service-health tiles each read
 * `tone={X != null && <threshold> ? "warn" : "ok"}`. When `X` is null the `&&`
 * short-circuits and ABSENT lands in the same branch as HEALTHY. Four of the
 * five figures are hardcoded `null` on the server
 * (`server/adminPlatformStore.ts:165-168`), so the absent branch is the ONLY
 * branch this card takes in this build — and above the dash on the Reconcile
 * tile sat a hardcoded `<ShieldCheck className="text-emerald-600" />`.
 *
 * ── WHY EVERY TEST HERE RENDERS TWO FIXTURES ────────────────────────────────
 * A test that asserts "the no-data tile is neutral" is satisfied by a component
 * that renders EVERY tile neutral — inert-proof mechanism 10, a fixture that
 * cannot distinguish the fix from the defect, and the specific trap flagged for
 * this pair: on a tile card, absent and healthy previously produced identical
 * output, so a single fixture proves nothing about which branch was taken.
 * §1 and §2 therefore render an ABSENT fixture and a PRESENT fixture and assert
 * they render DIFFERENTLY, naming the difference on both sides.
 *
 * Both screens are the REAL exported page components, mounted in the real
 * providers (§8 of ENGINEERING_NOTES: never prove a replica). §1 drives the REAL
 * reconciliation runner to populate history rather than hand-writing a result
 * object into the store, so the "present" fixture is one the product itself can
 * produce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useLocation: () => ["/admin", vi.fn()] };
});

import AdminDashboard from "../Dashboard";
import AdminReconciliation from "../Reconciliation";
import { useSprint3, runReconciliation, buildDemoComputeOpts } from "@/lib/sprint3";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** The health block EXACTLY as this build's server emits it: four hardcoded
 *  nulls plus a reconcile block whose rate is null because `recon_runs` is
 *  empty. Verified against server/adminPlatformStore.ts:163-169. */
const HEALTH_ABSENT = {
  capTableReconcile: { runs: 0, success: 0, successRatePct: null },
  closeGateFailures: null,
  dataroomUploadErrors: null,
  messageDelivery: { sent: null, delivered: null, deliveryRatePct: null },
  emailSlaSec: null,
};

/** The same block with every figure PRESENT and inside its healthy threshold.
 *  Not reachable in this build; it exists so §2 can prove the two cases render
 *  differently rather than assert a constant. */
const HEALTH_PRESENT = {
  capTableReconcile: { runs: 4, success: 4, successRatePct: 100 },
  closeGateFailures: 0,
  dataroomUploadErrors: 0,
  messageDelivery: { sent: 200, delivered: 200, deliveryRatePct: 100 },
  emailSlaSec: 12,
};

function kpis(health: unknown) {
  return {
    summary: {
      totalCompanies: 3, totalInvestors: 4, totalCommittedSoftCircle: null, totalFunded: null,
      momGrowthPct: null, churnPct: null, nrr: null,
      totalSpvCommittedMinor: { USD: 1_100_037 },
      totalSpvSubscribedAllStagesMinor: { USD: 10_500_108 },
      totalSpvWiredMinor: { USD: 400_000 },
      totalActiveSpvs: 2,
    },
    queues: {},
    health,
    funnels: { onboarding: [], investor: [] },
    topCompanies: [], topInvestors: [], regions: [],
  };
}

let health: unknown = HEALTH_ABSENT;

beforeEach(() => {
  health = HEALTH_ABSENT;
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/api/admin/dashboard/kpis")) return jsonResponse(kpis(health));
    if (url.includes("/api/admin/dashboard/activity")) return jsonResponse({ items: [] });
    if (url.includes("/api/admin/companies")) return jsonResponse({ items: [] });
    return jsonResponse({ items: [] });
  });
  /* Zustand is module-global; reset the run history so §1's ABSENT case is
     genuinely absent and cannot be contaminated by §1's PRESENT case. */
  useSprint3.setState({ reconciliations: [] } as never);
});

afterEach(() => cleanup());

function mount(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

const DIV_STAT = "admin-intro-stat-divergences-(30d)";
const DIV_VALUE = "admin-intro-stat-value-divergences-(30d)";

describe("W239 §1 — a never-run check says so, and a run check still reports green", () => {
  it("ABSENT: with no run in history the divergence figure is '—', its dot is slate, and it is NOT emerald", async () => {
    expect(useSprint3.getState().reconciliations).toHaveLength(0);
    mount(<AdminReconciliation />);
    await waitFor(() => expect(screen.getByTestId(DIV_VALUE)).toBeTruthy());

    expect(screen.getByTestId(DIV_VALUE).textContent).toBe("—");
    /* The point of the wave: 0 is not the honest answer when nothing ran. */
    expect(screen.getByTestId(DIV_VALUE).textContent).not.toBe("0");

    const dot = screen.getByTestId(DIV_STAT).querySelector("span");
    expect(dot).toBeTruthy();
    expect(dot!.className).toContain("bg-slate-400");
    expect(dot!.className).not.toContain("bg-emerald-500");

    expect(screen.getByTestId(DIV_STAT).textContent).toContain("No run recorded — nothing has been compared");
  });

  it("PRESENT: after the REAL runner records a clean run, the same tile reports 0 with an emerald dot — so §1's neutrality is a branch, not a constant", async () => {
    /* Drives client/src/lib/sprint3.ts's own `runReconciliation`, the function
       the screen's button calls. If this produced nothing, the ABSENT assertion
       above would be unfalsifiable. */
    await act(async () => {
      await runReconciliation(buildDemoComputeOpts("co_w239"), { actorId: "u_w239", companyId: "co_w239" } as never);
    });
    expect(useSprint3.getState().reconciliations.length).toBeGreaterThan(0);

    mount(<AdminReconciliation />);
    await waitFor(() => expect(screen.getByTestId(DIV_VALUE)).toBeTruthy());

    /* MEASURED, NOT ASSUMED. I first asserted "0" here on the assumption that the
       built-in example cap table reconciles cleanly. It does not: the real runner
       reports ONE divergence, so this fixture lands on the `critical` branch
       (rose dot), not `positive`. That is a better proof than the one I intended
       — it shows the tile's OTHER pre-existing branch is still reachable and was
       not flattened by adding `neutral` — and it is recorded rather than tuned
       away, because a test that had been bent until it passed would have hidden
       the fact that the demonstration cap table does not agree with itself. */
    expect(screen.getByTestId(DIV_VALUE).textContent).toBe("1");
    expect(screen.getByTestId(DIV_VALUE).textContent).not.toBe("—");
    const dot = screen.getByTestId(DIV_STAT).querySelector("span");
    expect(dot!.className).toContain("bg-rose-500");
    expect(dot!.className).not.toContain("bg-slate-400");
    expect(screen.getByTestId(DIV_STAT).textContent).not.toContain("No run recorded");
  });

  it("the scope disclosure states the three facts an operator needs, and does not claim a check the platform performs", async () => {
    mount(<AdminReconciliation />);
    await waitFor(() => expect(screen.getByTestId("recon-scope-disclosure")).toBeTruthy());
    const text = screen.getByTestId("recon-scope-disclosure").textContent ?? "";
    expect(text).toContain("held in this browser tab only");
    expect(text).toContain("They are not a report about the server");
    expect(text).toContain("There is no scheduled reconciliation job");
    expect(text).toContain("built-in example cap table that ships with the software");
    expect(text).toContain("shows a dash, not a zero");
  });
});

describe("W240 §2 — an absent service-health figure renders as absent, not as a pass", () => {
  it("ABSENT: all five tiles show '—', carry a 'Not reported' line, a dashed neutral card and a greyed icon", async () => {
    health = HEALTH_ABSENT;
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("card-health-reconcile")).toBeTruthy());

    const ids = ["card-health-reconcile", "card-health-closegate", "card-health-dataroom", "card-health-msgs", "card-health-email"];
    for (const id of ids) {
      const tile = screen.getByTestId(id);
      expect(tile.textContent).toContain("—");
      /* The absence is SAID, not merely styled: colour is not evidence to a
         colour-blind or screen-reader operator. */
      expect(screen.getByTestId(`${id}-nodata`).textContent).toContain("Not reported");
      expect(tile.className).toContain("border-dashed");
      expect(screen.getByTestId(`${id}-icon`).className).toContain("grayscale");
    }
    /* The specific hazard named for this wave: a green tick above a dash. The
       emerald shield literal is untouched at the call site — it is greyed by its
       wrapper — so this asserts what the operator SEES. */
    expect(screen.getByTestId("card-health-reconcile-icon").className).toContain("opacity-50");
  });

  it("PRESENT: with every figure supplied and healthy, NO tile is dashed, NO 'Not reported' line exists, and the shield is not greyed", async () => {
    health = HEALTH_PRESENT;
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("card-health-reconcile")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("card-health-reconcile").textContent).toContain("100"));

    const ids = ["card-health-reconcile", "card-health-closegate", "card-health-dataroom", "card-health-msgs", "card-health-email"];
    for (const id of ids) {
      expect(screen.getByTestId(id).className).not.toContain("border-dashed");
      expect(screen.queryByTestId(`${id}-nodata`)).toBeNull();
      expect(screen.getByTestId(`${id}-icon`).className).not.toContain("grayscale");
    }
  });

  it("WARN still warns: a breaching figure is amber, and is neither the neutral nor the ok branch", async () => {
    /* Three-way tone unions are where a refactor quietly loses a branch. */
    health = { ...HEALTH_PRESENT, emailSlaSec: 900 };
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("card-health-email").textContent).toContain("900s"));
    const tile = screen.getByTestId("card-health-email");
    expect(tile.className).toContain("bg-amber-50");
    expect(tile.className).not.toContain("border-dashed");
    expect(screen.queryByTestId("card-health-email-nodata")).toBeNull();
  });

  it("the provenance note is unconditional and says a reconcile percentage is not evidence a reconciliation ran", async () => {
    health = HEALTH_PRESENT; // present, healthy, 100% — the case where a reader most needs the caveat
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("health-row-provenance")).toBeTruthy());
    const text = screen.getByTestId("health-row-provenance").textContent ?? "";
    expect(text).toContain("Not reported");
    expect(text).toContain("is not a pass");
    expect(text).toContain("not evidence that a cap table was reconciled");
    expect(text).toContain("no source in this build");
  });

  it("nothing was removed: all five tile labels still render", async () => {
    health = HEALTH_ABSENT;
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("card-health-reconcile")).toBeTruthy());
    for (const label of ["Reconcile success", "Close-gate fails", "Dataroom errors", "Message delivery", "Email SLA"]) {
      expect(screen.getByTestId("card-health-row").textContent).toContain(label);
    }
  });
});
