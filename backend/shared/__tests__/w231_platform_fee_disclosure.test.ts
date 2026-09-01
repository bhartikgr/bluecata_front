/**
 * WAVE 231 — THE CLASSIFIER, ACROSS EVERY STATE THE DATABASE CANNOT CURRENTLY REACH.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The seeded platform row is INACTIVE at 0, so a live probe can only ever produce
 * `not_set`. That is exactly why the rule lives in a pure module: the states that
 * matter most — an active non-zero rate, a decided zero, an unreadable store, a
 * rate too fine to display — are unreachable through the database today and would
 * otherwise ship completely unexercised.
 *
 * THE ASSERTION THAT CARRIES THIS FILE: **no state except `applied_rate` may put a
 * figure on screen, and no state may ever produce the characters "0%".** That is
 * checked exhaustively over the declared state list, so a future state added to
 * the module without a decision about figures fails here rather than on a partner's
 * screen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  spvPlatformFeeDisclosure,
  SPV_PLATFORM_FEE_DISCLOSURE_STATES,
  type SpvPlatformFeeDisclosureState,
} from "../spvPlatformFeeDisclosure";

const SCALE = 1_000_000_000; // CARRY_FRACTION_SCALE, as the schedule stores it.

/**
 * "Does this sentence state a percentage of ZERO?"
 *
 * NOT `statement.includes("0%")`. That was the first version and it was WRONG in
 * the most embarrassing possible direction: it fails on the correct disclosure
 * "...set at 20%...", because `"20%"` contains the substring `"0%"`. A guard that
 * fires on a legitimate 20% fee would have had me "fix" a correct statement.
 *
 * The real rule is about the VALUE of the percentage token, so the token has to be
 * matched at its boundary: a run of digits (optionally with a decimal part) that is
 * numerically zero, immediately followed by `%`. `20%` is not zero. `0%`, `0.0%`
 * and `00%` are.
 */
function statesAZeroPercent(statement: string): boolean {
  for (const m of statement.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    if (/^0+(\.0+)?$/.test(m[1])) return true;
  }
  return false;
}
const rate = (rateScaled: number | null, pricesARate = true, scale: number | null = SCALE) => ({
  rateScaled,
  scale,
  pricesARate,
});

