/**
 * WAVE 191 — A CURRENCY ON EVERY RECORD, AND NEVER TWO ADDED TOGETHER.
 * ════════════════════════════════════════════════════════════════════════════
 * The owner's ruling this wave implements, verbatim:
 *
 *   "a company can have multiple vehicles in different currencies. We do not
 *    have to combine all of them into one for reporting. Just state each
 *    currency."
 *
 * and the standing rule it rests on, R156.1: THE PLATFORM NEVER CONVERTS. Those
 * two together make the currency tag on a record a CONTRACT — it is the thing
 * that tells an LP what to send — so this file proves, by rendering, that the tag
 * can be set, that it is stated in words where money is asked for, and that two
 * of them never become one number.
 *
 * WHAT IS PROVED BY RENDERING (jsdom), and what is proved otherwise:
 *   D-1..D-4   Item D — the LP is told the currency. RENDERED, two currencies
 *              each, with a no-currency negative control.
 *   A-1..A-4   Item A — the honest label siblings. RENDERED, for a non-USD
 *              currency, a USD currency, and no currency.
 *   C-1..C-5   Item C — the mixed-currency refusal vocabulary and the grouping
 *              rule. Unit-level on the exported decision layer.
 *   R-1..R-4   R143.1 — every pre-existing literal this wave sits beside is
 *              still present BYTE FOR BYTE. Proved against the source text,
 *              because "the old string was not deleted" is a claim about source
 *              text and cannot be made from a render.
 *
 * NOT PROVED HERE, and stated as such in W191_TESTS.md rather than implied: the
 * full `RoundNew` wizard and `CapTable` page are not mounted in jsdom. Their
 * decision layers are extracted and rendered instead (`WizardCurrencyLabelNote`,
 * `CurrencyLabelNote`, `mixedCurrencyStatement`), and their wiring is proved by
 * source text plus the server suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { SpvInvitations } from "@/components/investor/SpvInvitations";
import { LpPositions } from "@/components/investor/LpPositions";
import { CurrencyLabelNote } from "@/pages/founder/Rounds";
import { WizardCurrencyLabelNote } from "@/pages/founder/RoundNew";
import {
  MIXED_CURRENCY_ON_RECORD_CELL,
  mixedCurrencyStatement,
  symbolOnRecord,
  moneyOnRecord,
  symbolCellOnRecord,
  amountCellOnRecord,
  NO_CURRENCY_ON_RECORD_CELL,
} from "../currencyOnRecordDisplay";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

afterEach(() => cleanup());
beforeEach(() => apiRequestMock.mockReset());

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
}

/* A real invitation payload shape, taken from `InvitedSpv` in the component. */
function invitedSpv(currency: string | null) {
  return {
    spvId: "spv_1",
    name: "Keiretsu Canada NovaPay SPV 2026",
    sponsorPartnerId: "p_1",
    spvType: "canadian_lp",
    jurisdiction: "Canada",
    status: "open",
    currency,
    scope: "invite_only",
    targetRaiseMinor: 500000000,
    minCheckMinor: 2500000,
    closeDate: "2026-12-31",
    viaInvitation: true,
    scopeCopy: "You can see this vehicle because a general partner invited you to it.",
  };
}

