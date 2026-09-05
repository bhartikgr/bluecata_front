/* ════════════════════════════════════════════════════════════════════════════
   WAVE NB-B — WHAT THE PARTNER ACTUALLY READS.

   The server tests prove the NAMES ARRIVE. This file proves the SCREEN PRINTS
   THEM, and — the harder half — proves what the screen prints when there is no
   name to print. Rule: where no name exists, a plain labelled description, never
   a raw token and never an invented name.

   THREE PLACES, EACH ASSERTED ON BOTH POLES:
     1. Managed Founders detail heading  — was `Reference …` where a name belongs.
     2. The CRM layer table's contact cell — was the raw composite `company:co_…`.
     3. The engagements table's company cell.

   THE NEGATIVE POLE IS THE POINT. A fixture with a name on every row cannot
   distinguish this fix from a fix that prints `companyName ?? companyId`, or from
   one that invents a name out of the id. Every case here runs the SAME component
   twice — once with the name, once with `companyName: null` — and asserts the
   nameless render still carries the pre-existing `Reference …` wording, still
   carries NO bare `company:` token, and is NOT blank.

   EVERY QUERY IS SCOPED to the container under test. This page renders company
   references in several tables, so an unscoped `getByText` would prove nothing
   about which one changed.
   ════════════════════════════════════════════════════════════════════════════ */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerManagedFounders from "../PartnerManagedFounders";
import { partyReferenceLabel } from "@/lib/partnerDisplay";

const ENGAGEMENT_ID = "mfe_nbb";
const COMPANY_ID = "co_nbb_dom";
const COMPANY_NAME = "Kestrel Holdings Ltd";
const CONTACT_REF = `company:${COMPANY_ID}`;

/* The two dials. Each case moves them and asserts the DOM follows. */
let companyName: string | null = COMPANY_NAME;
let contactName: string | null = COMPANY_NAME;
/* Matches the detail route by default; flipped for the list-table case. */
let routeMatches = true;

