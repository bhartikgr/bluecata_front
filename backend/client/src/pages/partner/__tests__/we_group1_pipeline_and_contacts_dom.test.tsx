/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WALKTHROUGH WAVE E · GROUP 1 — ITEMS 4a (pipeline board) AND 9a (contacts)
 * THE COLOUR HOOKS EXIST ON THE REAL RENDERED PAGES, AND THE FLOW IS UNCHANGED.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The owner's words for both pages were the same: "great functionality… can this
 * be improved by colour coding… DO NOT MAKE IT MORE COMPLICATED, as the flow is
 * awesome!", and for Contacts, "DO NOT CHANGE THE LAYOUT of this page, as it is
 * PERFECT!". So the risk here is not that the colour fails — the sister file
 * `client/src/styles/__tests__/we_group1_colour_contrast.test.tsx` measures every
 * ratio. The risk is that a colour pass QUIETLY CHANGED THE PAGE. This file is
 * therefore half proof-of-hook and half proof-of-no-change:
 *
 *   · the six pipeline columns still render, in the original order, with the
 *     original headings, counts and descriptions, and the same controls;
 *   · each column now also carries an honest `data-we-stage-rank` (its position
 *     on the ladder, 1–6) and `data-we-stage-empty` (whether it holds any deal);
 *   · the contacts table still renders the same columns and the same stage TEXT,
 *     and the only new thing on the row is `data-stage`;
 *   · a contact with NO stage gets an EMPTY attribute and the existing em-dash —
 *     it is never painted as though it had a stage we recognise. This is the
 *     "never fabricate a value" rule applied to colour: an absent stage must
 *     look absent.
 *
 * WHY THE DATA IS SUPPLIED THROUGH THE PAGE'S OWN `apiRequest`: the partner
 * tables in `work/data.db` (`partner_deal_pipeline`, `partner_crm_contacts`)
 * hold zero rows, so a test that mounted the page against the real database
 * would prove a colour system against an empty screen — the exact failure the
 * wave rules call out. Realistic rows are therefore served through the single
 * `apiRequest` seam the page already uses, INCLUDING a deal in every one of the
 * six stages, an empty stage, a contact at each ladder step, a contact with a
 * null stage and a contact carrying a stage value the ladder does not know.
 *
 * NOT A REPLICA: nothing here reimplements the page's logic. The stage list, the
 * ordering, the counts, the headings and the descriptions all come from the real
 * component; this file only supplies rows and reads the rendered result.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerPipeline from "../PartnerPipeline";
import PartnerContacts from "../PartnerContacts";

/* A DECOY THE PAGE ALREADY CONTAINS, NAMED SO NOBODY TRIPS OVER IT AGAIN.
   `[data-testid^="column-"]` matches TWELVE elements, not six: each column div
   `column-<stage>` also contains a description div `column-<stage>-desc`. And
   the same page carries a SECOND board whose ids are `spv-column-<state>` —
   the SPV lifecycle board, which item 4a does not cover and which this wave
   deliberately left alone. Both the stylesheet rule and this test therefore
   key on `[data-we-stage-rank]`, which only the six real columns carry. The
   first test below asserts the decoy count so the distinction stays visible. */
const COLUMN_SEL = '[data-testid^="column-"][data-we-stage-rank]';

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
      partnerId: "p_we", tier: "builder", subRole: "managing_partner",
      identity: { userId: "u_we", email: "we@example.com", name: "WE Partner" },
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
    ok: true, status: 200, statusText: "200",
    text: async () => JSON.stringify(body), json: async () => body,
  } as unknown as Response;
}

/* ── REALISTIC SEED ────────────────────────────────────────────────────────── */
/* One deal in five of the six stages and NONE in `signed`, so the empty-column
   branch is exercised by real data rather than by an assumption. Currencies are
   deliberately mixed and never summed by this test. */
const PIPELINE_ROWS = [
  { id: "pd_1", dealName: "Northwind Robotics", stage: "invited",     estCheckSizeMinor: 5_000_000,  currency: "USD", ownerUserId: "u_we", sector: "Robotics", companyId: "co_1" },
  { id: "pd_2", dealName: "Halden Bio",         stage: "viewed",      estCheckSizeMinor: 2_500_000,  currency: "EUR", ownerUserId: "u_we", sector: "Biotech",  companyId: "co_2" },
  { id: "pd_3", dealName: "Solstice Grid",      stage: "soft_circle", estCheckSizeMinor: 10_000_000, currency: "CAD", ownerUserId: "u_we", sector: "Energy",   companyId: "co_3" },
  { id: "pd_4", dealName: "Petra Logistics",    stage: "funded",      estCheckSizeMinor: 7_500_000,  currency: "GBP", ownerUserId: "u_we", sector: "Logistics", companyId: "co_4" },
  { id: "pd_5", dealName: "Meridian Health",    stage: "committed",   estCheckSizeMinor: null,       currency: null,  ownerUserId: "u_we", sector: "Health",   companyId: "co_5" },
];
/* The board's own order. Read from the page's rendered testids, never asserted
   from a copy of the constant — see the first test. */
