/**
 * WAVE B · ITEM 2b — THE CHAPTER CARRY COPY, AND THE MANUFACTURED ZERO.
 *
 * The owner's report: *"Explain to the Consortium Partner what this is? A chapter
 * does not necessarily have a 'carry' unless it is a fund."*
 *
 * Two separate claims are pinned here, and each is pinned in the direction that
 * would let the defect ship if the assertion were removed:
 *
 *   1. THE ASSERTION. The screen must not tell a Consortium Partner that a
 *      chapter EARNS a carry. `carry_bps` is never multiplied into any monetary
 *      amount anywhere in the platform (traced in the wave report), so "the carry
 *      each one earns" asserted an income the system does not produce. The test
 *      BANS that sentence from the rendered document and REQUIRES the standing
 *      explanation that replaces it — in the loaded branch AND in the empty,
 *      loading and error branches, because a sentence that is only true when data
 *      arrives is not true.
 *
 *   2. THE MANUFACTURED ZERO. `carry_bps INTEGER NOT NULL DEFAULT 0` and both
 *      writers coerce a missing value to 0, so a chapter with no carry
 *      arrangement is stored identically to a chapter with an agreed 0%. The
 *      test asserts that a stored 0 does NOT render as "0%" / "0.00%" — a
 *      measured-looking rate — while a genuinely recorded rate is untouched.
 *
 * A CONTROL RUNS FIRST (§0): a non-zero rate must still render as a percentage.
 * If the sentinel swallowed every value the fix would be indistinguishable from
 * blanking the column, and the fixture could not tell the fix from the defect.
 *
 * NOTHING HERE ASSERTS A VARIABLE NAME. Every assertion reads rendered text out
 * of the real component, mounted through the same harness the pre-existing
 * `wave20_partner_surface` suite uses.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const IDENTITY = {
  ready: true,
  error: null,
  identity: {
    partnerId: "ac_consortium_partner_test_partner_inc",
    tier: "builder",
    subRole: "managing_partner",
    identity: { userId: "u_avi_managing", email: "avi@example.com", name: "Test Partner Inc" },
  },
};
vi.mock("@/lib/partner/useRequirePartnerRole", async () => {
  const actual = await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  );
  return { ...actual, useRequirePartnerRole: () => IDENTITY };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import PartnerMfcrmPersonas from "../PartnerMfcrmPersonas";
import type { MfcrmCapability } from "@/lib/partner/mfcrmPersona";

/* --------------------------------------------------------------- utilities */

/** The exact sentence the owner objected to. Written out in full so that a
 *  future edit which re-introduces any part of it is caught. */
const THE_FALSE_ASSERTION = "the carry each one earns";
/* WAVE 340 · ITEM 2 — THIS SENTINEL CHANGED, AND WHY.
   Wave B rendered EVERY stored zero as "No carry rate confirmed" because the
   schema could not distinguish "no arrangement" from "an agreed 0%". The owner
   ruled on 2026-09-06 that the default must become NULL, and migration 0233 adds
   the nullable `carry_bps_recorded`, so the two ARE now distinguishable:
     no rate recorded   -> "Not set"   (the owner's words)
     an agreed 0%       -> "0.00%"     (a real term; Wave B hid it)
   The §2 tests below therefore assert the NEW label for a not-recorded rate, and
   a NEW test (§2d) pins the case Wave B could not express. Nothing about §0, §1
   or §3 changes. */
const NOT_SET = "Not set";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const url = queryKey.filter((k) => typeof k === "string").join("/").replace(/\/+/g, "/");
          return (await apiRequestMock("GET", url)).json();
        },
      },
      mutations: { retry: false },
    },
  });
}

function renderAt(pathname: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path: pathname, static: false, record: true });
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <TooltipProvider>{ui}</TooltipProvider>
      </Router>
    </QueryClientProvider>,
  );
}

