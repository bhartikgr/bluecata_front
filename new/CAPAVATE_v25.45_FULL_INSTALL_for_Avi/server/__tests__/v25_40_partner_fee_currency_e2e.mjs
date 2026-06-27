/* v25.40 — E2E: PartnerFeeSchedules currency unit semantics (FIX-4 / sync P1 #4).
 *
 * Proves the v25.40 FIX-4 closure: the admin PartnerFeeSchedules create form
 * previously did `Math.round(parseFloat(amount) * 100)` for amount, sizeBandMin
 * and sizeBandMax. That hardcoded `* 100` divisor:
 *   - persisted 100x-too-LARGE amount_minor for 0-decimal currencies (JPY/KRW),
 *   - persisted 10x-too-SMALL amount_minor for 3-decimal currencies (BHD),
 * which then displayed via formatMinor as wrong prices. FIX-4 replaces the
 * hardcoded `* 100` with the shared ISO 4217-aware toMinor(amount, currency)
 * (the same fix CollectivePaymentSchedules already shipped in v25.37), and
 * uppercases the currency first.
 *
 * The client form's conversion is pure (no server round-trip needed): this
 * suite imports the shared currency helpers (server/lib/currency.ts — the exact
 * mirror of client/src/lib/currency.ts that PartnerFeeSchedules.tsx imports as
 * "@/lib/currency") and replicates the EXACT post-FIX-4 conversion the form
 * now performs, then asserts the minor-unit results are correct per exponent
 * and that round-tripping back through formatMinor reproduces the major amount.
 *
 * Runs under the v25.34 E2E vitest config like the other v25.3x E2E scripts.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect } from "vitest";
import { currencyExponent, formatMinor, toMinor } from "../lib/currency.ts";

/**
 * Faithful replica of the post-FIX-4 PartnerFeeSchedules.createMut conversion.
 * Mirrors client/src/pages/admin/PartnerFeeSchedules.tsx:
 *   const currency = (form.currency || "USD").trim().toUpperCase();
 *   const amountMajor = parseFloat(form.amountMajor || "0");
 *   const amountMinor = toMinor(amountMajor, currency);
 *   body.sizeBandMin = bandMin === null ? null : toMinor(bandMin, currency);
 *   body.sizeBandMax = bandMax === null ? null : toMinor(bandMax, currency);
 */
function buildFeeBody(form) {
  const currency = (form.currency || "USD").trim().toUpperCase();
  if (!currency) throw new Error("invalid_currency");
  const amountMajor = parseFloat(form.amountMajor || "0");
  if (!Number.isFinite(amountMajor) || amountMajor < 0) throw new Error("invalid_amount");
  const amountMinor = toMinor(amountMajor, currency);
  const body = { feeKind: form.feeKind, tier: form.tier || null, amountMinor, currency };
  if (form.feeKind === "spv_deployment") {
    const bandMin = form.sizeBandMinMajor ? parseFloat(form.sizeBandMinMajor) : null;
    const bandMax = form.sizeBandMaxMajor ? parseFloat(form.sizeBandMaxMajor) : null;
    if (bandMin !== null && (!Number.isFinite(bandMin) || bandMin < 0)) throw new Error("invalid_band_min");
    if (bandMax !== null && (!Number.isFinite(bandMax) || bandMax < 0)) throw new Error("invalid_band_max");
    body.sizeBandMin = bandMin === null ? null : toMinor(bandMin, currency);
    body.sizeBandMax = bandMax === null ? null : toMinor(bandMax, currency);
  }
  return body;
}

/* The OLD (pre-FIX-4) hardcoded conversion, kept here ONLY to prove the bug it
 * fixed: it produced wrong minor units for non-2-decimal currencies. */
function oldHardcoded(amountMajor) {
  return Math.round(parseFloat(amountMajor) * 100);
}

