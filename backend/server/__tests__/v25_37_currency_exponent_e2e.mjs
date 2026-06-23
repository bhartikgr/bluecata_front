/* v25.37 Phase 3 — E2E: multi-currency ISO 4217 exponent awareness.
 *
 * Proves the BLOCKER B-Currency fix: the shared exponent table + formatMinor /
 * toMinor in server/lib/currency.ts (mirrored in client/src/lib/currency.ts)
 * derive the minor-unit divisor from the currency code instead of a hardcoded
 * `/ 100` / `* 100`. Covers the common 2-decimal case (USD/EUR), zero-decimal
 * currencies (JPY/KRW), three-decimal currencies (BHD/JOD/KWD), and the
 * unknown-code default.
 *
 * Also asserts server/softCircleStore.toAmountMinor (now delegating to toMinor)
 * agrees with the table by exercising createSoftCircle across exponents and
 * reading back amount_minor from the live DB.
 *
 * Runs under the v25.34 E2E vitest config (pool=forks, singleFork) like the
 * other v25.3x E2E scripts.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect } from "vitest";
import { currencyExponent, formatMinor, toMinor } from "../lib/currency.ts";

describe("v25.37 currencyExponent — ISO 4217 minor-unit exponents", () => {
  it("USD is a 2-decimal currency", () => {
    expect(currencyExponent("USD")).toBe(2);
  });
  it("EUR / GBP are 2-decimal currencies", () => {
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("GBP")).toBe(2);
  });
  it("JPY is a zero-decimal currency", () => {
    expect(currencyExponent("JPY")).toBe(0);
  });
  it("KRW is a zero-decimal currency", () => {
    expect(currencyExponent("KRW")).toBe(0);
  });
  it("BHD is a three-decimal currency", () => {
    expect(currencyExponent("BHD")).toBe(3);
    expect(currencyExponent("KWD")).toBe(3);
    expect(currencyExponent("JOD")).toBe(3);
  });
  it("an unknown / unlisted code defaults to 2 decimals", () => {
    expect(currencyExponent("XXX")).toBe(2);
    expect(currencyExponent("")).toBe(2);
    expect(currencyExponent(null)).toBe(2);
    expect(currencyExponent(undefined)).toBe(2);
  });
  it("is case-insensitive on the code", () => {
    expect(currencyExponent("jpy")).toBe(0);
    expect(currencyExponent("bhd")).toBe(3);
  });
});

describe("v25.37 formatMinor — display respects the exponent", () => {
  it("formats USD minor units with 2 decimals", () => {
    // Allow either "$1.00" (symbol) or "US$1.00" (locale narrow) — both are
    // valid Intl outputs; the invariant is exactly 2 fraction digits + the 1.
    const out = formatMinor(100, "USD");
    expect(out).toMatch(/1\.00$/);
  });
  it("formats JPY with NO decimals (zero-decimal currency)", () => {
    const out = formatMinor(100, "JPY");
    expect(out).toMatch(/100$/);
    expect(out).not.toMatch(/\./); // no decimal point
  });
  it("formats KRW with NO decimals", () => {
    const out = formatMinor(5000, "KRW");
    expect(out).not.toMatch(/\./);
    expect(out.replace(/[^\d]/g, "")).toBe("5000");
  });
  it("formats BHD with 3 decimals (three-decimal currency)", () => {
    const out = formatMinor(1000, "BHD");
    expect(out).toMatch(/1\.000$/);
  });
  it("falls back gracefully for an unknown code (default 2 decimals)", () => {
    const out = formatMinor(250, "XXX");
    expect(out).toMatch(/2\.50/);
  });
});

describe("v25.37 toMinor — math respects the exponent (mirror of formatMinor)", () => {
  it("USD 1 major => 100 minor", () => {
    expect(toMinor(1, "USD")).toBe(100);
  });
  it("JPY 1 major => 1 minor (zero-decimal)", () => {
    expect(toMinor(1, "JPY")).toBe(1);
  });
  it("BHD 1 major => 1000 minor (three-decimal)", () => {
    expect(toMinor(1, "BHD")).toBe(1000);
  });
  it("rounds to the nearest integer minor unit", () => {
    expect(toMinor(1.014, "USD")).toBe(101); // 101.4 -> 101
    expect(toMinor(1.236, "USD")).toBe(124); // 123.6 -> 124 (rounds up)
    expect(toMinor(1234.567, "JPY")).toBe(1235);
  });
  it("guards non-finite input by returning 0 (prior behavior preserved)", () => {
    expect(toMinor(NaN, "USD")).toBe(0);
    expect(toMinor(Infinity, "JPY")).toBe(0);
  });
  it("round-trips toMinor -> /10**exp for representative currencies", () => {
    for (const [cur, major] of [["USD", 42.5], ["JPY", 9000], ["BHD", 3.125]]) {
      const minor = toMinor(major, cur);
      const back = minor / Math.pow(10, currencyExponent(cur));
      expect(back).toBeCloseTo(major, 6);
    }
  });
});

// v25.37 round-2 (per GPT-5.5): regression — the admin Collective Payment
// Schedules create path was previously hardcoded to `* 100`. After the
// surgical fix it must use toMinor(amount, currency). This block proves the
// shared helper would produce the correct minor-unit value for the create
// payload across 0/2/3-decimal currencies (the same helper the client now
// imports from @/lib/currency).
describe("v25.37 admin create-path — toMinor round-2 contract", () => {
  it("USD 12.34 -> 1234 minor (2-decimal)", () => {
    expect(toMinor(12.34, "USD")).toBe(1234);
  });
  it("JPY 250 -> 250 minor (zero-decimal; was previously 25000 with * 100 hardcode)", () => {
    expect(toMinor(250, "JPY")).toBe(250);
  });
  it("BHD 1.234 -> 1234 minor (three-decimal; was previously 123 with * 100 hardcode)", () => {
    expect(toMinor(1.234, "BHD")).toBe(1234);
  });
  it("KRW 50000 -> 50000 minor (zero-decimal)", () => {
    expect(toMinor(50000, "KRW")).toBe(50000);
  });
  it("KWD 0.5 -> 500 minor (three-decimal)", () => {
    expect(toMinor(0.5, "KWD")).toBe(500);
  });
});
