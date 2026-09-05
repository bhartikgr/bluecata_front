/**
 * WAVE NB-A — THE RELATIONSHIP MAP SUMMARY TILES, ON RENDERED DOM.
 *
 * ── WHAT THIS FILE IS FOR ───────────────────────────────────────────────────
 * The server half of this wave (the tiles being counted from the four surfaces
 * rather than from the materialised `pcr_surface_presence` spine) is proved
 * where the data is, in `server/__tests__/nb_a_relationship_breakdown_http.test.ts`,
 * over a real HTTP route and against stored rows. A page cannot prove that; a
 * page can only prove what a partner READS. So this file proves exactly the
 * three things a partner reads and nothing else:
 *
 *   1. the tiles print the figures the server sent — the fix is visible;
 *   2. a surface the server could NOT count prints a stated read-failure and
 *      NOT a `0`;
 *   3. a surface the server counted as genuinely EMPTY still prints `0`.
 *
 * (2) and (3) are the pair that matters. A fixture that only ever sent `null`
 * could not distinguish the fix from a page that simply stopped printing
 * numbers, and a fixture that only ever sent numbers could not distinguish it
 * from the defect. Both poles are here, on the same tile, with the same page.
 *
 * ── AND THE COPY THIS WAVE ADDED IS ASSERTED HERE, BY TEST ──────────────────
 * The copy guard diffs a stored baseline, so it cannot protect a string this
 * wave introduced. The basis caption ("companies, not deals") and the re-framed
 * reconcile sentence are therefore pinned below by rule rather than by
 * screenshot: the caption must state the unit, and the reconcile panel must not
 * claim it repairs the figures — because it never did and now it visibly does
 * not need to.
 *
 * ── PRECONDITIONS, NEVER ASSUMED ────────────────────────────────────────────
 * Every pole first proves the endpoint was actually requested
 * (`relationshipRequests > 0`) and that the container it is about really
 * mounted. An absence assertion against a document that failed to render is
 * worthless. Every text assertion is SCOPED to the element under test — never
 * `document.body` — because the word "0" appears in plenty of unrelated places
 * on this page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerRelationships from "../PartnerRelationships";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/partner/useRequirePartnerRole", async () => {
  const actual = await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  );
  return {
    ...actual,
    /* managing_partner deliberately: it is the one role for which the reconcile
       panel renders its button rather than its refusal, so the re-framed copy is
       actually on screen to be asserted. */
    useRequirePartnerRole: () => ({
      ready: true,
      error: null,
      identity: {
        partnerId: "ac_consortium_partner_nba",
        tier: "catalyst",
        subRole: "managing_partner",
        identity: { userId: "u_nba", email: "partner@example.com", name: "NB-A Partner" },
      },
    }),
  };
});

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return {
    ...actual,
    PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const SURFACES = ["mfc", "pipeline", "clients", "portfolio"] as const;

const LABELS = {
  mfc: "Managed Founder CRM",
  pipeline: "Pipeline",
  clients: "Clients",
  portfolio: "Portfolio",
};

/** One real relationship row, so the page renders its table rather than the
 *  empty state — the tiles are what is under test, but a crash in a neighbour
 *  is indistinguishable from the fix failing. */
const ROW = {
  id: "pcr_ac_consortium_partner_nba|co_nba_one",
  partnerId: "ac_consortium_partner_nba",
  companyId: "co_nba_one",
  companyName: "NB-A Company One",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  activeSurfaces: ["clients"],
  pastSurfaces: [],
  presence: [
    {
      id: "pcrp_nba_1",
      surface: "clients",
      rowId: "pa_nba_1",
      addedAt: "2026-08-01T00:00:00.000Z",
      removedAt: null,
    },
  ],
};

function payload(breakdown: Record<string, number | null>) {
  return { relationships: [ROW], breakdown, surfaceLabels: LABELS };
}

/** THE FIX VISIBLE: the figures measured live on 2026-09-04 for the real
 *  partner, counted from the four surfaces (companies, not rows). */
const COUNTED = payload({ mfc: 1, pipeline: 6, clients: 4, portfolio: 4 });

/** THE UNCOUNTABLE SURFACE: mfc could not be read. The other three could, and
 *  are deliberately non-zero, so a page that simply stopped printing any figure
 *  would fail this pole. */
const MFC_UNREADABLE = payload({ mfc: null, pipeline: 6, clients: 4, portfolio: 4 });

/** THE TRUTHFUL ZERO: mfc was read and holds nothing. This must still print 0.
 *  Withholding a figure that was genuinely measured is the same defect pointing
 *  the other way. */
const MFC_TRULY_EMPTY = payload({ mfc: 0, pipeline: 6, clients: 4, portfolio: 4 });

/** DEPLOY SKEW — an older server, or a cached payload, with no breakdown at all.
 *  An absent figure is not a zero either. */
const NO_BREAKDOWN = { relationships: [ROW], surfaceLabels: LABELS } as unknown as ReturnType<
  typeof payload
>;

let snapshot: unknown = COUNTED;
let relationshipRequests = 0;
let holdRelationships = false;
let failRelationships = false;

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/partner/me/relationships") {
        relationshipRequests += 1;
        if (holdRelationships) return await new Promise<Response>(() => {});
        if (failRelationships) return res(500, { error: "NB_A_READ_FAILED" });
        return res(200, snapshot);
      }
      if (u === "/api/feature-flags") return res(200, { PARTNER_WORKSPACE_ENABLED: true });
      return res(200, {});
    }),
  );
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerRelationships />
    </QueryClientProvider>,
  );
}

