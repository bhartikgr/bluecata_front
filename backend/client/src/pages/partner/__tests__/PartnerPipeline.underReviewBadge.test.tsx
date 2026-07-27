/**
 * w-partner F8 — a managing_partner must be able to tell an APPROVED collective
 * promotion from one still awaiting chapter-admin review.
 *
 * ANTI-VACUITY. The previous managing_partner branch rendered "Make Private"
 * and nothing else, so `underReview` was computed and thrown away: a pending
 * promotion and a live one looked identical. Two failure modes are therefore
 * asserted separately:
 *   1. pending_collective_review → the badge renders AND "Make Private" is
 *      still there. A fix that swapped the button for a badge would be a silent
 *      drop of the withdraw affordance, so the button assertion is the point.
 *   2. live → the badge is ABSENT. Without this, a hardcoded badge would pass
 *      test (1) while telling the partner nothing.
 * The associate branch is asserted unchanged (read-only badge, no button).
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerPipeline from "../PartnerPipeline";

const DEAL_ID = "pd_f8_deal";

let subRole = "managing_partner";
let promotionStatus = "pending_collective_review";

/* PartnerShell pulls in the nav chrome; PartnerEmptyState ships from the same
   module and IS used by the page, so the mock must provide both. */
vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_f8",
      tier: "builder",
      subRole,
      identity: { userId: "u_f8", email: "f8@example.com", name: "F8 Partner" },
    },
  }),
}));

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

beforeEach(() => {
  subRole = "managing_partner";
  promotionStatus = "pending_collective_review";
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/partner/me/pipeline") {
      return jsonResponse({
        pipeline: [
          {
            id: DEAL_ID,
            dealName: "F8 Deal",
            stage: "invited",
            estCheckSizeMinor: null,
            currency: null,
            ownerUserId: "u_f8",
            sector: "Fintech",
            companyId: "co_f8",
          },
        ],
        stages: [],
      });
    }
    if (url === "/api/partner/me/promotions") {
      return jsonResponse({
        promotions: [
          { id: "promo_f8", pipelineDealId: DEAL_ID, promotionType: "collective_deal_room", status: promotionStatus },
        ],
      });
    }
    if (url === "/api/partner/me/spv") return jsonResponse({ spvs: [] });
    if (url === "/api/partner/me/following") return jsonResponse({ following: [] });
    return jsonResponse({});
  });
});

afterEach(() => cleanup());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerPipeline />
    </QueryClientProvider>,
  );
}

describe("F8 — managing_partner sees promotion review state", () => {
  it("renders the In-review badge ALONGSIDE Make Private while pending review", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId(`make-private-btn-${DEAL_ID}`)).toBeTruthy());
    // The new state affordance…
    expect(screen.getByTestId(`promo-under-review-mp-${DEAL_ID}`).textContent).toContain("In review");
    // …and the withdraw control it must NOT have replaced.
    expect(screen.getByTestId(`make-private-btn-${DEAL_ID}`).textContent).toContain("Make Private");
    // Make Private is deliberately NOT gated on `live` — withdrawing a pending
    // promotion is exactly what a partner needs to be able to do.
    expect((screen.getByTestId(`make-private-btn-${DEAL_ID}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the same badge for the plain `pending` status", async () => {
    promotionStatus = "pending";
    renderPage();
    await waitFor(() => expect(screen.getByTestId(`make-private-btn-${DEAL_ID}`)).toBeTruthy());
    expect(screen.getByTestId(`promo-under-review-mp-${DEAL_ID}`)).toBeTruthy();
  });

  it("does NOT render the badge once the promotion is live (badge is state-driven)", async () => {
    promotionStatus = "live";
    renderPage();
    await waitFor(() => expect(screen.getByTestId(`make-private-btn-${DEAL_ID}`)).toBeTruthy());
    expect(screen.queryByTestId(`promo-under-review-mp-${DEAL_ID}`)).toBeNull();
    // NO-DROP — the live-gated In-Deal-Room badge is untouched.
    expect(screen.getByTestId(`badge-promoted-${DEAL_ID}`).textContent).toContain("In Deal Room");
  });
});

describe("F8 — NO-DROP: the associate branch is unchanged", () => {
  it("an associate still sees the read-only status badge and NO withdraw control", async () => {
    subRole = "associate";
    renderPage();
    await waitFor(() => expect(screen.getByTestId(`collective-status-${DEAL_ID}`)).toBeTruthy());
    expect(screen.getByTestId(`collective-status-${DEAL_ID}`).textContent).toContain("In review");
    expect(screen.queryByTestId(`make-private-btn-${DEAL_ID}`)).toBeNull();
    expect(screen.queryByTestId(`promo-under-review-mp-${DEAL_ID}`)).toBeNull();
  });
});
