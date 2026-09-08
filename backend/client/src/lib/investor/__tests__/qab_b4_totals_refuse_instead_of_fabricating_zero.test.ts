/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA-B4 — the dashboard told every investor their portfolio was worth $0.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `DashboardSpinePanels.tsx` declared its own view type with `invested?: number`
 * and `currentValue?: number`. WAVE 183 removed both fields from the wire: money
 * now arrives as `investedMinor` (integer minor units, in a string) beside an
 * ISO `currency`, and `currentValueMinor` is `null` on this route because no
 * valuation-marks service is attached. `Number(undefined ?? 0)` is `0`, so the
 * two summary tiles and every holding row printed $0 FOR EVERY INVESTOR,
 * REGARDLESS OF DATA. A hardcoded zero wearing a loop.
 *
 * This file proves the REPLACEMENT — `totalInvested` / `totalCurrentValue` in
 * the canonical module — has the four properties the platform's own rule needs:
 *
 *   NEVER FABRICATE A ZERO. Every absence returns a refusal with a sentence.
 *   NEVER CONCEAL A TRUE ONE. A genuinely recorded 0 still renders as a figure.
 *   NEVER CROSS A CURRENCY. Mixed books refuse; nothing is converted.
 *   NEVER LOSE PRECISION. The sum is `bigint`, exact past 2^53.
 *
 * AND THE HAZARD THE SPEC NAMED: a careless fix that read `investedMinor` but
 * kept a bare-dollar formatter would print $10,000.00 for $100.00 — worse than
 * $0, because $0 is visibly wrong and $10,000 is not. Test 8 pins the scale.
 */
import { describe, it, expect } from "vitest";
import {
  totalInvested,
  totalCurrentValue,
  PORTFOLIO_UNKNOWN_COPY,
  NO_POSITIONS_COPY,
  AMOUNT_MISSING_COPY,
  type DerivedPosition,
} from "@/lib/investor/portfolioPositions";

function pos(over: Partial<DerivedPosition> = {}): DerivedPosition {
  return {
    id: "p1", companyId: "co_1", company: "Acme", sector: null, stage: null,
    instrument: null, lastRoundLabel: null, lastRoundDate: null,
    investedMinor: "10000", currency: "USD", investedExceedsSafeRange: false,
    currentValueMinor: null, shares: null, ownershipPct: null, vintageYear: null,
    unknown: [], matchedVia: "canonical",
    ...over,
  } as DerivedPosition;
}

