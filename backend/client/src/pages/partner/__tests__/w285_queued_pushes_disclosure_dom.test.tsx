/**
 * WAVE 285 — WHAT THE PARTNER ACTUALLY READS NEXT TO "QUEUED PUSHES".
 *
 * THE DEFECT, AS MEASURED (not as the preflight described it). The Managed
 * Founders dashboard prints a "Queued pushes" tile. The number is real: an
 * SPV-on-behalf create genuinely INSERTs an `mf_collective_push` row with
 * status 'queued', and the counter genuinely moves — that half is proved over
 * real HTTP against real sqlite in
 * `server/__tests__/w285_collective_push_disclosure_http.test.ts`.
 *
 * What does NOT exist is the other end. Nothing drains the queue: there is no
 * worker, `processCollectivePush` is a word inside a comment, and the only
 * route that can move a push out of 'queued' has no caller on any screen. So
 * "Queued pushes: 3" tells a GP that three deals are on their way to the
 * Collective when none of them are, and "Queued pushes: 0" reads like
 * "everything has been delivered" when it means "nothing has been created".
 *
 * THIS WAVE ADDS NO PIPELINE (not authorised) AND CHANGES NO NUMBER. It appends
 * two static sentences so the screen stops implying a capability the platform
 * does not have.
 *
 * WHY THIS FILE IS NOT VACUOUS
 * ----------------------------
 *  1. PLACEMENT IS POSITIONAL, NEVER "present on the page". The tile disclosure
 *     is asserted to be the `nextElementSibling` of the "Queued pushes" tile
 *     inside the widget, and the panel disclosure to be the LAST CHILD of the
 *     very `<p>` that carries the pre-existing promise. A sentence that drifted
 *     to the bottom of the page would pass a "page contains" test and fail
 *     these.
 *  2. EVERY QUERY IS SCOPED to `mf-dashboard-widget` or to `mf-spv-on-behalf`.
 *     An unscoped DOM query is one of the known inert-proof mechanisms.
 *  3. THE FIXTURE IS MOVED, not asserted constant. The tile disclosure is
 *     required at `queuedPushes: 0` AND at `queuedPushes: 3`, so a disclosure
 *     accidentally gated on the zero case fails. The "not yet" state (dashboard
 *     still loading / errored) is enumerated too: there the widget is absent,
 *     and the sentence must be absent WITH it — copy that outlived its subject
 *     would be a second falsehood.
 *  4. PRECONDITIONS ARE ASSERTED FIRST. Before anything is concluded from the
 *     disclosure, the widget, the four tiles and the untouched label and value
 *     are asserted, so a page that failed to render cannot pass as a proof.
 *  5. THE PRE-EXISTING COPY IS ASSERTED INTACT, byte for byte, with no
 *     normalising call inside the equality — a reworded original would fail.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerManagedFounders from "../PartnerManagedFounders";

const ENGAGEMENT_ID = "mfe_w285";
const COMPANY_ID = "co_w285";

/* Fixture dials. Every test below moves one of these and asserts the DOM follows. */
const h = vi.hoisted(() => ({ detailRoute: false }));
let queuedPushes = 0;
let dashboardStatus = 200;

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/* The route dial: `false` renders the LIST view (where the tile lives), `true`
   renders the real, non-exported `ManagedFounderDetail` (where the on-behalf
   panel lives). Both views come from the real default export. */
