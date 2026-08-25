/**
 * WAVE 126 - FINDING 2: the partner money-entry contract.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. Every money field on the Consortium Partner
 * surface asked the client for the currency's SMALLEST unit. The label said so
 * ("enter the amount in USD cents, not whole USD") and the placeholder said so
 * ("e.g. 5000000 for five million cents"), but a paying client types the amount
 * they mean. Typing five million dollars produced fifty thousand dollars. A
 * factor of one hundred, on a capital call, a distribution and a commitment.
 *
 * WAVE 106 LOOKED AT THIS AND DECLINED IT. The comment block still standing in
 * SpvDetailTabs.tsx chose to relabel the fields rather than re-scale them,
 * calling a contract change "a larger piece of work than this wave can honestly
 * claim". That was a defensible call at the time and it is the call being
 * reversed here, deliberately and on the record: a field that a client reads
 * wrong is not made safe by explaining the trap more clearly.
 *
 * WHAT CHANGES AND WHAT DOES NOT.
 *   · The UI accepts WHOLE CURRENCY UNITS - "5000000", "5,000,000",
 *     "5000000.50", "$5,000,000.00".
 *   · The WIRE FORMAT DOES NOT CHANGE. Everything downstream still receives an
 *     exact integer in minor units, so no server contract, no stored value and
 *     no piece of arithmetic moves.
 *
 * WHY BIGINT, AND WHY THE SPLIT IS TEXTUAL. The wave's rule is absolute: no
 * `Number()`, no `parseInt`, no `parseFloat` on a money value. Not even
 * transiently - `Number("5000000.50") * 100` is 500000049.99999994 on some
 * inputs, and the whole point of storing minor units is that no float ever
 * touches the figure. So the integer part and the fractional part are separated
 * as STRINGS, the fraction is validated and right-padded against the currency's
 * ISO-4217 exponent as a STRING, the two are concatenated as a STRING, and
 * `BigInt` is applied exactly once to a string of digits. There is no point in
 * this module at which a money value exists as a `number`.
 *
 * The platform's existing `majorToMinorExact` (client/src/lib/moneyInput.ts)
 * solves the same problem for admin surfaces, but it does it with
 * `toMinor(Number(s), currency)` - float multiplication. It is correct for the
 * magnitudes those surfaces see and it is not being changed by this wave; it is
 * simply not usable under this wave's no-float rule, so this module is the
 * partner surface's own edge parser. The ISO-4217 exponent still comes from the
 * one shared table (`currencyExponent`), never from a literal 2.
 *
 * NOTHING IS ROUNDED. An amount with more fractional digits than the currency
 * has is REFUSED, not truncated and not rounded. Quietly rounding a client's
 * money is the same class of defect as multiplying it by one hundred: the
 * platform would be acting on a figure nobody authorised.
 *
 * REFUSALS ARE SENTENCES. The return is a result object, never a throw, so a
 * refusal can be shown inline beside the field as the client types instead of
 * arriving as a toast after they have already pressed the button.
 */
import { currencyExponent } from "@/lib/currency";

/* BigInt LITERALS (`0n`) are not available at this project's compile target, so
   every bigint constant in this module is built with `BigInt(...)`. */
const BIG_ZERO = BigInt(0);
const IMPLAUSIBLE_WHOLE_UNITS = BigInt("100000000000");

/** The human name of a currency's whole unit, for use in a label. */
export function wholeUnitName(currency: string): string {
  const c = (currency || "").trim().toUpperCase();
  return c || "currency";
}

/**
 * The label for a partner money field. Asks for the amount the client means,
 * in the currency they are working in, and says nothing about how the platform
 * stores it - that is our business, not theirs.
 */
export function wholeUnitsLabel(name: string, currency: string): string {
  return `${name} (${wholeUnitName(currency)})`;
}

/** The same label where the component has no currency in scope. */
export function wholeUnitsLabelNoCurrency(name: string): string {
  return `${name} (whole amount)`;
}

/**
 * The placeholder for a partner money field: an example of the amount, written
 * the way a person writes an amount.
 */
export function wholeUnitsPlaceholder(currency: string): string {
  const exp = currencyExponent(currency);
  return exp === 0 ? "e.g. 5,000,000" : "e.g. 5,000,000.00";
}

export type MoneyParse =
  | { ok: true; minor: bigint; formatted: string }
  | { ok: false; message: string };

/**
 * Strip the decoration a person types around an amount: thousands separators,
 * ordinary spaces, non-breaking spaces, and a leading currency symbol or code.
 * Nothing here can change the VALUE - only characters that carry no magnitude
 * are removed, and a stray separator inside the fraction is left in place so
 * the digit check below refuses it rather than silently "cleaning" it.
 */
function undecorate(raw: string): string {
  let s = (raw ?? "").trim();
  /* Leading currency symbol or 3-letter code, with or without a space. */
  s = s.replace(/^[$€£¥₩₹]\s*/, "");
  s = s.replace(/^[A-Za-z]{3}\s+/, "");
  s = s.replace(/[\u00a0\u202f\s]/g, "");
  /* Thousands separators only in the integer part, only in groups of three. */
  const dot = s.indexOf(".");
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const rest = dot === -1 ? "" : s.slice(dot);
  return intPart.replace(/,/g, "") + rest;
}

