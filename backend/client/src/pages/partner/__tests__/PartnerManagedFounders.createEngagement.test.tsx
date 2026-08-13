/**
 * WAVE 16 — ORP-031 (DEF-031, MFC-05 / MFC-06): "Create an engagement" must be
 * fireable by a human, and its prerequisite must be visible.
 *
 * ANTI-VACUITY. Before this wave the page had 0 `<Button>` and 0 `useMutation`
 * while its own empty state told the partner to "Create an engagement" — the
 * classic shape of a check that checks nothing would be to assert only that a
 * button EXISTS. Every assertion here therefore has a paired opposite pole:
 *
 *   1. classified=true + write role  → button ENABLED, no blocked notice.
 *      classified=false             → button DISABLED, notice PRESENT and naming
 *                                     the administrator as the grantor.
 *      Neither pole can pass with a hardcoded outcome.
 *   2. The POST body is asserted FIELD BY FIELD against the server's actual
 *      reader (server/managedFounderRoutes.ts:90-108). A wiring that fired the
 *      right URL with the wrong keys would be indistinguishable from a working
 *      one without this.
 *   3. Mode A: the submit button is DISABLED without an authority artifact and
 *      ENABLED once one is typed — the client mirror of GATE 6
 *      (server/managedFounderStore.ts:381). Asserting only "disabled" would be
 *      satisfied by a permanently dead button, so both poles are asserted.
 *   4. `authorityExpiresAt` must be sent as END of the chosen day. A bare
 *      `YYYY-MM-DD` parses as UTC midnight and the server's `t <= Date.now()`
 *      (server/managedFounderStore.ts:80) would reject an artifact expiring
 *      today as EXPIRED. The test asserts the sent value is strictly greater
 *      than midnight of that date, so reverting to the bare date fails.
 *   5. A 404 `COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED` renders HUMAN copy and NOT
 *      the enum — asserted both ways (enum absent, sentence present).
 *   6. Detail view: mode change (PATCH .../mode) and hand-over (POST
 *      .../handover) fire with the right direction for the CURRENT mode, and the
 *      previously-unread event log (GET .../events) renders. A read-only role
 *      (viewer) gets no action buttons at all — opposite pole.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerManagedFounders from "../PartnerManagedFounders";

/* This repo's vitest setup does not install jest-dom, so `disabled` is asserted
   on the DOM property directly rather than through a matcher that does not exist. */
function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true;
}

const ENGAGEMENT_ID = "mfe_orp031";
const COMPANY_ID = "co_orp031";

let subRole = "managing_partner";
let classified = true;
let delegatedAgency = true;
let detailRoute = false;
let createHandler: (body: Record<string, unknown>) => { status: number; body: unknown } = () => ({
  status: 201,
  body: { engagement: engagementFixture() },
});

