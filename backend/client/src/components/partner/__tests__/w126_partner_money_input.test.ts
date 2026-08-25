/**
 * WAVE 126 / FINDING 2 — the whole-currency-unit money entry contract.
 *
 * These assertions fail before the wave because `partnerMoneyInput.ts` did not
 * exist: every partner money field asked the client for the currency's smallest
 * unit, so "5000000" meant $50,000.00 and there was no code path that turned a
 * typed five million into five million.
 */
import { describe, it, expect } from "vitest";
import {
  parseWholeUnits,
  formatWholeUnits,
  wholeUnitsEcho,
  wholeUnitsLabel,
  wholeUnitsLabelNoCurrency,
  wholeUnitsPlaceholder,
  toWireMinor,
  isImplausiblyLarge,
} from "../partnerMoneyInput";

describe("W126 F2 — whole currency units in, exact minor units out", () => {
  it("reads five million dollars as five million dollars, not fifty thousand", () => {
    const r = parseWholeUnits("5000000", "USD", { label: "Commitment" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    /* THE 100x DEFECT. Before this wave the same keystrokes produced 5000000
       minor units = $50,000.00. */
    expect(r.minor).toBe(BigInt("500000000"));
    expect(r.formatted).toBe("5,000,000.00 USD");
  });

  it("accepts the amount written the way a person writes it", () => {
    for (const typed of ["5000000", "5,000,000", "5,000,000.00", "$5,000,000.00", "USD 5,000,000"]) {
      const r = parseWholeUnits(typed, "USD");
      expect(r.ok, typed).toBe(true);
      if (r.ok) expect(r.minor, typed).toBe(BigInt("500000000"));
    }
  });

  it("keeps exact cents", () => {
    const r = parseWholeUnits("1234.56", "USD");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.minor).toBe(BigInt("123456"));
  });

  it("carries a figure beyond IEEE-754 integer precision without losing a unit", () => {
    /* 2^53 - 1 minor units is 90,071,992,547,409.91 USD. One more unit than
       that cannot be represented as a double, so this is the assertion that
       proves no float touched the value. */
    const r = parseWholeUnits("90071992547409.92", "USD");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.minor).toBe(BigInt("9007199254740992"));
    expect(toWireMinor(r.minor)).toBe("9007199254740992");
    expect(formatWholeUnits(r.minor, "USD")).toBe("90,071,992,547,409.92 USD");
  });

  it("refuses a negative amount with a sentence", () => {
    const r = parseWholeUnits("-5000", "USD", { label: "Commitment" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/cannot be negative/i);
    expect(r.message).toMatch(/\.$/);
  });

  it("refuses zero with a sentence unless zero is meaningful for the field", () => {
    const r = parseWholeUnits("0", "USD", { label: "Commitment" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/greater than zero/i);
    expect(parseWholeUnits("0", "USD", { allowZero: true }).ok).toBe(true);
  });

  it("refuses more decimal places than the currency has, rather than rounding", () => {
    const r = parseWholeUnits("100.005", "USD", { label: "Gross proceeds" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/2 decimal places/);
      expect(r.message).toMatch(/not rounded/i);
    }
  });

  it("refuses any decimal point for a zero-exponent currency", () => {
    const r = parseWholeUnits("1500.5", "JPY", { label: "Amount" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no fractional unit/i);
    const ok = parseWholeUnits("1500", "JPY");
    expect(ok.ok).toBe(true);
    /* A yen has no minor unit: 1500 yen is 1500 minor units, NOT 150000. */
    if (ok.ok) expect(ok.minor).toBe(BigInt("1500"));
  });

  it("refuses scientific notation and free text with a sentence", () => {
    for (const bad of ["1e7", "five million", "1.2.3", "--5", ""]) {
      const r = parseWholeUnits(bad, "USD", { label: "Amount" });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.message.length, bad).toBeGreaterThan(10);
    }
  });

  it("never asks for cents, minor units or the storage model in a label", () => {
    const strings = [
      wholeUnitsLabel("Commitment", "USD"),
      wholeUnitsLabelNoCurrency("Minimum check"),
      wholeUnitsPlaceholder("USD"),
      wholeUnitsPlaceholder("JPY"),
    ];
    for (const s of strings) {
      expect(s, s).not.toMatch(/cent|pence|minor unit|smallest unit|billionth/i);
    }
    expect(wholeUnitsLabel("Commitment", "USD")).toBe("Commitment (USD)");
  });

  it("echoes a formatted confirmation so a mistyped magnitude is visible before submit", () => {
    expect(wholeUnitsEcho("5000000", "USD")).toBe("5,000,000.00 USD");
    expect(wholeUnitsEcho("-5000", "USD")).toBeNull();
    expect(wholeUnitsEcho("abc", "USD")).toBeNull();
  });

  it("confirms rather than blocks an implausibly large amount", () => {
    const big = parseWholeUnits("999999999999", "USD");
    expect(big.ok).toBe(true);
    if (!big.ok) return;
    /* Accepted — there is no defensible universal ceiling on a commitment. */
    expect(isImplausiblyLarge(big.minor, "USD")).toBe(true);
    const normal = parseWholeUnits("5000000", "USD");
    if (normal.ok) expect(isImplausiblyLarge(normal.minor, "USD")).toBe(false);
  });
});
