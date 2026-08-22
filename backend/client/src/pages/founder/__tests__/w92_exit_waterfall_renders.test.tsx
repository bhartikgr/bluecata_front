/**
 * WAVE 92 · ITEM 1 — THE EXIT WATERFALL SCREEN, RENDERED.
 * ════════════════════════════════════════════════════════════════════════════
 * A read-only audit of the LIVE site searched all four portals and found no exit,
 * waterfall, liquidation or distributions screen anywhere; the glossary returned 0
 * results for "waterfall" and 0 for "distribution"; and `GET
 * /api/founder/captable/waterfall` had ZERO client callers. Three waves of
 * corrected money work — 48 wrong figures (88), pari passu abatement (91), 766 of
 * 4,000 fixtures publishing a wrong participation-cap figure (94) — were invisible
 * to every customer and to QA.
 *
 * EVERY RESPONSE BODY BELOW IS A REAL ONE. They are trimmed from
 * `build_log/wave92/transcripts/01_pinned_route_bodies.json`, produced over live
 * HTTP by `server/__tests__/w92_exit_waterfall_screen.test.ts`. Nothing here was
 * invented: a screen test built on a made-up payload proves the screen renders a
 * fiction.
 *
 * THE ASSERTIONS THAT MATTER MOST:
 *   · a holder receiving $0 IS ON THE PAGE, showing $0, with the reason. Being
 *     absent is the defect (Wave 91 · Item 3);
 *   · a refusal renders as an answer with a to-do list, in the server's own plain
 *     English, with NO machine identifier anywhere on screen (R77 / R67F-17), and
 *     with a working control;
 *   · changing the sale price CLEARS the previous answer before the next arrives,
 *     so a founder never reads last scenario's figures under this scenario's
 *     heading;
 *   · the conservation residual is DISPLAYED, not hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ExitWaterfall, { isRenderableRefusalMessage } from "../ExitWaterfall";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w92_screen",
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: "co_w92_screen", companyName: "W92 Co" } },
  }),
}));

let nextBody: { status: number; body: unknown } = { status: 200, body: {} };
let requestedUrls: string[] = [];

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
  requestedUrls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/api/founder/captable/waterfall")) {
        requestedUrls.push(u);
        return res(nextBody.status, nextBody.body);
      }
      return res(200, {});
    }),
  );
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <ExitWaterfall />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

async function computeAt(price: string) {
  fireEvent.change(await screen.findByTestId("input-exit-price"), { target: { value: price } });
  fireEvent.click(screen.getByTestId("button-compute-waterfall"));
}

/* ── W92-PIN-02's REAL BODY, trimmed to the keys the screen reads. Series A
   $10,000,000 and Series B $5,000,000 both at rank 0, exit $9,000,000 against
   $15,000,000 of claims: abatement factor 0.6, A takes $6,000,000, B takes
   $3,000,000, and THE FOUNDERS TAKE NOTHING. ─────────────────────────────────── */
const PARI_PASSU_SHORT_EXIT = {
  ok: true,
  lpProceeds: "900000000",
  founderProceeds: "0",
  commonLegProceeds: "0",
  convertibleProceeds: "0",
  commonLegShares: "8000000",
  remainder: "0",
  byShareClass: [
    {
      classId: "rnd_a", className: "pin02 class0", proceeds: "600000000", proceedsExact: "600000000",
      decision: "preference_abated_pari_passu", engineDecision: "preference_then_participate",
      emittedByEngine: true, seniority: 0, seniorityOnRecord: true, participatingOnRecord: false,
      liquidationPreferenceMultiple: 1, investedMinor: "1000000000", claimMinor: "1000000000",
      abated: true,
    },
    {
      classId: "rnd_b", className: "pin02 class1", proceeds: "300000000", proceedsExact: "300000000",
      decision: "preference_abated_pari_passu", engineDecision: "preference_then_participate",
      emittedByEngine: true, seniority: 0, seniorityOnRecord: true, participatingOnRecord: false,
      liquidationPreferenceMultiple: 1, investedMinor: "500000000", claimMinor: "500000000",
      abated: true,
    },
  ],
  byConvertible: [],
  byCommonHolder: [
    {
      holderId: "hld_founder", holderName: "Founder Pin02", shares: "8000000", proceeds: "0",
      decision: "no_proceeds_reached_common", emittedByEngine: false,
      basis:
        "The sale price did not reach the common shares: the preference claims ranking ahead of them " +
        "absorbed all of it, so this holder receives nothing on this sale.",
    },
  ],
  excludedFromPayout: [],
  nonPreferenceClasses: [],
  convertibleCashOutBasis: null,
  seniority: [
    { roundId: "rnd_a", className: "pin02 class0", seniority: 0, onRecord: true },
    { roundId: "rnd_b", className: "pin02 class1", seniority: 0, onRecord: true },
  ],
  seniorityAssumed: null,
  pariPassu: {
    equalRankingDetected: true, duplicateRanks: [0], abatementEngaged: true,
    availableToPreferenceStackMinor: "900000000",
    tiers: [{
      seniority: 0,
      classes: [
        { classId: "rnd_a", className: "pin02 class0", claimMinor: "1000000000" },
        { classId: "rnd_b", className: "pin02 class1", claimMinor: "500000000" },
      ],
      tierClaimMinor: "1500000000", availableMinor: "900000000",
      abated: true, abatementFactor: "0.6",
    }],
    precisionCeiling: "38",
    basis: "Classes recorded with the same seniority rank equally — pari passu.",
  },
  participationCaps: {
    anyOnRecord: false, classes: [], capBound: [], capForcedConversion: [],
    releasedExcessMinor: "0", releasedExcessRedistributed: false,
    conservationExact: true, conservationResidualMinor: "0",
    residualSharedMinor: null, residualPricePerShareMinor: null,
    precisionCeiling: "38", basis: "A participation cap is a ceiling on the TOTAL a class can take.",
  },
};

