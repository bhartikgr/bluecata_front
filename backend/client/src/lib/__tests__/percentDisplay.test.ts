/**
 * WAVE 3A (spec items P-1 / P-3) — percentage ROUND-TRIP tests.
 *
 * The binding owner's ruling for this wave:
 *   STORAGE stays FRACTIONAL. ADMIN INPUT is percent-as-written. The DISPLAY
 *   was the defect (renders omitted the ×100). No migration, no storage change.
 *
 * The contract these tests pin, end to end:
 *   type 100  → store 1.0   → display "100%"
 *   type 30   → store 0.3   → display "30%"
 *   type 12.5 → store 0.125 → display "12.5%"
 *
 * Plain `.test.ts` (no JSX / React) → excluded from the tsc budget.
 */
import { describe, it, expect } from "vitest";
import {
  formatFractionAsPercent,
  formatPercentValue,
  fractionToPercentInput,
  parsePercentInputToFraction,
} from "../percentDisplay";

/** The admin round trip, as one function: what the owner types → what the DB
 *  holds → what the screen renders. */
function roundTrip(typed: string): { stored: number; displayed: string } {
  const parsed = parsePercentInputToFraction(typed);
  if (!parsed.ok) throw new Error(`expected "${typed}" to parse: ${parsed.error}`);
  return { stored: parsed.fraction, displayed: formatFractionAsPercent(parsed.fraction) };
}

describe("WAVE 3A — admin percent round trip (type → store → display)", () => {
  it("type 100 → store 1.0 → display \"100%\"", () => {
    const rt = roundTrip("100");
    expect(rt.stored).toBe(1.0);
    expect(rt.displayed).toBe("100%");
  });

  it("type 30 → store 0.3 → display \"30%\"", () => {
    const rt = roundTrip("30");
    expect(rt.stored).toBe(0.3);
    expect(rt.displayed).toBe("30%");
  });

  it("type 12.5 → store 0.125 → display \"12.5%\"", () => {
    const rt = roundTrip("12.5");
    expect(rt.stored).toBe(0.125);
    expect(rt.displayed).toBe("12.5%");
  });

  it("round-trips the live-verified codes exactly as the owner ruled", () => {
    // VIP = 1 genuinely IS 100% off on the $840 annual SKU.
    expect(formatFractionAsPercent(1)).toBe("100%");
    // YC2025 = 0.3 genuinely IS 30%.
    expect(formatFractionAsPercent(0.3)).toBe("30%");
    // The legacy carrier codes, which the page's own copy always said were
    // 10 / 20 / 5 while the table printed 0.1 / 0.2 / 0.05.
    expect(formatFractionAsPercent(0.1)).toBe("10%");
    expect(formatFractionAsPercent(0.2)).toBe("20%");
    expect(formatFractionAsPercent(0.05)).toBe("5%");
  });

  it("survives repeated store→input→store cycles without drifting", () => {
    for (const typed of ["100", "30", "12.5", "0", "2", "6", "0.5", "99.99"]) {
      let fraction = parsePercentInputToFraction(typed);
      expect(fraction.ok).toBe(true);
      if (!fraction.ok) return;
      const first = fraction.fraction;
      for (let i = 0; i < 5; i++) {
        const reseeded = fractionToPercentInput(first);
        const again = parsePercentInputToFraction(reseeded);
        expect(again.ok).toBe(true);
        if (!again.ok) return;
        expect(again.fraction).toBe(first);
      }
      expect(fractionToPercentInput(first)).toBe(String(Number(typed)));
    }
  });
});

describe("WAVE 3A — formatFractionAsPercent (the missing ×100)", () => {
  it("scales a stored fraction into percent units", () => {
    expect(formatFractionAsPercent(0.02)).toBe("2%");
    expect(formatFractionAsPercent(0.06)).toBe("6%");
    expect(formatFractionAsPercent(0.125)).toBe("12.5%");
  });

  it("kills binary-float dust (0.14 * 100 === 14.000000000000002)", () => {
    // The raw arithmetic a naive inline `* 100` produces.
    expect(0.14 * 100).not.toBe(14);
    expect(0.29 * 100).not.toBe(29);
    expect(0.07 * 100).not.toBe(7);
    expect(0.575 * 100).not.toBe(57.5);
    // The helper rounds onto the 4-decimal percent grid instead.
    expect(formatFractionAsPercent(0.14)).toBe("14%");
    expect(formatFractionAsPercent(0.29)).toBe("29%");
    expect(formatFractionAsPercent(0.07)).toBe("7%");
    expect(formatFractionAsPercent(0.575)).toBe("57.5%");
    expect(formatFractionAsPercent(0.3)).toBe("30%");
    // Seeding an admin input must not show "14.000000000000002" either — that
    // is what PartnerDetail.tsx:242's String(pct * 100) used to emit.
    expect(String(0.14 * 100)).toBe("14.000000000000002");
    expect(fractionToPercentInput(0.14)).toBe("14");
    expect(fractionToPercentInput(0.29)).toBe("29");
  });

  it("honours a fixed digit count for the commission-roster style", () => {
    expect(formatFractionAsPercent(0.02, { digits: 2 })).toBe("2.00%");
    expect(formatFractionAsPercent(0.06, { digits: 2 })).toBe("6.00%");
  });

  it("renders a fallback for null / undefined / non-numeric, never \"NaN%\"", () => {
    expect(formatFractionAsPercent(null)).toBe("—");
    expect(formatFractionAsPercent(undefined)).toBe("—");
    expect(formatFractionAsPercent("")).toBe("—");
    expect(formatFractionAsPercent("abc")).toBe("—");
    expect(formatFractionAsPercent(null, { fallback: "tier default" })).toBe("tier default");
  });

  it("renders a genuine zero as 0%, not as the fallback", () => {
    expect(formatFractionAsPercent(0)).toBe("0%");
  });
});

