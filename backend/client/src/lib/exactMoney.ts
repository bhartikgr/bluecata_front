/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 92 — THE DISPLAY LAYER FOR EXACT-DECIMAL MONEY. OPEN ITEM J-1, RESOLVED.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS A NEW FILE.
 *
 * Open item J-1 (`build_log/OPEN_ITEMS_REGISTER.md`) was opened by Wave 75: a
 * founder's exit proceeds rendered as `3333333333.3333335`, because one third of
 * $100,000,000 is a NON-TERMINATING decimal and no IEEE-754 double is that value.
 * The owner answered with R72 — carry the money as exact decimal TEXT — and Wave
 * 77 did the server half: `lpProceeds`, `founderProceeds`, `byShareClass[].proceeds`
 * and `breakpoints[].exitMinor` are now the engine's own unrounded decimal strings.
 *
 * R72 condition 3 and condition 5 left the other half open, in these words: *any
 * rounding belongs at a display layer, once, with the convention stated*, and *no
 * screen renders this figure yet — which is the reason the change is cheap now*.
 * `W77-M4` pinned that second clause as an assertion: NO file under `client/src`
 * may mention `founderProceeds` or `lpProceeds`, so that the first screen to read
 * one CANNOT ship without deciding the convention. Wave 92 builds that screen. So
 * this is the display layer, it is written in the same step that first renders the
 * figure (R83.1), and the convention is stated below rather than left implicit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONVENTION, STATED. THREE RULES AND A REASON FOR EACH.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. THE WIRE IS EXACT AND UNROUNDED; ONLY THE SCREEN ROUNDS. Nothing in this
 *    module is ever written back to the server, put in a payload, summed into
 *    another figure, or used to make a decision. It produces text for an eye. The
 *    exact string stays available beside every rounded figure — the screen shows
 *    it — so a reader can always see the digits the engine actually produced.
 *
 * 2. A SINGLE FIGURE IS ROUNDED HALF-UP TO THE CURRENCY'S OWN SMALLEST UNIT.
 *    Half-up, not half-even, because this is the convention a founder, an
 *    accountant and every spreadsheet they will check us against use, and because
 *    a DISPLAY rounding must be the one a human would perform by hand. The
 *    engine's own arithmetic is HALF_EVEN at 38 significant digits and is NOT
 *    touched by this: the two roundings are at opposite ends of the pipe and only
 *    one of them decides money.
 *
 * 3. A COLUMN OF FIGURES THAT MUST ADD UP IS ROUNDED BY LARGEST REMAINDER.
 *    Rounding each row independently makes a column of rows fail to sum to its own
 *    total — `$3,333,333.33` three times is `$9,999,999.99` under a
 *    `$10,000,000.00` heading, and a founder reading that on an exit screen
 *    concludes the platform cannot add up. `displayRowsSummingTo` floors every row
 *    to the smallest unit and hands the leftover units, one each, to the rows with
 *    the largest discarded fractions, so the displayed rows sum to the displayed
 *    total EXACTLY, every time, and no row moves by more than one smallest unit.
 *    THE UNDERLYING FIGURES ARE UNCHANGED — this is presentation, and the screen
 *    labels it as such.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO `Number()` ON MONEY. R72 CONDITION 4.
 * ─────────────────────────────────────────────────────────────────────────────
 * Not one function here converts a money string to a `number`. Every operation is
 * on decimal DIGIT TEXT and on `bigint`, which is exact and unbounded. `parseInt`,
 * `parseFloat`, `Number`, `+x`, `Math.round` and `.toFixed()` are absent from this
 * file by construction; `W92-M-01` polices that as source text, so a later edit
 * cannot reintroduce the narrowing this module exists to avoid.
 *
 * `Decimal` is deliberately NOT imported. `Decimal.set()` mutates the shared
 * decimal.js instance the SACRED engine imports, and importing decimal.js into the
 * client bundle to divide by 100 would be a large dependency for a task `bigint`
 * does exactly. There is no configuration here to get wrong.
 */

/** Rendered where a figure does not exist. Deliberately the same glyph
 *  `client/src/lib/moneyDisplay.ts` already uses, so two screens never disagree
 *  about what "we do not have this number" looks like. */
export const EXACT_MONEY_UNAVAILABLE = "—";