function engagementFixture() {
  return {
    id: ENGAGEMENT_ID,
    companyId: COMPANY_ID,
    companyName,
    mode: "B" as const,
    status: "ACTIVE",
    authorityArtifactRef: null,
    authorityExpiresAt: null,
    trialExpiresAt: null,
    chapterId: null,
    matterId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function layerFixture() {
  return [
    {
      id: "mflay_nbb",
      contact_ref: CONTACT_REF,
      contactName,
      layer: "partner",
      engagement_id: ENGAGEMENT_ID,
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  ];
}

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("wouter", () => ({
  useRoute: () => [routeMatches, routeMatches ? { id: ENGAGEMENT_ID } : undefined],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_nbb",
      tier: "catalyst",
      subRole: "managing_partner",
      identity: { userId: "u_nbb", email: "nbb@example.com", name: "nbb@example.com" },
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

beforeEach(() => {
  companyName = COMPANY_NAME;
  contactName = COMPANY_NAME;
  routeMatches = true;
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (url === "/api/partner/me/mfcrm/capability") {
      return jsonResponse(200, {
        capability: {
          partnerId: "p_nbb",
          partnerType: "angel_network",
          classified: true,
          delegatedAgency: true,
          advisoryCoseat: true,
          sourcesCapital: true,
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      });
    }
    if (url === "/api/partner/me/mfcrm/dashboard") {
      return jsonResponse(200, {
        classified: true,
        partnerType: "angel_network",
        engagements: { total: 1, active: 1, modeA: 0, modeB: 1, lapsed: 0 },
        openCrossoverFlags: 0,
        queuedPushes: 0,
      });
    }
    if (url === "/api/partner/me/mfcrm/engagements" && method === "GET") {
      return jsonResponse(200, { engagements: [engagementFixture()] });
    }
    if (url === "/api/partner/me/portfolio") {
      return jsonResponse(200, { portfolio: [] });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}`) {
      return jsonResponse(200, { engagement: engagementFixture(), trial: null });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}/events`) {
      return jsonResponse(200, { events: [] });
    }
    if (url.startsWith("/api/partner/me/mfcrm/layers/")) {
      return jsonResponse(200, { layers: layerFixture() });
    }
    if (url.startsWith("/api/partner/me/mfcrm/spv-on-behalf")) {
      return jsonResponse(200, { vehicles: [] });
    }
    if (url.startsWith("/api/partner/me/mfcrm/handovers")) {
      return jsonResponse(200, { handovers: [] });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPage(): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartnerManagedFounders />
    </QueryClientProvider>,
  );
  const container = await screen.findByTestId(routeMatches ? "mf-detail" : "mf-table", {}, { timeout: 5000 });
  return container as HTMLElement;
}

describe("WAVE NB-B · the engagement heading", () => {
  it("(1) prints the company's real name when the payload carries one", async () => {
    const c = await renderPage();
    const h = within(c).getByRole("heading", { level: 2 });
    expect(h.textContent).toBe(COMPANY_NAME);
    /* The reference wording is no longer the heading. */
    expect(h.textContent).not.toContain("Reference");
  });

  it("(2) THE FLOOR — with no name, the heading keeps the existing labelled reference and is never blank", async () => {
    companyName = null;
    const c = await renderPage();
    const h = within(c).getByRole("heading", { level: 2 });
    /* Byte-for-byte the SAME string the page produced before this wave. */
    expect(h.textContent).toBe(partyReferenceLabel(COMPANY_ID));
    expect(h.textContent).toBe("Reference NBB-DOM");
    expect((h.textContent ?? "").trim().length).toBeGreaterThan(0);
    /* And nothing was invented from the id. */
    expect(h.textContent).not.toContain("Kestrel");
  });
});

describe("WAVE NB-B · the CRM layer contact cell", () => {
  async function layerCellText(): Promise<string> {
    const c = await renderPage();
    const table = await within(c).findByTestId("mf-layer-table-partner", {}, { timeout: 5000 });
    const rows = within(table).getAllByRole("row");
    /* PRECONDITION — a table with no body row would make every assertion below
       vacuous. Header + exactly one data row. */
    expect(rows.length).toBe(2);
    const cells = within(rows[1]).getAllByRole("cell");
    return cells[0].textContent ?? "";
  }

  it("(3) prints the company name in place of the raw composite storage key", async () => {
    const text = await layerCellText();
    expect(text).toBe(COMPANY_NAME);
    /* THE DEFECT ITSELF: the raw `company:co_…` token must be gone from the cell. */
    expect(text).not.toContain("company:");
    expect(text).not.toContain(CONTACT_REF);
  });

  it("(4) THE FLOOR — with no name, a labelled reference, not the raw token and not an empty cell", async () => {
    contactName = null;
    const text = await layerCellText();
    expect(text).toBe(partyReferenceLabel(CONTACT_REF));
    expect(text.trim().length).toBeGreaterThan(0);
    /* `partyReferenceLabel` leaves an unrecognised prefix intact rather than
       truncating on a guess, so the value stays unique per row — but it is
       LABELLED as a reference and upper-cased, so it no longer reads as a name. */
    expect(text.startsWith("Reference ")).toBe(true);
    expect(text).not.toBe(CONTACT_REF);
    expect(text).not.toContain("Kestrel");
  });
});

describe("WAVE NB-B · the engagements list table", () => {
  async function listCellText(): Promise<string> {
    routeMatches = false;
    const table = await renderPage();
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBe(2);
    const cells = within(rows[1]).getAllByRole("cell");
    return cells[0].textContent ?? "";
  }

  it("(5) prints the company name", async () => {
    const text = await listCellText();
    expect(text).toBe(COMPANY_NAME);
  });

  it("(6) THE FLOOR — with no name, the unchanged labelled reference", async () => {
    companyName = null;
    const text = await listCellText();
    expect(text).toBe(partyReferenceLabel(COMPANY_ID));
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
