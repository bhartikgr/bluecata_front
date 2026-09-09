/**
 * ══════════════════════════════════════════════════════════════════════════════
 * RESIDUALS · ITEM 4 (client half) — `dataroom:co_a2e5ca95c358:drf_54fe72c0`.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * QA read that string in the founder dashboard's activity feed, where a
 * description of what happened belongs.
 *
 * TWO THINGS WERE WRONG, AND MEASURING FOUND THE SECOND ONE.
 *
 *   (1) `founder/Dashboard.tsx` rendered `{a.targetLabel || a.target}` RAW, at
 *       two places (the bento card and the main activity list). It never called
 *       a formatter at all — the same shape as the currency card, where the
 *       formatter already existed one file away and the screen was not using it.
 *
 *   (2) BUT ROUTING IT THROUGH THE EXISTING FORMATTER WOULD NOT HAVE FIXED THE
 *       REPORTED STRING, and claiming otherwise would have been a false green.
 *       `safeTargetLabel` deliberately returns a non-person target UNCHANGED,
 *       because on the ADMIN AUDIT LEDGER an object reference is information an
 *       operator needs. So `founder/Activity.tsx` leaks this string today too —
 *       the dashboard was simply the surface QA happened to be looking at.
 *
 * Hence `founderTargetLabel`: a layer over the existing guard, applied on the
 * two FOUNDER surfaces, leaving the admin audit column byte-unchanged.
 *
 * WHAT THIS FILE PROVES:
 *   1  CONTROL — the feed really rendered, and the matchers can fail.
 *   2  THE DEFECT IS GONE FROM THE RENDERED DASHBOARD — the raw composite key is
 *      nowhere in the activity feed's text.
 *   3  WHAT IS THERE INSTEAD is honest and unique — the kind in words plus the
 *      platform's existing Wave 115 reference.
 *   4  A SERVER-SUPPLIED HUMAN LABEL STILL WINS — the fix does not overwrite
 *      good data. This is the pole that makes 2 and 3 non-vacuous.
 *   5  THE LABELLER'S OWN POLES, including that a plain human target and a
 *      person-shaped target are untouched.
 *   6  THE ADMIN AUDIT LEDGER IS NOT CHANGED — `safeTargetLabel` still returns
 *      the object reference exactly as before.
 *
 * Harness modelled on `w116_founder_dashboard_money_truth.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "../Dashboard";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { founderTargetLabel, safeTargetLabel } from "@/lib/actorLabel";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const COMPANY_ID = "co_residuals_i4";
/** The exact string QA read off the live founder dashboard. */
const RAW_TARGET = "dataroom:co_a2e5ca95c358:drf_54fe72c0";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    isLoading: false,
    data: { activeCompanyId: COMPANY_ID, company: { id: COMPANY_ID, companyName: "Residuals Co", billing: { plan: "founder_pro" } } },
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

let ACTIVITY: Array<Record<string, unknown>> = [];

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
    if (u.includes("/api/activity")) return res(200, ACTIVITY);
    if (u === "/api/rounds" || u.startsWith("/api/rounds?")) return res(200, []);
    if (u.includes("/api/auth/me")) return res(200, { id: "u_f", displayName: "Founder", role: "founder" });
    if (u.includes("/api/founder/profile/completion")) return res(200, { percent: 50, missing: [] });
    if (u.includes("/api/founder/dataroom/engagement")) return res(200, { topDocs: [], investors: [] });
    if (u.includes("attribution")) return res(200, { attributedPartner: null });
    return res(200, []);
  }));
}

function renderDashboard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "returnNull" }) } },
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

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "act_residuals_1",
    ts: "2026-09-01T10:00:00Z",
    actor: "u_someone",
    actorLabel: "Ada Founder",
    action: "dataroom.uploaded",
    target: RAW_TARGET,
    targetLabel: null,
    ...overrides,
  };
}

const squash = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The feed's rendered text, from whichever of the two lists mounted. */
async function feedText(): Promise<string> {
  const node = await waitFor(
    () => {
      const el =
        document.querySelector('[data-testid="row-activity-act_residuals_1"]') ??
        document.querySelector('[data-testid="bento-activity-act_residuals_1"]');
      expect(el, "the activity row must be rendered before its text can be asserted").toBeTruthy();
      return el as HTMLElement;
    },
    { timeout: 8000 },
  );
  return squash(node.textContent);
}

beforeEach(() => { ACTIVITY = [activityRow()]; installFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("RESIDUALS · Item 4 — the founder activity feed, rendered", () => {
  it("1 · CONTROL — the row rendered with real content, and a false claim about it fails", async () => {
    renderDashboard();
    const text = await feedText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("Ada Founder");                    // positive anchor
    expect(text).not.toContain("a sentence this feed does not contain");
    expect(screen.queryByTestId("row-activity-THIS-DOES-NOT-EXIST")).toBeNull();
  }, 20_000);

  it("2 · THE DEFECT IS GONE — the raw composite key is not in the feed's text", async () => {
    renderDashboard();
    const text = await feedText();
    expect(text).not.toContain(RAW_TARGET);
    expect(text).not.toContain("drf_");
    expect(text).not.toContain("co_a2e5ca95c358");
  }, 20_000);

  it("3 · what is shown instead is honest, readable and still unique", async () => {
    renderDashboard();
    const text = await feedText();
    expect(text).toContain("Dataroom");
    expect(text).toContain("Reference DRF-54FE72C0");
    /* The reference preserves the discriminator, so two different files never
       collapse into the same words. */
    expect(founderTargetLabel(null, "dataroom:co_a2e5ca95c358:drf_54fe72c0"))
      .not.toBe(founderTargetLabel(null, "dataroom:co_a2e5ca95c358:drf_99999999"));
  }, 20_000);

  it("4 · a server-supplied HUMAN label still wins — the fix does not overwrite good data", async () => {
    ACTIVITY = [activityRow({ targetLabel: "Q3 Financials.pdf" })];
    renderDashboard();
    const text = await feedText();
    expect(text).toContain("Q3 Financials.pdf");
    expect(text).not.toContain("Reference");
    expect(text).not.toContain(RAW_TARGET);
  }, 20_000);

  it("5 · the labeller's own poles — only a composite storage key is rewritten", () => {
    /* Untouched: an ordinary human string. */
    expect(founderTargetLabel(null, "Series A")).toBe("Series A");
    expect(founderTargetLabel("Series A", "rnd_1")).toBe("Series A");
    /* Untouched: a colon string whose last segment is NOT a storage key. */
    expect(founderTargetLabel(null, "round:Series A")).toBe("round:Series A");
    /* Untouched: the person-shaped case the original guard already handled. */
    expect(founderTargetLabel(null, "user:u_founder_1")).toBe(safeTargetLabel(null, "user:u_founder_1"));
    /* Nothing is returned empty. */
    expect(founderTargetLabel(null, RAW_TARGET).trim().length).toBeGreaterThan(0);
  });

  it("6 · the ADMIN audit ledger is unchanged — `safeTargetLabel` still returns the object reference", () => {
    /* The admin operator's column keeps its raw reference, deliberately. If this
       ever changes it is a separate, argued decision — not a side effect of a
       founder-facing copy fix. */
    expect(safeTargetLabel(null, RAW_TARGET)).toBe(RAW_TARGET);
    expect(safeTargetLabel(null, RAW_TARGET)).not.toBe(founderTargetLabel(null, RAW_TARGET));
  });
});