/* ══════════════════════════════════════════════════════════════════════════════
   §1 — THE FABRICATED ZERO. The single rule this module exists for.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W231 §1 — a 0% platform fee is NEVER rendered as a decided price", () => {
  it("the SEEDED reality (inactive → no row) says no fee is applied, and shows no figure", () => {
    const d = spvPlatformFeeDisclosure({ row: null, readable: true });
    expect(d.state).toBe("not_set");
    expect(d.percentDisplay).toBeNull();
    expect(d.statement).toBe(
      "No platform fee layer is currently applied to SPVs you create. " +
        "If Capavate applies one, its exact terms appear on this SPV's Fees tab.",
    );
    // It must state no percentage at all, and certainly not a zero one.
    expect(statesAZeroPercent(d.statement)).toBe(false);
    expect(/\d+\s*%/.test(d.statement)).toBe(false);
  });

  it("an ACTIVE row at rate 0 is a decided nil, reported in words and never as \"0%\"", () => {
    const d = spvPlatformFeeDisclosure({ row: rate(0), readable: true });
    // The STATE distinguishes it — an auditor can tell "we decided nil" from
    // "nobody decided" — while the SENTENCE does not, because for the partner
    // the fact is identical: nothing is charged.
    expect(d.state).toBe("set_to_zero");
    expect(d.percentDisplay).toBeNull();
    expect(statesAZeroPercent(d.statement)).toBe(false);
    expect(/\d+\s*%/.test(d.statement)).toBe(false);
    expect(d.statement).toBe(
      spvPlatformFeeDisclosure({ row: null, readable: true }).statement,
    );
  });

  it("EXHAUSTIVE over the declared states: only `applied_rate` may carry a figure, and none may say 0%", () => {
    /* Every declared state is produced by a real input below. If a state is added
       to the module and not given an input here, the final coverage assertion
       fails — so a new state cannot ship without a decision about figures. */
    const produced = new Map<SpvPlatformFeeDisclosureState, ReturnType<typeof spvPlatformFeeDisclosure>>();
    const inputs: Array<Parameters<typeof spvPlatformFeeDisclosure>[0]> = [
      { row: null, readable: false },                            // unreadable
      { row: null, readable: true },                             // not_set
      { row: rate(0), readable: true },                          // set_to_zero
      { row: rate(200_000_000), readable: true },                // applied_rate
      { row: rate(null, false), readable: true },                // applied_not_a_rate
      { row: rate(1, true, 1_000_000_000_000_000), readable: true }, // rate_not_exactly_displayable
    ];
    for (const i of inputs) {
      const d = spvPlatformFeeDisclosure(i);
      produced.set(d.state, d);
      if (d.state === "applied_rate") {
        expect(d.percentDisplay).not.toBeNull();
      } else {
        expect(d.percentDisplay, `state ${d.state} leaked a figure`).toBeNull();
      }
      expect(statesAZeroPercent(d.statement), `state ${d.state} stated a 0% price`).toBe(false);
      // Only `applied_rate` may state ANY percentage.
      if (d.state !== "applied_rate") {
        expect(/\d+\s*%/.test(d.statement), `state ${d.state} stated a percentage`).toBe(false);
      }
      // No state may emit a currency symbol: this surface discloses a rate or nothing.
      for (const sym of ["$", "€", "£", "¥", "CA$"]) {
        expect(d.statement.includes(sym), `state ${d.state} emitted ${sym}`).toBe(false);
      }
      // Every statement is a sentence, not a machine code.
      expect(d.statement.length).toBeGreaterThan(40);
      expect(d.statement.endsWith(".")).toBe(true);
      expect(/[A-Z_]{6,}/.test(d.statement), `state ${d.state} leaked a code`).toBe(false);
    }
    // COVERAGE — every declared state was exercised.
    expect([...produced.keys()].sort()).toEqual([...SPV_PLATFORM_FEE_DISCLOSURE_STATES].sort());
  });

  it("an unreadable store REFUSES to claim either way — it does not report \"no fee\"", () => {
    const d = spvPlatformFeeDisclosure({ row: rate(200_000_000), readable: false });
    expect(d.state).toBe("unreadable");
    expect(d.percentDisplay).toBeNull();
    // The distinguishing words. A database failure must not become a price.
    expect(d.statement.includes("could not be read")).toBe(true);
    expect(d.statement.includes("This is not a statement that there is no platform fee")).toBe(true);
    // And it is NOT the `not_set` sentence.
    expect(d.statement).not.toBe(spvPlatformFeeDisclosure({ row: null, readable: true }).statement);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   §2 — WHEN THERE *IS* A FIGURE, IT IS EXACT.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W231 §2 — the disclosed percentage is exact, or is not disclosed at all", () => {
  it("converts scaled integer rates to exact decimal strings", () => {
    const cases: Array<[number, string]> = [
      [200_000_000, "20"],       // 20%
      [25_000_000, "2.5"],       // 2.5%
      [10_000_000, "1"],         // 1%
      [1_000_000, "0.1"],        // 0.1%
      [12_500_000, "1.25"],      // 1.25%
      [1_000_000_000, "100"],    // 100%
      [10, "0.000001"],          // the finest exactly-displayable rate
    ];
    for (const [rateScaled, expected] of cases) {
      const d = spvPlatformFeeDisclosure({ row: rate(rateScaled), readable: true });
      expect(d.state, `rate ${rateScaled}`).toBe("applied_rate");
      expect(d.percentDisplay, `rate ${rateScaled}`).toBe(expected);
      expect(d.statement.includes(`${expected}%`)).toBe(true);
    }
  });

  it("NEGATIVE CONTROL — the conversion is not returning whatever it is handed", () => {
    // 20% must not come out as "200000000", "0.2", or "2000".
    const d = spvPlatformFeeDisclosure({ row: rate(200_000_000), readable: true });
    expect(d.percentDisplay).toBe("20");
    expect(d.percentDisplay).not.toBe("200000000");
    expect(d.percentDisplay).not.toBe("0.2");
    expect(d.percentDisplay).not.toBe("2000");
  });

  it("REFUSES rather than rounds when the rate is finer than it can display", () => {
    // 1 part in 1e15 is a real, non-zero rate that cannot be shown at 6 decimals.
    const d = spvPlatformFeeDisclosure({ row: rate(1, true, 1_000_000_000_000_000), readable: true });
    expect(d.state).toBe("rate_not_exactly_displayable");
    expect(d.percentDisplay).toBeNull();
    expect(d.statement.includes("do not rely on a figure from this screen")).toBe(true);
  });

  it("REFUSES on non-integer, negative, unsafe and nonsense inputs — no truncated price", () => {
    for (const bad of [
      rate(1.5),                                  // non-integer
      rate(-200_000_000),                         // negative
      rate(Number.MAX_SAFE_INTEGER + 2),          // past the safe-integer gate
      rate(Number.NaN),
      rate(Number.POSITIVE_INFINITY),
      rate(200_000_000, true, 0),                 // zero divisor
      rate(200_000_000, true, -1_000_000_000),    // negative divisor
      rate(200_000_000, true, 1.5),               // non-integer divisor
    ]) {
      const d = spvPlatformFeeDisclosure({ row: bad, readable: true });
      expect(d.state, JSON.stringify(bad)).toBe("rate_not_exactly_displayable");
      expect(d.percentDisplay).toBeNull();
    }
  });

  it("a flat-amount row states that a fee applies WITHOUT inventing a percentage", () => {
    const d = spvPlatformFeeDisclosure({ row: rate(null, false), readable: true });
    expect(d.state).toBe("applied_not_a_rate");
    expect(d.percentDisplay).toBeNull();
    expect(d.statement.includes("it is not a percentage")).toBe(true);
    // It does NOT claim no fee applies — a fee DOES apply, it is just not a rate.
    expect(d.statement.includes("No platform fee layer is currently applied")).toBe(false);
  });

  it("pricesARate=true with null rate/scale is treated as \"not a rate\", not as zero", () => {
    for (const r of [rate(null, true), rate(200_000_000, true, null)]) {
      const d = spvPlatformFeeDisclosure({ row: r, readable: true });
      expect(d.state).toBe("applied_not_a_rate");
      expect(d.percentDisplay).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   §3 — THE MONEY RULE, ASSERTED AGAINST THE MODULE'S OWN SOURCE TEXT.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W231 §3 — nothing is hardcoded and no float coercion is used", () => {
  /* THIS READS SOURCE TEXT, AND THE CONTENT UNDER TEST IS PARTLY STRING LITERALS
     (the four statements), so comments are NOT stripped before these greps —
     stripping would also be free to strip the literals, and a "banned call" that
     survives only inside a comment is not a defect worth failing over anyway. The
     greps below are therefore deliberately written to be immune to prose: they
     look for the CALL form `Number(` / `parseInt(` / `parseFloat(`, which does not
     occur in this module's comments. Verified by the negative control below. */
  const SRC = readFileSync(
    resolve(__dirname, "../spvPlatformFeeDisclosure.ts"),
    "utf8",
  );

  /** SRC with comments removed and string/template literals PRESERVED. */
  const CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("THE STRIPPER STRIPPED — comments are gone, literals are not", () => {
    /* Required before any grep conclusion, and it is not a formality: the first
       version of the next test grepped the RAW source for `Number(` and failed,
       because the module's own header comment contains the sentence "uses
       `Number()`, `parseInt` and `parseFloat` NOWHERE". The grep was correct; the
       input was wrong. Comments must be stripped. Literals must NOT be, because
       the four disclosure statements ARE string literals and are part of what is
       under test. */
    expect(SRC.includes("NEVER RENDER A FABRICATED 0%")).toBe(true);
    expect(CODE_ONLY.includes("NEVER RENDER A FABRICATED 0%")).toBe(false);
    expect(SRC.includes("parseFloat")).toBe(true);
    expect(CODE_ONLY.includes("parseFloat")).toBe(false);
    // ...and a STRING LITERAL survived the stripper.
    expect(CODE_ONLY.includes("No platform fee layer is currently applied")).toBe(true);
    expect(CODE_ONLY.length).toBeGreaterThan(1000);
  });

  it("uses no Number()/parseInt/parseFloat coercion", () => {
    for (const banned of ["Number(", "parseInt(", "parseFloat("]) {
      expect(CODE_ONLY.includes(banned), `found ${banned} in code`).toBe(false);
    }
    // ...while the SAFE integer predicates it DOES use are present, so the grep
    // above is not passing because the stripper ate everything.
    expect(CODE_ONLY.includes("Number.isSafeInteger(")).toBe(true);
    expect(CODE_ONLY.includes("BigInt(")).toBe(true);
    expect(SRC.length).toBeGreaterThan(2000);
  });

  it("contains no percentage, currency or exponent literal", () => {
    /* Strip the statement literals and comments, then look for anything that
       could be a price. `100n` (the definition of per-cent) and the display
       precision are the only numerics that may remain. */
    const code = SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    // No currency symbols or ISO codes in code.
    for (const sym of ["$", "€", "£", "¥", "USD", "EUR", "GBP", "JPY", "CAD"]) {
      expect(code.includes(sym), `code contains ${sym}`).toBe(false);
    }
    /* The only numeric literals left are the three BigInt unit constants
       (`BigInt(0)`, `BigInt(10)`, `BigInt(100)` — zero, the decimal base, and the
       definition of per-cent), the display precision `6`, and `0`/`1` from the
       guards. NOTHING that could encode a rate, a price or an exponent.

       (Bigint LITERALS `0n`/`10n`/`100n` were the first version and do not compile
       under this tree's TypeScript target — TS2737. See the module's own note.) */
    const numerics = [...new Set([...code.matchAll(/\b\d[\d_]*n?\b/g)].map((m) => m[0]))];
    expect(numerics.sort()).toEqual(["0", "1", "6", "10", "100"].sort());
    // And no bigint literal syntax survived anywhere, comments included.
    expect(/\b\d+n\b/.test(code)).toBe(false);
  });

  it("NEGATIVE CONTROL — the source grep can actually fail", () => {
    // Prove the technique: a string the file definitely does not contain.
    expect(SRC.includes("computeFeeMinor(")).toBe(false);
    // and one it definitely does.
    expect(SRC.includes("NEVER RENDER A FABRICATED 0%")).toBe(true);
  });
});
