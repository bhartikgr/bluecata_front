/**
 * WAVE 60 · A-9 — SEVEN READS FIRED BEFORE THERE WAS A COMPANY TO SCOPE THEM TO.
 *
 * ── WHAT WAS ACTUALLY WRONG (the register's mechanism is corrected here) ──────
 * `client/src/lib/useActiveCompany.ts:75-86` returns `""` — an EMPTY STRING, not
 * `undefined` — until the active company resolves. None of these seven `useQuery`
 * calls had an `enabled:` option, so each issued a request with an EMPTY scope
 * parameter, `?companyId=`:
 *
 *   founder/ApplyToCollective.tsx  investor-crm · collective/nominations · collective/applications
 *   founder/Collective.tsx         collective/nominations · collective/applications
 *   founder/Dashboard.tsx          dataroom/engagement · reports2
 *
 * The register said the failure was "swallowed by `.catch(() => [])`". That is
 * wrong on two counts, both corrected by the pre-flight and re-verified here:
 *   (i)  `.catch` exists at only TWO of the seven sites (Collective.tsx:29, :35)
 *        and is attached to `.json()`, NOT to `apiRequest` — `apiRequest` throws
 *        `ApiError` on any non-2xx, so an HTTP failure PROPAGATES. Only an
 *        unparseable body is swallowed.
 *   (ii) The fabricated emptiness came from `?? []`. On /founder/collective that
 *        feeds the `statusBadge` IIFE whose empty-pair output is the badge
 *        **"Not applied"** — a confident assertion about the founder's OWN
 *        membership, produced by a read that never had a scope.
 *
 * ── A-9 IS A GUARD FIX, NOT A COPY FIX ───────────────────────────────────────
 * The only change is one option per query, `enabled: Boolean(companyId)`, copying
 * `founder/Dashboard.tsx:284` and `founder/CapTableSnapshots.tsx:84`. NO copy and
 * NO empty state is touched, which is why the UPPER POLE below asserts that
 * "Not applied" and the collective empty states are BYTE-IDENTICAL to before.
 * (Adding a refusal to these seven would be WRONG: with `enabled` false the query
 * is PENDING, not errored. That sequel is recorded as out of scope.)
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 *   LOWER  companyId === ""  → NO request is issued for any of the seven URLs
 *   UPPER  companyId set     → all of them ARE issued, with the id
 *   UPPER  companyId set + genuinely empty 200 → "Not applied" still renders,
 *          unchanged (proof A-9 changed no copy)
 *
 * MUTATION TRANSCRIPT: build_log/wave60/W60_TESTS.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

let activeCompanyId = "";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/useActiveCompany", async () => {
  const actual = await vi.importActual<typeof import("@/lib/useActiveCompany")>("@/lib/useActiveCompany");
  return {
    ...actual,
    useActiveCompanyId: () => activeCompanyId,
    /* founder/Dashboard.tsx:259-261 reads `active.data?.activeCompanyId`, NOT
       useActiveCompanyId(), so both shapes are supplied from the same switch. */
    useActiveCompany: () => ({
      data: { company: { companyName: "W60 Co" }, activeCompanyId: activeCompanyId || null },
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

import Collective from "../Collective";
import ApplyToCollective from "../ApplyToCollective";
import FounderDashboard from "../Dashboard";

/** The seven URL fragments, per page. */
const APPLY_URLS = [
  "/api/founder/investor-crm?companyId=",
  "/api/founder/collective/nominations?companyId=",
  "/api/founder/collective/applications?companyId=",
];
const COLLECTIVE_URLS = [
  "/api/founder/collective/nominations?companyId=",
  "/api/founder/collective/applications?companyId=",
];
const DASHBOARD_URLS = [
  "/api/founder/dataroom/engagement?companyId=",
  "/api/founder/reports2?companyId=",
];

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function requestedUrls(): string[] {
  return apiRequestMock.mock.calls.map((c) => String(c[1] ?? ""));
}

function renderPage(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: (async () => []) as never }, mutations: { retry: false } },
  });
  window.history.pushState({}, "", "/founder/collective");
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockImplementation(async () => jsonResponse([]));
});
afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  activeCompanyId = "";
});