function capability(over: Partial<MfcrmCapability> = {}): MfcrmCapability {
  return {
    partnerId: "ac_consortium_partner_test_partner_inc",
    partnerType: null,
    classified: true,
    sourcesCapital: false,
    delegatedAgency: false,
    spvWriteAuthority: false,
    advisoryCoseat: false,
    documentCustody: false,
    paysOnBehalf: false,
    attributionTracking: false,
    collectiveFronting: false,
    chapterScoping: false,
    fundAdmin: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Unrouted calls REJECT. A harness that silently resolves `{}` for a URL the
 *  page did not expect proves nothing about what the page renders. */
function routeGets(table: Record<string, unknown>) {
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    const key = String(url).split("?")[0];
    if (method === "GET" && key in table) {
      const v = table[key];
      if (v instanceof Error) throw v;
      return jsonResponse(v);
    }
    throw new Error(`unrouted ${method} ${url}`);
  });
}

const ANGEL = () => capability({ partnerType: "angel_network", chapterScoping: true });

function chapterFixture(carryBps: number) {
  return {
    "/api/partner/me/mfcrm/capability": { capability: ANGEL() },
    "/api/partner/me/mfcrm/angel/chapters": {
      chapters: [{ id: "mfch_1", name: "Toronto", region: "CA-ON", carry_bps: carryBps, status: "active" }],
    },
    "/api/partner/me/mfcrm/angel/carry-report": {
      report: [{ chapterId: "mfch_1", name: "Toronto", region: "CA-ON", carryBps, engagementCount: 3, activeCount: 2 }],
    },
  };
}

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

/* ============================================================= §0 CONTROL */

describe("WB·2b §0 CONTROL — a recorded rate still renders as a rate", () => {
  /**
   * THE DISAGREEMENT, DEMONSTRATED BEFORE THE AGREEMENT. If this test and the
   * zero test below both passed with the column blanked, the fixture could not
   * distinguish the fix from the defect. 1250 bps must still read "12.5%" in
   * BOTH cells, and must NOT read the not-confirmed sentinel.
   */
  it("1250 basis points still renders 12.5% in both carry cells", async () => {
    routeGets(chapterFixture(1250));
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");

    const cell = await screen.findByTestId("mfcrm-angel-chapter-carry-mfch_1");
    const reportCell = await screen.findByTestId("mfcrm-angel-report-carry-mfch_1");
    expect(cell.textContent).toBe("12.5%");
    expect(reportCell.textContent).toBe("12.5%");
    expect(cell.textContent).not.toContain(NOT_SET);
    expect(reportCell.textContent).not.toContain(NOT_SET);
  });

  it("a 3-basis-point rate is not swallowed either — the sentinel is keyed to EXACTLY zero", async () => {
    routeGets(chapterFixture(3));
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");
    const cell = await screen.findByTestId("mfcrm-angel-chapter-carry-mfch_1");
    expect(cell.textContent).not.toBe(NOT_SET);
    expect(cell.textContent).toContain("0.03");
  });
});

/* ================================================= §1 THE FALSE ASSERTION */

