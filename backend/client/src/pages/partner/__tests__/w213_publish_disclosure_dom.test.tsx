/**
 * WAVE 213 — the governing clause is ON the publish panel, and the tick is real.
 *
 * Handbook §8, NEVER PROVE A REPLICA: the REAL `PartnerPipeline` page is mounted
 * and the REAL "Publish to Collective" button is clicked. Nothing about the panel
 * is re-implemented here. The harness (mocks for the nav shell, toast, role hook
 * and `apiRequest`) is the one `PartnerPipeline.underReviewBadge.test.tsx` already
 * uses on this same page, so the page under test is unmodified.
 *
 * ANTI-VACUITY. Three failure modes are asserted separately, because a fix that
 * satisfied one could still ship the defect:
 *   1. the clause RENDERS and says the true things (a panel with a heading and no
 *      body would pass a "does the block exist" test);
 *   2. the button is DISABLED until the tick and ENABLED after it (a clause that
 *      is merely decorative would pass (1));
 *   3. the request actually CARRIES the sentence (a tick that gates only the
 *      button would pass (1) and (2) while the server had nothing to check).
 * Plus: no existing copy on the panel was replaced (R143.1), and the tick does
 * not survive re-opening the panel for a DIFFERENT company.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerPipeline from "../PartnerPipeline";
import {
  PUBLISH_ACK_FIELD,
  PUBLISH_CLAUSE_AGREEMENT_PATH,
  PUBLISH_CLAUSE_ID,
  PUBLISH_CLAUSE_VERSION,
  publishAcknowledgementText,
  publishGoverningClauseParagraphs,
  consortiumAgreementSection,
} from "@shared/wave213PublishGoverningClause";

const DEAL_ID = "pd_w213_deal";
const DEAL_NAME = "Northwind Robotics";
const DEAL2_ID = "pd_w213_other";
const DEAL2_NAME = "Southgate Health";

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
      partnerId: "p_w213",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w213", email: "w213@example.com", name: "W213 Partner" },
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
    status: 201,
    statusText: "201",
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
          { id: DEAL_ID, dealName: DEAL_NAME, stage: "invited", estCheckSizeMinor: null, currency: null, ownerUserId: "u_w213", sector: "Robotics", companyId: "co_w213" },
          { id: DEAL2_ID, dealName: DEAL2_NAME, stage: "invited", estCheckSizeMinor: null, currency: null, ownerUserId: "u_w213", sector: "Health", companyId: "co_w213b" },
        ],
        stages: [],
      });
    }
    if (url === "/api/partner/me/promotions") return jsonResponse({ promotions: [] });
    if (url === "/api/partner/me/spv") return jsonResponse({ spvs: [] });
    if (url === "/api/partner/me/following") return jsonResponse({ following: [] });
    return jsonResponse({ promotion: { id: "promo_w213", status: "pending_collective_review" } });
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

/** Opens the real publish panel for a deal by clicking the real button. */
async function openPanel(dealId: string) {
  await waitFor(() => expect(screen.getByTestId(`publish-collective-btn-${dealId}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`publish-collective-btn-${dealId}`));
  await waitFor(() => expect(screen.getByTestId("promote-modal")).toBeTruthy());
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 1 — THE CLAUSE IS THERE, AND IT SAYS THE TRUE THINGS.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("1 — the governing clause renders on the panel where publishing happens", () => {
  it("1a every paragraph of the clause is on the screen, verbatim", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    const expected = publishGoverningClauseParagraphs(DEAL_NAME);
    expect(expected.length).toBeGreaterThan(5);
    expected.forEach((para, i) => {
      /* Verbatim per paragraph, not a substring search over the whole panel: a
         panel that rendered only the first sentence of each would pass that. */
      expect(screen.getByTestId(`publish-clause-para-${i}`).textContent).toBe(para);
    });
    /* And nothing is left over — no paragraph is silently dropped. */
    expect(screen.queryByTestId(`publish-clause-para-${expected.length}`)).toBeNull();
    expect(screen.getByTestId("publish-clause-block")).toBeTruthy();
  });

  it("1b the clause names THIS company, not a generic placeholder", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    const text = screen.getByTestId("publish-clause-block").textContent ?? "";
    expect(text).toContain(DEAL_NAME);
    expect(text).not.toContain("this deal");
    expect(text).not.toContain(DEAL2_NAME);
  });

  it("1c the four facts a partner could not otherwise know are on the screen", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    const text = screen.getByTestId("publish-clause-block").textContent ?? "";
    expect(text).toContain("pending Collective review");           /* not immediate */
    expect(text).toContain("Your firm is named");                   /* not anonymous */
    expect(text).toContain(`${DEAL_NAME} is not notified`);          /* company unaware */
    expect(text).toContain("You cannot fully undo this");            /* partial reversal */
    expect(text).toContain("cap-table summary");                     /* the material field */
  });

  it("1d the signed agreement clause is QUOTED and LINKED, not paraphrased", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    const quote = consortiumAgreementSection();
    expect(quote).not.toBeNull();
    expect(screen.getByTestId("publish-clause-agreement-quote").textContent).toBe(quote);
    const link = screen.getByTestId("publish-clause-agreement-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(PUBLISH_CLAUSE_AGREEMENT_PATH);
  });

  it("1e the acknowledgement sentence shown is the sentence the server will rebuild", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    expect(screen.getByTestId("publish-ack-text").textContent).toBe(publishAcknowledgementText(DEAL_NAME));
  });

  it("1f NO-DROP (R143.1) — every sentence that was on this panel before is still on it", async () => {
    /* This wave APPENDS. If any of these had been replaced rather than joined,
       the guard would score removed copy and a partner would have lost text. */
    renderPage();
    await openPanel(DEAL_ID);
    const modal = screen.getByTestId("promote-modal").textContent ?? "";
    for (const before of [
      "Promote to Collective Deal Room",
      "This deal will be submitted for Collective admin review.",
      `Deal: ${DEAL_NAME}`,
      "Notes (optional)",
      "Cancel",
      "Promote",
    ]) {
      expect(modal, `pre-existing copy "${before}"`).toContain(before);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 2 — THE TICK GATES THE ACTION, AND IS ABOUT ONE NAMED COMPANY.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("2 — the acknowledgement is mandatory in the UI", () => {
  it("2a Promote is disabled before the tick and enabled after it", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    const btn = () => screen.getByTestId("promote-confirm") as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    fireEvent.click(screen.getByTestId("publish-ack-check"));
    expect(btn().disabled).toBe(false);
    /* Un-ticking disables it again — the gate is bound to state, not a one-way flip. */
    fireEvent.click(screen.getByTestId("publish-ack-check"));
    expect(btn().disabled).toBe(true);
  });

  it("2b clicking Promote while untigged sends NOTHING", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    apiRequestMock.mockClear();
    fireEvent.click(screen.getByTestId("promote-confirm"));
    await new Promise((r) => setTimeout(r, 20));
    const promoteCalls = apiRequestMock.mock.calls.filter((c) => String(c[1]).includes("promote-to-collective"));
    expect(promoteCalls.length).toBe(0);
  });

  it("2c the tick does NOT carry over to a different company", async () => {
    /* The confirmation names a subject. A tick harvested on one deal must not
       pre-authorise publishing another. */
    renderPage();
    await openPanel(DEAL_ID);
    fireEvent.click(screen.getByTestId("publish-ack-check"));
    expect((screen.getByTestId("promote-confirm") as HTMLButtonElement).disabled).toBe(false);
    /* Dismiss and open the panel for the OTHER deal. */
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("promote-modal")).toBeNull());
    await openPanel(DEAL2_ID);
    expect((screen.getByTestId("promote-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("publish-ack-check") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("publish-ack-text").textContent).toBe(publishAcknowledgementText(DEAL2_NAME));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 3 — THE REQUEST CARRIES THE SENTENCE.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("3 — the acknowledgement travels to the server", () => {
  it("3a the POST body carries the clause id, version and the exact sentence", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    fireEvent.click(screen.getByTestId("publish-ack-check"));
    fireEvent.click(screen.getByTestId("promote-confirm"));

    await waitFor(() => {
      const call = apiRequestMock.mock.calls.find((c) => String(c[1]).includes("promote-to-collective"));
      expect(call).toBeTruthy();
    });
    const call = apiRequestMock.mock.calls.find((c) => String(c[1]).includes("promote-to-collective"))!;
    expect(call[0]).toBe("POST");
    expect(call[1]).toBe(`/api/partner/me/pipeline/${DEAL_ID}/promote-to-collective`);
    const body = call[2] as Record<string, unknown>;
    const ack = body[PUBLISH_ACK_FIELD] as Record<string, unknown>;
    expect(ack).toBeTruthy();
    expect(ack.clauseId).toBe(PUBLISH_CLAUSE_ID);
    expect(ack.clauseVersion).toBe(PUBLISH_CLAUSE_VERSION);
    /* Not a boolean. The sentence, so the server can refuse a stale one. */
    expect(ack.text).toBe(publishAcknowledgementText(DEAL_NAME));
  });

  it("3b nothing else about the request changed — notes still travel as before", async () => {
    renderPage();
    await openPanel(DEAL_ID);
    const notes = screen.getByPlaceholderText(/Why this deal fits the Collective/i);
    fireEvent.change(notes, { target: { value: "strong team" } });
    fireEvent.click(screen.getByTestId("publish-ack-check"));
    fireEvent.click(screen.getByTestId("promote-confirm"));
    await waitFor(() => {
      const call = apiRequestMock.mock.calls.find((c) => String(c[1]).includes("promote-to-collective"));
      expect(call).toBeTruthy();
    });
    const body = apiRequestMock.mock.calls.find((c) => String(c[1]).includes("promote-to-collective"))![2] as Record<string, unknown>;
    expect(body.notes).toBe("strong team");
    /* And no field appeared that would narrow what is shared. */
    expect(Object.keys(body).sort()).toEqual([PUBLISH_ACK_FIELD, "notes"].sort());
  });
});
