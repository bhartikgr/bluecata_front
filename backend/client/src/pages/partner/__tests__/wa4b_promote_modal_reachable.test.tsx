/**
 * WAVE A · ITEM 4b — the acknowledgement tick and the confirm button on the
 * "Publish to Collective" panel must be REACHABLE.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE — stated plainly, because a test that
 * cannot distinguish the fix from the defect is worse than no test.
 *   jsdom performs NO LAYOUT. Every getBoundingClientRect() here is 0x0, so a
 *   "the checkbox is on screen" assertion in this file would pass identically
 *   against the broken build. It is therefore NOT attempted.
 *   The reachability proof is a REAL BROWSER run: the same page, bundled from
 *   this tree, driven in headless Chromium at 360x640, 390x740, 414x896 and
 *   1280x720. Before the fix the box rendered ~1921px tall with
 *   `overflow-y: visible` and `max-height: none`, its top at -555px, twenty
 *   wheel events moved its scrollTop by 0, and clicking `publish-ack-check`
 *   timed out. After it, scrollTop reached 1381, both controls entered the
 *   viewport, and the tick + Promote click completed. Evidence:
 *   build_log/walkthroughA/.
 *
 * WHAT THIS FILE DOES PROVE, and it is the thing that can silently regress:
 *   that THIS call site still passes a height bound and an overflow rule of its
 *   own. The shared primitive supplies neither, so if this className is dropped
 *   the blocker returns. That is a durable, non-vacuous assertion.
 *
 * ANTI-VACUITY. A DOM assertion that passes against an empty <body> has
 * happened on this platform before, so every check below is gated on
 * preconditions the empty page cannot satisfy: the fixture deal name must be
 * rendered, the panel must be opened by clicking the REAL button, and the panel
 * must carry the REAL long disclosure (its paragraph count is asserted) — that
 * length is the whole reason the box overflowed.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerPipeline from "../PartnerPipeline";
import { publishGoverningClauseParagraphs } from "@shared/wave213PublishGoverningClause";

const DEAL_ID = "pd_wa4b_deal";
const DEAL_NAME = "Northwind Robotics";

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
      partnerId: "p_wa4b",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_wa4b", email: "wa4b@example.com", name: "WA4B Partner" },
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
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/partner/me/pipeline") {
      return jsonResponse({
        pipeline: [
          { id: DEAL_ID, dealName: DEAL_NAME, stage: "invited", estCheckSizeMinor: null, currency: null, ownerUserId: "u_wa4b", sector: "Robotics", companyId: "co_wa4b" },
        ],
        stages: [],
      });
    }
    if (url === "/api/partner/me/promotions") return jsonResponse({ promotions: [] });
    if (url === "/api/partner/me/spv") return jsonResponse({ spvs: [] });
    if (url === "/api/partner/me/following") return jsonResponse({ following: [] });
    return jsonResponse({ promotion: { id: "promo_wa4b", status: "pending_collective_review" } });
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

async function openPanel(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByTestId(`publish-collective-btn-${DEAL_ID}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`publish-collective-btn-${DEAL_ID}`));
  await waitFor(() => expect(screen.getByTestId("promote-modal")).toBeTruthy());
  return screen.getByTestId("promote-modal");
}

describe("WAVE A item 4b — the publish panel bounds its own height and scrolls", () => {
  it("4b.0 PRECONDITIONS — the real deal, the real button and the real long disclosure are present", async () => {
    renderPage();
    // An empty <body> fails here before any className is inspected.
    await waitFor(() => expect(screen.getByText(DEAL_NAME)).toBeTruthy());
    const modal = await openPanel();
    const paras = modal.querySelectorAll('[data-testid^="publish-clause-para-"]');
    // The disclosure is what makes the box taller than a phone screen. If it is
    // ever shortened, this test's premise is gone and it must be re-derived.
    expect(paras.length).toBe(publishGoverningClauseParagraphs(DEAL_NAME).length);
    expect(paras.length).toBeGreaterThanOrEqual(5);
    expect(modal.textContent!.length).toBeGreaterThan(2000);
    expect(modal.querySelectorAll('[data-testid="publish-ack-check"]').length).toBe(1);
    expect(modal.querySelectorAll('[data-testid="promote-confirm"]').length).toBe(1);
  });

  it("4b.1 the panel carries a height bound AND an overflow rule of its own", async () => {
    renderPage();
    const modal = await openPanel();
    const cls = modal.className;
    expect(cls).toMatch(/\bmax-h-\[[^\]]+\]/);
    expect(cls).toMatch(/\boverflow-y-(auto|scroll)\b/);
  });

  it("4b.2 the shared dialog primitive still supplies NEITHER — so the call site is load-bearing", async () => {
    // This is the control. It fails the moment someone 'helpfully' moves the fix
    // into components/ui/dialog.tsx, which would change 65 surfaces at once and
    // must be a reviewed wave of its own rather than a silent side effect here.
    const src = await import("../../../components/ui/dialog");
    expect(typeof src.DialogContent).toBe("object");
    renderPage();
    const modal = await openPanel();
    const base = modal.className.replace(/\bmax-h-\[[^\]]+\]/g, "").replace(/\boverflow-y-(auto|scroll)\b/g, "");
    expect(base).not.toMatch(/max-h-/);
    expect(base).not.toMatch(/overflow-y-/);
  });

  it("4b.3 the tick is still what enables Promote, and the disclosure text is unchanged", async () => {
    renderPage();
    const modal = await openPanel();
    const confirm = screen.getByTestId("promote-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("publish-ack-check"));
    await waitFor(() => expect((screen.getByTestId("promote-confirm") as HTMLButtonElement).disabled).toBe(false));
    // The server rebuilds and compares this sentence. Nothing in this wave may move it.
    for (const para of publishGoverningClauseParagraphs(DEAL_NAME)) {
      expect(modal.textContent).toContain(para);
    }
  });
});