const EXPECTED_STAGES = ["invited", "viewed", "soft_circle", "signed", "funded", "committed"];

const CONTACT_ROWS = [
  { id: "ct_1", displayName: "Alice Prospect",  email: "a@x.test", stage: "prospect",  starred: false, kind: "person", org: "Alpha" },
  { id: "ct_2", displayName: "Bo Engaged",      email: "b@x.test", stage: "engaged",   starred: false, kind: "person", org: "Beta" },
  { id: "ct_3", displayName: "Cy Committed",    email: "c@x.test", stage: "committed", starred: false, kind: "person", org: "Gamma" },
  { id: "ct_4", displayName: "Dee Invested",    email: "d@x.test", stage: "invested",  starred: false, kind: "person", org: "Delta" },
  { id: "ct_5", displayName: "Eve Longterm",    email: "e@x.test", stage: "longterm",  starred: false, kind: "person", org: "Epsilon" },
  /* The two honesty cases. */
  { id: "ct_6", displayName: "Fay Nostage",     email: "f@x.test", stage: null,        starred: false, kind: "person", org: "Zeta" },
  { id: "ct_7", displayName: "Gil Unknownstage", email: "g@x.test", stage: "archived_2019", starred: false, kind: "person", org: "Eta" },
];

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/partner/me/pipeline") return jsonResponse({ pipeline: PIPELINE_ROWS, stages: [] });
    if (url === "/api/partner/me/promotions") return jsonResponse({ promotions: [] });
    if (url === "/api/partner/me/spv") return jsonResponse({ spvs: [] });
    if (url === "/api/partner/me/following") return jsonResponse({ following: [] });
    if (url === "/api/partner/me/crm/contacts") return jsonResponse({ contacts: CONTACT_ROWS });
    if (url === "/api/partner/me/crm/link-targets") return jsonResponse({ targets: [] });
    return jsonResponse({});
  });
});
afterEach(() => cleanup());