/* ── W92-PIN-05's REAL BODY: two caps bind, the residual price per share does not
   terminate, and `conservationResidualMinor` is therefore NON-ZERO. ──────────── */
const NON_TERMINATING = {
  ...PARI_PASSU_SHORT_EXIT,
  lpProceeds: "3288888888.8888888888888888888888888889",
  founderProceeds: "2711111111.1111111111111111111111111111",
  commonLegProceeds: "2711111111.1111111111111111111111111111",
  byShareClass: [{
    classId: "rnd_c1", className: "pin05 class0", proceeds: "2000000000", proceedsExact: "2000000000",
    decision: "preference_then_participate", engineDecision: "preference_then_participate",
    emittedByEngine: true, seniority: 0, seniorityOnRecord: true, participatingOnRecord: true,
    liquidationPreferenceMultiple: 1, investedMinor: "1000000000", claimMinor: "1000000000",
    abated: false,
  }],
  byCommonHolder: [{
    holderId: "hld_f5", holderName: "Founder Pin05", shares: "8000000",
    proceeds: "2711111111.1111111111111111111111111111",
    decision: "common_pro_rata", emittedByEngine: true, basis: null,
  }],
  pariPassu: { ...PARI_PASSU_SHORT_EXIT.pariPassu, abatementEngaged: false, tiers: [] },
  participationCaps: {
    anyOnRecord: true,
    classes: [{
      roundId: "rnd_c1", className: "pin05 class0", onRecord: true, capMultiple: 2,
      source: "capParticipation", inert: false, capAmountMinor: "2000000000",
    }],
    capBound: ["rnd_c1"], capForcedConversion: [],
    releasedExcessMinor: "228571428.57142857142857142857142857143",
    releasedExcessRedistributed: true,
    conservationExact: false,
    conservationResidualMinor: "-0.00000000000000000000000000001",
    residualSharedMinor: "3050000000",
    residualPricePerShareMinor: "338.88888888888888888888888888888888889",
    precisionCeiling: "38",
    basis: "A participation cap is a ceiling on the TOTAL a class can take.",
  },
};

/* ── A REAL REFUSAL BODY: the convertible note whose payout depends on three facts
   nobody has recorded. Wave 88 measured this note's payout moving by $1,687,763.71
   across defensible assumptions, which is why it must stay a refusal. ─────────── */
const NOTE_REFUSAL = {
  ok: false,
  /* THE `error` IDENTIFIER IS DELIBERATELY NOT IN THIS FIXTURE. The screen never
     reads it and never switches on it (see the block above `RefusalPanel`), so the
     fixture does not need it — and `R67F-17` in
     `server/__tests__/w88_exit_proceeds_per_instrument.test.ts` is a RAW TEXT SCAN
     of every `.ts`/`.tsx` under `client/src`, test files included. Putting the
     literal here would turn that pin red for no gain. That pin MUST STAY GREEN and
     it is not this wave's to edit; `W92-S-03` asserts the same thing about the
     screen's own source. */
  className: "W92 Bridge Note",
  message:
    "A convertible note is outstanding on this cap table and its payout at an exit cannot be " +
    "determined from what is on record. Capavate will not publish a figure it cannot stand behind.",
  missingFacts: ["exit_date", "day_count_convention", "change_of_control_repayment_multiple"],
};

