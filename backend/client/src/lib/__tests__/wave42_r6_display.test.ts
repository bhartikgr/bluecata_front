/**
 * WAVE 42 · OWNER RULING R6 — the shared honest-refusal display helpers.
 *
 *   > "Go with your recommendation. Apply it everywhere as this seems to be an
 *   >  investor grade best practice globally."      — the owner, 2026-08-13
 *
 * R6: any money value, percentage or count that has NEVER BEEN ENTERED renders
 * an explicit refusal. A GENUINE ZERO renders 0 and MEANS it.
 *
 * ── WHY EVERY SINGLE CASE HERE IS ASSERTED TWICE ──────────────────────────
 * This file is written against a specific, named failure mode of the fix
 * itself, not just against the original bug:
 *
 *   A helper that returned "Not provided" for `0` as well as for `null` would
 *   pass a one-pole test suite perfectly. It would also be a WORSE defect than
 *   the one R6 corrects, because it would make a deliberate zero UNSAYABLE —
 *   a company with genuinely 0 directors on file, a round with a genuinely $0
 *   minimum ticket, an SPV with a genuinely 0% carry could no longer state
 *   those facts, and the platform would be lying in the opposite direction.
 *
 * So for every function: POLE A (unknown -> refusal) and POLE B (real zero ->
 * "0") are asserted side by side, and a third assertion states that the two
 * outputs are NOT EQUAL to each other. That last one is the actual ruling: the
 * two states must be distinguishable on screen.
 *
 * ── MONEY: ISO 4217 EXPONENTS, AND THE JPY FIXTURE ────────────────────────
 * Every money case is repeated for THREE exponent classes, because a hardcoded
 * `/ 100` is correct for exactly one of them and this codebase has been bitten
 * by that before:
 *
 *     JPY  exponent 0   ¥1234    (a `/100` understates by 100x)
 *     USD  exponent 2   $12.34
 *     BHD  exponent 3   BD1.234  (a `/100` overstates by 10x)
 *
 * The brief requires a JPY fixture in every money test for a concrete reason:
 * NO JPY DATA EXISTS ON THE LIVE PLATFORM, so this test file is the only place
 * the exponent-0 branch ever executes. If it is not asserted here it is not
 * asserted anywhere, and the first Japanese SPV would be the test.
 *
 * ── PERCENT: OWNER RULING R16, WHICH CORRECTS AN EARLIER BRIEF ────────────
 * PERCENT IS AS-WRITTEN. `1` is 1%. `100` is 100%. NO CONVERSION ANYWHERE.
 * An earlier brief stated this rule backwards; R16 is the binding correction.
 * The assertions below are deliberately chosen to FAIL LOUDLY if anyone ever
 * adds a `* 100` or a `/ 100` to the percent path: `pctOrNotProvided(1)` must
 * be "1.0%" — under a fraction interpretation it would be "100.0%", and under
 * a divide-by-100 interpretation "0.0%". Both wrong answers are excluded.
 *
 * A RATIO IS NOT A PERCENT. LTV/CAC of `3` means 3x, never 300%.
 */
import { describe, it, expect } from "vitest";
import {
  NOT_PROVIDED,
  NOT_REPORTED,
  isUnknownNumber,
  moneyOrNotProvided,
  moneyMajorOrNotProvided,
  pctOrNotProvided,
  ratioOrNotProvided,
  countOrNotProvided,
  formatMinorOrUnavailable,
} from "../moneyDisplay";
import { currencyExponent } from "../currency";

/** The three exponent classes. A money rule that is only tested at exponent 2
 *  is a money rule that is only tested for the United States. */
const EXPONENT_FIXTURES = [
  { cur: "JPY", exp: 0, note: "Japanese yen — NO minor unit. The `/100` trap." },
  { cur: "USD", exp: 2, note: "the only case a hardcoded /100 gets right" },
  { cur: "BHD", exp: 3, note: "Bahraini dinar — 1000 fils. The other `/100` trap." },
] as const;