function engagementFixture(mode: "A" | "B" = "B") {
  return {
    id: ENGAGEMENT_ID,
    companyId: COMPANY_ID,
    mode,
    status: "active",
    authorityArtifactRef: null,
    authorityExpiresAt: null,
    trialExpiresAt: null,
    chapterId: null,
    matterId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

let engagementMode: "A" | "B" = "B";
let eventRows: Array<{ id: string; eventType: string; detail: null; actor: string | null; createdAt: string }> = [];
/* WAVE 17 ORP-031 — rows served by GET /api/partner/me/mfcrm/handovers. */
let handoverRows: Array<Record<string, unknown>> = [];

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("wouter", () => ({
  useRoute: () => (detailRoute ? [true, { id: ENGAGEMENT_ID }] : [false, null]),
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_orp031",
      tier: "builder",
      subRole,
      identity: { userId: "u_orp031", email: "orp031@example.com", name: "ORP031 Partner" },
    },
  }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** Mirrors `throwIfResNotOk` in client/src/lib/queryClient.ts:44 for the mock. */
async function respond(status: number, body: unknown): Promise<Response> {
  if (status >= 400) {
    const { ApiError } = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
    const code = (body as { error?: string }).error ?? null;
    throw new ApiError(status, "We couldn’t find what you were looking for.", code, body);
  }
  return jsonResponse(status, body);
}

const postBodies: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  subRole = "managing_partner";
  classified = true;
  delegatedAgency = true;
  detailRoute = false;
  engagementMode = "B";
  eventRows = [];
  handoverRows = [];
  postBodies.length = 0;
  createHandler = () => ({ status: 201, body: { engagement: engagementFixture() } });
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (method: string, url: string, body?: Record<string, unknown>) => {
    if (method !== "GET") postBodies.push({ method, url, body: body ?? {} });
    if (url === "/api/partner/me/mfcrm/capability") {
      return jsonResponse(200, {
        capability: {
          partnerId: "p_orp031",
          partnerType: classified ? "angel_network" : null,
          classified,
          delegatedAgency,
          advisoryCoseat: true,
          sourcesCapital: true,
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      });
    }
    if (url === "/api/partner/me/mfcrm/dashboard") {
      return jsonResponse(200, {
        classified,
        partnerType: classified ? "angel_network" : null,
        engagements: { total: 0, active: 0, modeA: 0, modeB: 0, lapsed: 0 },
        openCrossoverFlags: 0,
        queuedPushes: 0,
      });
    }
    if (url === "/api/partner/me/mfcrm/engagements" && method === "GET") {
      return jsonResponse(200, { engagements: [] });
    }
    if (url === "/api/partner/me/mfcrm/engagements" && method === "POST") {
      const out = createHandler(body ?? {});
      return respond(out.status, out.body);
    }
    if (url === "/api/partner/me/portfolio") {
      return jsonResponse(200, { portfolio: [{ companyId: COMPANY_ID, companyName: "ORP031 Co" }] });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}`) {
      return jsonResponse(200, { engagement: engagementFixture(engagementMode), trial: null });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}/events`) {
      return jsonResponse(200, { events: eventRows });
    }
    if (url.startsWith("/api/partner/me/mfcrm/layers/")) {
      return jsonResponse(200, { layers: [] });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}/mode`) {
      return jsonResponse(200, { engagement: engagementFixture("A") });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}/handover`) {
      return jsonResponse(201, { handover: { id: "mfh_1", status: "pending" } });
    }
    /* WAVE 17 ORP-031 — the detail view now READS the hand-over listing instead
       of relying on React state, so the fake transport must serve it. Returns
       whatever `handoverRows` holds, so a test can exercise both the empty pole
       and a pending row that this session did not initiate. */
    if (url.startsWith("/api/partner/me/mfcrm/handovers?")) {
      return jsonResponse(200, { handovers: handoverRows });
    }
    if (url === "/api/partner/me/mfcrm/handovers/mfh_1/confirm") {
      return jsonResponse(200, { engagement: engagementFixture("A") });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerManagedFounders />
    </QueryClientProvider>,
  );
}

async function openForm() {
  renderPage();
  const open = await screen.findByTestId("mf-create-open");
  await waitFor(() => expect(isDisabled(open)).toBe(false));
  fireEvent.click(open);
  return screen.findByTestId("mf-create-form");
}

describe("ORP-031 — the create control exists and can actually fire", () => {
  it("renders an ENABLED create control for a classified partner with a write role", async () => {
    renderPage();
    const btn = await screen.findByTestId("mf-create-open");
    await waitFor(() => expect(isDisabled(btn)).toBe(false));
    expect(btn.textContent).toContain("Create an engagement");
    // Opposite pole: no blocked notice when nothing blocks it.
    expect(screen.queryByTestId("mf-create-blocked")).toBeNull();
  });

  it("posts to the real route with the exact field names the server reads", async () => {
    await openForm();
    fireEvent.change(screen.getByTestId("mf-create-company"), { target: { value: COMPANY_ID } });
    fireEvent.change(screen.getByTestId("mf-create-chapter"), { target: { value: "ch_1" } });
    fireEvent.change(screen.getByTestId("mf-create-matter"), { target: { value: "m_1" } });
    fireEvent.click(screen.getByTestId("mf-create-submit"));

    await waitFor(() => expect(postBodies.length).toBe(1));
    const sent = postBodies[0];
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("/api/partner/me/mfcrm/engagements");
    expect(sent.body.companyId).toBe(COMPANY_ID);
    expect(sent.body.mode).toBe("B");
    expect(sent.body.chapterId).toBe("ch_1");
    expect(sent.body.matterId).toBe("m_1");
    // Mode B must NOT carry a Mode-A authority grant.
    expect(sent.body.authorityArtifactRef).toBeNull();
    expect(sent.body.authorityExpiresAt).toBeNull();
  });

  it("closes the form on success (proving the mutation's onSuccess ran)", async () => {
    await openForm();
    fireEvent.change(screen.getByTestId("mf-create-company"), { target: { value: COMPANY_ID } });
    fireEvent.click(screen.getByTestId("mf-create-submit"));
    await waitFor(() => expect(screen.queryByTestId("mf-create-form")).toBe(null));
  });

  it("offers the partner's portfolio as suggestions but keeps the field free text", async () => {
    await openForm();
    const input = screen.getByTestId("mf-create-company") as HTMLInputElement;
    expect(input.getAttribute("list")).toBe("mf-company-options");
    await waitFor(() => {
      const suggestions = document.querySelectorAll("#mf-company-options option");
      expect(suggestions.length).toBe(1);
      expect((suggestions[0] as HTMLOptionElement).value).toBe(COMPANY_ID);
    });
    // Free text: a company NOT in the datalist can still be submitted.
    fireEvent.change(input, { target: { value: "co_not_in_portfolio" } });
    fireEvent.click(screen.getByTestId("mf-create-submit"));
    await waitFor(() => expect(postBodies[0].body.companyId).toBe("co_not_in_portfolio"));
  });
});

describe("ORP-031 / MFC-06 — the invisible prerequisite is now visible", () => {
  it("disables creation and NAMES the reason when the capability profile is unclassified", async () => {
    classified = false;
    delegatedAgency = false;
    renderPage();
    const notice = await screen.findByTestId("mf-create-blocked");
    expect(notice.textContent).toMatch(/capability profile has not been classified/i);
    expect(notice.textContent).toMatch(/administrator/i);
    await waitFor(() => expect(isDisabled(screen.getByTestId("mf-create-open"))).toBe(true));
    // The refusal is SHOWN, not hidden: the control is present, just refused.
    expect(screen.getByTestId("mf-create-open")).toBeTruthy();
  });

  it("refuses a read-only partner role with a stated reason, not a vanished button", async () => {
    subRole = "viewer";
    renderPage();
    const notice = await screen.findByTestId("mf-create-blocked");
    expect(notice.textContent).toMatch(/read-only/i);
    expect(isDisabled(screen.getByTestId("mf-create-open"))).toBe(true);
  });

  it("warns before submission when Mode A is chosen without delegated agency", async () => {
    delegatedAgency = false;
    await openForm();
    expect(screen.queryByTestId("mf-create-mode-a-warning")).toBeNull(); // pole 1: Mode B, no warning
    fireEvent.change(screen.getByTestId("mf-create-mode"), { target: { value: "A" } });
    const warn = await screen.findByTestId("mf-create-mode-a-warning"); // pole 2
    expect(warn.textContent).toMatch(/delegated agency/i);
  });
});

describe("ORP-031 — Mode A authority handling mirrors GATE 6", () => {
  it("blocks submit until an authority artifact is supplied, then allows it", async () => {
    await openForm();
    fireEvent.change(screen.getByTestId("mf-create-company"), { target: { value: COMPANY_ID } });
    fireEvent.change(screen.getByTestId("mf-create-mode"), { target: { value: "A" } });
    expect(isDisabled(screen.getByTestId("mf-create-submit"))).toBe(true);
    fireEvent.change(screen.getByTestId("mf-create-artifact"), { target: { value: "doc_a" } });
    expect(isDisabled(screen.getByTestId("mf-create-submit"))).toBe(false);
  });

  it("sends the authority expiry as END of the chosen day, never bare UTC midnight", async () => {
    await openForm();
    fireEvent.change(screen.getByTestId("mf-create-company"), { target: { value: COMPANY_ID } });
    fireEvent.change(screen.getByTestId("mf-create-mode"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("mf-create-artifact"), { target: { value: "doc_a" } });
    fireEvent.change(screen.getByTestId("mf-create-artifact-expiry"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByTestId("mf-create-submit"));

    await waitFor(() => expect(postBodies.length).toBe(1));
    const sentIso = String(postBodies[0].body.authorityExpiresAt);
    expect(Date.parse(sentIso)).toBeGreaterThan(Date.parse("2026-12-31T00:00:00.000Z"));
    expect(Date.parse(sentIso)).toBeLessThan(Date.parse("2027-01-01T00:00:00.000Z"));
    expect(postBodies[0].body.authorityArtifactRef).toBe("doc_a");
  });
});

describe("ORP-031 — server gate codes surface as human copy", () => {
  it("translates COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED instead of leaking the enum", async () => {
    createHandler = () => ({ status: 404, body: { error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" } });
    await openForm();
    fireEvent.change(screen.getByTestId("mf-create-company"), { target: { value: "co_other" } });
    fireEvent.click(screen.getByTestId("mf-create-submit"));

    const err = await screen.findByTestId("mf-create-error");
    expect(err.textContent).toMatch(/not attributed to your firm/i);
    expect(err.textContent).not.toContain("COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED");
  });

  it("translates ENGAGEMENT_ALREADY_EXISTS (409) too", async () => {
    createHandler = () => ({ status: 409, body: { error: "ENGAGEMENT_ALREADY_EXISTS" } });
    await openForm();
    fireEvent.change(screen.getByTestId("mf-create-company"), { target: { value: COMPANY_ID } });
    fireEvent.click(screen.getByTestId("mf-create-submit"));
    const err = await screen.findByTestId("mf-create-error");
    expect(err.textContent).toMatch(/already has an engagement/i);
    expect(err.textContent).not.toContain("ENGAGEMENT_ALREADY_EXISTS");
  });
});

describe("ORP-031 — detail view: mode change, hand-over and the event log", () => {
  it("moves a Mode B engagement to Mode A only with an artifact, and PATCHes the real route", async () => {
    detailRoute = true;
    engagementMode = "B";
    renderPage();
    const btn = await screen.findByTestId("mf-actions-change-mode");
    expect(btn.textContent).toContain("Move to Mode A");
    expect(isDisabled(btn)).toBe(true); // GATE 6 mirror
    fireEvent.change(screen.getByTestId("mf-actions-artifact"), { target: { value: "doc_b2a" } });
    expect(isDisabled(btn)).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(postBodies.length).toBe(1));
    expect(postBodies[0].method).toBe("PATCH");
    expect(postBodies[0].url).toBe(`/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}/mode`);
    expect(postBodies[0].body.mode).toBe("A");
    expect(postBodies[0].body.authorityArtifactRef).toBe("doc_b2a");
  });

  it("offers the opposite target for a Mode A engagement and needs no artifact to leave Mode A", async () => {
    detailRoute = true;
    engagementMode = "A";
    renderPage();
    const btn = await screen.findByTestId("mf-actions-change-mode");
    expect(btn.textContent).toContain("Move to Mode B");
    expect(isDisabled(btn)).toBe(false);
    expect(screen.queryByTestId("mf-actions-artifact")).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(postBodies[0].body.mode).toBe("B"));
  });

  it("initiates a hand-over with the direction implied by the current mode", async () => {
    detailRoute = true;
    engagementMode = "A";
    renderPage();
    fireEvent.click(await screen.findByTestId("mf-actions-handover"));
    await waitFor(() => expect(postBodies.length).toBe(1));
    expect(postBodies[0].url).toBe(`/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}/handover`);
    expect(postBodies[0].body.direction).toBe("A_TO_B");
    expect(postBodies[0].body.initiatorParty).toBe("partner");
    // The confirm affordance only appears once there is a hand-over to confirm.
    const confirm = await screen.findByTestId("mf-actions-handover-confirm");
    fireEvent.click(confirm);
    await waitFor(() => expect(postBodies.length).toBe(2));
    expect(postBodies[1].url).toBe("/api/partner/me/mfcrm/handovers/mfh_1/confirm");
  });

  it("does not offer a confirm affordance before a hand-over exists", async () => {
    detailRoute = true;
    renderPage();
    await screen.findByTestId("mf-actions-handover");
    expect(screen.queryByTestId("mf-actions-handover-confirm")).toBeNull();
  });

  it("hides the actions from a read-only role and says why", async () => {
    detailRoute = true;
    subRole = "viewer";
    renderPage();
    const note = await screen.findByTestId("mf-actions-readonly");
    expect(note.textContent).toMatch(/read-only/i);
    expect(screen.queryByTestId("mf-actions-change-mode")).toBeNull();
    expect(screen.queryByTestId("mf-actions-handover")).toBeNull();
  });

  it("renders the engagement event log that no client previously read", async () => {
    detailRoute = true;
    eventRows = [
      { id: "ev_1", eventType: "engagement_created", detail: null, actor: "u_orp031", createdAt: "2026-08-01T10:00:00.000Z" },
      { id: "ev_2", eventType: "mode_changed", detail: null, actor: null, createdAt: "2026-08-02T10:00:00.000Z" },
    ];
    renderPage();
    expect((await screen.findByTestId("mf-event-ev_1")).textContent).toContain("engagement_created");
    expect(screen.getByTestId("mf-event-ev_2").textContent).toContain("mode_changed");
    expect(screen.queryByTestId("mf-events-empty")).toBeNull();
  });

  it("shows an explicit empty state when there are no events (opposite pole)", async () => {
    detailRoute = true;
    eventRows = [];
    renderPage();
    expect((await screen.findByTestId("mf-events-empty")).textContent).toMatch(/no recorded events/i);
  });
});

/**
 * WAVE 17 — ORP-031 continuation: the hand-over listing.
 *
 * Wave 16's confirm affordance appeared only when THIS browser session had just
 * initiated, because the id lived in React state. These tests pin the fix and
 * both poles of it: with no server rows there is no confirm control (already
 * asserted above), and with a server row that this session did NOT initiate the
 * control appears AND confirms that specific id.
 */
describe("ORP-031 — pending hand-overs come from the server, not React state", () => {
  it("lists a pending hand-over this session never initiated, and confirms THAT id", async () => {
    detailRoute = true;
    handoverRows = [
      {
        id: "mfh_from_founder",
        engagementId: ENGAGEMENT_ID,
        companyId: COMPANY_ID,
        direction: "B_TO_A",
        initiatorParty: "founder",
        status: "initiated",
        createdAt: "2026-08-03T10:00:00.000Z",
        confirmedAt: null,
      },
    ];
    renderPage();

    const row = await screen.findByTestId("mf-handover-row-mfh_from_founder");
    expect(row.textContent).toContain("Mode B → Mode A");
    expect(row.textContent).toMatch(/initiated by the founder/i);

    fireEvent.click(screen.getByTestId("mf-handover-confirm-mfh_from_founder"));
    await waitFor(() => expect(postBodies.length).toBe(1));
    /* The id from the LISTING, not a session-held one. */
    expect(postBodies[0].url).toBe("/api/partner/me/mfcrm/handovers/mfh_from_founder/confirm");
  });

  it("renders no pending-hand-over panel when the server returns none (opposite pole)", async () => {
    detailRoute = true;
    handoverRows = [];
    renderPage();
    await screen.findByTestId("mf-actions-handover");
    expect(screen.queryByTestId("mf-handovers-pending")).toBeNull();
    expect(screen.queryByTestId("mf-actions-handover-confirm")).toBeNull();
  });

  it("a CONFIRMED row is not offered for confirmation again", async () => {
    detailRoute = true;
    handoverRows = [
      {
        id: "mfh_done",
        engagementId: ENGAGEMENT_ID,
        companyId: COMPANY_ID,
        direction: "A_TO_B",
        initiatorParty: "partner",
        status: "confirmed",
        createdAt: "2026-08-03T10:00:00.000Z",
        confirmedAt: "2026-08-04T10:00:00.000Z",
      },
    ];
    renderPage();
    await screen.findByTestId("mf-actions-handover");
    expect(screen.queryByTestId("mf-handover-row-mfh_done")).toBeNull();
    expect(screen.queryByTestId("mf-handovers-pending")).toBeNull();
  });
});