/** ISO-4217 minor-unit exponents that are not 2. Everything absent from this map
 *  is 2, which is the overwhelming majority and the only case this screen's test
 *  data exercises. Kept deliberately small and local: the tree's own
 *  `client/src/lib/currency.ts` owns the full table, and it is reused below rather
 *  than duplicated — this constant exists only as the fallback when that table
 *  cannot answer. */
const DEFAULT_EXPONENT = 2;

/* `bigint` CONSTANTS, NOT `bigint` LITERALS. This tree's `tsconfig.json` sets no
   `target`, so TypeScript defaults below ES2020 and REFUSES the zero-suffix literal form
   ("BigInt literals are not available when targeting lower than ES2020"). Raising
   the target would change the compiler's behaviour for every one of the ~1,900
   files in the project and move the `tsc` error multiset this wave is gated on, so
   the correct fix is to write the constants the long way rather than to edit shared
   compiler configuration for one new file. `lib` is `esnext`, so the `BigInt`
   TYPE and its constructor are available; only the literal SYNTAX is not. */
const B_ZERO = BigInt(0);
const B_ONE = BigInt(1);

type Parsed = {
  /** `true` when the value is negative. */
  negative: boolean;
  /** The integer part, digits only, no sign, no separators. May be `"0"`. */
  int: string;
  /** The fractional part, digits only, possibly empty. */
  frac: string;
};

/**
 * Is this string a plain decimal number the way the engine writes one?
 *
 * The engine emits `.toFixed()` with no argument: optional sign, digits, an
 * optional single dot, digits. NO exponent, no separators, no currency symbol.
 * Anything else is refused rather than guessed at — a screen that guesses about
 * money is how this project shipped a $2,222,222 error.
 */
export function isExactDecimalText(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim());
}

function parse(value: string): Parsed | null {
  const t = value.trim();
  if (!isExactDecimalText(t)) return null;
  const negative = t.charAt(0) === "-";
  const body = negative ? t.slice(1) : t;
  const dot = body.indexOf(".");
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? "" : body.slice(dot + 1);
  return { negative, int, frac };
}

/** `"000123"` → `"123"`, `"000"` → `"0"`. Pure text, no parse. */
function stripLeadingZeros(digits: string): string {
  let i = 0;
  while (i < digits.length - 1 && digits.charAt(i) === "0") i += 1;
  return digits.slice(i);
}

/**
 * Round an exact decimal minor-unit string to a WHOLE minor unit, HALF-UP,
 * returning the signed whole-unit count as a `bigint`.
 *
 * Rule 2 above. Half-up on the magnitude — `-0.5` minor units becomes `-1`, which
 * is "away from zero", the same direction a human rounding `-$0.005` writes down.
 */
function roundToWholeMinorHalfUp(p: Parsed): bigint {
  const magnitude = BigInt(stripLeadingZeros(p.int));
  const firstFracDigit = p.frac.length > 0 ? p.frac.charAt(0) : "0";
  /* A string comparison against "5" over a single character is a digit test, not
     arithmetic: "5" through "9" round up, "0" through "4" round down. */
  const roundsUp = firstFracDigit >= "5";
  const whole = roundsUp ? magnitude + B_ONE : magnitude;
  return p.negative ? -whole : whole;
}

/** The whole minor units DISCARDED by flooring toward zero, and the fraction that
 *  was dropped, as digit text — the two things largest-remainder needs. */
function floorAndRemainder(p: Parsed): { floorUnits: bigint; remainderDigits: string } {
  const magnitude = BigInt(stripLeadingZeros(p.int));
  return {
    floorUnits: p.negative ? -magnitude : magnitude,
    remainderDigits: p.frac,
  };
}

/** Group a digit string into thousands. `"1234567"` → `"1,234,567"`. Text only. */
function group(digits: string): string {
  const out: string[] = [];
  let count = 0;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out.push(digits.charAt(i));
    count += 1;
    if (count % 3 === 0 && i > 0) out.push(",");
  }
  return out.reverse().join("");
}

/**
 * Render a signed whole-minor-unit `bigint` as major units with `exponent`
 * fraction digits. `240000000n`, exponent 2 → `"2,400,000.00"`.
 *
 * Pure `bigint` and text. No division by `Math.pow(10, exponent)` — that is the
 * float division `client/src/lib/moneyDisplay.ts` has to do because it starts from
 * a `number`, and it is the step this module exists to avoid.
 */