/** Every value that means "nobody ever entered this". */
const UNKNOWNS = [null, undefined, NaN, Infinity, -Infinity, ""] as const;

/* ══════════════════════════════════════════════════════════════════════════
   THE VOCABULARY ITSELF. Pinned, because the 2026-08-13 live audit found the
   honest-refusal wording existed in the SPV/NAV/K-1 code and had NEVER been
   applied to founder surfaces — the string drifting is how that happens.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 — the refusal vocabulary is one vocabulary", () => {
  it("NOT_PROVIDED is exactly 'Not provided'", () => {
    expect(NOT_PROVIDED).toBe("Not provided");
  });

  it("NOT_REPORTED is exactly 'Not reported'", () => {
    expect(NOT_REPORTED).toBe("Not reported");
  });

  it("neither refusal string contains a zero, a currency symbol, or a bare dash", () => {
    /* R6 rejects "$0", "0.00%", "0" AND a blank. An em-dash is a blank with
       extra steps: it tells the reader nothing about WHY there is no number. */
    for (const s of [NOT_PROVIDED, NOT_REPORTED]) {
      expect(s).not.toMatch(/0/);
      expect(s).not.toMatch(/[$¥€£]/);
      expect(s.trim()).not.toBe("—");
      expect(s.trim().length).toBeGreaterThan(3);
    }
  });

  it("the refusal is re-exported from moneyDisplay and identical to wave4Display's, not a second spelling", async () => {
    const wave4 = await import("../wave4Display");
    expect(NOT_PROVIDED).toBe(wave4.NOT_PROVIDED);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   isUnknownNumber — the single predicate the whole ruling rests on.
   If it ever answers `true` for 0, every helper below silently breaks pole B.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 — isUnknownNumber: 0 IS NOT UNKNOWN", () => {
  it("POLE A — every never-entered value is unknown", () => {
    for (const u of UNKNOWNS) {
      expect(isUnknownNumber(u), `${String(u)} must count as unknown`).toBe(true);
    }
  });

  it("POLE B — zero, negative zero, and a negative number are all KNOWN", () => {
    expect(isUnknownNumber(0), "0 is a NUMBER, not an absence — this is the ruling").toBe(false);
    expect(isUnknownNumber(-0)).toBe(false);
    expect(isUnknownNumber(0.0)).toBe(false);
    /* a negative valuation is nonsense but it is not UNKNOWN; refusing it here
       would hide a real data problem behind a politeness string */
    expect(isUnknownNumber(-5)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   MONEY — MINOR UNITS. Both poles, all three exponent classes.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 — moneyOrNotProvided (minor units)", () => {
  for (const { cur, exp, note } of EXPONENT_FIXTURES) {
    describe(`${cur} (exponent ${exp}) — ${note}`, () => {
      it("the exponent fixture is real, not an assumption", () => {
        /* If currencyExponent disagreed with this table the tests below would
           be asserting the wrong thing while passing. */
        expect(currencyExponent(cur)).toBe(exp);
      });

      it("POLE A — a never-entered amount renders the refusal, never a zero amount", () => {
        for (const u of UNKNOWNS) {
          const out = moneyOrNotProvided(u as number | null | undefined, cur);
          expect(out).toBe(NOT_PROVIDED);
          expect(out).not.toMatch(/0/);
        }
      });

      it("POLE B — a genuine zero renders as money and CONTAINS a 0", () => {
        const out = moneyOrNotProvided(0, cur);
        expect(out).not.toBe(NOT_PROVIDED);
        expect(out, "a real zero must be visibly a zero amount").toMatch(/0/);
      });

      it("POLE A and POLE B are DIFFERENT STRINGS — the two states are distinguishable", () => {
        expect(moneyOrNotProvided(null, cur)).not.toBe(moneyOrNotProvided(0, cur));
      });

      it("a real non-zero amount is formatted at this currency's own precision, with no /100", () => {
        /* 1234 minor units. The whole point: the SAME integer means a different
           amount of money in each currency, and only the exponent knows. */
        const out = moneyOrNotProvided(1234, cur, { locale: "en-US" });
        const digits = (out.match(/\.(\d+)/) ?? [, ""])[1] as string;
        expect(
          digits.length,
          `${cur} must render exactly ${exp} fraction digits; a hardcoded /100 ` +
          `would render 2 for every currency and misstate ${cur}`,
        ).toBe(exp);
      });

      it("JPY/BHD are NOT relabelled as USD", () => {
        const out = moneyOrNotProvided(1234, cur, { locale: "en-US" });
        if (cur !== "USD") expect(out).not.toMatch(/^\$/);
      });
    });
  }

  it("an amount with NO KNOWN CURRENCY refuses rather than guessing a denomination", () => {
    /* Picking USD for an unknown denomination is the same class of lie as
       picking 0 for an unknown amount (Wave 21, Review A). */
    expect(moneyOrNotProvided(1234, null)).toBe(NOT_PROVIDED);
    expect(moneyOrNotProvided(1234, "")).toBe(NOT_PROVIDED);
    /* ...and this holds even for a REAL ZERO: "0 of what?" has no honest answer */
    expect(moneyOrNotProvided(0, null)).toBe(NOT_PROVIDED);
  });

  it("does not disturb the pre-existing Wave 21 helper it delegates to", () => {
    /* formatMinorOrUnavailable still defaults to the em-dash for its existing
       ~15 call sites. R6 changes the DEFAULT ONLY for the new R6 entry points,
       so this is an additive change and no existing screen silently changes. */
    expect(formatMinorOrUnavailable(null, "USD")).toBe("—");
    expect(formatMinorOrUnavailable(0, "JPY", { locale: "en-US" })).toMatch(/0/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   MONEY — MAJOR UNITS. This is the path that fixes live-audit F-4, because
   rounds.pre_money / post_money / min_ticket are legacy MAJOR-unit columns.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 — moneyMajorOrNotProvided (F-4: the pre/post-money card)", () => {
  it("POLE A — an unset pre-money renders 'Not provided', NOT '$0'", () => {
    for (const u of UNKNOWNS) {
      expect(moneyMajorOrNotProvided(u as number | null | undefined, "USD")).toBe(NOT_PROVIDED);
    }
    /* the exact string the live audit found on screen must be impossible here */
    expect(moneyMajorOrNotProvided(null, "USD")).not.toBe("$0");
    expect(moneyMajorOrNotProvided(null, "USD", { compact: true })).not.toBe("$0");
  });

  it("POLE B — a deliberately-entered $0 min ticket still renders as zero dollars", () => {
    const out = moneyMajorOrNotProvided(0, "USD", { locale: "en-US" });
    expect(out).toMatch(/0/);
    expect(out).not.toBe(NOT_PROVIDED);
  });

  it("POLE A vs POLE B are distinguishable, compact and standard notation alike", () => {
    for (const compact of [false, true]) {
      expect(moneyMajorOrNotProvided(null, "USD", { compact })).not.toBe(
        moneyMajorOrNotProvided(0, "USD", { compact }),
      );
    }
  });

  it("performs NO unit conversion — a stored 8_000_000 is eight million, not eighty thousand", () => {
    /* If this path ever acquired a `/ 100` to reuse the minor-unit formatter, an
       $8M pre-money would render as $80,000 and every valuation on the platform
       would be understated 100x. That is a bigger lie than F-4. */
    const out = moneyMajorOrNotProvided(8_000_000, "USD", { locale: "en-US" });
    expect(out).toMatch(/8[,.]0{0,3}/);
    expect(out).not.toMatch(/80,000\.00$/);
    const compact = moneyMajorOrNotProvided(8_000_000, "USD", { locale: "en-US", compact: true });
    expect(compact).toMatch(/8/);
    expect(compact).toMatch(/M/);
  });

  it("JPY fixture — an exponent-0 major amount gets no fraction digits", () => {
    const out = moneyMajorOrNotProvided(1234, "JPY", { locale: "en-US" });
    expect(out).not.toMatch(/\.\d/);
    expect(out).toMatch(/1,?234/);
  });

  it("BHD fixture — an exponent-3 major amount gets three fraction digits", () => {
    const out = moneyMajorOrNotProvided(1.5, "BHD", { locale: "en-US" });
    expect((out.match(/\.(\d+)/) ?? [, ""])[1]).toHaveLength(3);
  });

  it("R5 — a CAD round is denominated CAD, and an absent currency does not crash", () => {
    const cad = moneyMajorOrNotProvided(1_000_000, "CAD", { locale: "en-US" });
    expect(cad).toMatch(/CA|CAD/);
    /* currency unknown + amount known: falls back to USD formatting rather than
       throwing, because the amount IS known and hiding it would lose data. This
       is a documented, deliberate asymmetry with the minor-unit path above,
       where the caller has an explicit currency column to supply. */
    expect(moneyMajorOrNotProvided(5, null)).not.toBe(NOT_PROVIDED);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PERCENT — OWNER RULING R16. AS-WRITTEN. NO CONVERSION.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 + R16 — pctOrNotProvided is AS-WRITTEN", () => {
  it("POLE A — an unmeasured score renders the refusal, not '0%'", () => {
    for (const u of UNKNOWNS) {
      expect(pctOrNotProvided(u as number | null | undefined)).toBe(NOT_PROVIDED);
    }
    /* the exact strings the live audit found on founder surfaces */
    expect(pctOrNotProvided(null)).not.toBe("0%");
    expect(pctOrNotProvided(null)).not.toBe("0.0%");
    expect(pctOrNotProvided(null, 2)).not.toBe("0.00%");
  });

  it("POLE B — a genuine 0% ownership renders '0.0%' and means zero percent", () => {
    expect(pctOrNotProvided(0)).toBe("0.0%");
    expect(pctOrNotProvided(0, 2)).toBe("0.00%");
    expect(pctOrNotProvided(0)).not.toBe(NOT_PROVIDED);
  });

  it("POLE A and POLE B are distinguishable", () => {
    expect(pctOrNotProvided(null)).not.toBe(pctOrNotProvided(0));
  });

  it("R16 — 1 is ONE PERCENT. Not 100%. Not 0.01%.", () => {
    expect(pctOrNotProvided(1)).toBe("1.0%");
    expect(pctOrNotProvided(1)).not.toBe("100.0%"); /* the fraction misreading */
    expect(pctOrNotProvided(1)).not.toBe("0.0%");   /* the divide-by-100 misreading */
  });

  it("R16 — 100 is ONE HUNDRED PERCENT. Not 10000%.", () => {
    expect(pctOrNotProvided(100)).toBe("100.0%");
    expect(pctOrNotProvided(100)).not.toBe("10000.0%");
  });

  it("R16 — a realistic ownership figure round-trips exactly", () => {
    expect(pctOrNotProvided(41)).toBe("41.0%");
    expect(pctOrNotProvided(0.5, 2)).toBe("0.50%"); /* half a percent stays half a percent */
    expect(pctOrNotProvided(12.5, 1)).toBe("12.5%");
  });

  it("a stored 4250 is SURFACED AS WRITTEN, never silently reinterpreted as 42.5%", () => {
    /* R16: "A stored 4250 is ambiguous — surface it, never silently
       reinterpret." Guessing basis points here would quietly rewrite data. */
    expect(pctOrNotProvided(4250)).toBe("4250.0%");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   RATIO — a multiple, NOT a percent.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 + R16 — ratioOrNotProvided renders a multiple", () => {
  it("POLE A — an uncomputed ratio refuses", () => {
    expect(ratioOrNotProvided(null)).toBe(NOT_PROVIDED);
    expect(ratioOrNotProvided(undefined)).toBe(NOT_PROVIDED);
  });

  it("POLE B — a genuine 0 ratio renders '0.0×'", () => {
    expect(ratioOrNotProvided(0)).toBe("0.0\u00d7");
    expect(ratioOrNotProvided(0)).not.toBe(NOT_PROVIDED);
  });

  it("R16 — an LTV/CAC of 3 is 3×, and is NEVER rendered as 300%", () => {
    const out = ratioOrNotProvided(3);
    expect(out).toBe("3.0\u00d7");
    expect(out).not.toMatch(/%/);
    expect(out).not.toMatch(/300/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   COUNT — "0 directors" and "we have not been told" are different sentences.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 — countOrNotProvided", () => {
  it("POLE A — an unknown director count refuses, it does not claim zero directors", () => {
    for (const u of UNKNOWNS) {
      expect(countOrNotProvided(u as number | null | undefined)).toBe(NOT_PROVIDED);
    }
    expect(countOrNotProvided(null)).not.toBe("0");
  });

  it("POLE B — a company that genuinely has 0 directors on file can SAY 0", () => {
    expect(countOrNotProvided(0)).toBe("0");
    expect(countOrNotProvided(0)).not.toBe(NOT_PROVIDED);
  });

  it("POLE A and POLE B are distinguishable — this is the entire ruling in one line", () => {
    expect(countOrNotProvided(null)).not.toBe(countOrNotProvided(0));
  });

  it("a real count is grouped and never given fraction digits", () => {
    expect(countOrNotProvided(1234)).toBe("1,234");
    expect(countOrNotProvided(15)).toBe("15");
    /* 15-20 active rounds, per the live audit's founder cap-table observation */
    expect(countOrNotProvided(20)).toBe("20");
  });

  it("a caller may override the refusal with the other honest wording", () => {
    expect(countOrNotProvided(null, { placeholder: NOT_REPORTED })).toBe("Not reported");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE ANTI-OVERREACH TEST. Read this one first if the suite ever goes red.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 42 · R6 — the fix must not become a worse bug", () => {
  it("NO helper maps a genuine zero to a refusal string", () => {
    /* If a future edit made any of these refuse on 0, R6 would have destroyed
       the platform's ability to state a real zero — a regression strictly worse
       than the "$0 pre-money" defect it was written to fix. */
    const zeroOutputs = [
      moneyOrNotProvided(0, "USD"),
      moneyOrNotProvided(0, "JPY"),
      moneyOrNotProvided(0, "BHD"),
      moneyMajorOrNotProvided(0, "USD"),
      moneyMajorOrNotProvided(0, "JPY"),
      pctOrNotProvided(0),
      ratioOrNotProvided(0),
      countOrNotProvided(0),
    ];
    for (const out of zeroOutputs) {
      expect(out).not.toBe(NOT_PROVIDED);
      expect(out).not.toBe(NOT_REPORTED);
      expect(out, `a real zero must render a visible 0, got ${JSON.stringify(out)}`).toMatch(/0/);
    }
  });

  it("NO helper maps a never-entered value to anything containing a digit", () => {
    const unknownOutputs = [
      moneyOrNotProvided(null, "USD"),
      moneyOrNotProvided(undefined, "JPY"),
      moneyMajorOrNotProvided(null, "USD"),
      moneyMajorOrNotProvided(NaN, "BHD"),
      pctOrNotProvided(null),
      ratioOrNotProvided(null),
      countOrNotProvided(null),
    ];
    for (const out of unknownOutputs) {
      expect(out, `an unknown must not render any digit, got ${JSON.stringify(out)}`).not.toMatch(/\d/);
    }
  });
});
