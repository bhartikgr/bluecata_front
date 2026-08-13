/**
 * WAVE 35 · ROW 7 — falsification harness: the product must never tell an
 * investor who has wired real capital that they hold nothing.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 * `PortfolioCompanySwitcher` rendered "Your portfolio is empty" from a count of
 * DIRECT cap-table positions, directly above `<LpPositions />`, which was at
 * the same moment rendering the investor's real vehicle interests — a visible
 * self-contradiction inside one viewport. Review C found that one instance.
 * There was a SECOND: `DashboardSpinePanels`, driven by the equally
 * cap-table-only `spine.hasFundedPosition`, and that panel has no LP list
 * beneath it, so the false statement stood entirely unqualified.
 *
 * ── ANTI-VACUITY ────────────────────────────────────────────────────────────
 * The lazy fix is to delete the sentence, and the lazy test is "the LP does not
 * see the word empty" — which a blank component passes. Every section below
 * therefore asserts BOTH poles on BOTH surfaces:
 *
 *   POLE A — a GENUINELY empty investor (no direct positions, no vehicle
 *            interests) still sees the original empty-state, with its original
 *            copy and its original CTAs. Deleting the message fails here.
 *   POLE B — an LP-only investor sees an honest state, does NOT see the false
 *            sentence, and the count they are told matches the fixture.
 *   POLE C — a DUAL-position investor sees BOTH kinds of holding, with the
 *            vehicle interests NOT folded into the cap-table totals.
 *   POLE D — the answer is UNKNOWN (the LP request failed): the surface must
 *            not present "empty" as established fact; it renders an explicit
 *            refusal. A null is not a zero.
 *
 * Preconditions are established by the test, never consulted: no `process.env`
 * read decides what is asserted. Static imports only.
 *
 * Assertions target exported copy constants rather than retyped strings, so a
 * copy edit cannot make an assertion silently stop matching and pass anyway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { PortfolioCompanySwitcher } from "../PortfolioCompanySwitcher";
import { PortfolioStandingPanel } from "../DashboardSpinePanels";
import {
  LP_ONLY_HEADLINE,
  LP_INTERESTS_UNAVAILABLE_COPY,
  lpOnlyBody,
  lpOnlyBodyDashboard,
  LP_POSITIONS_QUERY_KEY,
} from "@/lib/investor/lpVehicleInterests";

/* ── the sentence under indictment ────────────────────────────────────────── */
const FALSE_SENTENCE = "Your portfolio is empty";
const LADDER_COPY = /You don't hold any positions yet/;

/* ── network fixtures ─────────────────────────────────────────────────────── */
const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

/* The dashboard panel is a pure consumer of SPINE-0; the spine itself is not
   under test in this row, so it is supplied as a fixture. The LP hook is NOT
   mocked anywhere in this file — the real hook runs against the real endpoint
   shape, because the hook is the thing being proven. */
let SPINE_FIXTURE: Record<string, unknown> = {};
vi.mock("@/lib/investor/investorSpine", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/investor/investorSpine")
  >("@/lib/investor/investorSpine");
  return { ...actual, useInvestorSpine: () => SPINE_FIXTURE };
});

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useLocation: () => ["/investor/portfolio", vi.fn()],
    // Spread every prop: shadcn's <Button asChild> forwards `data-testid` and
    // handlers onto its child, so a Link mock that swallows props would make
    // the CTA assertions fail for a reason unrelated to the defect.
    Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const VEHICLE = (id: string) => ({
  spvId: id,
  spvName: `Vehicle ${id}`,
  jurisdiction: "DE",
  currency: "JPY", // exponent 0 — a /100 anywhere in the count path is visible
  positionType: "spv_lp_interest" as const,
  commitmentMinor: 5_000_000,
  calledCapitalMinor: 5_000_000,
  distributionsReceivedMinor: 0,
  ownershipFraction: 0.05,
  capitalAccountMinor: 5_000_000,
  navTotalMinor: null,
  navShareMinor: null,
  navAsOfDate: "2026-01-01",
  navBadge: null,
  navRefusalCopy: null,
  hasSideLetter: false,
  refusalCopy: null,
});

const DIRECT = (companyId: string, company: string) => ({
  id: `pos_${companyId}`,
  companyId,
  company,
  logoColor: "#123456",
});

/**
 * Establishes the whole world for one identity. `lpMode` is either a list of
 * vehicles, or the literal "fail" to model an unanswerable LP question.
 */
