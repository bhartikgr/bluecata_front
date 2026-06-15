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

  it("defaults the price-per-share input to the derived value and read-only, with an opt-in manual override (v23.9 C1 / BUG-038)", () => {
    // v23.9 C1 (BUG-038): the PPS input is auto-derived AND read-only BY
    // DEFAULT, but the founder can opt into manual entry via the
    // `pricePerShareOverridden` flag. When NOT overridden it shows the derived
    // value and stays read-only (preserving Avi's v23.4.9 auto-calc feedback);
    // when overridden it becomes editable and bound to form.pricePerShare.
    const ppsBlock = ROUND_NEW.slice(
      ROUND_NEW.indexOf('data-testid="pps-block"'),
      ROUND_NEW.indexOf('data-testid="btn-pps-override"') + 60,
    );
    // Value falls back to the derived value when not overridden.
    expect(ppsBlock).toMatch(/derivedPricePerShare/);
    // Read-only is now gated on the override flag rather than hardcoded.
    expect(ppsBlock).toMatch(/readOnly=\{!pricePerShareOverridden\}/);
    // An explicit override affordance exists.
    expect(ppsBlock).toMatch(/data-testid="btn-pps-override"/);
    // The auto-derivation effect respects the override flag.
    expect(ROUND_NEW).toMatch(/if \(pricePerShareOverridden\) return;/);
  });

  it("explains the auto-calculation in the field tooltip", () => {
    expect(ROUND_NEW).toMatch(/Calculated automatically/);
    expect(ROUND_NEW).toMatch(/pre-money valuation ÷ shares authorized/);
  });
});