describe("WAVE 3A — DOUBLE-CONVERSION GUARD", () => {
  /* A double ×100 charges a partner 100× the intended amount; a missing one
     charges 1/100×. These pin the two helpers apart so a future call site
     cannot quietly pick the wrong one. */
  it("formatPercentValue does NOT scale — it is for values already in percent", () => {
    expect(formatPercentValue(30)).toBe("30%");
    expect(formatPercentValue(100)).toBe("100%");
    expect(formatPercentValue(2, { digits: 2 })).toBe("2.00%");
  });

  it("applying the fraction formatter twice is visibly wrong, by construction", () => {
    const once = formatFractionAsPercent(0.3, { suffix: false }); // "30"
    expect(once).toBe("30");
    // If someone fed that back through the fraction formatter they would get
    // 3000% — the failure mode this test exists to make loud.
    expect(formatFractionAsPercent(Number(once))).toBe("3000%");
  });

  it("parse then format is the identity on percent units", () => {
    for (const typed of ["0", "1", "2", "12.5", "30", "99", "100"]) {
      const p = parsePercentInputToFraction(typed);
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      expect(formatFractionAsPercent(p.fraction)).toBe(`${Number(typed)}%`);
    }
  });
});

describe("WAVE 3A — parsePercentInputToFraction validation", () => {
  it("accepts the inclusive 0–100 range", () => {
    expect(parsePercentInputToFraction("0")).toEqual({ ok: true, percent: 0, fraction: 0 });
    expect(parsePercentInputToFraction("100")).toEqual({ ok: true, percent: 100, fraction: 1 });
  });

  it("rejects out-of-range and non-numeric input rather than storing it", () => {
    expect(parsePercentInputToFraction("101").ok).toBe(false);
    expect(parsePercentInputToFraction("-1").ok).toBe(false);
    expect(parsePercentInputToFraction("abc").ok).toBe(false);
    expect(parsePercentInputToFraction("").ok).toBe(false);
    expect(parsePercentInputToFraction(null).ok).toBe(false);
  });

  it("tolerates surrounding whitespace the way a typed field produces it", () => {
    const p = parsePercentInputToFraction("  12.5  ");
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.fraction).toBe(0.125);
  });

  it("names the convention in its error message so the admin is not guessing", () => {
    const p = parsePercentInputToFraction("250", { label: "Commission" });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error).toContain("Commission");
      expect(p.error).toContain("percent as written");
    }
  });

  it("supports a narrower band for call sites that need one", () => {
    expect(parsePercentInputToFraction("50", { maxPercent: 20 }).ok).toBe(false);
    expect(parsePercentInputToFraction("10", { maxPercent: 20 }).ok).toBe(true);
  });
});

describe("WAVE 3A — fractionToPercentInput (seeding an admin field)", () => {
  it("seeds percent-as-written from fractional storage", () => {
    expect(fractionToPercentInput(1)).toBe("100");
    expect(fractionToPercentInput(0.3)).toBe("30");
    expect(fractionToPercentInput(0.125)).toBe("12.5");
    expect(fractionToPercentInput(0)).toBe("0");
  });

  it("returns \"\" for null so a blank field means \"no override\", not \"0%\"", () => {
    expect(fractionToPercentInput(null)).toBe("");
    expect(fractionToPercentInput(undefined)).toBe("");
  });
});

describe("WAVE 3A — sites deliberately NOT changed keep working", () => {
  /* `partner_commission_rate_config.rate` is EXEMPT from any storage
     conversion (00_SHARED_STANDARDS.md:39). Its display was already correct
     via an inline `(r.rate * 100).toFixed(2)`; this asserts the shared helper
     agrees with that existing render, so adopting it later can never shift a
     live number. */
  it("the shared helper reproduces the already-correct commission-rate render", () => {
    for (const rate of [0.02, 0.03, 0.04, 0.05, 0.06]) {
      expect(formatFractionAsPercent(rate, { digits: 2 })).toBe(`${(rate * 100).toFixed(2)}%`);
    }
  });
});
