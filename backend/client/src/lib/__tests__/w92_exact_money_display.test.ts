/**
 * WAVE 92 · OPEN ITEM J-1 — THE DISPLAY LAYER FOR EXACT-DECIMAL MONEY.
 * ════════════════════════════════════════════════════════════════════════════
 * J-1 was opened by Wave 75: a founder's exit proceeds rendered as
 * `3333333333.3333335`, because one third of $100,000,000 is a NON-TERMINATING
 * decimal and no IEEE-754 double is that value. R72 answered it — carry the money
 * as exact decimal TEXT — and Wave 77 did the server half. The other half, in
 * R72's own words, was that *any rounding belongs at a display layer, once, with
 * the convention stated*, and `W77-M4` pinned that no screen may read the field
 * until that decision is made. Wave 92 built the screen, so the convention was
 * decided in the same step (R83.1).
 *
 * THE THREE RULES UNDER TEST:
 *   1. the wire stays exact; only the screen rounds;
 *   2. a single figure rounds HALF-UP at the currency's smallest unit;
 *   3. a column that must add up rounds by LARGEST REMAINDER, so the displayed
 *      rows sum to the displayed total EXACTLY.
 *
 * AND THE FENCE: no `Number()`, `parseFloat`, `parseInt`, `Math.round` or
 * `.toFixed()` on money, anywhere (R72 condition 4). `W77-M4` polices that as
 * source text on this file and on the screen; the assertions here police the
 * BEHAVIOUR, which is the half a text scan cannot see.
 *
 * WHY THE FIGURES BELOW ARE THE FIGURES. Every long decimal in this file is a real
 * response value from `build_log/wave92/transcripts/01_pinned_route_bodies.json`,
 * produced over live HTTP by `server/__tests__/w92_exit_waterfall_screen.test.ts`.
 * Nothing here was typed from memory: this project has shipped a $2,222,222 error
 * and a waterfall that added up perfectly for the wrong exit value.
 */
import { describe, it, expect } from "vitest";
import {
  EXACT_MONEY_UNAVAILABLE,
  displayIsRounded,
  displayRowsSummingTo,
  formatExactFactorAsPercent,
  formatExactMinor,
  isExactDecimalText,
  majorTextToExactMinor,
} from "../exactMoney";