describe("W60 · A-9 — no company-scoped read is issued before there is a company", () => {
  it("LOWER POLE (/founder/collective) — with companyId === \"\" neither scoped read is issued", async () => {
    activeCompanyId = "";
    renderPage(<Collective />);
    await new Promise((r) => setTimeout(r, 60));
    for (const frag of COLLECTIVE_URLS) {
      expect(requestedUrls().filter((u) => u.startsWith(frag))).toHaveLength(0);
    }
  });

  it("LOWER POLE (/founder/collective) — the request that WAS going out carried an empty scope", async () => {
    /* Pins the actual pre-fix shape, so this test is about the real defect and
       not about an invented one: the URL ended in `?companyId=` with nothing
       after it. If any such URL is ever issued again, this fails. */
    activeCompanyId = "";
    renderPage(<Collective />);
    await new Promise((r) => setTimeout(r, 60));
    expect(requestedUrls().filter((u) => /\?companyId=$/.test(u))).toHaveLength(0);
  });

  it("UPPER POLE (/founder/collective) — with a real companyId BOTH reads are issued, scoped", async () => {
    activeCompanyId = "co_w60";
    renderPage(<Collective />);
    await waitFor(() => {
      for (const frag of COLLECTIVE_URLS) {
        expect(requestedUrls().some((u) => u === `${frag}co_w60`)).toBe(true);
      }
    });
  });

  it("UPPER POLE (/founder/collective) — a genuinely empty SUCCESS still renders \"Not applied\", unchanged", async () => {
    /* A-9 touched no copy. If this string moves, A-9 did more than it claimed. */
    activeCompanyId = "co_w60";
    renderPage(<Collective />);
    expect(await screen.findByText("Not applied")).toBeTruthy();
  });

  it("LOWER POLE (/founder/collective/apply) — with companyId === \"\" none of the three scoped reads is issued", async () => {
    activeCompanyId = "";
    renderPage(<ApplyToCollective />);
    await new Promise((r) => setTimeout(r, 60));
    for (const frag of APPLY_URLS) {
      expect(requestedUrls().filter((u) => u.startsWith(frag))).toHaveLength(0);
    }
  });

  it("UPPER POLE (/founder/collective/apply) — with a real companyId all three ARE issued, scoped", async () => {
    activeCompanyId = "co_w60";
    renderPage(<ApplyToCollective />);
    await waitFor(() => {
      for (const frag of APPLY_URLS) {
        expect(requestedUrls().some((u) => u === `${frag}co_w60`)).toBe(true);
      }
    });
  });

  it("LOWER POLE (/founder/dashboard) — with companyId === \"\" neither tile read is issued", async () => {
    activeCompanyId = "";
    renderPage(<FounderDashboard />);
    await new Promise((r) => setTimeout(r, 80));
    for (const frag of DASHBOARD_URLS) {
      expect(requestedUrls().filter((u) => u.startsWith(frag))).toHaveLength(0);
    }
  });

  it("UPPER POLE (/founder/dashboard) — with a real companyId both tile reads ARE issued, scoped", async () => {
    activeCompanyId = "co_w60";
    renderPage(<FounderDashboard />);
    await waitFor(() => {
      for (const frag of DASHBOARD_URLS) {
        expect(requestedUrls().some((u) => u === `${frag}co_w60`)).toBe(true);
      }
    });
  });

  it("the deliberately-correct `mine` query is UNAFFECTED — it is not company-scoped and must still fire", async () => {
    /* founder/ApplyToCollective.tsx:208-227 is the tree's own worked example of
       getting this right (ApiError 404 → null, retry:false). A-9 must not have
       gated it, because it does not take a companyId at all. */
    activeCompanyId = "";
    renderPage(<ApplyToCollective />);
    await waitFor(() =>
      expect(requestedUrls().some((u) => u === "/api/founder/collective/applications/mine")).toBe(true),
    );
  });
});