function setWorld(opts: {
  direct: ReturnType<typeof DIRECT>[];
  lp: ReturnType<typeof VEHICLE>[] | "fail";
}) {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url === "/api/investor/me/lp-positions") {
      if (opts.lp === "fail") throw new Error("503 LP_POSITIONS_UNAVAILABLE");
      return jsonResponse({ positions: opts.lp, collectiveScope: "all" });
    }
    throw new Error(`unexpected apiRequest to ${url}`);
  });

  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        // The switcher reads /api/investor/portfolio2 through the default
        // queryFn; route it off the same fixture so one identity is described
        // in one place and the two surfaces cannot be given different worlds.
        queryFn: async ({ queryKey }) => {
          const key = String(queryKey[0]);
          if (key === "/api/investor/portfolio2") return opts.direct;
          // The LP key must NEVER reach here: the hook supplies its own queryFn
          // through `apiRequest`. If this throws, the hook stopped going
          // through the endpoint it claims to read, and the test says so
          // loudly instead of quietly serving a duplicate fixture.
          throw new Error(`unexpected query ${key}`);
        },
      },
    },
  });
  return qc;
}

function renderWith(qc: QueryClient, node: React.ReactElement) {
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const SWITCHER = <PortfolioCompanySwitcher selectedCompanyId={null} onCompanyChange={() => {}} />;

function spine(holdings: { companyId: string; company: string; invested: number; currentValue: number }[]) {
  return {
    holdings,
    hasFundedPosition: holdings.length > 0,
    recentActivity: [],
    pendingInvitations: [],
    softCircledInvitations: [],
    channelUnlockState: {},
    maCompanyIds: [],
    isLoading: false,
  } as Record<string, unknown>;
}

beforeEach(() => {
  SPINE_FIXTURE = spine([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* SURFACE 1 — PortfolioCompanySwitcher                                      */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("ROW 7 · surface 1 — PortfolioCompanySwitcher", () => {
  it("POLE B: an LP-only investor is NOT told their portfolio is empty", async () => {
    const qc = setWorld({ direct: [], lp: [VEHICLE("spv_a"), VEHICLE("spv_b")] });
    renderWith(qc, SWITCHER);

    await waitFor(() =>
      expect(screen.getByTestId("portfolio-lp-only-state")).toBeTruthy(),
    );

    // The false sentence is gone for THIS identity...
    expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    expect(screen.queryByTestId("portfolio-empty-state")).toBeNull();
    // ...and something TRUE is in its place. Not merely "not empty" — the
    // headline and the count are both asserted, so a component that rendered
    // nothing at all would fail here.
    expect(screen.getByTestId("portfolio-lp-only-headline").textContent).toBe(
      LP_ONLY_HEADLINE,
    );
    expect(screen.getByTestId("portfolio-lp-only-body").textContent).toBe(
      lpOnlyBody(2),
    );
    expect(screen.getByTestId("portfolio-lp-only-body").textContent).toContain(
      "2 vehicles",
    );
  });

  it("POLE B (singular): the count is the real count, not a boolean", async () => {
    const qc = setWorld({ direct: [], lp: [VEHICLE("spv_only")] });
    renderWith(qc, SWITCHER);
    await waitFor(() =>
      expect(screen.getByTestId("portfolio-lp-only-body")).toBeTruthy(),
    );
    // "1 vehicle", not "1 vehicles" and not "2 vehicles" — a hardcoded count or
    // a boolean-to-string collapse fails this.
    expect(screen.getByTestId("portfolio-lp-only-body").textContent).toBe(
      lpOnlyBody(1),
    );
    expect(screen.getByTestId("portfolio-lp-only-body").textContent).toContain(
      "1 vehicle.",
    );
  });

  it("POLE A: a GENUINELY empty investor still sees the empty state, unaltered", async () => {
    const qc = setWorld({ direct: [], lp: [] });
    renderWith(qc, SWITCHER);

    await waitFor(() =>
      expect(screen.getByTestId("portfolio-empty-state")).toBeTruthy(),
    );
    // The message was NOT deleted — this is the assertion that fails if the
    // "fix" were simply to remove the sentence.
    expect(screen.getByText(FALSE_SENTENCE)).toBeTruthy();
    expect(screen.getByText(LADDER_COPY)).toBeTruthy();
    // Its CTAs survive too (functionality is never silently dropped).
    expect(screen.getByTestId("button-portfolio-review-invitations")).toBeTruthy();
    expect(screen.getByTestId("button-portfolio-claim-earlier")).toBeTruthy();
    expect(screen.getByTestId("button-portfolio-explore")).toBeTruthy();
    // And the LP-only state must NOT appear for someone who holds nothing.
    expect(screen.queryByTestId("portfolio-lp-only-state")).toBeNull();
    expect(screen.queryByTestId("portfolio-lp-unavailable")).toBeNull();
  });

  it("POLE C: a DUAL-position investor keeps the direct switcher (LP does not suppress it)", async () => {
    const qc = setWorld({
      direct: [DIRECT("co_alpha", "Alpha Robotics Inc."), DIRECT("co_beta", "Beta Foods Ltd.")],
      lp: [VEHICLE("spv_a")],
    });
    renderWith(qc, SWITCHER);

    await waitFor(() =>
      expect(screen.getByTestId("portfolio-company-switcher")).toBeTruthy(),
    );
    // Direct holdings still render (an over-fix that showed the LP state to
    // everyone with a vehicle interest would fail here)...
    expect(screen.queryByTestId("portfolio-lp-only-state")).toBeNull();
    expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    // ...and the LP interests are rendered by <LpPositions /> on the same page,
    // which is proven by the source fence at the end of this file.
  });

  it("POLE D: an UNANSWERABLE LP question is not reported as 'empty' without a refusal", async () => {
    const qc = setWorld({ direct: [], lp: "fail" });
    renderWith(qc, SWITCHER);

    await waitFor(() =>
      expect(screen.getByTestId("portfolio-lp-unavailable")).toBeTruthy(),
    );
    expect(screen.getByTestId("portfolio-lp-unavailable").textContent).toBe(
      LP_INTERESTS_UNAVAILABLE_COPY,
    );
    // The empty-state is still shown (we cannot invent holdings either), but it
    // is no longer an unqualified assertion of fact.
    expect(screen.getByTestId("portfolio-empty-state")).toBeTruthy();
  });

  it("no surface asserts emptiness while the LP question is still open", async () => {
    // A pending LP request must not produce a flash of the false sentence that
    // is then corrected — a lie for 200ms is still a lie.
    // NOTE: the hook supplies its OWN queryFn (via apiRequest), so the default
    // queryFn below is NOT what serves the LP key. Both have to be pinned or
    // the test silently exercises a stale mock from a previous case — which is
    // exactly what happened on the first run of this file.
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(() => new Promise(() => {}));
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          queryFn: async ({ queryKey }) => {
            const key = String(queryKey[0]);
            if (key === "/api/investor/portfolio2") return [];
            return new Promise(() => {}); // LP request never settles
          },
        },
      },
    });
    renderWith(qc, SWITCHER);
    await waitFor(() =>
      expect(screen.getByTestId("portfolio-empty-pending-lp")).toBeTruthy(),
    );
    expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* SURFACE 2 — DashboardSpinePanels (the instance Review C did not name)     */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("ROW 7 · surface 2 — DashboardSpinePanels portfolio standing", () => {
  it("POLE B: an LP-only investor is NOT told their portfolio is empty", async () => {
    SPINE_FIXTURE = spine([]);
    const qc = setWorld({ direct: [], lp: [VEHICLE("spv_a"), VEHICLE("spv_b"), VEHICLE("spv_c")] });
    renderWith(qc, <PortfolioStandingPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("spine-portfolio-lp-only")).toBeTruthy(),
    );
    expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    expect(screen.queryByTestId("spine-portfolio-empty")).toBeNull();
    expect(screen.getByTestId("spine-portfolio-lp-only-headline").textContent).toBe(
      LP_ONLY_HEADLINE,
    );
    expect(screen.getByTestId("spine-portfolio-lp-only-body").textContent).toBe(
      lpOnlyBodyDashboard(3),
    );
    // The dashboard has no LP list of its own, so it MUST route the investor to
    // the surface that does. Without this they are told what they hold and then
    // given nowhere to see it.
    expect(screen.getByTestId("spine-portfolio-lp-only-view")).toBeTruthy();
  });

  it("POLE A: a GENUINELY empty investor still sees the dashboard empty state", async () => {
    SPINE_FIXTURE = spine([]);
    const qc = setWorld({ direct: [], lp: [] });
    renderWith(qc, <PortfolioStandingPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("spine-portfolio-empty")).toBeTruthy(),
    );
    expect(screen.getByText(FALSE_SENTENCE)).toBeTruthy();
    expect(screen.getByText(LADDER_COPY)).toBeTruthy();
    expect(screen.queryByTestId("spine-portfolio-lp-only")).toBeNull();
    expect(screen.queryByTestId("spine-portfolio-lp-unavailable")).toBeNull();
  });

  it("POLE C: a DUAL-position investor sees BOTH kinds of holding on the dashboard", async () => {
    SPINE_FIXTURE = spine([
      { companyId: "co_alpha", company: "Alpha Robotics Inc.", invested: 50_000, currentValue: 75_000 },
    ]);
    const qc = setWorld({ direct: [DIRECT("co_alpha", "Alpha Robotics Inc.")], lp: [VEHICLE("spv_a")] });
    renderWith(qc, <PortfolioStandingPanel />);

    // the direct holding
    await waitFor(() =>
      expect(screen.getByTestId("spine-holding-co_alpha")).toBeTruthy(),
    );
    // rule #13 — the full company name, verbatim
    expect(screen.getByTestId("spine-holding-co_alpha").textContent).toContain(
      "Alpha Robotics Inc.",
    );
    // AND the vehicle interest is acknowledged rather than silently omitted
    await waitFor(() =>
      expect(screen.getByTestId("spine-portfolio-also-lp")).toBeTruthy(),
    );
    expect(screen.getByTestId("spine-portfolio-also-lp-view")).toBeTruthy();
    // NEVER summed together: the panel's holdings count still describes only
    // cap-table holdings. Folding a vehicle interest into "Holdings: 2" would
    // tell the investor they are on two cap tables when they are on one.
    expect(screen.getByTestId("spine-portfolio-count").textContent).toContain("1");
  });

  it("POLE D: an UNANSWERABLE LP question renders a refusal, not a bare 'empty'", async () => {
    SPINE_FIXTURE = spine([]);
    const qc = setWorld({ direct: [], lp: "fail" });
    renderWith(qc, <PortfolioStandingPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("spine-portfolio-lp-unavailable")).toBeTruthy(),
    );
    expect(screen.getByTestId("spine-portfolio-lp-unavailable").textContent).toBe(
      LP_INTERESTS_UNAVAILABLE_COPY,
    );
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* SOURCE FENCES — a component that is not mounted is not shipped            */
/* ═════════════════════════════════════════════════════════════════════════ */

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("ROW 7 · fences", () => {
  it("both surfaces consume the SAME hook — a third instance cannot drift", () => {
    const switcher = read("client/src/components/investor/PortfolioCompanySwitcher.tsx");
    const dash = read("client/src/components/investor/DashboardSpinePanels.tsx");
    expect(switcher).toContain("useLpVehicleInterests");
    expect(dash).toContain("useLpVehicleInterests");
    // Neither re-implements the question locally against the endpoint.
    expect(switcher).not.toContain('"/api/investor/me/lp-positions"');
    expect(dash).not.toContain('"/api/investor/me/lp-positions"');
  });

  it("the fence itself fails on a fixture that lacks the hook (anti-vacuity)", () => {
    const bare = "export function X() { return null; }";
    expect(bare).not.toContain("useLpVehicleInterests");
  });

  it("LpPositions still shares one query key with the hook", () => {
    const lp = read("client/src/components/investor/LpPositions.tsx");
    expect(lp).toContain("/api/investor/me/lp-positions");
    expect(LP_POSITIONS_QUERY_KEY[0]).toBe("/api/investor/me/lp-positions");
  });

  it("the Portfolio page still mounts LpPositions beneath the switcher", () => {
    const page = read("client/src/pages/investor/Portfolio.tsx");
    expect(page).toContain("<LpPositions />");
    expect(page.indexOf("<PortfolioCompanySwitcher")).toBeLessThan(
      page.indexOf("<LpPositions />"),
    );
  });

  it("there is no THIRD un-guarded instance of the false sentence", () => {
    // Review C found one; there were two. This fails the build if a third
    // appears anywhere in the client that is not one of the two guarded sites.
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "node_modules") continue;
          walk(rel);
        } else if (/\.tsx?$/.test(e.name)) {
          // Strip comments first: a doc-comment that NAMES the defect (as this
          // row's own comments do) is not a surface that renders it. Without
          // this the fence would fire on its own documentation and get
          // relaxed away, which is how fences die.
          const src = read(rel)
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "");
          if (src.includes(FALSE_SENTENCE)) hits.push(rel);
        }
      }
    };
    walk("client/src");
    expect(hits.sort()).toEqual([
      "client/src/components/investor/DashboardSpinePanels.tsx",
      "client/src/components/investor/PortfolioCompanySwitcher.tsx",
    ]);
  });
});