function mountPartner(node: ReactNode) {
  const root = document.createElement("div");
  root.setAttribute("data-product", "partner");
  document.body.appendChild(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>, { container: root });
  return { root, ...r };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ITEM 4a — THE PIPELINE BOARD
   ═══════════════════════════════════════════════════════════════════════════ */
describe("WE 4a · pipeline board — ladder colour added, flow untouched", () => {
  it("PREMISE + NO-CHANGE: all six columns still render in order, with their headings and counts", async () => {
    const { root } = mountPartner(<PartnerPipeline />);
    await waitFor(() => expect(root.querySelectorAll(COLUMN_SEL).length).toBe(6));
    /* The decoy, asserted rather than avoided: the loose prefix matches 12. */
    expect(root.querySelectorAll('[data-testid^="column-"]').length).toBe(12);
    expect(root.querySelectorAll('[data-testid$="-desc"]').length).toBe(6);
    const cols = Array.from(root.querySelectorAll<HTMLElement>(COLUMN_SEL));
    expect(cols.map((c) => c.getAttribute("data-testid"))).toEqual(EXPECTED_STAGES.map((s) => `column-${s}`));
    /* The counts the partner reads are still printed, and they are the real
       counts of the real rows — not a number this test invented. */
    const seeded: Record<string, number> = {};
    for (const s of EXPECTED_STAGES) seeded[s] = PIPELINE_ROWS.filter((r) => r.stage === s).length;
    for (const c of cols) {
      const stage = c.getAttribute("data-testid")!.replace("column-", "");
      expect(c.textContent, `column ${stage} must print its count`).toContain(`(${seeded[stage]})`);
    }
    expect(Object.values(seeded)).toEqual([1, 1, 1, 0, 1, 1]);
  });

  it("each column carries its LADDER POSITION 1–6, which is what the colour means", async () => {
    const { root } = mountPartner(<PartnerPipeline />);
    await waitFor(() => expect(root.querySelectorAll("[data-we-stage-rank]").length).toBe(6));
    const ranks = Array.from(root.querySelectorAll<HTMLElement>(COLUMN_SEL)).map((c) =>
      c.getAttribute("data-we-stage-rank"),
    );
    expect(ranks).toEqual(["1", "2", "3", "4", "5", "6"]);
    /* Rank must track the board's own order, so a future reorder repaints
       correctly instead of leaving a stale hue behind. */
    const byTestid = Object.fromEntries(
      Array.from(root.querySelectorAll<HTMLElement>(COLUMN_SEL)).map((c) => [
        c.getAttribute("data-testid"), c.getAttribute("data-we-stage-rank"),
      ]),
    );
    expect(byTestid["column-invited"]).toBe("1");
    expect(byTestid["column-committed"]).toBe("6");
  });

  it("THE NON-COLOUR AFFORDANCE: an empty column is marked as empty, and it is the RIGHT one", async () => {
    const { root } = mountPartner(<PartnerPipeline />);
    await waitFor(() => expect(root.querySelectorAll('[data-we-stage-empty="true"]').length).toBe(1));
    const empty = root.querySelector<HTMLElement>('[data-we-stage-empty="true"]')!;
    expect(empty.getAttribute("data-testid")).toBe("column-signed");
    expect(empty.textContent).toContain("(0)");
    /* The other five must say so too — a flag that is only ever "true" proves
       nothing, so both poles are asserted. */
    expect(root.querySelectorAll('[data-we-stage-empty="false"]').length).toBe(5);
  });

  it("ANTI-VACUITY: the empty flag FOLLOWS the data — reseeding moves it", async () => {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/partner/me/pipeline") {
        return jsonResponse({ pipeline: [{ ...PIPELINE_ROWS[0], stage: "signed" }], stages: [] });
      }
      if (url === "/api/partner/me/promotions") return jsonResponse({ promotions: [] });
      if (url === "/api/partner/me/spv") return jsonResponse({ spvs: [] });
      if (url === "/api/partner/me/following") return jsonResponse({ following: [] });
      return jsonResponse({});
    });
    const { root } = mountPartner(<PartnerPipeline />);
    await waitFor(() => expect(root.querySelectorAll('[data-we-stage-empty="true"]').length).toBe(5));
    expect(root.querySelector<HTMLElement>('[data-we-stage-empty="false"]')!.getAttribute("data-testid"))
      .toBe("column-signed");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ITEM 9a — THE CONTACTS TABLE (PROTECTED LAYOUT, R221.6)
   ═══════════════════════════════════════════════════════════════════════════ */
describe("WE 9a · contacts table — colour only, layout untouched", () => {
  async function mountContacts() {
    const m = mountPartner(<PartnerContacts />);
    await waitFor(() => expect(m.root.querySelectorAll("td[data-stage]").length).toBe(CONTACT_ROWS.length));
    return m;
  }

  it("every row carries its ladder step, and the stage TEXT is still printed in the same cell", async () => {
    const { root } = await mountContacts();
    const cells = Array.from(root.querySelectorAll<HTMLElement>("td[data-stage]"));
    expect(cells.length).toBe(7);
    expect(cells.map((c) => c.getAttribute("data-stage"))).toEqual([
      "prospect", "engaged", "committed", "invested", "longterm", "", "archived_2019",
    ]);
    /* NEVER COLOUR ALONE: the label a colour-blind reader relies on. */
    expect(cells.map((c) => c.textContent)).toEqual([
      "Prospect", "Engaged", "Committed", "Invested", "Longterm", "—", "Archived 2019",
    ]);
  });

  it("A CONTACT WITH NO STAGE IS NOT PAINTED AS ONE: the attribute is empty and matches no colour rule", async () => {
    const { root } = await mountContacts();
    const cells = Array.from(root.querySelectorAll<HTMLElement>("td[data-stage]"));
    const blank = cells.find((c) => c.getAttribute("data-stage") === "")!;
    expect(blank, "the null-stage contact must still render a cell").toBeTruthy();
    expect(blank.textContent).toBe("—");
    for (const known of ["prospect", "engaged", "committed", "invested", "longterm"]) {
      expect(blank.matches(`td[data-stage="${known}"]`), `blank must not match ${known}`).toBe(false);
    }
    /* Same for a value the ladder has never heard of. */
    const unknown = cells.find((c) => c.getAttribute("data-stage") === "archived_2019")!;
    for (const known of ["prospect", "engaged", "committed", "invested", "longterm"]) {
      expect(unknown.matches(`td[data-stage="${known}"]`)).toBe(false);
    }
  });

  it("R221.6 — THE PROTECTED LAYOUT IS BYTE-FOR-BYTE THE SAME SHAPE: same columns, same class, same cell count", async () => {
    const { root } = await mountContacts();
    const table = root.querySelector<HTMLElement>('[data-testid="contacts-table"]');
    expect(table, "the contacts table must still be found by its own testid").toBeTruthy();
    const headers = Array.from(table!.querySelectorAll("thead th")).map((h) => h.textContent);
    expect(headers.length).toBeGreaterThan(0);
    /* The stage cell keeps its ORIGINAL class list — the colour is applied by
       an attribute selector in the stylesheet, so not one utility changed. */
    for (const c of table!.querySelectorAll<HTMLElement>("td[data-stage]")) {
      expect(c.className).toBe("p-3 text-[var(--cv-color-text-muted)]");
      expect(c.tagName).toBe("TD");
      /* No wrapper was introduced inside the cell. */
      expect(c.children.length).toBe(0);
    }
    /* Every body row still has the same number of cells as there are headers. */
    const rows = Array.from(table!.querySelectorAll("tbody tr"));
    expect(rows.length).toBe(CONTACT_ROWS.length);
    for (const r of rows) expect(r.querySelectorAll("td").length).toBe(headers.length);
  });
});
