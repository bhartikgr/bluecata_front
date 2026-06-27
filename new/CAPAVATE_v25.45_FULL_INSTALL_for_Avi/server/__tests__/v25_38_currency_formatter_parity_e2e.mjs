/* v25.38 Phase 3 — E2E: currency formatter parity (UI look & feel guard).
 *
 * The bulk sweep migrated ~16 client surfaces from inline
 *   new Intl.NumberFormat(..., { style: "currency", currency }).format(minor / 100)
 * to the shared `formatMinor(minor, currency)`. The CRITICAL rule is: do NOT
 * change the UI for 2-decimal currencies (USD/EUR/GBP/CAD must render
 * IDENTICALLY). This suite proves byte-for-byte parity for the 2-decimal case
 * and correct fraction-digit behavior for zero-decimal (JPY/KRW) and
 * three-decimal (BHD) currencies.
 *
 * Tests the shared server lib (server/lib/currency.ts), which mirrors the
 * client lib (client/src/lib/currency.ts) verbatim. Server-side vitest is fine
 * per the brief.
 *
 * Runs under the v25.34 E2E vitest config (pool=forks, singleFork).
 */
import { describe, it, expect } from "vitest";
import { formatMinor, currencyExponent, toMinor, fromMinor } from "../lib/currency.ts";

/** The PRE-sweep inline formatter the surfaces used: a plain currency-style
 * Intl format over `minor / 100`. For 2-decimal currencies Intl defaults
 * minimumFractionDigits to the currency's own exponent (2), so the output
 * equals our new formatMinor exactly.
 *
 * v25.38 round-2: most migrated surfaces used `new Intl.NumberFormat("en-US",
 * ...)` and a couple used `new Intl.NumberFormat(undefined, ...)`. The new
 * formatMinor defaults locale to undefined (runtime) so it's a drop-in for
 * the `undefined` callers without breaking the `"en-US"` callers (Node test
 * runtime locale is en-US). Test both with `undefined` and explicit `en-US`
 * to prove parity in both call shapes. */
function legacyInlineEnUS(minor, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}
function legacyInlineUndefined(minor, currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

const TWO_DECIMAL = ["USD", "EUR", "GBP", "CAD"];
const REPRESENTATIVE = [0, 100, 999_999, 1_000_000, 50_00, 250_000];

describe("v25.38 formatMinor parity — 2-decimal currencies (UI unchanged)", () => {
  for (const ccy of TWO_DECIMAL) {
    for (const minor of REPRESENTATIVE) {
      it(`${ccy} ${minor}: formatMinor(undefined locale) == legacy inline (undefined locale)`, () => {
        expect(formatMinor(minor, ccy)).toBe(legacyInlineUndefined(minor, ccy));
      });
      it(`${ccy} ${minor}: formatMinor(en-US) == legacy inline (en-US)`, () => {
        expect(formatMinor(minor, ccy, { locale: "en-US" })).toBe(legacyInlineEnUS(minor, ccy));
      });
    }
  }
});

describe("v25.38 formatMinor — exponent-aware fraction digits", () => {
  it("USD/EUR/GBP/CAD are 2-decimal", () => {
    for (const c of TWO_DECIMAL) expect(currencyExponent(c)).toBe(2);
  });

  it("JPY renders with NO fractional digits (zero-decimal)", () => {
    const out = formatMinor(5000, "JPY");
    expect(out).not.toMatch(/\./);
    expect(out.replace(/[^\d]/g, "")).toBe("5000");
  });

  it("KRW renders with NO fractional digits (zero-decimal)", () => {
    const out = formatMinor(12345, "KRW");
    expect(out).not.toMatch(/\./);
    expect(out.replace(/[^\d]/g, "")).toBe("12345");
  });

  it("BHD renders with 3 fractional digits (three-decimal)", () => {
    const out = formatMinor(1000, "BHD"); // 1000 minor / 10^3 = 1.000
    expect(out).toMatch(/1\.000$/);
    const frac = out.split(".")[1].replace(/[^\d]/g, "");
    expect(frac.length).toBe(3);
  });
});

// v25.38 round-2 regression scenarios (per Opus + GPT-5.5)
describe("v25.38 round-2: formatMinor locale parity + fromMinor/toMinor symmetry", () => {
  it("formatMinor with no opts uses runtime locale (matches legacy `new Intl.NumberFormat(undefined, ...)`)", () => {
    // Without opts.locale, formatMinor must use the runtime locale so it's a
    // drop-in replacement for the legacy `new Intl.NumberFormat(undefined, ...)`
    // call. (The legacy callers in Pricing.tsx and PricingModelDetail.tsx
    // explicitly passed `undefined`.) Verify by comparing to a direct Intl call
    // with the same `undefined` locale.
    const legacy = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.56);
    expect(formatMinor(123456, "USD")).toBe(legacy);
  });

  it("formatMinor honors caller's pinned locale when opts.locale provided", () => {
    expect(formatMinor(123456, "USD", { locale: "en-US" })).toContain("$1,234.56");
  });

  it("fromMinor/toMinor round-trip for USD is lossless", () => {
    expect(toMinor(fromMinor(1234, "USD"), "USD")).toBe(1234);
  });

  it("fromMinor/toMinor round-trip for JPY is lossless (was 100x-inflated in v25.38 round 1)", () => {
    // JPY exponent 0: 5000 minor units == 5000 yen
    // Round 1 bug: fromMinor(5000, "JPY") = 5000 -> parseToMinor *100 -> 500000 (wrong)
    // Round 2 fix: fromMinor(5000, "JPY") = 5000 -> toMinor(5000, "JPY") = 5000 (correct)
    expect(toMinor(fromMinor(5000, "JPY"), "JPY")).toBe(5000);
  });

  it("fromMinor/toMinor round-trip for BHD is lossless", () => {
    // BHD exponent 3: 1234 minor units == 1.234 BHD
    expect(toMinor(fromMinor(1234, "BHD"), "BHD")).toBe(1234);
  });

  it("fromMinor/toMinor round-trip for KRW is lossless", () => {
    expect(toMinor(fromMinor(50000, "KRW"), "KRW")).toBe(50000);
  });
});