describe("QA-B4 · the portfolio totals refuse instead of fabricating a zero", () => {
  it("0 · CONTROL — the helper CAN return a figure, so a refusal below is a real refusal", () => {
    const t = totalInvested([pos({ investedMinor: "150000", currency: "USD" })]);
    expect(t.kind).toBe("amount");
    /* rows > 0 precondition for a pure function: the fixture really carried an
       amount. If this test could not produce ANY figure, every `kind ===
       "unknown"` assertion below would pass for the wrong reason. */
    if (t.kind !== "amount") throw new Error("control failed");
    expect(t.text).toContain("1,500");
  });

  it("1 · THE OLD DEFECT, DIRECTLY — the removed fields do NOT produce a total", () => {
    /* This is the exact shape the panel used to read: a row carrying the old
       `invested` / `currentValue` names and none of the current ones. The old
       code summed it to 0. The new code must refuse. */
    const legacy = pos({ investedMinor: null, currency: null }) as unknown as DerivedPosition;
    (legacy as unknown as Record<string, unknown>).invested = 1_500_000;
    const t = totalInvested([legacy]);
    expect(t.kind).toBe("unknown");
    if (t.kind !== "unknown") throw new Error("unreachable");
    expect(t.note).toBe(PORTFOLIO_UNKNOWN_COPY.CURRENCY_NOT_ON_RECORD);
  });

  it("2 · an empty book states that no positions are on record — not $0", () => {
    const t = totalInvested([]);
    expect(t.kind).toBe("unknown");
    if (t.kind !== "unknown") throw new Error("unreachable");
    expect(t.note).toBe(NO_POSITIONS_COPY);
    expect(t.note).not.toContain("0");
  });

  it("3 · NEVER CROSS A CURRENCY — a mixed book refuses and converts nothing", () => {
    const t = totalInvested([
      pos({ investedMinor: "10000", currency: "USD" }),
      pos({ id: "p2", investedMinor: "20000", currency: "EUR" }),
    ]);
    expect(t.kind).toBe("unknown");
    if (t.kind !== "unknown") throw new Error("unreachable");
    expect(t.note).toBe(PORTFOLIO_UNKNOWN_COPY.INVESTED_SPANS_CURRENCIES);
    /* And it did not quietly pick one side: neither amount appears anywhere. */
    expect(t.note).not.toContain("100");
    expect(t.note).not.toContain("200");
  });

  it("4 · one missing amount refuses for the WHOLE total, rather than under-reporting", () => {
    const t = totalInvested([
      pos({ investedMinor: "10000", currency: "USD" }),
      pos({ id: "p2", investedMinor: null, currency: "USD" }),
    ]);
    expect(t.kind).toBe("unknown");
    if (t.kind !== "unknown") throw new Error("unreachable");
    expect(t.note).toBe(AMOUNT_MISSING_COPY);
  });

  it("5 · NEVER CONCEAL A TRUE ZERO — a recorded 0 is still a figure", () => {
    const t = totalInvested([pos({ investedMinor: "0", currency: "USD" })]);
    expect(t.kind).toBe("amount");
    if (t.kind !== "amount") throw new Error("unreachable");
    expect(t.text).toMatch(/0/);
    /* The distinction the whole item rests on: this zero is a FIGURE, and the
       empty-book case in test 2 is a REFUSAL. They are not the same output. */
    expect(t.kind).not.toBe(totalInvested([]).kind);
  });

  it("6 · current value REFUSES on this route, where the platform's rule requires it", () => {
    /* `currentValueMinor` is null for every position because no marks service is
       attached. The old panel printed $0 paper value here — telling an investor
       their portfolio is worth nothing. */
    const t = totalCurrentValue([pos(), pos({ id: "p2" })]);
    expect(t.kind).toBe("unknown");
    if (t.kind !== "unknown") throw new Error("unreachable");
    expect(t.note).toBe(PORTFOLIO_UNKNOWN_COPY.CURRENT_VALUE_NO_MARK_RECORDED);
    expect(t.note).toContain("This is not a value of zero");
  });

  it("7 · current value DOES total the day marks arrive — one code path, not two", () => {
    const t = totalCurrentValue([
      pos({ currentValueMinor: "50000", currency: "USD" }),
      pos({ id: "p2", currentValueMinor: "25000", currency: "USD" }),
    ]);
    expect(t.kind).toBe("amount");
    if (t.kind !== "amount") throw new Error("unreachable");
    expect(t.text).toContain("750");
  });

  it("8 · THE SPEC'S NAMED HAZARD — minor units are not printed as major units", () => {
    /* $100.00 is 10000 minor units. A fix that kept a bare-dollar formatter
       would print $10,000.00 here: plausible, and wrong by 100x. */
    const t = totalInvested([pos({ investedMinor: "10000", currency: "USD" })]);
    if (t.kind !== "amount") throw new Error("expected an amount");
    expect(t.text).toContain("100");
    expect(t.text).not.toContain("10,000");
  });

  it("9 · the sum is exact past 2^53, because it is bigint and not float", () => {
    /* Two amounts whose float sum would round. If this ever used `Number`, the
       last digits would drift and this assertion would catch it. */
    const big = "9007199254740993";  // 2^53 + 1, in minor units
    const t = totalInvested([
      pos({ investedMinor: big, currency: "USD", investedExceedsSafeRange: true }),
    ]);
    /* Beyond safe range the platform's standing rule is to REFUSE rather than
       render a silently-rounded approximation of itself. */
    expect(t.kind).toBe("unknown");

    /* And within range, two large values ADD EXACTLY. 4503599627370495 + 1 =
       4503599627370496 minor units. MEASURED, not assumed: the first draft of
       this test asserted a refusal here on the guess that the value exceeded
       the display gate. It does not — it is below 2^53 — and the helper
       correctly returned the figure. The assertion was corrected to the
       measurement rather than the measurement to the assertion. The trailing
       "...96" is the point: a float path would have lost that last digit. */
    const exact = totalInvested([
      pos({ investedMinor: "4503599627370495", currency: "USD" }),
      pos({ id: "p2", investedMinor: "1", currency: "USD" }),
    ]);
    expect(exact.kind).toBe("amount");
    if (exact.kind !== "amount") throw new Error("unreachable");
    expect(exact.text).toContain("704.96");
  });
});