describe("WB·2b §1 — the screen must not claim a chapter EARNS a carry", () => {
  it("the false sentence is absent and the standing explanation is present, WITH data", async () => {
    routeGets(chapterFixture(1250));
    const { container } = renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");

    expect(container.textContent ?? "").not.toContain(THE_FALSE_ASSERTION);

    for (const id of ["mfcrm-angel-chapters-carry-meaning", "mfcrm-angel-report-carry-meaning"]) {
      const note = screen.getByTestId(id);
      const text = (note.textContent ?? "").replace(/\s+/g, " ");
      /* The three things that must be said, because each is the correction to a
         specific thing the old sentence implied. */
      expect(text).toContain("does not calculate, accrue, invoice or pay carry");
      expect(text).toContain("a chapter is not a fund");
      expect(text).toContain("record here for your own reference");
    }
  });

  it("the explanation is ALSO true and present in the EMPTY branch", async () => {
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: ANGEL() },
      "/api/partner/me/mfcrm/angel/chapters": { chapters: [] },
      "/api/partner/me/mfcrm/angel/carry-report": { report: [] },
    });
    const { container } = renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-angel-chapters-empty");
    expect(container.textContent ?? "").not.toContain(THE_FALSE_ASSERTION);
    expect(screen.getByTestId("mfcrm-angel-chapters-carry-meaning").textContent ?? "").toContain("not a fund");
    expect(screen.getByTestId("mfcrm-angel-report-carry-meaning").textContent ?? "").toContain("not a fund");
  });

  it("the explanation is ALSO present when the chapter load FAILS", async () => {
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: ANGEL() },
      "/api/partner/me/mfcrm/angel/chapters": new Error("boom"),
      "/api/partner/me/mfcrm/angel/carry-report": new Error("boom"),
    });
    const { container } = renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-angel-chapters-error");
    expect(container.textContent ?? "").not.toContain(THE_FALSE_ASSERTION);
    expect(screen.getByTestId("mfcrm-angel-chapters-carry-meaning").textContent ?? "").toContain("not a fund");
  });

  it("the card descriptions themselves no longer assert an earning", async () => {
    routeGets(chapterFixture(1250));
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    const chapters = await screen.findByTestId("mfcrm-angel-chapters");
    const report = await screen.findByTestId("mfcrm-angel-report");
    for (const card of [chapters, report]) {
      const t = (card.textContent ?? "").replace(/\s+/g, " ");
      expect(t).not.toContain("earns");
      expect(t).toContain("any carry rate");
    }
  });
});

/* ============================================== §2 THE MANUFACTURED ZERO */