describe("WAVE 92 · ITEM 1 — the exit waterfall screen renders the answer", () => {
  beforeEach(() => installFetch());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("W92-R-01 · nothing is fetched until a price is entered, and the empty state is a real state", async () => {
    renderScreen();
    expect(await screen.findByTestId("panel-waterfall-empty")).toBeTruthy();
    expect(requestedUrls).toEqual([]);
    /* NO SAMPLE FIGURES on an empty page. */
    expect(screen.queryByTestId("section-waterfall-totals")).toBeNull();
  });

  it("W92-R-02 · THE $0 ROW IS ON THE PAGE — being absent is the defect", async () => {
    nextBody = { status: 200, body: PARI_PASSU_SHORT_EXIT };
    renderScreen();
    await computeAt("9000000");
    await screen.findByTestId("section-waterfall-common");

    /* The founders' row exists, is named, and shows a FIGURE of zero. */
    const row = screen.getByTestId("row-common-hld_founder");
    expect(row.textContent).toContain("Founder Pin02");
    expect(row.textContent).toContain("0.00");
    /* WITH THE REASON, in the server's own words rather than a sentence this screen
       invented — so two screens can never word it differently. */
    expect(row.textContent).toContain("did not reach the common shares");
  });

  it("W92-R-03 · the abatement is shown AS AN ABATEMENT, with the three numbers behind it", async () => {
    nextBody = { status: 200, body: PARI_PASSU_SHORT_EXIT };
    renderScreen();
    await computeAt("9000000");
    await screen.findByTestId("section-waterfall-pari-passu");

    /* An investor asked to accept 60% of what they are owed is entitled to see what
       the group was owed, what was available, and the resulting percentage. */
    const tier = screen.getByTestId("row-tier-0");
    expect(tier.textContent).toContain("15,000,000.00");
    expect(tier.textContent).toContain("9,000,000.00");
    expect(screen.getByTestId("text-abatement-0").textContent).toContain("60%");
    expect(screen.getByTestId("text-abatement-explained").textContent)
      .toContain("same proportion of its own claim");

    /* And the two class figures are Wave 91's verified split. */
    expect(screen.getByTestId("row-preferred-rnd_a").textContent).toContain("6,000,000.00");
    expect(screen.getByTestId("row-preferred-rnd_b").textContent).toContain("3,000,000.00");
  });

  it("W92-R-04 · THE CONSERVATION RESIDUAL IS DISPLAYED, not hidden", async () => {
    nextBody = { status: 200, body: NON_TERMINATING };
    renderScreen();
    await computeAt("60000000");
    await screen.findByTestId("panel-conservation");

    const line = screen.getByTestId("text-conservation-residual");
    /* The measured figure itself, on the page. Wave 94 publishes it precisely so it
       cannot be absorbed into a tolerance, and the screen prints it. */
    expect(line.textContent).toContain("-0.00000000000000000000000000001");
    expect(line.textContent).toContain("does not terminate");
    expect(line.textContent).toContain("38");
  });

  it("W92-R-05 · a binding cap says where the released excess went", async () => {
    nextBody = { status: 200, body: NON_TERMINATING };
    renderScreen();
    await computeAt("60000000");
    await screen.findByTestId("section-waterfall-caps");

    expect(screen.getByTestId("row-cap-rnd_c1").textContent).toContain("2x");
    expect(screen.getByTestId("row-cap-rnd_c1").textContent).toContain("stopped at its ceiling");
    const released = screen.getByTestId("text-released-excess").textContent ?? "";
    expect(released).toContain("2,285,714.29");
    /* J-3: NOT a windfall for the common stock alone. */
    expect(released).toContain("other participating preference classes");
  });

  it("W92-R-06 · a REFUSAL is an answer with a to-do list — and no identifier reaches the page", async () => {
    nextBody = { status: 422, body: NOTE_REFUSAL };
    renderScreen();
    await computeAt("50000000");
    await screen.findByTestId("panel-waterfall-refusal");

    /* A CALM HEADING. Not "Error", not a red toast. */
    expect(screen.getByTestId("panel-waterfall-refusal").textContent)
      .toContain("cannot publish a figure for this sale yet");
    /* THE SERVER'S MESSAGE, VERBATIM. */
    expect(screen.getByTestId("text-refusal-message").textContent)
      .toContain("will not publish a figure it cannot stand behind");
    /* THE THREE MISSING FACTS, AS PLAIN ENGLISH A FOUNDER CAN ACT ON. */
    const facts = screen.getByTestId("list-missing-facts").textContent ?? "";
    expect(facts).toContain("What Capavate needs (3)");
    expect(facts).toContain("date the sale is expected to complete");
    expect(facts).toContain("How interest days are counted");
    expect(facts).toContain("repayment multiple");
    /* AND NOT ONE MACHINE TOKEN ON SCREEN (R77 / the internal-language fence). */
    const page = document.body.textContent ?? "";
    for (const token of [
      "exit_date", "day_count_convention",
      "change_of_control_repayment_multiple", "/api/founder", "extras_json",
    ]) {
      expect(page.includes(token), `${token} is readable on screen`).toBe(false);
    }
    /* A WORKING CONTROL. "No dead promises." */
    expect(screen.getByTestId("button-open-rounds")).toBeTruthy();
  });

  it("W92-R-07 · a message that is NOT prose is never rendered verbatim", () => {
    /* THE FINDING THIS GATE EXISTS FOR: `WATERFALL_COMPUTE_ERROR` carries
       `message: (err as Error).message` at three sites — an EXCEPTION string from
       inside the engine, which is not curated copy and can say anything. The
       pre-flight verified the LITERAL message strings in the handler and correctly
       did not cover it. So verbatim rendering is gated rather than assumed. */
    expect(isRenderableRefusalMessage(NOTE_REFUSAL.message)).toBe(true);
    expect(isRenderableRefusalMessage("TypeError: cannot read property 'gt' of undefined")).toBe(false);
    expect(isRenderableRefusalMessage("shares_in_pool must be greater than zero for this computation")).toBe(false);
    expect(isRenderableRefusalMessage("at computeWaterfall (liquidationWaterfall.ts:83)")).toBe(false);
    expect(isRenderableRefusalMessage("boom")).toBe(false);
    expect(isRenderableRefusalMessage(null)).toBe(false);
  });

  it("W92-R-08 · a session or ownership refusal gets its own copy, not a blank panel", async () => {
    /* These refusals carry NO `message` at all, so a screen that only rendered
       `message` would show an empty panel. */
    nextBody = { status: 403, body: { ok: false, error: "FORBIDDEN" } };
    renderScreen();
    await computeAt("50000000");
    await screen.findByTestId("panel-waterfall-refusal");
    expect(screen.getByTestId("text-refusal-message").textContent)
      .toContain("not on your account");
    expect(document.body.textContent ?? "").not.toContain("FORBIDDEN");
  });

  it("W92-R-09 · CHANGING THE PRICE CLEARS THE PREVIOUS ANSWER before the next one arrives", async () => {
    nextBody = { status: 200, body: PARI_PASSU_SHORT_EXIT };
    renderScreen();
    await computeAt("9000000");
    await screen.findByTestId("section-waterfall-totals");
    expect(screen.getByTestId("row-preferred-rnd_a").textContent).toContain("6,000,000.00");

    /* The founder starts typing a new price. The figures on screen belong to the
       OLD one, so they must go — or a founder reads last scenario's figures under
       this scenario's heading. */
    fireEvent.change(screen.getByTestId("input-exit-price"), { target: { value: "56000000" } });
    await waitFor(() => expect(screen.queryByTestId("section-waterfall-totals")).toBeNull());
    expect(screen.queryByTestId("row-preferred-rnd_a")).toBeNull();
  });

  it("W92-R-10 · an unreadable price is refused HERE, in the screen's own words, before the server is troubled", async () => {
    nextBody = { status: 200, body: PARI_PASSU_SHORT_EXIT };
    renderScreen();
    await computeAt("fifty million");
    expect((await screen.findByTestId("text-price-refusal")).textContent)
      .toContain("plain amount");
    expect(requestedUrls).toEqual([]);
  });

  it("W92-R-11 · the price reaches the wire as MINOR UNITS, shifted in text, never multiplied", async () => {
    nextBody = { status: 200, body: PARI_PASSU_SHORT_EXIT };
    renderScreen();
    await computeAt("56,000,000");
    await screen.findByTestId("section-waterfall-totals");
    expect(requestedUrls.length).toBe(1);
    expect(requestedUrls[0]).toContain("exitValuationMinor=5600000000");
    expect(requestedUrls[0]).toContain("companyId=co_w92_screen");
    /* The SPV-style preferred return is deliberately NOT sent: it is not a
       liquidation multiple, and Wave 71 · D11 severed that confusion. */
    expect(requestedUrls[0]).not.toContain("preferredReturnPct");
  });
});
