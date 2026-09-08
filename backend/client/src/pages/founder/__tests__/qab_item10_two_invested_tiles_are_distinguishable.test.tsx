/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ITEM 10 — two tiles on the investor CRM screen both said "INVESTED".
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * BOTH COUNTERS WERE CORRECT. They count different things:
 *   · Network reach `reach-invested` — contacts at stage `invested` OR `longterm`.
 *   · Pipeline strip `stage-invested` — contacts at stage `invested` alone.
 * Under the same word, on the same screen, they showed two different numbers and
 * the founder had no way to tell which was which. THE LABEL WAS THE DEFECT.
 * The arithmetic is not touched by this change and this file proves that too.
 *
 * WHAT IS PROVED, from the MOUNTED real page and RENDERED TEXT:
 *   0  CONTROL — the page really rendered rows, so the counts below are computed
 *      from real contacts and not from an empty screen showing zeros.
 *   1  THE TWO LABELS ARE NOW DIFFERENT WORDS.
 *   2  THE ARITHMETIC IS UNCHANGED — with a deliberately chosen fixture the two
 *      figures are 3 and 2, exactly as the two definitions require. If a future
 *      edit "fixed" the discrepancy by making them equal, this fails.
 *   3  THE NEW LABEL NAMES WHAT IT COUNTS — it mentions both stages it adds up.
 *   4  THE TEST IDS ARE UNCHANGED, so no other consumer was broken to fix a word.
 *
 * Harness modelled on w344_item2_archive_exclusion_labels.test.tsx, which
 * already mounts the REAL CRM page with only the network stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { RoleProvider } from "@/lib/role";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_qab_item10",
  useActiveCompany: () => ({ companyId: "co_qab_item10", companyName: "QAB Item 10 Co" }),
}));

const state: { contacts: unknown[] } = { contacts: [] };

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return {
    queryClient: new QC({ defaultOptions: { queries: { retry: false } } }),
    apiRequest: async (_method: string, url: string) => {
      if (url.includes("archive-summary")) return { json: async () => ({ ok: true, archivedCount: 0 }) };
      return { json: async () => state.contacts };
    },
  };
});

import FounderInvestorCRM from "@/pages/founder/CRM";

function contact(id: string, stage: string) {
  return {
    id, companyId: "co_qab_item10", investorId: `inv_${id}`,
    name: `Contact ${id}`, firmName: `Firm ${id}`, email: `${id}@example.test`,
    region: "US", stage, ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [], maSignals: 0, threadIds: [], notes: "",
    notesUpdatedAt: "", tasks: [], series: "Series A",
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

/** The tile's LABEL — the element immediately preceding its figure, and nothing
 *  else. A first attempt climbed to the parent and swept up the figure and the
 *  archived-contacts footnote too, which made the label string unreadable and
 *  would have let an assertion pass or fail for a reason that had nothing to do
 *  with the label. Read the label node itself. */
function labelOf(testId: string): string {
  const figure = screen.getByTestId(testId);
  const label = figure.previousElementSibling as HTMLElement | null;
  if (!label) throw new Error(`no label element precedes ${testId}`);
  return (label.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The pipeline stage tile's LABEL, read the same way: its first child div. */
function stageLabelOf(testId: string): string {
  const btn = screen.getByTestId(testId);
  const label = btn.firstElementChild as HTMLElement | null;
  if (!label) throw new Error(`no label element inside ${testId}`);
  return (label.textContent ?? "").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  /* CHOSEN SO THE TWO FIGURES MUST DIFFER: two `invested` and one `longterm`.
     Network reach counts invested + longterm = 3. Pipeline `invested` = 2. */
  state.contacts = [
    contact("a", "invested"),
    contact("b", "invested"),
    contact("c", "longterm"),
    contact("d", "prospect"),
  ];
});
afterEach(() => cleanup());

describe("ITEM 10 · the two INVESTED tiles can be told apart, and the maths is untouched", () => {
  it("0 · CONTROL — the real page rendered real rows, so the figures are not an empty screen", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("reach-total").textContent).toBe("4"), { timeout: 5000 });
    /* 4 contacts in, 4 counted out. If this were 0 every assertion below would be
       about a page that never received data. */
  });

  it("1 · the two tiles no longer carry the same word", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("reach-invested")).toBeTruthy(), { timeout: 5000 });
    const reachLabel = labelOf("reach-invested");
    const stageLabel = stageLabelOf("stage-invested");
    /* CONTROL WITHIN THE ASSERTION: both labels are real, non-empty strings, so
       `not.toBe` cannot pass by comparing two empty strings. */
    expect(reachLabel.length).toBeGreaterThan(0);
    expect(stageLabel).toBe("Invested");
    expect(reachLabel).not.toBe(stageLabel);
  });

  it("2 · THE ARITHMETIC IS UNTOUCHED — 3 and 2, and they are NOT made equal", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("reach-invested").textContent).toBe("3"), { timeout: 5000 });
    expect(screen.getByTestId("reach-invested").textContent).toBe("3"); // invested + longterm
    /* The stage tile's figure is the second child text of its button. */
    const stage = (screen.getByTestId("stage-invested").textContent ?? "");
    expect(stage).toContain("2");                                       // invested alone
    expect(screen.getByTestId("reach-invested").textContent).not.toBe("2");
  });

  it("3 · the new label names BOTH stages it adds up", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("reach-invested")).toBeTruthy(), { timeout: 5000 });
    const label = labelOf("reach-invested").toLowerCase();
    expect(label).toContain("invested");
    expect(label).toContain("long-term");
  });

  it("4 · the test ids are unchanged, so nothing else was broken to fix a word", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("reach-invested")).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByTestId("reach-total")).toBeTruthy();
    expect(screen.getByTestId("reach-edges")).toBeTruthy();
    expect(screen.getByTestId("reach-top-series")).toBeTruthy();
    expect(screen.getByTestId("stage-invested")).toBeTruthy();
    expect(screen.getByTestId("stage-longterm")).toBeTruthy();
  });
});