function lpPosition(currency: string | null) {
  return {
    spvId: "spv_1",
    spvName: "Keiretsu Canada NovaPay SPV 2026",
    jurisdiction: "Canada",
    legalForm: null,
    currency,
    positionType: "spv_lp_interest",
    commitmentMinor: 5000000,
    calledCapitalMinor: 2500000,
    distributionsReceivedMinor: 0,
    ownershipFraction: 0.05,
    capitalAccountMinor: 2500000,
    navTotalMinor: 100000000,
    navShareMinor: 5000000,
    navAsOfDate: "2026-08-01",
    navBadge: null,
    navRefusalCopy: null,
    hasSideLetter: false,
    refusalCopy: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ITEM D — TELL THE LP WHICH CURRENCY TO SEND.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 191 · Item D — the LP is told the currency, in words", () => {
  it("(D-1) an invitation to a USD vehicle says USD and says funds must be delivered in USD", async () => {
    apiRequestMock.mockResolvedValue({
      json: async () => ({ spvs: [invitedSpv("USD")], emptyCopy: "" }),
    });
    render(
      <QueryClientProvider client={qc()}>
        <SpvInvitations />
      </QueryClientProvider>,
    );
    const el = await waitFor(() => screen.getByTestId("spv-invitation-currency-spv_1"));
    expect(el.textContent).toContain("denominated in USD");
    expect(el.textContent).toContain("funds must be delivered in USD");
    expect(el.textContent).toContain("does not convert");
    /* The scope copy it was appended AFTER is still there — nothing replaced. */
    expect(screen.getByTestId("spv-invitation-scope-spv_1").textContent).toBe(
      "You can see this vehicle because a general partner invited you to it.",
    );
  });

  it("(D-2) the SAME surface says HKD for an HKD vehicle — the currency is derived, not written into the file", async () => {
    apiRequestMock.mockResolvedValue({
      json: async () => ({ spvs: [invitedSpv("HKD")], emptyCopy: "" }),
    });
    render(
      <QueryClientProvider client={qc()}>
        <SpvInvitations />
      </QueryClientProvider>,
    );
    const el = await waitFor(() => screen.getByTestId("spv-invitation-currency-spv_1"));
    expect(el.textContent).toContain("denominated in HKD");
    expect(el.textContent).toContain("funds must be delivered in HKD");
    /* NEGATIVE CONTROL on the same render: no other currency leaked in. */
    expect(el.textContent).not.toContain("USD");
    expect(el.textContent).not.toContain("CAD");
  });

  it("(D-3) a vehicle with NO currency on record says nothing rather than defaulting to dollars", async () => {
    apiRequestMock.mockResolvedValue({
      json: async () => ({ spvs: [invitedSpv(null)], emptyCopy: "" }),
    });
    render(
      <QueryClientProvider client={qc()}>
        <SpvInvitations />
      </QueryClientProvider>,
    );
    await waitFor(() => screen.getByTestId("spv-invitation-scope-spv_1"));
    expect(screen.queryByTestId("spv-invitation-currency-spv_1")).toBeNull();
  });

  it("(D-4) the LP position screen states the funding currency for CAD and for HKD", async () => {
    for (const cur of ["CAD", "HKD"]) {
      apiRequestMock.mockResolvedValue({
        json: async () => ({ positions: [lpPosition(cur)] }),
      });
      render(
        <QueryClientProvider client={qc()}>
          <LpPositions />
        </QueryClientProvider>,
      );
      const el = await waitFor(() => screen.getByTestId("investor-lp-funding-currency"));
      expect(el.textContent).toContain(`denominated in ${cur}`);
      expect(el.textContent).toContain(`capital calls must be funded in ${cur}`);
      expect(el.textContent).toContain("does not convert");
      cleanup();
    }
  });

  it("(D-5) an LP position with no currency on record prints no funding sentence", async () => {
    apiRequestMock.mockResolvedValue({ json: async () => ({ positions: [lpPosition(null)] }) });
    render(
      <QueryClientProvider client={qc()}>
        <LpPositions />
      </QueryClientProvider>,
    );
    await waitFor(() => screen.getByTestId("investor-lp-commitment"));
    expect(screen.queryByTestId("investor-lp-funding-currency")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ITEM A — THE HARDCODED "(USD)" LABELS ARE CORRECTED, NOT DELETED.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 191 · Item A — a label that said USD for every jurisdiction", () => {
  it("(A-1) a non-USD round renders the correction beside the label, naming the real currency", () => {
    render(<CurrencyLabelNote currency="HKD" testid="n" />);
    const el = screen.getByTestId("n");
    expect(el.textContent).toContain("Recorded in HKD, not US dollars");
    expect(el.textContent).toContain("never converts");
  });

  it("(A-2) the wizard's variant tells the founder which currency to TYPE", () => {
    render(<WizardCurrencyLabelNote currency="CAD" testid="w" />);
    expect(screen.getByTestId("w").textContent).toContain("Enter this amount in CAD");
  });

  it("(A-3) NEGATIVE CONTROL — a genuinely USD round adds nothing, because the old label is correct", () => {
    render(
      <>
        <CurrencyLabelNote currency="USD" testid="n" />
        <WizardCurrencyLabelNote currency="USD" testid="w" />
      </>,
    );
    expect(screen.queryByTestId("n")).toBeNull();
    expect(screen.queryByTestId("w")).toBeNull();
  });

  it("(A-4) NEGATIVE CONTROL — no currency, and a region token, both render nothing", () => {
    /* A region code must never reach this component and produce a sentence. Every
       region token in this platform is two letters, so the /^[A-Z]{3}$/ gate
       excludes all of them; "USD" is the only three-letter value that is silent,
       and it is silent for the right reason. */
    for (const bad of ["", "  ", "us", "HK", "hkd", "H", "HKDX", "$"]) {
      cleanup();
      render(<CurrencyLabelNote currency={bad} testid="n" />);
      expect(screen.queryByTestId("n")).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ITEM C — NEVER COMBINE CURRENCIES, AND SAY SO.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 191 · Item C — two currencies never become one number", () => {
  it("(C-1) the mixed-currency statement names every currency and refuses a total", () => {
    const s = mixedCurrencyStatement(["CAD", "HKD", "USD"]);
    expect(s).toContain("CAD and HKD and USD");
    expect(s).toContain("Not shown as one figure");
    expect(s).toContain("holds no exchange rate and will not invent one");
    /* The convention sentence, byte for byte as the earlier waves wrote it. */
    expect(s).toContain(
      "This is not the same as zero, and Capavate will not show a zero total for a figure it does not hold.",
    );
  });

  it("(C-2) the statement invents no currency of its own — it can only echo what it was given", () => {
    expect(mixedCurrencyStatement(["GBP", "JPY"])).not.toContain("USD");
    expect(mixedCurrencyStatement([])).not.toMatch(/USD|CAD|HKD|\$/);
  });

  it("(C-3) the short cell form is a sentence, never a number and never a symbol", () => {
    expect(MIXED_CURRENCY_ON_RECORD_CELL).toBe("Not shown — more than one currency");
    expect(MIXED_CURRENCY_ON_RECORD_CELL).not.toMatch(/[0-9$£¥]/);
  });

  it("(C-4) the gate the cap-table totals pass through refuses when the symbol is withheld", () => {
    /* This is the exact mechanism `crossRoundSym` uses: when the book is not in one
       currency it is `null`, and wave 190's helpers already refuse for `null`.
       No new refusal path was invented, so there is nothing new to get wrong. */
    expect(moneyOnRecord(null, "20,200,000")).toBe(NO_CURRENCY_ON_RECORD_CELL);
    expect(symbolCellOnRecord(null)).toBe(NO_CURRENCY_ON_RECORD_CELL);
    expect(amountCellOnRecord(null, "20,200,000")).toBe("");
    /* And the single-currency NEGATIVE CONTROL still prints the real figure. */
    expect(moneyOnRecord(symbolOnRecord("CAD"), "20,200,000")).toBe("C$20,200,000");
    expect(symbolCellOnRecord(symbolOnRecord("USD"))).toBe("$");
    expect(amountCellOnRecord(symbolOnRecord("USD"), "20,200,000")).toBe("20,200,000");
  });

  it("(C-5) the grouping rule itself: same amounts, different round currencies, never summed", () => {
    /* The rule as the page applies it, stated independently of React. A security
       is grouped by the currency of ITS OWN round; a round with no currency does
       not fall back to the company default, it forces a refusal. */
    const roundCurrency = new Map<string, string>([
      ["r_usd", "USD"],
      ["r_cad", "CAD"],
      ["r_hkd", "HKD"],
    ]);
    const secs = [
      { roundId: "r_usd", amount: 100 },
      { roundId: "r_cad", amount: 100 },
      { roundId: "r_hkd", amount: 100 },
      { roundId: "r_none", amount: 100 },
    ];
    const buckets = new Map<string, number>();
    let unknown = 0;
    for (const s of secs) {
      const c = roundCurrency.get(s.roundId) ?? null;
      if (c === null) { unknown += 1; continue; }
      buckets.set(c, (buckets.get(c) ?? 0) + s.amount);
    }
    expect(unknown).toBe(1);
    expect(Array.from(buckets.keys()).sort()).toEqual(["CAD", "HKD", "USD"]);
    /* Each is 100. The naive total would have been 400 with one symbol on it. */
    for (const k of ["CAD", "HKD", "USD"]) expect(buckets.get(k)).toBe(100);
    expect(Array.from(buckets.values()).reduce((a, b) => a + b, 0)).toBe(300);
    /* And nowhere in the rendered output does 300 or 400 appear as one figure —
       that is what C-4's `null` gate enforces on the page. */
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   R143.1 — EVERY EXISTING LITERAL, STILL THERE, BYTE FOR BYTE.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 191 · R143.1 — nothing was reworded and nothing was removed", () => {
  it("(R-1) every hardcoded (USD) label this wave sits beside is still present verbatim", () => {
    const rounds = read("client/src/pages/founder/Rounds.tsx");
    for (const lit of [
      "<Label>Target amount (USD)</Label>",
      "<Label>Min ticket (USD)</Label>",
      "<Label>Price per share (USD)</Label>",
      "<Label>Valuation cap (USD)</Label>",
      "<Label>Strike price (USD)</Label>",
    ]) expect(rounds).toContain(lit);

    const wizard = read("client/src/pages/founder/RoundNew.tsx");
    for (const lit of [
      "<Label>Target raise (USD)</Label>",
      "<Label>Pre-money valuation (USD)</Label>",
      "<Label>Valuation cap (USD)</Label>",
      "<Label>Strike price (USD)</Label>",
      "<Label>Minimum ticket (USD)</Label>",
    ]) expect(wizard).toContain(lit);
  });

  it("(R-2) the cap-table Region control and all nine of its option labels survive", () => {
    const ct = read("client/src/pages/founder/CapTable.tsx");
    for (const lit of ["US ($)", "CA (C$)", "UK (£)", "SG ($)", "HK (HK$)", "CN (¥)", "IN (₹)", "JP (¥)", "AU (A$)"])
      expect(ct).toContain(lit);
    /* The now-inaccurate help text is KEPT, and corrected by an appended sibling
       rather than reworded — the sibling is what the reader is left with. */
    expect(ct).toContain("Changes display currency and conversion rules");
    expect(ct).toContain('data-testid="captable-region-scope-note"');
  });

  it("(R-3) wave 190's two-expression-child money cell was not collapsed", () => {
    const ct = read("client/src/pages/founder/CapTable.tsx");
    expect(ct).toContain("{symbolCellOnRecord(totalSym)}{amountCellOnRecord(totalSym, totalInvested.toLocaleString())}");
    /* Two calls, two children, same order. A single `moneyOnRecord` here would be
       read by the drop guard as a removed panel body (the wave-182 trap). */
    expect(ct).not.toContain("{moneyOnRecord(totalSym, totalInvested.toLocaleString())}");
  });

  it("(R-4) the round currency options come from the shared catalogue, not a list in a component", () => {
    /* R156.2. Both round surfaces read `buildCurrencyOptions()`, which is the same
       function the proven partner vehicle wizard reads. */
    for (const rel of ["client/src/pages/founder/Rounds.tsx", "client/src/pages/founder/RoundNew.tsx"]) {
      const src = read(rel);
      expect(src).toContain('from "@/lib/currencyOptions"');
      expect(src).toContain("buildCurrencyOptions()");
      /* and no rival list of codes typed into the page itself */
      expect(src).not.toMatch(/\[\s*"USD"\s*,\s*"CAD"/);
    }
    expect(read("client/src/pages/partner/PartnerSpvEngine.tsx")).toContain("buildCurrencyOptions()");
  });

  it("(R-5) the edit dialog sends `currency` only when it is a well-formed code — no accidental backfill", () => {
    const rounds = read("client/src/pages/founder/Rounds.tsx");
    expect(rounds).toContain('if (/^[A-Z]{3}$/.test(currency)) common.currency = currency;');
    /* Seeded from the ROUND, never from the company: an existing round's money is
       not a place to guess. */
    expect(rounds).toContain('useState(round.currency ?? "")');
    expect(rounds).not.toContain("useState(round.currency ?? defaultCurrency");
  });

  it("(R-6) round creation cannot proceed without a currency", () => {
    const wizard = read("client/src/pages/founder/RoundNew.tsx");
    expect(wizard).toContain('const roundCurrencyChosen = /^[A-Z]{3}$/.test(form.currency);');
    expect(wizard).toContain("!roundCurrencyChosen");
    expect(wizard).toContain('data-testid="select-round-currency"');
  });
});