vi.mock("wouter", () => ({
  useRoute: () => (h.detailRoute ? [true, { id: ENGAGEMENT_ID }] : [false, null]),
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w285",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w285", email: "w285@example.com", name: "W285 Partner" },
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

function engagementFixture() {
  return {
    id: ENGAGEMENT_ID,
    companyId: COMPANY_ID,
    mode: "A",
    status: "ACTIVE",
    authorityArtifactRef: "doc_w285",
    authorityExpiresAt: "2027-01-01T00:00:00.000Z",
    trialExpiresAt: null,
    chapterId: null,
    matterId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  h.detailRoute = false;
  queuedPushes = 0;
  dashboardStatus = 200;
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (url === "/api/partner/me/mfcrm/capability") {
      return jsonResponse(200, {
        capability: {
          partnerId: "p_w285",
          partnerType: "angel_network",
          classified: true,
          delegatedAgency: true,
          advisoryCoseat: true,
          sourcesCapital: true,
          spvWriteAuthority: true,
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      });
    }
    if (url === "/api/partner/me/mfcrm/dashboard") {
      if (dashboardStatus !== 200) throw new Error("dashboard unavailable");
      return jsonResponse(200, {
        classified: true,
        partnerType: "angel_network",
        engagements: { total: 1, active: 1, modeA: 1, modeB: 0, lapsed: 0 },
        openCrossoverFlags: 0,
        queuedPushes,
      });
    }
    if (url === "/api/partner/me/mfcrm/engagements" && method === "GET") {
      return jsonResponse(200, { engagements: [engagementFixture()] });
    }
    if (url === "/api/partner/me/portfolio") {
      return jsonResponse(200, { portfolio: [{ companyId: COMPANY_ID, companyName: "W285 Co" }] });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}`) {
      return jsonResponse(200, { engagement: engagementFixture(), trial: null });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}/events`) {
      return jsonResponse(200, { events: [] });
    }
    if (url.startsWith("/api/partner/me/mfcrm/layers/")) return jsonResponse(200, { layers: [] });
    if (url.startsWith("/api/partner/me/mfcrm/spv-on-behalf")) return jsonResponse(200, { vehicles: [] });
    if (url.startsWith("/api/partner/me/mfcrm/handovers")) return jsonResponse(200, { handovers: [] });
    throw new Error(`unexpected request ${method} ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <PartnerManagedFounders />
    </QueryClientProvider>,
  );
}

const widget = (): Promise<HTMLElement> => screen.findByTestId("mf-dashboard-widget");

/** The "Queued pushes" tile, found by the LABEL A PARTNER READS. Scoped. */
function queuedTile(w: HTMLElement): HTMLElement {
  const tiles = Array.from(w.children) as HTMLElement[];
  const tile = tiles.find((t) => t.textContent?.includes("Queued pushes"));
  if (!tile) throw new Error("the 'Queued pushes' tile is gone — the page shape changed");
  return tile;
}

describe("W285 §1 — the tile disclosure sits IMMEDIATELY AFTER the tile it corrects", () => {
  it("PRECONDITION — the widget renders four tiles and the untouched label and value", async () => {
    mount();
    const w = await widget();
    /* Asserted BEFORE any conclusion is drawn from the new sentence. */
    const tile = queuedTile(w);
    expect(tile.textContent).toContain("Queued pushes");
    expect(tile.textContent).toContain("0");
    const labels = Array.from(w.children)
      .map((c) => (c as HTMLElement).querySelector(".text-xs")?.textContent ?? "")
      .filter(Boolean);
    expect(labels).toContain("Engagements");
    expect(labels).toContain("Active");
    expect(labels).toContain("Open crossover flags");
    expect(labels).toContain("Queued pushes");
  });

  it("the disclosure is the tile's NEXT ELEMENT SIBLING — placement, not page presence", async () => {
    mount();
    const w = await widget();
    const tile = queuedTile(w);
    const next = tile.nextElementSibling as HTMLElement | null;
    expect(next, "nothing follows the Queued pushes tile").not.toBeNull();
    expect(next!.getAttribute("data-testid")).toBe("mf-queued-pushes-no-delivery");
    /* And it is the LAST thing in the grid, so no tile was renumbered. */
    expect(w.lastElementChild).toBe(next);
    /* It is a SIBLING of the tile, not a child of it — the tile is untouched. */
    expect(tile.contains(next!)).toBe(false);
  });

  it("it says delivery is unavailable, that the count only rises, and what a zero means", async () => {
    mount();
    const w = await widget();
    const note = w.querySelector('[data-testid="mf-queued-pushes-no-delivery"]') as HTMLElement;
    const text = note.textContent ?? "";
    expect(text).toContain("Delivery of queued pushes to the Collective is not available yet.");
    expect(text).toContain("no screen on Capavate can move a push out of the queue");
    expect(text).toContain("this figure can rise but never fall");
    expect(text).toContain("A push counted here has not reached the Collective");
    expect(text).toContain("a zero here means nothing is waiting — not that a deal was delivered");
  });
});

describe("W285 §2 — every state the tile can be in, including 'not yet'", () => {
  it("queuedPushes = 0 → the tile shows 0 AND the disclosure is still there", async () => {
    queuedPushes = 0;
    mount();
    const w = await widget();
    expect(queuedTile(w).textContent).toContain("0");
    expect(w.querySelector('[data-testid="mf-queued-pushes-no-delivery"]')).not.toBeNull();
  });

  it("queuedPushes = 3 → the tile shows 3 AND the disclosure is still there (fixture MOVED)", async () => {
    /* The opposite pole. A disclosure accidentally written as `{n === 0 && …}`
       would pass the test above and fail this one. */
    queuedPushes = 3;
    mount();
    const w = await widget();
    await waitFor(() => expect(queuedTile(w).textContent).toContain("3"));
    expect(w.querySelector('[data-testid="mf-queued-pushes-no-delivery"]')).not.toBeNull();
  });

  it("the dashboard read FAILS → there is no widget, no tile AND no orphan sentence", async () => {
    /* The 'not yet' state, enumerated rather than assumed. The sentence must
       not outlive the number it explains: a standalone warning on a screen with
       no counter would be a new confusion, not a correction. */
    dashboardStatus = 500;
    mount();
    await screen.findByTestId("mf-table");
    await waitFor(() => {
      expect(screen.queryByTestId("mf-dashboard-widget")).toBeNull();
    });
    expect(screen.queryByTestId("mf-queued-pushes-no-delivery")).toBeNull();
    expect(screen.queryByText(/Queued pushes/)).toBeNull();
  });
});

describe("W285 §3 — the SECOND surface: the enqueue panel's own promise", () => {
  it("PRECONDITION — the on-behalf panel renders and its ORIGINAL sentence is byte-identical", async () => {
    h.detailRoute = true;
    mount();
    const panel = await screen.findByTestId("mf-spv-on-behalf");
    const p = panel.querySelector("p");
    expect(p, "the panel's description paragraph is gone").not.toBeNull();
    /* No trim, no lowercase, no whitespace collapse inside the comparison —
       the original clause is asserted verbatim. */
    expect(p!.textContent).toContain(
      "Creates the vehicle, records an audit entry in the on-behalf chain, and queues the Collective push — in one transaction.",
    );
  });

  it("the correction is the LAST CHILD of that same paragraph, not a page-level note", async () => {
    h.detailRoute = true;
    mount();
    const panel = await screen.findByTestId("mf-spv-on-behalf");
    const p = panel.querySelector("p") as HTMLElement;
    const span = p.querySelector('[data-testid="mf-sob-push-not-delivered"]') as HTMLElement | null;
    expect(span, "the panel disclosure is not inside the promise paragraph").not.toBeNull();
    expect(p.lastElementChild).toBe(span);
    expect(span!.textContent).toContain("The queued push is not delivered to the Collective.");
    expect(span!.textContent).toContain("this deal does not reach the Collective");
  });

  it("the panel is still rendered exactly once and nothing was removed from it", async () => {
    h.detailRoute = true;
    mount();
    const panel = await screen.findByTestId("mf-spv-on-behalf");
    expect(screen.getAllByTestId("mf-spv-on-behalf").length).toBe(1);
    /* Anchored on parts of the panel this wave does not touch. */
    expect(panel.textContent).toContain("SPV on behalf of this founder");
  });
});
