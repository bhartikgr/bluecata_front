/**
 * v23.4.9 Phase 1 (Avi feedback #2) — Share price auto-calculation in RoundNew.
 *
 * Avi (30 May 2026): "the share price has to be entered manually, whereas it
 * should be calculated automatically based on the value."
 *
 * Vitest config in this tree only globs `.test.ts` (no jsdom), so we do
 * source-grep style assertions like the v23.4.7 / v23.4.8 client phase tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUND_NEW = readFileSync(
  resolve(__dirname, "..", "RoundNew.tsx"),
  "utf8",
);

describe("v23.4.9 Phase 1 — share price is derived & read-only for priced rounds", () => {
  it("removes the hardcoded '1.42' mock default from the form state", () => {
    // The pricePerShare default must no longer be the mock "1.42".
    expect(ROUND_NEW).not.toMatch(/pricePerShare:\s*"1\.42"/);
    // It should now start empty.
    expect(ROUND_NEW).toMatch(/pricePerShare:\s*""/);
  });

  it("computes a derived price-per-share for priced instruments", () => {
    expect(ROUND_NEW).toMatch(/isPricedInstrument/);
    expect(ROUND_NEW).toMatch(/derivedPricePerShare/);
    // Derivation is pre-money divided by shares (auto-calc based on the value).
    expect(ROUND_NEW).toMatch(/pre\s*\/\s*shares/);
  });

  it("renders the price-per-share input as read-only and bound to the derived value", () => {
    // The PPS input must be read-only and show the derived value, not allow
    // free manual entry for priced rounds.
    const ppsBlock = ROUND_NEW.slice(
      ROUND_NEW.indexOf('data-testid="pps-block"'),
      ROUND_NEW.indexOf('data-testid="input-pps"') + 200,
    );
    expect(ppsBlock).toMatch(/value=\{derivedPricePerShare\}/);
    expect(ppsBlock).toMatch(/readOnly/);
  });

  it("explains the auto-calculation in the field tooltip", () => {
    expect(ROUND_NEW).toMatch(/Calculated automatically/);
    expect(ROUND_NEW).toMatch(/pre-money valuation ÷ shares authorized/);
  });
});
