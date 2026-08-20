/**
 * WAVE 73 · ITEM 8 · R47 / R48 (R58 row 6) — THE FOUNDER DASHBOARD STOPS
 * FABRICATING AN OWNERSHIP FIGURE.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, quoted from the tree as it was:
 *
 *     client/src/pages/founder/Dashboard.tsx:454
 *     client/src/pages/founder/Dashboard.tsx:554
 *         fmtPct((company?.kpi?.ownershipPct ?? 0) * 100, 2)
 *
 * When the server sent no ownership figure at all, `?? 0` turned "unknown" into
 * the specific, confident claim `0.00%` — twice, on the first screen a founder
 * sees. R47: an unknown ownership renders an em-dash. R48 already ruled the same
 * fabrication out at the API. Open across three waves (Wave 69 V-5, Wave 72 F-4).
 *
 * THE FIX IS A REMOVAL. There is no replacement default: one derivation,
 * `ownershipPctRaw == null ? null : Number(ownershipPctRaw) * 100`, feeding the
 * platform's own `fmtPct`, which renders the dash for a value it cannot read.
 *
 * BOTH POLES, both read out of the DOM:
 *   HONEST pole      — the response carries NO `ownershipPct`. Both renders show
 *                      the em-dash, and `0.00%` is ABSENT from the whole page.
 *   LEGITIMATE pole  — a real fraction (0.385) still renders `38.50%` at both
 *                      sites, and a GENUINE STORED ZERO still renders `0.00%`,
 *                      because a real zero is a value and not an unknown.
 *
 * The legitimate poles are deliberately the same numbers Wave 61a pinned
 * (`w61a_ownership_precision.test.tsx`), so this file cannot pass by weakening
 * what that wave proved.
 *
 * MUTATION TRANSCRIPT: build_log/wave73/W73_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

/** The KPI block the mocked `/api/founder/active-company` answer carries. Set per
    test. `undefined` means the field is ABSENT from the response, which is the
    state the `?? 0` fabricated a zero for. */
let kpi: Record<string, unknown> = { capTableHolders: 3, ownershipPct: 0.385 };

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/useActiveCompany", async () => {
  const actual = await vi.importActual<typeof import("@/lib/useActiveCompany")>("@/lib/useActiveCompany");
  return {
    ...actual,
    useActiveCompanyId: () => "co_w73",
    useActiveCompany: () => ({
      data: { activeCompanyId: "co_w73", company: { companyName: "W73 Co", kpi } },
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

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  kpi = { capTableHolders: 3, ownershipPct: 0.385 };
});

describe("WAVE 73 · ITEM 8 — an unknown founder ownership renders a dash, never 0.00%", () => {
  it("HONEST POLE — no ownershipPct in the response: BOTH renders show the dash and 0.00% is absent from the page", async () => {
    kpi = { capTableHolders: 3 }; /* the field is not there at all */
    renderDashboard();

    await waitFor(() => expect(screen.getByTestId("stat-ownership")).toBeTruthy());
    const strip = screen.getByTestId("stat-ownership").textContent ?? "";
    const tile = screen.getByTestId("bento-tile-kpi-ownership").textContent ?? "";

    /* THE STRING THAT MUST REACH THE DOM. */
    expect(strip).toContain("—");
    expect(tile).toContain("—");
    /* THE STRING THAT MUST NOT. Both the fabricated figure and any other\n       zero-shaped ownership claim. */
    expect(strip).not.toContain("0.00%");
    expect(tile).not.toContain("0.00%");
    expect(strip).not.toContain("0%");
    expect(tile).not.toContain("0%");

    /* NO SILENT DROP: the refusal replaced the VALUE, not the container. The
       label, the hint and the tile are all still on screen. */
    expect(strip).toContain("Founder ownership");
    expect(strip).toContain("of fully-diluted");
    expect(tile).toContain("Founder ownership");
    expect(screen.getByTestId("stat-holders")).toBeTruthy();
  });

  it("HONEST POLE — an explicit null is treated the same as an absent field", async () => {
    kpi = { capTableHolders: 3, ownershipPct: null };
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("stat-ownership")).toBeTruthy());
    expect(screen.getByTestId("stat-ownership").textContent ?? "").toContain("—");
    expect(screen.getByTestId("stat-ownership").textContent ?? "").not.toContain("0.00%");
    expect(screen.getByTestId("bento-tile-kpi-ownership").textContent ?? "").toContain("—");
  });

  it("LEGITIMATE POLE — a real fraction is unchanged: 0.385 still renders 38.50% at BOTH sites", async () => {
    kpi = { capTableHolders: 3, ownershipPct: 0.385 };
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("stat-ownership")).toBeTruthy());
    const strip = screen.getByTestId("stat-ownership").textContent ?? "";
    expect(strip).toContain("38.50%");
    expect(strip).not.toContain("—");
    /* The value, not just the format — a rescale in either direction fails. */
    expect(strip).not.toContain("3850");
    expect(strip).not.toContain("0.385%");
    expect(screen.getByTestId("bento-tile-kpi-ownership").textContent ?? "").toContain("38.50%");
  });

  it("LEGITIMATE POLE — a GENUINE STORED ZERO still says 0.00%: the fix removes a fabrication, not a real value", async () => {
    kpi = { capTableHolders: 3, ownershipPct: 0 };
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("stat-ownership")).toBeTruthy());
    const strip = screen.getByTestId("stat-ownership").textContent ?? "";
    expect(strip).toContain("0.00%");
    expect(strip).not.toContain("—");
    expect(screen.getByTestId("bento-tile-kpi-ownership").textContent ?? "").toContain("0.00%");
  });

  it("SOURCE — the `?? 0` coalesce is gone from Dashboard.tsx, and no other default replaced it", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const raw = fs.readFileSync(path.resolve(__dirname, "..", "Dashboard.tsx"), "utf8");
    /* COMMENTS ARE STRIPPED FIRST, and this is not a convenience. The fix's own
       comment QUOTES the defect it removed — that quotation is the record of what
       the screen used to say, and a source assertion that cannot tell code from
       prose would force the next agent to delete the evidence to keep the gate
       green. Only executable text is asserted on. */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    /* The exact defect text, as R58 row 6 recorded it. */
    expect(src).not.toContain("fmtPct((company?.kpi?.ownershipPct ?? 0) * 100, 2)");
    /* And no substitute default crept in (R54: no `?? 0`, `|| 0`, `Math.max`). */
    expect(src).not.toContain("kpi?.ownershipPct ?? 0");
    expect(src).not.toContain("kpi?.ownershipPct || 0");
    expect(src).not.toContain("Math.max(0, ownershipPct");
    /* One derivation, two renders. */
    expect((src.match(/fmtPct\(ownershipPctDisplay, 2\)/g) ?? []).length).toBe(2);
  });
});
