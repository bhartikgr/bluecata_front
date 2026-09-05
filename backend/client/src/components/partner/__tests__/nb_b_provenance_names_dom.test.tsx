/* ════════════════════════════════════════════════════════════════════════════
   WAVE NB-B — THE ATTRIBUTION PROVENANCE PANEL, AS THE PARTNER READS IT.

   Before this wave the panel printed, for a live account:
       Company reference co_261cb9e192f7
       Source: Administrator (manual) · By: u_redeemed_1783181835779
   Two raw storage tokens, one of them standing where a person's name belongs.

   THE TWO POLES, ASSERTED IN THE SAME FILE:
     · RESOLVED — the server sends `companyName` and `attributedByName`, and the
       panel prints them.
     · UNRESOLVED — the server sends `null` for both, and the panel prints EXACTLY
       what it printed before this wave: `Company reference {id}` and the
       `actorDisplay` description with its labelled reference. That existing
       wording is the floor; it is asserted byte-for-byte against `actorDisplay`
       itself, so a paraphrase or a silently-dropped reference reddens.

   NO FABRICATION. The unresolved pole asserts the panel does NOT print the
   resolved-pole values, and that nothing derived from the id (a truncation, a
   title-cased token) appears. The resolved pole asserts the email is printed
   verbatim, not prettified into something that looks like a person's name.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AttributionProvenancePanel from "../AttributionProvenancePanel";
import { actorDisplay } from "@/lib/partnerDisplay";

const ROW_ID = "attr_nbb_1";
const COMPANY_ID = "co_261cb9e192f7";
const COMPANY_NAME = "SD-TEST Wave X Co";
const ACTOR_ID = "u_redeemed_1783181835779";
const ACTOR_EMAIL = "ozan@trendwellventures.com";

let companyName: string | null = COMPANY_NAME;
let attributedByName: string | null = ACTOR_EMAIL;

function rowFixture() {
  return {
    id: ROW_ID,
    companyId: COMPANY_ID,
    companyName,
    attributedByName,
    attributedByEmail: attributedByName,
    attributionSource: "admin_manual",
    attributedBy: ACTOR_ID,
    attributedAt: "2026-08-01T09:30:00.000Z",
    selfService: false,
    intact: true,
    copy: "Recorded by an administrator.",
  };
}

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
  attributedByName = ACTOR_EMAIL;
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url === "/api/partner/me/attributions/provenance") {
      return jsonResponse(200, {
        attributions: [rowFixture()],
        total: 1,
        incomplete: 0,
        summary: "1 attribution on record.",
        sources: ["admin_manual"],
      });
    }
    throw new Error(`unexpected request ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderRow(): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AttributionProvenancePanel />
    </QueryClientProvider>,
  );
  const list = await screen.findByTestId("attribution-provenance-list", {}, { timeout: 5000 });
  const row = within(list).getByTestId(`attribution-provenance-row-${ROW_ID}`);
  return row as HTMLElement;
}

describe("WAVE NB-B · provenance panel — resolved pole", () => {
  it("(1) prints the company's real name instead of the reference wording", async () => {
    const row = await renderRow();
    const heading = within(row).getByTestId(`attribution-provenance-company-${ROW_ID}`);
    expect(heading.textContent).toBe(COMPANY_NAME);
    expect(heading.textContent).not.toContain("Company reference");
    expect(heading.textContent).not.toContain(COMPANY_ID);
  });

  it("(2) prints the actor's email verbatim — a real identifier, and the raw user id is gone from the line", async () => {
    const row = await renderRow();
    const text = row.textContent ?? "";
    expect(text).toContain(ACTOR_EMAIL);
    /* THE DEFECT: the raw synthetic user id must no longer be presented as the
       person. It is not printed anywhere on the row in this pole. */
    expect(text).not.toContain(ACTOR_ID);
    /* And the email is printed AS the email — not title-cased, not split into a
       fake first and last name. */
    expect(text).not.toContain("Ozan Trendwell");
    expect(text).not.toContain("Ozan Isinak");
  });
});

describe("WAVE NB-B · provenance panel — unresolved pole (the floor)", () => {
  it("(3) with no company name, the pre-existing reference wording renders unchanged", async () => {
    companyName = null;
    const row = await renderRow();
    const heading = within(row).getByTestId(`attribution-provenance-company-${ROW_ID}`);
    /* Byte-for-byte the string this panel produced before this wave. */
    expect(heading.textContent).toBe(`Company reference ${COMPANY_ID}`);
    expect(heading.textContent).not.toContain(COMPANY_NAME);
  });

  it("(4) with no actor name, the existing actorDisplay description and its LABELLED reference render unchanged", async () => {
    attributedByName = null;
    const row = await renderRow();
    const text = row.textContent ?? "";
    const d = actorDisplay(ACTOR_ID);
    /* PRECONDITION — this fixture is only meaningful if `actorDisplay` actually
       produces a reference for this id. If it did not, the assertion below could
       pass against a panel that dropped the reference entirely. */
    expect(d.reference).toBeTruthy();
    expect(text).toContain(d.text);
    expect(text).toContain(`(reference ${d.reference})`);
    /* No email appears when none was resolved — nothing is invented. */
    expect(text).not.toContain(ACTOR_EMAIL);
    expect(text).not.toContain("@");
  });

  it("(5) the row is never blank in the unresolved pole, and the timestamp line is untouched", async () => {
    companyName = null;
    attributedByName = null;
    const row = await renderRow();
    const text = (row.textContent ?? "").trim();
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain("Source:");
    expect(text).toContain("· On:");
    /* The raw ISO timestamp is still formatted by the existing helper, not
       re-exposed. W106's own pin covers the format; this only proves the line
       still exists after the edit above it. */
    expect(text).not.toContain("2026-08-01T09:30:00.000Z");
  });
});
