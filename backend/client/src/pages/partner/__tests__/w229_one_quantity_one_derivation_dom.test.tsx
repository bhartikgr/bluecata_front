/**
 * WAVE 229 — ONE QUANTITY, ONE DERIVATION (rendered half).
 *
 * The two real defects this wave fixes are both invisible in the server tests:
 * they were second derivations living in CLIENT components. So both real screens
 * are mounted — the real `PartnerTeam` and the real `PartnerPipeline`, not a
 * replica — and asserted against payloads shaped exactly like the ones the real
 * routes return (the server-side companion,
 * `server/__tests__/w229_one_quantity_one_resolver.test.ts`, drives those routes
 * over real HTTP and asserts the shape).
 *
 * ANTI-VACUITY — THIS IS THE POINT OF THE FILE. Each payload here is chosen so
 * that the OLD derivation and the NEW one produce DIFFERENT rendered output:
 *
 *   · Team: `pendingCount: 3` alongside an `invitations` array containing ONE
 *     unredeemed row. The old code counted the array (1); the new code renders
 *     the server figure (3). A fixture where the two agreed would pass either
 *     way and prove nothing.
 *   · Pipeline: a deal whose stage is the LEGACY value "sourcing". The old code
 *     (`if (byStage[d.stage])`) dropped it from every column; the new code lands
 *     it in Invited. A deal on a canonical stage would pass either way.
 *
 * A third case asserts the absent-value behaviour: with no `pendingCount` in the
 * payload the banner must NOT render "0 pending". A fabricated zero about seat
 * capacity is exactly the class of claim this platform is forbidden to make.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerTeam from "../PartnerTeam";
import PartnerPipeline from "../PartnerPipeline";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/partner/useRequirePartnerRole", async () => {
  const actual = await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  );
  return {
    ...actual,
    useRequirePartnerRole: () => ({
      ready: true,
      error: null,
      identity: {
        partnerId: "p_w229",
        tier: "builder",
        subRole: "managing_partner",
        identity: { userId: "u_w229", email: "w229@example.com", name: "W229 Partner" },
      },
    }),
  };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
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

/* ONE unredeemed invitation row. The old client derivation counted these. */
const ONE_UNREDEEMED_INVITATION = [
  {
    id: "inv_w229_a",
    invitedEmail: "pending.a@example.com",
    email: "pending.a@example.com",
    subRole: "viewer",
    title: null,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    redeemedAt: null,
  },
];

let teamPayload: Record<string, unknown>;
let pipelineStage: string;

beforeEach(() => {
  /* THE DIVERGENCE CASE: server says 3 pending, the array holds 1. */
  teamPayload = {
    members: [
      {
        userId: "u_w229",
        email: "w229@example.com",
        name: "W229 Partner",
        subRole: "managing_partner",
        status: "active",
        title: null,
      },
    ],
    invitations: ONE_UNREDEEMED_INVITATION,
    pendingCount: 3,
    seatLimit: 5,
    activeSeats: 1,
    meta: { duplicateSeatCount: 0 },
  };
  pipelineStage = "sourcing";
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/partner/me/team") return jsonResponse(teamPayload);
    if (url === "/api/partner/me/pipeline") {
      return jsonResponse({
        pipeline: [
          {
            id: "pd_w229",
            dealName: "W229 Legacy Stage Deal",
            stage: pipelineStage,
            estCheckSizeMinor: null,
            currency: null,
            ownerUserId: "u_w229",
            sector: "Fintech",
            companyId: "co_w229",
          },
        ],
        stages: [],
      });
    }
    if (url === "/api/partner/me/promotions") return jsonResponse({ promotions: [] });
    if (url === "/api/partner/me/spv") return jsonResponse({ spvs: [] });
    if (url === "/api/partner/me/following") return jsonResponse({ following: [] });
    return jsonResponse({});
  });
});

