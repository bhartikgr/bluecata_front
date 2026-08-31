/**
 * WAVE 190 · ITEM A — A SYMBOL COMES FROM A CURRENCY, OR IT DOES NOT COME.
 *
 * These are the UNIT proofs on the decision layer that both founder surfaces now
 * read. The rendered-surface proofs live in the sibling DOM suites; this file
 * proves the rule itself, including the NEGATIVE CONTROL the brief requires: no
 * region value, for any region this platform supports, can produce a symbol.
 */
import { describe, it, expect } from "vitest";
import {
  symbolOnRecord,
  moneyOnRecord,
  symbolCellOnRecord,
  amountCellOnRecord,
  NO_CURRENCY_ON_RECORD_CELL,
  ROUND_CURRENCY_NOT_RECORDED_STATEMENT,
} from "../currencyOnRecordDisplay";
import { currencySymbolForCurrency, currencySymbol } from "../currency";

describe("WAVE 190 · Item A — currency, never region", () => {
  /* ── A-1: a real currency renders THAT currency ───────────────────────── */
  it("(A-1) a round with a real currency shows that currency's symbol", () => {
    expect(symbolOnRecord("CAD")).toBe("C$");
    expect(symbolOnRecord("HKD")).toBe("HK$");
    expect(symbolOnRecord("GBP")).toBe("£");
    expect(symbolOnRecord("EUR")).toBe("€");
    expect(symbolOnRecord("SGD")).toBe("S$");
    expect(symbolOnRecord("USD")).toBe("$");
  });

  /* ── A-2: NULL currency REFUSES; it does not become "$" ──────────────── */
  it("(A-2) a NULL currency refuses rather than showing a dollar sign", () => {
    for (const absent of [null, undefined, "", "   "]) {
      expect(symbolOnRecord(absent)).toBeNull();
      expect(moneyOnRecord(symbolOnRecord(absent), "1,200.00")).toBe(
        NO_CURRENCY_ON_RECORD_CELL,
      );
    }
    /* The refusal is never a `$`, never a blank, and never the bare number. */
    const rendered = moneyOnRecord(symbolOnRecord(null), "1,200.00");
    expect(rendered).not.toContain("$");
    expect(rendered.trim().length).toBeGreaterThan(0);
    expect(rendered).not.toContain("1,200.00");
  });

  /* ── A-3: THE NEGATIVE CONTROL — no region can produce a symbol ──────── */
  it("(A-3) NEGATIVE CONTROL: no region value can produce a currency symbol", () => {
    /* Every region token this platform recognises, plus the live-site case the
       owner reported: a British Virgin Islands vehicle that displayed CA$. */
    const REGIONS = [
      "US", "HK", "CA", "AU", "UK", "JP", "IN", "CN", "SG",
      "us", "hk", "ca", "British Virgin Islands", "british_virgin_islands",
      "canadian_lp", "delaware", "DE", "GB",
    ];
    for (const region of REGIONS) {
      expect(symbolOnRecord(region)).toBeNull();
    }
    /* And the same tokens through the code→glyph map directly: a two-letter
       region cannot satisfy `/^[A-Z]{3}$/`, and a phrase cannot either. */
    for (const region of REGIONS) {
      if (/^[A-Z]{3}$/.test(region)) continue;
      expect(currencySymbolForCurrency(region)).toBeNull();
    }
  });

  /* ── A-4: the OLD function still defaults to "$" — proving A-3 matters ── */
  it("(A-4) the region-based `currencySymbol` still returns `$` by default, which is why callers were moved off it", () => {
    /* NOT a defect in `currencySymbol` itself: it is a REGION→glyph map and it is
       honest about that. The defect was calling it with a region and presenting
       the answer as the vehicle's denomination. This assertion pins the behaviour
       that made the old call sites wrong, so a future wave cannot "fix" the wrong
       layer and think Item A is satisfied. */
    expect(currencySymbol("British Virgin Islands")).toBe("$");
    expect(currencySymbol("HK")).toBe("HK$");
  });

  /* ── A-5: three-letter unknowns are NAMED, not guessed ───────────────── */
  it("(A-5) an ISO code with no glyph on file prints the code rather than inventing a glyph", () => {
    const sym = symbolOnRecord("BRL");
    expect(sym).not.toBeNull();
    expect(sym).toContain("BRL");
    expect(sym).not.toBe("$");
  });

  /* ── A-6: the two-child table form says the same thing ───────────────── */
  it("(A-6) the two-child cell form renders identically to moneyOnRecord", () => {
    expect(symbolCellOnRecord("C$") + amountCellOnRecord("C$", "500")).toBe(
      moneyOnRecord("C$", "500"),
    );
    expect(symbolCellOnRecord(null) + amountCellOnRecord(null, "500")).toBe(
      moneyOnRecord(null, "500"),
    );
    /* And the refused form carries no digits from the amount. */
    expect(symbolCellOnRecord(null) + amountCellOnRecord(null, "500")).not.toContain("500");
  });

  /* ── A-7: no conversion, ever (R156.1) ───────────────────────────────── */
  it("(A-7) R156.1 — the amount string is passed through untouched; only the symbol changes", () => {
    const amount = "1,234,567.89";
    expect(moneyOnRecord("HK$", amount)).toBe(`HK$${amount}`);
    expect(moneyOnRecord("C$", amount)).toBe(`C$${amount}`);
    /* Same digits under both denominations — nothing was converted. */
    const a = moneyOnRecord("HK$", amount).replace("HK$", "");
    const b = moneyOnRecord("C$", amount).replace("C$", "");
    expect(a).toBe(b);
    expect(a).toBe(amount);
  });

  /* ── A-8: the long statement names the missing fact ──────────────────── */
  it("(A-8) the long refusal names the missing fact and does not print a symbol", () => {
    expect(ROUND_CURRENCY_NOT_RECORDED_STATEMENT).toContain("no currency recorded");
    expect(ROUND_CURRENCY_NOT_RECORDED_STATEMENT).not.toContain("$");
    expect(NO_CURRENCY_ON_RECORD_CELL).not.toContain("$");
  });
});