/** Insert thousands separators into a string of digits. No arithmetic. */
function groupDigits(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/**
 * Format an exact minor-unit bigint for display, by string surgery on the
 * digits. Deliberately does NOT go through Intl or any numeric formatter: a
 * commitment large enough to lose precision in a double must still render
 * exactly, because the confirmation line is the whole defence against a
 * mistyped magnitude.
 */
export function formatWholeUnits(minor: bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = minor < BIG_ZERO;
  let digits = (neg ? BIG_ZERO - minor : minor).toString();
  const code = wholeUnitName(currency);
  if (exp === 0) return `${neg ? "-" : ""}${groupDigits(digits)} ${code}`;
  while (digits.length <= exp) digits = "0" + digits;
  const whole = digits.slice(0, digits.length - exp);
  const frac = digits.slice(digits.length - exp);
  return `${neg ? "-" : ""}${groupDigits(whole)}.${frac} ${code}`;
}

/**
 * Parse a whole-currency-unit amount typed by a client into exact minor units.
 *
 * `label` names the field in the refusal sentence, because "Amount must be a
 * number" beside four amount fields tells the client nothing.
 */
export function parseWholeUnits(
  raw: string,
  currency: string,
  opts?: { label?: string; allowZero?: boolean },
): MoneyParse {
  const label = opts?.label ?? "Amount";
  const code = wholeUnitName(currency);
  const exp = currencyExponent(currency);
  const s = undecorate(raw);

  if (s === "") {
    return { ok: false, message: `Enter ${label.toLowerCase()} in ${code}.` };
  }
  if (s.startsWith("-")) {
    return {
      ok: false,
      message: `${label} cannot be negative. Enter the amount as a positive figure in ${code}.`,
    };
  }
  if (/e/i.test(s)) {
    return {
      ok: false,
      message: `Enter ${label.toLowerCase()} as an ordinary amount in ${code}, for example 5,000,000 - not in scientific notation.`,
    };
  }

  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) {
    return {
      ok: false,
      message: `${label} must be an amount in ${code}, using digits and at most one decimal point.`,
    };
  }
  const intPart = m[1];
  const fracPart = m[2] ?? "";

  if (exp === 0 && (s.includes(".") || fracPart.length > 0)) {
    return {
      ok: false,
      message: `${code} has no fractional unit, so ${label.toLowerCase()} must be a whole number.`,
    };
  }
  if (fracPart.length > exp) {
    return {
      ok: false,
      message: `${code} amounts carry at most ${exp} decimal place${exp === 1 ? "" : "s"}. Enter ${label.toLowerCase()} to ${exp} decimal place${exp === 1 ? "" : "s"} - it is not rounded for you.`,
    };
  }

  /* String-only scaling: pad the fraction to the currency's exponent and
     concatenate. `BigInt` is applied once, to a string of digits. */
  const padded = fracPart.padEnd(exp, "0");
  const minor = BigInt(intPart + padded);

  if (minor === BIG_ZERO && opts?.allowZero !== true) {
    return {
      ok: false,
      message: `${label} must be greater than zero.`,
    };
  }

  return { ok: true, minor, formatted: formatWholeUnits(minor, currency) };
}

/**
 * The live confirmation line beside a money field. Returns null when there is
 * nothing valid to confirm, so the caller shows the refusal sentence instead of
 * a misleading zero.
 */
export function wholeUnitsEcho(raw: string, currency: string): string | null {
  const r = parseWholeUnits(raw, currency, { allowZero: true });
  return r.ok ? r.formatted : null;
}

/**
 * The wire value. Minor units as a decimal string of digits, never a `number`,
 * so a figure beyond 2^53 survives the journey to the server intact.
 */
export function toWireMinor(minor: bigint): string {
  return minor.toString();
}

/**
 * A commitment or a distribution has no defensible universal ceiling - a hard
 * maximum would eventually refuse a legitimate large vehicle, which is a worse
 * failure than accepting an implausible one. So a very large figure is never
 * blocked; it is confirmed. This returns true when the amount is large enough
 * that the client should be asked to look at it again.
 *
 * The threshold is one hundred billion whole units. Chosen because it is above
 * any single private-market vehicle this platform administers and below the
 * magnitudes a slipped decimal or a pasted minor-unit figure produces.
 */
export function isImplausiblyLarge(minor: bigint, currency: string): boolean {
  const exp = currencyExponent(currency);
  let scale = BigInt(1);
  for (let i = 0; i < exp; i++) scale *= BigInt(10);
  return minor / scale >= IMPLAUSIBLE_WHOLE_UNITS;
}

/**
 * The inverse, for pre-filling a field from a stored minor-unit value. Returns
 * a plain editable string in whole currency units - no thousands separators,
 * because the client is about to type into it. String surgery only; the stored
 * figure is never widened to a `number` on its way to the screen.
 */
export function minorToWholeUnitsInput(
  minor: bigint | number | string | null | undefined,
  currency: string,
): string {
  if (minor === null || minor === undefined || minor === "") return "";
  const exp = currencyExponent(currency);
  /* `number` inputs come from existing typed payloads; the value is converted
     through its decimal string, never by dividing. A non-integer or unsafe
     value is refused rather than shown wrong. */
  let digits: string;
  if (typeof minor === "bigint") digits = minor.toString();
  else if (typeof minor === "string") {
    if (!/^-?\d+$/.test(minor.trim())) return "";
    digits = minor.trim();
  } else {
    if (!Number.isSafeInteger(minor)) return "";
    digits = minor.toString();
  }
  const neg = digits.startsWith("-");
  if (neg) digits = digits.slice(1);
  if (exp === 0) return `${neg ? "-" : ""}${digits}`;
  while (digits.length <= exp) digits = "0" + digits;
  const whole = digits.slice(0, digits.length - exp);
  const frac = digits.slice(digits.length - exp).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