afterEach(() => cleanup());

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("WAVE 229 defect 1 — the Team seat banner renders the server's pending figure", () => {
  it("renders the server pendingCount (3), NOT the invitations-array count (1)", async () => {
    mount(<PartnerTeam />);
    const banner = await waitFor(() => screen.getByTestId("seat-banner"));
    await waitFor(() => expect(banner.textContent).toContain("3 pending"));
    /* The old derivation would have produced "1 pending". Asserting its ABSENCE
       is what makes this test fail on a revert rather than merely on a crash. */
    expect(banner.textContent).not.toContain("1 pending");
    expect(banner.textContent).toContain("1 of 5 seats");
  });

  it("MOVE THE FIXTURE — the rendered figure follows the server figure, so it is not a hardcoded 3", async () => {
    teamPayload = { ...teamPayload, pendingCount: 7 };
    mount(<PartnerTeam />);
    const banner = await waitFor(() => screen.getByTestId("seat-banner"));
    await waitFor(() => expect(banner.textContent).toContain("7 pending"));
    expect(banner.textContent).not.toContain("3 pending");
  });

  it("with NO server figure the banner renders an em dash, never a fabricated 0", async () => {
    const { pendingCount: _dropped, ...withoutPendingCount } = teamPayload as { pendingCount?: number };
    teamPayload = withoutPendingCount;
    mount(<PartnerTeam />);
    const banner = await waitFor(() => screen.getByTestId("seat-banner"));
    await waitFor(() => expect(banner.textContent).toContain("— pending"));
    expect(banner.textContent).not.toContain("0 pending");
  });

  it("NO-DROP — the pending invitation row itself is still listed", async () => {
    mount(<PartnerTeam />);
    await waitFor(() => expect(screen.getByTestId("seat-banner")).toBeTruthy());
    /* The `invitations` array is still consumed for the list; only the COUNT
       stopped being re-derived from it. */
    await waitFor(() => expect(screen.getByText("pending.a@example.com")).toBeTruthy());
  });
});

describe("WAVE 229 defect 2 — the Pipeline kanban canonicalises legacy stages", () => {
  it("a deal on the LEGACY stage 'sourcing' appears in the Invited column", async () => {
    mount(<PartnerPipeline />);
    await waitFor(() => expect(screen.getByTestId("pipeline-kanban")).toBeTruthy());
    const invited = screen.getByTestId("column-invited");
    await waitFor(() => expect(invited.querySelector('[data-testid="deal-pd_w229"]')).toBeTruthy());
    /* The count in the column header must move too — a card rendered under a
       header still reading "(0)" would be a different lie. */
    expect(invited.textContent).toContain("(1)");
  });

  it("the legacy-stage deal is not ALSO duplicated into another column", async () => {
    mount(<PartnerPipeline />);
    await waitFor(() => expect(screen.getByTestId("pipeline-kanban")).toBeTruthy());
    await waitFor(() => expect(screen.queryAllByTestId("deal-pd_w229").length).toBe(1));
  });

  it("MOVE THE FIXTURE — a canonical stage still lands in its own column", async () => {
    pipelineStage = "funded";
    mount(<PartnerPipeline />);
    await waitFor(() => expect(screen.getByTestId("pipeline-kanban")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId("column-funded").querySelector('[data-testid="deal-pd_w229"]')).toBeTruthy(),
    );
    expect(screen.getByTestId("column-invited").querySelector('[data-testid="deal-pd_w229"]')).toBeNull();
  });

  it("an unrecognised stage lands in a REAL column instead of vanishing", async () => {
    pipelineStage = "a_stage_that_has_never_existed";
    mount(<PartnerPipeline />);
    await waitFor(() => expect(screen.getByTestId("pipeline-kanban")).toBeTruthy());
    /* Losing a deal from every column is the failure this wave exists to remove;
       landing it in the default bucket is visible and correctable. */
    await waitFor(() => expect(screen.queryAllByTestId("deal-pd_w229").length).toBe(1));
  });
});

/* CONTROL RUN — jsdom does not implement `scrollIntoView`, and a component that
   calls it has previously produced "N passed" while the runner exited NONZERO.
   The exit code of this file's run is therefore part of its verdict and is
   recorded in W229_TESTS.md. This assertion exists so that a run in which the
   DOM harness silently failed to mount anything cannot read as a pass. */
it("control — the harness really mounted both real screens", async () => {
  mount(<PartnerTeam />);
  await waitFor(() => expect(screen.getByTestId("seat-banner")).toBeTruthy());
  cleanup();
  mount(<PartnerPipeline />);
  await waitFor(() => expect(screen.getByTestId("pipeline-kanban")).toBeTruthy());
});