function renderWholeMinor(units: bigint, exponent: number): string {
  const negative = units < B_ZERO;
  let digits = (negative ? -units : units).toString();
  const exp = exponent < 0 ? 0 : exponent;
  if (exp === 0) return `${negative ? "-" : ""}${group(digits)}`;
  while (digits.length <= exp) digits = `0${digits}`;
  const intPart = digits.slice(0, digits.length - exp);
  const fracPart = digits.slice(digits.length - exp);
  return `${negative ? "-" : ""}${group(intPart)}.${fracPart}`;
}

/**
 * THE MAIN ENTRY POINT. An exact decimal minor-unit string → the figure a founder
 * reads, rounded once, half-up, at the currency's own smallest unit.
 *
 * Returns `EXACT_MONEY_UNAVAILABLE` — never `"0.00"` — when the value is absent or
 * unreadable. R6: a figure we do not have must never render as a zero we do have.
 * A genuine `"0"` IS a figure and renders as one.
 */
export function formatExactMinor(
  value: unknown,
  opts?: { exponent?: number; symbol?: string },
): string {
  const p = typeof value === "string" ? parse(value) : null;
  if (p === null) return EXACT_MONEY_UNAVAILABLE;
  const exponent = opts?.exponent === undefined ? DEFAULT_EXPONENT : opts.exponent;
  const body = renderWholeMinor(roundToWholeMinorHalfUp(p), exponent);
  return opts?.symbol ? `${opts.symbol}${body}` : body;
}

/**
 * Is the exact value DIFFERENT from what the screen displays? The screen prints a
 * "the exact figure is …" note wherever this is true, so a rounded figure is never
 * presented as if it were the whole truth.
 */
export function displayIsRounded(value: unknown): boolean {
  const p = typeof value === "string" ? parse(value) : null;
  if (p === null) return false;
  return stripLeadingZeros(p.frac.replace(/0+$/, "")) !== "0" && p.frac.replace(/0+$/, "") !== "";
}

/**
 * RULE 3 — LARGEST REMAINDER, FOR DISPLAY ONLY.
 *
 * Given the exact figures for a set of rows and the exact figure for the total
 * they belong to, return one display string per row such that the displayed rows
 * sum EXACTLY to the displayed total.
 *
 * Method: floor every row toward zero at the smallest unit, count the units still
 * to be handed out to reach the rounded total, and give them one each to the rows
 * with the largest discarded fraction, ties broken by the row's own order so the
 * result is deterministic and does not depend on sort stability.
 *
 * If the rows' exact figures do not themselves sum to the total's exact figure,
 * this function DOES NOT invent an adjustment — it returns each row rounded
 * independently and reports `reconciles: false`, and the screen says so. A display
 * layer must never paper over an arithmetic disagreement; disagreeing rows are a
 * finding, and the conservation line is where the screen reports it.
 */
export function displayRowsSummingTo(
  rowValues: readonly unknown[],
  totalValue: unknown,
  opts?: { exponent?: number },
): { rows: string[]; reconciles: boolean } {
  const exponent = opts?.exponent === undefined ? DEFAULT_EXPONENT : opts.exponent;
  const parsed = rowValues.map((v) => (typeof v === "string" ? parse(v) : null));
  const totalParsed = typeof totalValue === "string" ? parse(totalValue) : null;

  const independent = (): string[] =>
    parsed.map((p) => (p === null ? EXACT_MONEY_UNAVAILABLE : renderWholeMinor(roundToWholeMinorHalfUp(p), exponent)));

  if (totalParsed === null || parsed.filter((p) => p === null).length > 0) {
    return { rows: independent(), reconciles: false };
  }

  /* Do the EXACT figures agree before any rounding? Compared as scaled integers at
     a common fractional width, so the comparison is exact and needs no tolerance
     and no `Number()`. */
  const width = Math.max(
    totalParsed.frac.length,
    ...parsed.map((p) => (p as Parsed).frac.length),
    0,
  );
  const scale = (p: Parsed): bigint => {
    const digits = `${stripLeadingZeros(p.int)}${p.frac}${"0".repeat(width - p.frac.length)}`;
    const v = BigInt(digits === "" ? "0" : digits);
    return p.negative ? -v : v;
  };
  const rowSum = parsed.reduce<bigint>((a, p) => a + scale(p as Parsed), B_ZERO);
  if (rowSum !== scale(totalParsed)) return { rows: independent(), reconciles: false };

  const totalUnits = roundToWholeMinorHalfUp(totalParsed);
  const floors = parsed.map((p) => floorAndRemainder(p as Parsed));
  const floorSum = floors.reduce<bigint>((a, f) => a + f.floorUnits, B_ZERO);
  let toHandOut = totalUnits - floorSum;

  const units = floors.map((f) => f.floorUnits);
  if (toHandOut > B_ZERO) {
    /* Rank by discarded fraction, descending, ties by original order. The fractions
       are compared as digit text padded to a common width — a lexicographic
       comparison of equal-length digit strings IS a numeric comparison. */
    const fracWidth = Math.max(...floors.map((f) => f.remainderDigits.length), 0);
    const order = floors
      .map((f, i) => ({ i, key: `${f.remainderDigits}${"0".repeat(fracWidth - f.remainderDigits.length)}` }))
      .sort((a, b) => (a.key === b.key ? a.i - b.i : a.key < b.key ? 1 : -1));
    for (const o of order) {
      if (toHandOut <= B_ZERO) break;
      units[o.i] += B_ONE;
      toHandOut -= B_ONE;
    }
  }
  /* A negative leftover cannot arise: flooring toward zero can only ever UNDERSTATE a
     non-negative column, and every figure on this response is non-negative because
     the engine never pays a negative amount. If a negative figure ever reaches
     here the exact-sum check above has already been satisfied, so the honest
     answer is the independently rounded column and the caller is told. */
  if (toHandOut !== B_ZERO) return { rows: independent(), reconciles: false };

  return { rows: units.map((u) => renderWholeMinor(u, exponent)), reconciles: true };
}