/** Read an element's text having FIRST proved it is on screen. */
async function textOf(testId: string): Promise<string> {
  const el = await screen.findByTestId(testId);
  expect(el).toBeTruthy();
  return el.textContent ?? "";
}

/** The tile's own figure, isolated from the label and from any sibling note —
 *  an unscoped read of the tile would pick up the surface name too. */
async function figureOf(surface: string): Promise<string> {
  const tile = await screen.findByTestId(`relationships-count-${surface}`);
  const label = tile.querySelector("div");
  const figure = tile.querySelectorAll("div")[1];
  expect(label).toBeTruthy();
  expect(figure).toBeTruthy();
  return (figure!.textContent ?? "").trim();
}

describe("WAVE NB-A — the relationship map tiles print what was counted, and say so when nothing was", () => {
  beforeEach(() => {
    snapshot = COUNTED;
    relationshipRequests = 0;
    holdRelationships = false;
    failRelationships = false;
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /* ══════════════════════════════ 1 — THE FIGURES ARE THE SERVER'S ═════════ */

  it("A1 every tile prints the figure the server counted — all four, not a sample", async () => {
    renderPage();
    await screen.findByTestId("relationships-breakdown");
    expect(relationshipRequests).toBeGreaterThan(0);
    const expected: Record<string, string> = {
      mfc: "1",
      pipeline: "6",
      clients: "4",
      portfolio: "4",
    };
    for (const s of SURFACES) {
      expect(await figureOf(s)).toBe(expected[s]);
    }
  });

  it("A2 the pipeline tile shows 6 — the number of COMPANIES — and not 10, the number of deals", async () => {
    /* The live pipeline holds ten rows covering six distinct companies plus
       three rows with no company at all. 10 would be the wrong unit and 4 was
       the old spine's stale answer; both are excluded explicitly. */
    renderPage();
    await screen.findByTestId("relationships-breakdown");
    const fig = await figureOf("pipeline");
    expect(fig).toBe("6");
    expect(fig).not.toBe("10");
    expect(fig).not.toBe("0");
  });

  /* ══════════════════════ 2 — UNCOUNTABLE IS NOT ZERO ═════════════════════ */

  it("A3 THE DEFECT POLE — a surface the server could not count prints NO figure, and never a 0", async () => {
    snapshot = MFC_UNREADABLE;
    renderPage();
    await screen.findByTestId("relationships-breakdown");
    expect(relationshipRequests).toBeGreaterThan(0);

    const fig = await figureOf("mfc");
    expect(fig).not.toBe("0");
    expect(fig).not.toMatch(/[0-9]/);
    expect(fig.length).toBeGreaterThan(2);

    /* And the reason is STATED, not merely implied by a blank. */
    const note = await textOf("relationships-count-mfc-unreadable");
    expect(note.length).toBeGreaterThan(30);
    expect(note.toLowerCase()).toContain("could not be read");
    /* Copy must be true: nothing is lost by a failed read, and the sentence
       must not print a machine code at a person. */
    expect(note).not.toMatch(/[A-Z]{3,}_[A-Z_]{2,}/);

    /* The OTHER THREE tiles are unaffected — a read failure on one surface must
       not suppress figures that were counted perfectly well. */
    expect(await figureOf("pipeline")).toBe("6");
    expect(await figureOf("clients")).toBe("4");
    expect(await figureOf("portfolio")).toBe("4");
    for (const s of ["pipeline", "clients", "portfolio"] as const) {
      expect(screen.queryByTestId(`relationships-count-${s}-unreadable`)).toBeNull();
    }
  });

  it("A4 THE OTHER POLE — a surface counted as genuinely empty still prints 0, with no failure note", async () => {
    snapshot = MFC_TRULY_EMPTY;
    renderPage();
    await screen.findByTestId("relationships-breakdown");
    expect(relationshipRequests).toBeGreaterThan(0);
    expect(await figureOf("mfc")).toBe("0");
    expect(screen.queryByTestId("relationships-count-mfc-unreadable")).toBeNull();
  });

  it("A5 an ABSENT breakdown is not a zero either — every tile states the read failure", async () => {
    snapshot = NO_BREAKDOWN;
    renderPage();
    await screen.findByTestId("relationships-breakdown");
    for (const s of SURFACES) {
      expect(await figureOf(s)).not.toMatch(/[0-9]/);
      expect(await textOf(`relationships-count-${s}-unreadable`)).toBeTruthy();
    }
  });

  /* ═══════════════ 3 — THE UNIT IS STATED ON SCREEN (rule: a rule, not a number) */

  it("A6 the basis caption states the unit and the source, and is the LAST child of the strip", async () => {
    renderPage();
    const strip = await screen.findByTestId("relationships-breakdown");
    const basis = await screen.findByTestId("relationships-breakdown-basis");
    /* Appended LAST, inside the strip — a panel added anywhere else is a drop
       under the copy guard's sixth rule. */
    expect(strip.lastElementChild).toBe(basis);
    const text = basis.textContent ?? "";
    expect(text.toLowerCase()).toContain("companies, not deals");
    /* It names all four sources, so a partner can check the figure themselves. */
    for (const fragment of ["Managed Founder CRM", "pipeline", "clients", "portfolio"]) {
      expect(text).toContain(fragment);
    }
    /* It is a RULE, not a restatement of today's figures. */
    expect(text).not.toMatch(/\b(1|4|6|10)\b/);
  });

  /* ══════════ 4 — RECONCILE NO LONGER CLAIMS TO REPAIR THE FIGURES ════════ */

  it("A7 the reconcile panel claims only what reconcile does — it adds, and it cannot reduce", async () => {
    renderPage();
    const panel = await screen.findByTestId("relationships-reconcile-panel");
    const text = panel.textContent ?? "";
    expect(text.toLowerCase()).toContain("only ever adds");
    expect(text.toLowerCase()).toContain("cannot make any figure smaller");
    /* The old claim — that reconcile REBUILDS the map, i.e. that the figures
       above are the thing it repairs — must be gone, because the figures are no
       longer materialised and there is nothing there to rebuild. */
    expect(text.toLowerCase()).not.toContain("rebuilds the map");
  });

  it("A8 the reconcile BUTTON is untouched — same test id, same label, still enabled for a managing partner", async () => {
    renderPage();
    const btn = (await screen.findByTestId("relationships-reconcile-button")) as HTMLButtonElement;
    expect(btn.textContent).toBe("Reconcile relationship map");
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId("relationships-reconcile-denied")).toBeNull();
  });

  /* ═════════════════ 5 — THE OTHER TWO STATES CANNOT BE FALSE ═════════════ */

  it("A9 while the read is in flight the tiles are NOT MOUNTED, so no figure and no caption can be wrong there", async () => {
    holdRelationships = true;
    renderPage();
    await screen.findByTestId("relationships-loading");
    expect(relationshipRequests).toBeGreaterThan(0);
    expect(screen.queryByTestId("relationships-breakdown")).toBeNull();
    expect(screen.queryByTestId("relationships-breakdown-basis")).toBeNull();
    for (const s of SURFACES) {
      expect(screen.queryByTestId(`relationships-count-${s}`)).toBeNull();
    }
  });

  it("A10 on a failed read the tiles are NOT MOUNTED and the page says the whole map could not load", async () => {
    failRelationships = true;
    renderPage();
    await waitFor(() => expect(screen.getByTestId("relationships-error")).toBeTruthy());
    expect(relationshipRequests).toBeGreaterThan(0);
    expect(screen.queryByTestId("relationships-breakdown")).toBeNull();
    for (const s of SURFACES) {
      expect(screen.queryByTestId(`relationships-count-${s}`)).toBeNull();
    }
  });
});