describe("W92 · J-1 — a single figure, rounded once, half-up", () => {
  it("W92-M-01 · a terminating figure renders exactly, with no rounding note", () => {
    /* Wave 94's corrected founder figure: 2,400,000,000 minor units. */
    expect(formatExactMinor("2400000000")).toBe("24,000,000.00");
    expect(displayIsRounded("2400000000")).toBe(false);
    /* The pre-flight's thrice-confirmed `S6` result. */
    expect(formatExactMinor("2000000000")).toBe("20,000,000.00");
    expect(formatExactMinor("1000000000")).toBe("10,000,000.00");
    /* Wave 91's pari passu split. */
    expect(formatExactMinor("600000000")).toBe("6,000,000.00");
    expect(formatExactMinor("300000000")).toBe("3,000,000.00");
    expect(formatExactMinor("450000000")).toBe("4,500,000.00");
  });

  it("W92-M-02 · ZERO IS A FIGURE, and it is not the same as an absent one", () => {
    /* Wave 91 · Item 3: a holder paid nothing must be SHOWN receiving nothing.
       If `"0"` rendered as the unavailable marker the screen would recreate the
       very defect it exists to expose. */
    expect(formatExactMinor("0")).toBe("0.00");
    expect(formatExactMinor("0")).not.toBe(EXACT_MONEY_UNAVAILABLE);
    /* And an absent figure is NEVER a zero we do not have (R6). */
    expect(formatExactMinor(null)).toBe(EXACT_MONEY_UNAVAILABLE);
    expect(formatExactMinor(undefined)).toBe(EXACT_MONEY_UNAVAILABLE);
    expect(formatExactMinor("")).toBe(EXACT_MONEY_UNAVAILABLE);
    /* Not a number, not a guess. A screen that guesses about money is how this
       project shipped a $2,222,222 error. */
    expect(formatExactMinor("1e9")).toBe(EXACT_MONEY_UNAVAILABLE);
    expect(formatExactMinor("1,000")).toBe(EXACT_MONEY_UNAVAILABLE);
    expect(formatExactMinor("$100")).toBe(EXACT_MONEY_UNAVAILABLE);
    expect(formatExactMinor(2400000000)).toBe(EXACT_MONEY_UNAVAILABLE);
  });

  it("W92-M-03 · the non-terminating figures round HALF-UP and disclose that they were rounded", () => {
    /* The route's own pre-Wave-94 figure for the founders on the headline cap
       table: 2,342,857,142.857… minor units. Half-up at the cent. */
    expect(formatExactMinor("2342857142.8571428571428571428571428571")).toBe("23,428,571.43");
    expect(displayIsRounded("2342857142.8571428571428571428571428571")).toBe(true);
    /* Wave 94's `W94-CAP-04` fixture, from `W92-PIN-05`. */
    expect(formatExactMinor("2711111111.1111111111111111111111111111")).toBe("27,111,111.11");
    expect(formatExactMinor("538888888.88888888888888888888888888889")).toBe("5,388,888.89");
    /* The boundary: exactly one half rounds UP, away from zero. */
    expect(formatExactMinor("100.5")).toBe("1.01");
    expect(formatExactMinor("100.4999999999999999999999999")).toBe("1.00");
    expect(formatExactMinor("-100.5")).toBe("-1.01");
  });

  it("W92-M-04 · precision far beyond a double survives, because nothing is narrowed", () => {
    /* 38 significant digits. `Number("…")` would destroy this at the 17th, which is
       the entire reason J-1 exists. */
    const huge = "99999999999999999999999999999999999999";
    expect(formatExactMinor(huge)).toBe("999,999,999,999,999,999,999,999,999,999,999,999.99");
    /* And beyond any `Number` at all. */
    expect(formatExactMinor("123456789012345678901234567890123456789012")).toContain(
      "1,234,567,890,123,456,789,012,345,678,901,234,567,890.12",
    );
  });

  it("W92-M-05 · a currency with no minor unit is not divided by 100", () => {
    /* JPY has exponent 0. `minor / 100` \u2014 the idiom this module replaces \u2014
       misstates JPY by 100x, which Wave 21 already had to fix once. */
    expect(formatExactMinor("2000000", { exponent: 0 })).toBe("2,000,000");
    /* And an exponent-3 currency prints three places. */
    expect(formatExactMinor("2000000", { exponent: 3 })).toBe("2,000.000");
  });
});

describe("W92 · J-1 — a column that must add up, by largest remainder", () => {
  it("W92-M-06 · THE DEFECT THIS RULE EXISTS FOR: three thirds under one total", () => {
    /* One third of $10,000,000 three times. Rounded independently each row is
       3,333,333.33 and the column shows 9,999,999.99 under a 10,000,000.00
       heading \u2014 which is how a founder concludes the platform cannot add up. */
    const third = "333333333.33333333333333333333333333333";
    const independently = [third, third, third].map((v) => formatExactMinor(v));
    expect(independently).toEqual(["3,333,333.33", "3,333,333.33", "3,333,333.33"]);

    const d = displayRowsSummingTo(
      [third, third, "333333333.33333333333333333333333333334"],
      "1000000000",
    );
    expect(d.reconciles).toBe(true);
    /* The leftover cent goes to the row with the largest discarded fraction, and
       no row moves by more than one cent. */
    expect(d.rows).toEqual(["3,333,333.33", "3,333,333.33", "3,333,333.34"]);
  });

  it("W92-M-07 · a terminating column is untouched and still reconciles", () => {
    /* `W92-PIN-04`: A 2,200,000,000 + B 1,000,000,000 = lpProceeds 3,200,000,000. */
    const d = displayRowsSummingTo(["2200000000", "1000000000"], "3200000000");
    expect(d.reconciles).toBe(true);
    expect(d.rows).toEqual(["22,000,000.00", "10,000,000.00"]);
  });

  it("W92-M-08 · a $0 row keeps its place and its zero in a reconciling column", () => {
    /* Wave 91 \u00b7 Item 3, in the display layer: the founders' $0 row must survive
       largest-remainder allocation as a $0 row, in position. */
    const d = displayRowsSummingTo(["600000000", "300000000", "0"], "900000000");
    expect(d.reconciles).toBe(true);
    expect(d.rows).toEqual(["6,000,000.00", "3,000,000.00", "0.00"]);
  });

  it("W92-M-09 · rows that DO NOT sum to the total are reported, never adjusted", () => {
    /* A display layer must never paper over an arithmetic disagreement. If the
       exact figures disagree, that is a FINDING, and the screen's conservation line
       is where it is reported. */
    const d = displayRowsSummingTo(["100", "100"], "300");
    expect(d.reconciles).toBe(false);
    expect(d.rows).toEqual(["1.00", "1.00"]);
    /* An unreadable row is likewise reported rather than guessed at. */
    const bad = displayRowsSummingTo(["100", null], "200");
    expect(bad.reconciles).toBe(false);
    expect(bad.rows).toEqual(["1.00", EXACT_MONEY_UNAVAILABLE]);
  });

  it("W92-M-10 · an empty column against a zero total reconciles trivially, with no division by zero", () => {
    const d = displayRowsSummingTo([], "0");
    expect(d.reconciles).toBe(true);
    expect(d.rows).toEqual([]);
  });
});