describe("v25.40 FIX-4 — PartnerFeeSchedules amount_minor honors ISO 4217 exponent", () => {
  it("USD (2-decimal): 49.99 → 4999 minor units", () => {
    const body = buildFeeBody({ feeKind: "subscription_monthly", amountMajor: "49.99", currency: "USD" });
    expect(body.amountMinor).toBe(4999);
    expect(body.currency).toBe("USD");
  });

  it("JPY (0-decimal): 5000 → 5000 minor units (NOT 500000)", () => {
    const body = buildFeeBody({ feeKind: "subscription_monthly", amountMajor: "5000", currency: "JPY" });
    expect(currencyExponent("JPY")).toBe(0);
    expect(body.amountMinor).toBe(5000);
    // The old hardcoded path was 100x too large — this is the bug FIX-4 closes.
    expect(oldHardcoded("5000")).toBe(500000);
    expect(body.amountMinor).not.toBe(oldHardcoded("5000"));
  });

  it("KRW (0-decimal): 12000 → 12000 minor units (NOT 1200000)", () => {
    const body = buildFeeBody({ feeKind: "subscription_annual", amountMajor: "12000", currency: "krw" });
    // currency is uppercased before conversion (FIX-4 + FIX-13).
    expect(body.currency).toBe("KRW");
    expect(currencyExponent("KRW")).toBe(0);
    expect(body.amountMinor).toBe(12000);
    expect(body.amountMinor).not.toBe(oldHardcoded("12000"));
  });

  it("BHD (3-decimal): 1.5 → 1500 minor units (NOT 150)", () => {
    const body = buildFeeBody({ feeKind: "subscription_monthly", amountMajor: "1.5", currency: "BHD" });
    expect(currencyExponent("BHD")).toBe(3);
    expect(body.amountMinor).toBe(1500);
    // The old hardcoded path was 10x too small for 3-decimal currencies.
    expect(oldHardcoded("1.5")).toBe(150);
    expect(body.amountMinor).not.toBe(oldHardcoded("1.5"));
  });

  it("amount_minor round-trips back through formatMinor to the major amount", () => {
    for (const [amt, cur] of [["49.99", "USD"], ["5000", "JPY"], ["1.5", "BHD"]]) {
      const body = buildFeeBody({ feeKind: "subscription_monthly", amountMajor: amt, currency: cur });
      const formatted = formatMinor(body.amountMinor, cur, { locale: "en-US" });
      // The numeric portion of the formatted string equals the original major amount.
      const numeric = parseFloat(formatted.replace(/[^0-9.]/g, ""));
      expect(numeric).toBeCloseTo(parseFloat(amt), 3);
    }
  });
});

describe("v25.40 FIX-4 — SPV deployment size bands use the same exponent-aware conversion", () => {
  it("JPY bands convert with exponent 0 (no 100x inflation)", () => {
    const body = buildFeeBody({
      feeKind: "spv_deployment",
      amountMajor: "200000",
      currency: "JPY",
      sizeBandMinMajor: "1000000",
      sizeBandMaxMajor: "5000000",
    });
    expect(body.amountMinor).toBe(200000);
    expect(body.sizeBandMin).toBe(1000000);
    expect(body.sizeBandMax).toBe(5000000);
  });

  it("USD bands convert with exponent 2", () => {
    const body = buildFeeBody({
      feeKind: "spv_deployment",
      amountMajor: "2500.00",
      currency: "USD",
      sizeBandMinMajor: "10000",
      sizeBandMaxMajor: "50000",
    });
    expect(body.amountMinor).toBe(250000);
    expect(body.sizeBandMin).toBe(1000000);
    expect(body.sizeBandMax).toBe(5000000);
  });

  it("omitted bands stay null (not coerced to 0)", () => {
    const body = buildFeeBody({ feeKind: "spv_deployment", amountMajor: "100", currency: "USD" });
    expect(body.sizeBandMin).toBe(null);
    expect(body.sizeBandMax).toBe(null);
  });
});

describe("v25.40 FIX-13 — currency input normalization on submit", () => {
  it("lowercase currency is uppercased before conversion", () => {
    const body = buildFeeBody({ feeKind: "subscription_monthly", amountMajor: "10", currency: "jpy" });
    expect(body.currency).toBe("JPY");
  });
  it("whitespace-padded currency is trimmed + uppercased", () => {
    const body = buildFeeBody({ feeKind: "subscription_monthly", amountMajor: "10", currency: "  usd  " });
    expect(body.currency).toBe("USD");
  });
  it("negative amount is rejected", () => {
    expect(() => buildFeeBody({ feeKind: "subscription_monthly", amountMajor: "-5", currency: "USD" })).toThrow();
  });
  it("non-numeric amount is rejected", () => {
    expect(() => buildFeeBody({ feeKind: "subscription_monthly", amountMajor: "abc", currency: "USD" })).toThrow();
  });
});
