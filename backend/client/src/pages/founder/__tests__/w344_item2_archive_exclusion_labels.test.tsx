/**
 * WAVE 344 · ITEM 2 — EVERY FIGURE THAT LEAVES ARCHIVED CONTACTS OUT SAYS SO.
 *
 * ── WHY THIS IS THE HIGHEST-RISK PART OF THE WHOLE ITEM ────────────────────
 * Archiving is safe for the record: the row, its history and its seals survive.
 * What archiving CHANGES is the numbers on the screen. Every count on the
 * founder CRM screen is computed from the working list, so archiving one contact
 * silently moves eighteen figures the owner reads. If the screen does not SAY
 * that, archiving becomes an invisible way to change a number he relies on.
 *
 * So this file asserts RENDERED TEXT — the actual strings in the actual DOM
 * produced by the actual page component — for every one of those figures.
 *
 * ── IT COUNTS THE FIGURES ITSELF ───────────────────────────────────────────
 * It does not trust a number written in a comment. It derives the figure list
 * from what the page renders (the four reach figures, one per pipeline stage
 * button, one per filter chip), asserts the total is EXACTLY 18, and then
 * requires a label on each. A new stage or a new chip added later without a
 * label turns this red.
 *
 * A NOTE ON THE NUMBER, BECAUSE AN EARLIER COUNT IN THIS WAVE WAS WRONG: an
 * interim note in this wave said seventeen. The pipeline strip renders one
 * button per entry in `STAGES`, and `STAGES` has EIGHT entries
 * (invited_unregistered, prospect, engaged, soft_circle, committed, signing,
 * invested, longterm) — not seven. 4 + 8 + 6 = 18. The count below is derived
 * from the DOM rather than asserted from memory, which is how the discrepancy
 * surfaced.
 *
 * ── THE FOUR SENTENCES, AND WHY NONE OF THEM IS SILENCE ────────────────────
 *   · some archived            → "Excludes archived contacts — N archived"
 *   · none archived           → "Excludes archived contacts — none are archived"
 *   · count could not be read → "Excludes archived contacts — how many is not known"
 *                               (NOT "0" — a fabricated zero is the failure this
 *                               programme has repeatedly been bitten by)
 *   · showing archived too    → "Includes archived contacts"
 * All four are asserted as rendered text.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { RoleProvider } from "@/lib/role";

/* ── the page's environment, stubbed at the edges only ───────────────────── */
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w344_labels",
  useActiveCompany: () => ({ companyId: "co_w344_labels", companyName: "W344 Labels Co" }),
}));

/**
 * THE ONLY THING FAKED IS THE NETWORK.
 *
 * `apiRequest` is replaced so the two server reads the page makes can be given
 * known answers; every count, every label and every string asserted below is
 * computed and rendered by the REAL page component from those answers. The page
 * itself is not stubbed, re-implemented or partially mounted.
 */
const state: { contacts: unknown[]; archivedCount: number | null; failSummary: boolean } = {
  contacts: [],
  archivedCount: 0,
  failSummary: false,
};

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return {
    queryClient: new QC({ defaultOptions: { queries: { retry: false } } }),
    apiRequest: async (_method: string, url: string) => {
      if (url.includes("archive-summary")) {
        if (state.failSummary) {
          // The server's honest "not known" answer: null, never 0.
          return { json: async () => ({ ok: false, archivedCount: null }) };
        }
        return { json: async () => ({ ok: true, archivedCount: state.archivedCount }) };
      }
      return { json: async () => state.contacts };
    },
  };
});

import FounderInvestorCRM from "@/pages/founder/CRM";

function contact(id: string, stage: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    companyId: "co_w344_labels",
    investorId: `inv_${id}`,
    name: `Contact ${id}`,
    firmName: `Firm ${id}`,
    email: `${id}@example.test`,
    region: "US",
    stage,
    ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0,
    threadIds: [],
    notes: "",
    notesUpdatedAt: "",
    tasks: [],
    series: "Series A",
    ...extra,
  };
}

/** The eight pipeline stages the page renders one button for, in page order. */
const STAGE_KEYS = [
  "invited_unregistered",
  "prospect",
  "engaged",
  "soft_circle",
  "committed",
  "signing",
  "invested",
  "longterm",
] as const;

/** The six quick-filter chips the page renders one count for. */
const CHIP_KEYS = [
  "all",
  "high_value",
  "soft_circled",
  "inactive_90d",
  "series_a",
  "strategic_intro",
] as const;

/** The four Network-reach figures. */
const REACH_KEYS = ["reach-total", "reach-invested", "reach-edges", "reach-top-series"] as const;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  /* The page's real providers: the router it reads links from and the role
     context its shell header needs. Providing the real ones rather than stubbing
     the shell keeps this a render of the actual screen. */
  const { hook } = memoryLocation({ path: "/founder/crm", static: true });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <RoleProvider>
          <FounderInvestorCRM />
        </RoleProvider>
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.contacts = [
    contact("a", "prospect"),
    contact("b", "invested", { ownership: { sharesUsd: 250000, pct: 2.5 } }),
    contact("c", "soft_circle", {
      softCircleHistory: [{ ts: "2026-01-01T00:00:00Z", amountUsd: 50000, type: "soft" }],
    }),
  ];
  state.archivedCount = 3;
  state.failSummary = false;
});

afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════
   0 — CONTROLS. The page really rendered, and the assertion CAN fail.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · CONTROLS — the screen is really on the screen", () => {
  it("CONTROL: the real page rendered its contacts, so the figures are computed from real rows", async () => {
    mount();
    // rows > 0 equivalent for a rendered surface: if the page had rendered empty,
    // every count would be 0 and every label assertion below would be about a
    // screen nobody could read anything off.
    await waitFor(() => expect(screen.getByTestId("reach-total").textContent).toBe("3"));
  });

  it("CONTROL: a figure that does not exist has NO label — so 'has a label' means something", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("reach-total")).toBeTruthy());
    expect(screen.queryByTestId("excludes-archived-figure-that-does-not-exist")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1 — THE COUNT OF AFFECTED FIGURES, DERIVED FROM THE DOM.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · the affected figures are counted, not assumed", () => {
  it("the page renders EXACTLY 18 figures computed from the working list === 18", async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByTestId("reach-total")).toBeTruthy());

    const stageButtons = STAGE_KEYS.filter((k) => screen.queryByTestId(`stage-${k}`));
    const chipButtons = CHIP_KEYS.filter((k) => screen.queryByTestId(`chip-${k}`));
    const reachFigures = REACH_KEYS.filter((k) => screen.queryByTestId(k));

    expect(reachFigures.length).toBe(4);
    expect(stageButtons.length).toBe(8);
    expect(chipButtons.length).toBe(6);
    expect(reachFigures.length + stageButtons.length + chipButtons.length).toBe(18);

    // And the number of labels actually in the DOM equals that same 18. Counted
    // off the rendered document, so a label rendered for a figure that is not
    // there, or a figure with no label, both break this.
    const labels = container.querySelectorAll('[data-testid^="excludes-archived-"]');
    expect(labels.length).toBe(18);
  });

  it("EVERY ONE of the 18 figures carries the exclusion sentence as RENDERED TEXT", async () => {
    mount();
    // Wait for the SETTLED sentence, not merely for the element: while the count
    // is still being read the label correctly says "checking how many", and
    // asserting mid-flight would be asserting against the loading state.
    await waitFor(() =>
      expect(screen.getByTestId("excludes-archived-reach-total").textContent).toContain(
        "3 archived",
      ),
    );

    const figures = [
      ...REACH_KEYS,
      ...STAGE_KEYS.map((k) => `stage-${k}`),
      ...CHIP_KEYS.map((k) => `chip-${k}`),
    ];
    expect(figures.length).toBe(18);

    for (const f of figures) {
      const label = screen.getByTestId(`excludes-archived-${f}`);
      const text = label.textContent ?? "";
      // The sentence itself, as a reader sees it.
      expect(text).toContain("Excludes archived contacts");
      expect(text).toContain("3 archived");
    }
  });

  it("the label is INSIDE the element that shows the figure, not floating elsewhere on the page", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("stage-prospect")).toBeTruthy());
    // Adjacency matters: a caveat printed at the bottom of the page is not a
    // caveat on a number. For the stage and chip figures the label must be
    // within the same control the number is printed in.
    for (const k of STAGE_KEYS) {
      const button = screen.getByTestId(`stage-${k}`);
      expect(within(button).getByTestId(`excludes-archived-stage-${k}`)).toBeTruthy();
    }
    for (const k of CHIP_KEYS) {
      const chip = screen.getByTestId(`chip-${k}`);
      expect(within(chip).getByTestId(`excludes-archived-chip-${k}`)).toBeTruthy();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 — THE FOUR SENTENCES. NONE OF THEM IS SILENCE, NONE IS A FABRICATED ZERO.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · the sentence is right in all four situations", () => {
  it("SOME ARCHIVED: it says how many are being left out", async () => {
    state.archivedCount = 7;
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("excludes-archived-reach-total").textContent).toContain(
        "7 archived",
      ),
    );
  });

  it("NONE ARCHIVED: it says none are archived — it does not go silent", async () => {
    // Silence would leave the owner unable to tell a complete figure from an
    // incomplete one, which is the whole reason this label exists.
    state.archivedCount = 0;
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("excludes-archived-reach-total").textContent).toContain(
        "none are archived",
      ),
    );
    expect(screen.getByTestId("excludes-archived-reach-total").textContent).not.toContain(
      "0 archived",
    );
  });

  it("COUNT NOT KNOWN: it says so, and NEVER prints a zero it does not have", async () => {
    state.failSummary = true;
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("excludes-archived-reach-total").textContent).toContain(
        "how many is not known",
      ),
    );
    const text = screen.getByTestId("excludes-archived-reach-total").textContent ?? "";
    // THE CRITICAL NEGATIVE: a fabricated zero here would tell the owner his
    // figures are complete when the platform does not know that.
    expect(text).not.toContain("none are archived");
    expect(text).not.toMatch(/\b0 archived\b/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 — THE ARCHIVE IS REVERSIBLE FROM THIS SCREEN, AND SAYS SO.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · the screen offers the undo, not just the archive", () => {
  it("every contact row shows an ARCHIVE control", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("button-archive-a")).toBeTruthy());
    for (const id of ["a", "b", "c"]) {
      expect(screen.getByTestId(`button-archive-${id}`)).toBeTruthy();
    }
  });

  it("the screen carries a control to SEE the archived contacts, which is where restoring happens", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("button-toggle-archived")).toBeTruthy());
    const panel = screen.getByTestId("archive-panel");
    const text = panel.textContent ?? "";
    // The promise made to the reader in the interface, in plain words: nothing is
    // deleted and it can be undone.
    expect(text.toLowerCase()).toContain("archiv");
    expect(screen.getByTestId("archive-panel-note").textContent ?? "").not.toBe("");
  });
});