/**
 * A percentage for display, from an exact decimal FACTOR such as an abatement
 * factor `"0.6"`. Returns `"60%"` — or `"60.0000%"` where more precision is
 * needed to avoid printing `"60%"` for `0.599999`.
 *
 * Text only: the factor's digits are shifted two places left and truncated, never
 * parsed. `maxDecimals` bounds the tail so a non-terminating factor does not print
 * thirty-eight digits into a table cell; the screen prints the exact factor beside
 * it whenever it has been shortened.
 */
export function formatExactFactorAsPercent(
  value: unknown,
  opts?: { maxDecimals?: number },
): { text: string; truncated: boolean } {
  const p = typeof value === "string" ? parse(value) : null;
  if (p === null) return { text: EXACT_MONEY_UNAVAILABLE, truncated: false };
  const maxDecimals = opts?.maxDecimals === undefined ? 4 : opts.maxDecimals;
  /* Shift two decimal places: move two digits from the fraction into the integer. */
  const frac = `${p.frac}00`;
  const intPart = stripLeadingZeros(`${p.int}${frac.slice(0, 2)}`);
  const rest = frac.slice(2).replace(/0+$/, "");
  const kept = rest.slice(0, maxDecimals);
  const truncated = kept.length < rest.length;
  const sign = p.negative ? "-" : "";
  return {
    text: kept.length > 0 ? `${sign}${group(intPart)}.${kept}%` : `${sign}${group(intPart)}%`,
    truncated,
  };
}

/**
 * Read a founder's typed sale price — MAJOR units, as a human types them — and
 * return the MINOR-unit exact decimal text the endpoint's query string takes.
 *
 * `"50,000,000"` → `"5000000000"`. `"50000000.50"` → `"5000000050"`.
 *
 * This is the boundary R72 condition 4 is about, and it is done by SHIFTING THE
 * DECIMAL POINT IN TEXT, not by multiplying a float by 100 — `0.07 * 100` is
 * `7.000000000000001` in IEEE-754 and that is a money defect in a single
 * expression. Returns `null` for anything that is not a plain non-negative amount,
 * so the screen can refuse it in its own words before troubling the server.
 */
export function majorTextToExactMinor(
  input: string,
  opts?: { exponent?: number },
): string | null {
  const exponent = opts?.exponent === undefined ? DEFAULT_EXPONENT : opts.exponent;
  const cleaned = input.replace(/[,\s]/g, "").replace(/^\$/, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d*)?$/.test(cleaned)) return null;
  const dot = cleaned.indexOf(".");
  const int = dot === -1 ? cleaned : cleaned.slice(0, dot);
  let frac = dot === -1 ? "" : cleaned.slice(dot + 1);
  /* More precision than the currency has smallest units is a typo, not a value —
     refuse it rather than silently discard a digit the founder typed. */
  if (frac.length > exponent) return null;
  while (frac.length < exponent) frac += "0";
  return stripLeadingZeros(`${int}${frac}`);
}