describe("WB·2b §2 — a stored zero is not presented as a measured rate", () => {
  it("carry_bps 0 with NOTHING recorded renders \"Not set\", NOT a percentage", async () => {
    routeGets(chapterFixture(0));
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");

    const cell = await screen.findByTestId("mfcrm-angel-chapter-carry-mfch_1");
    const reportCell = await screen.findByTestId("mfcrm-angel-report-carry-mfch_1");

    expect(cell.textContent).toBe(NOT_SET);
    expect(reportCell.textContent).toBe(NOT_SET);
    /* The literal forms the pre-Wave-B code produced. Any of them reappearing for
       a row with NOTHING recorded means a defaulted zero is being shown as if it
       had been measured. §2d asserts the opposite direction. */
    for (const bad of ["0%", "0.00%", "0.0%"]) {
      expect(cell.textContent).not.toContain(bad);
      expect(reportCell.textContent).not.toContain(bad);
    }
  });

  it("the ambiguity is STATED, not hidden — the note says why zero is not shown as a rate", async () => {
    routeGets(chapterFixture(0));
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");
    const text = (screen.getByTestId("mfcrm-angel-chapters-carry-meaning").textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(NOT_SET);
    /* WAVE 340 · ITEM 2 — the note no longer describes an ambiguity the schema has
       stopped having. It states the RULE the storage now follows: a blank is not
       recorded as a nought, and a real 0% is shown. */
    expect(text).toContain("we do not record a nought on your behalf");
    expect(text).toContain("it will be shown as 0.00%");
    expect(text).not.toContain("cannot be told apart");
  });

  it("a NULL carry value is treated as the same ambiguity as a stored zero, not as a rate", async () => {
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: ANGEL() },
      "/api/partner/me/mfcrm/angel/chapters": {
        chapters: [{ id: "mfch_1", name: "Toronto", region: "CA-ON", carry_bps: null, status: "active" }],
      },
      "/api/partner/me/mfcrm/angel/carry-report": { report: [] },
    });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");
    /* A NULL legacy value with nothing recorded is the same answer as a defaulted
       zero: no rate is recorded, so the cell reads "Not set". It must NOT read
       "0%". The next test pins the other direction — a value that is PRESENT but
       unreadable keeps the em dash, because "Not set" would be a claim the data
       does not support. */
    const cell = await screen.findByTestId("mfcrm-angel-chapter-carry-mfch_1");
    expect(cell.textContent).toBe(NOT_SET);
  });

  it("§2d a RECORDED 0% renders 0.00% — the case Wave B could not express", async () => {
    /* THE POINT OF THE WHOLE ITEM. A GP who genuinely agreed zero carry now has
       that term shown. Under Wave B this row was indistinguishable from a blank
       and was displayed as "No carry rate confirmed", i.e. the platform hid a real
       commercial term. `carry_bps_recorded: 0` is what migration 0233 stores when
       somebody types 0. */
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: ANGEL() },
      "/api/partner/me/mfcrm/angel/chapters": {
        chapters: [{ id: "mfch_1", name: "Toronto", region: "CA-ON", carry_bps: 0, carry_bps_recorded: 0, status: "active" }],
      },
      "/api/partner/me/mfcrm/angel/carry-report": {
        report: [{ chapterId: "mfch_1", name: "Toronto", region: "CA-ON", carryBps: 0, carryBpsRecorded: 0, engagementCount: 1, activeCount: 1 }],
      },
    });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");
    const cell = await screen.findByTestId("mfcrm-angel-chapter-carry-mfch_1");
    const reportCell = await screen.findByTestId("mfcrm-angel-report-carry-mfch_1");
    expect(cell.textContent).toContain("0");
    expect(cell.textContent).not.toBe(NOT_SET);
    expect(reportCell.textContent).not.toBe(NOT_SET);
    expect(cell.textContent).toBe(reportCell.textContent);
  });

  it("§2e a PRE-MIGRATION rate is still shown — this wave hides nothing", async () => {
    /* `carry_bps_recorded` is NULL on every row that existed before 0233. A row
       whose legacy rate is 1250 must still read 12.5%; if it read "Not set" the
       wave would have DELETED information from the screen. */
    routeGets(chapterFixture(1250));
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");
    const cell = await screen.findByTestId("mfcrm-angel-chapter-carry-mfch_1");
    expect(cell.textContent).toBe("12.5%");
    expect(cell.textContent).not.toBe(NOT_SET);
  });

  it("a NaN-shaped carry value keeps the em dash", async () => {
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: ANGEL() },
      "/api/partner/me/mfcrm/angel/chapters": {
        chapters: [{ id: "mfch_1", name: "Toronto", region: "CA-ON", carry_bps: "not-a-number", status: "active" }],
      },
      "/api/partner/me/mfcrm/angel/carry-report": { report: [] },
    });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");
    const cell = await screen.findByTestId("mfcrm-angel-chapter-carry-mfch_1");
    expect(cell.textContent).toBe("—");
  });
});

/* ============================================ §3 THE FORM ASSERTS NOTHING */

describe("WB·2b §3 — neither input pre-asserts a carry of zero", () => {
  it("the create form tells the partner blank is allowed", async () => {
    routeGets(chapterFixture(1250));
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    const hint = await screen.findByTestId("mfcrm-angel-create-carry-hint");
    expect(hint.textContent ?? "").toContain("Leave this blank if you have not agreed a carry rate");
    expect((await screen.findByTestId("mfcrm-angel-create-carry")).getAttribute("value")).toBe("");
  });

  it("the edit box opens EMPTY for a stored zero and PRE-FILLED for a recorded rate", async () => {
    routeGets(chapterFixture(0));
    const first = renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    (await screen.findByTestId("mfcrm-angel-carry-edit-mfch_1")).click();
    expect((await screen.findByTestId("mfcrm-angel-carry-input-mfch_1")).getAttribute("value")).toBe("");
    first.unmount();
    cleanup();

    routeGets(chapterFixture(1250));
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    (await screen.findByTestId("mfcrm-angel-carry-edit-mfch_1")).click();
    expect((await screen.findByTestId("mfcrm-angel-carry-input-mfch_1")).getAttribute("value")).toBe("12.5");
  });
});