describe("W92 · J-1 — the input boundary and the abatement percentage", () => {
  it("W92-M-11 · a typed sale price becomes minor units by SHIFTING TEXT, not by multiplying a float", () => {
    /* `0.07 * 100` is `7.000000000000001` in IEEE-754. That is a money defect in a
       single expression, and it is why this conversion is textual. */
    expect(majorTextToExactMinor("50000000")).toBe("5000000000");
    expect(majorTextToExactMinor("50,000,000")).toBe("5000000000");
    expect(majorTextToExactMinor("$50,000,000")).toBe("5000000000");
    expect(majorTextToExactMinor("50000000.50")).toBe("5000000050");
    expect(majorTextToExactMinor("0.07")).toBe("7");
    expect(majorTextToExactMinor("0")).toBe("0");
    /* Wave 94's headline exit and Wave 91's short exit. */
    expect(majorTextToExactMinor("56000000")).toBe("5600000000");
    expect(majorTextToExactMinor("9000000")).toBe("900000000");
    expect(majorTextToExactMinor("14999999.99")).toBe("1499999999");
  });

  it("W92-M-12 · anything that is not a plain amount is REFUSED, not coerced", () => {
    expect(majorTextToExactMinor("")).toBeNull();
    expect(majorTextToExactMinor("abc")).toBeNull();
    expect(majorTextToExactMinor("-1000")).toBeNull();
    expect(majorTextToExactMinor("1e9")).toBeNull();
    /* MORE PRECISION THAN THE CURRENCY HAS IS A TYPO, NOT A VALUE. Silently
       discarding the third decimal a founder typed would change their sale price
       without telling them. */
    expect(majorTextToExactMinor("100.005")).toBeNull();
    expect(majorTextToExactMinor("100.5", { exponent: 0 })).toBeNull();
  });

  it("W92-M-13 · an abatement factor renders as the percentage an investor can check", () => {
    /* `W92-PIN-02`: 9,000,000 / 15,000,000 = 0.6, shown as 60%. An investor asked
       to accept 60% of what they are owed is entitled to read that as 60%. */
    expect(formatExactFactorAsPercent("0.6")).toEqual({ text: "60%", truncated: false });
    expect(formatExactFactorAsPercent("1")).toEqual({ text: "100%", truncated: false });
    expect(formatExactFactorAsPercent("0.45")).toEqual({ text: "45%", truncated: false });
    /* A non-terminating factor is SHORTENED AND SAID TO BE SHORTENED, so the screen
       can print the exact value beside it. */
    const nonTerminating = formatExactFactorAsPercent("0.58823529411764705882352941176470588235");
    expect(nonTerminating.truncated).toBe(true);
    expect(nonTerminating.text).toBe("58.8235%");
    /* And 60% is never printed for something that is not 60%. */
    expect(formatExactFactorAsPercent("0.599999").text).not.toBe("60%");
  });

  it("W92-M-14 · the shape test accepts what the engine emits and nothing else", () => {
    expect(isExactDecimalText("0")).toBe(true);
    expect(isExactDecimalText("2400000000")).toBe(true);
    expect(isExactDecimalText("-1e-29")).toBe(false);
    expect(isExactDecimalText("2,400")).toBe(false);
    expect(isExactDecimalText(0)).toBe(false);
  });
});
