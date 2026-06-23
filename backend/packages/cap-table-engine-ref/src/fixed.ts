/**
 * Reference engine fixed-point arithmetic.
 *
 * Author voice: This module deliberately *does not* use decimal.js. Instead, every
 * rational quantity is represented as a BigInt scaled by 10^38 (the SCALE). Addition
 * and subtraction are pure BigInt ops; multiplication divides by SCALE; division
 * multiplies by SCALE first to preserve precision. The trade-offs are different from
 * decimal.js (no automatic rounding-mode wrappers, no exponent representation), and
 * any divergence between the two implementations is a high-signal bug.
 *
 * Why BigInt scaled-int instead of decimal.js? Two engines with different bug
 * surfaces. decimal.js bugs cluster around rounding modes and toFixed behavior;
 * scaled-int bugs cluster around scale management and division order. If both
 * agree on every published worked example, our confidence is multiplicative.
 */

export const SCALE_DIGITS = 38;
export const SCALE: bigint = 10n ** BigInt(SCALE_DIGITS);

export type Fixed = bigint; // value × SCALE

/** Parse a decimal string into a fixed-point bigint at SCALE_DIGITS digits. */
export function fxFromString(s: string | number): Fixed {
  const str = typeof s === "number" ? s.toString() : s;
  const trimmed = str.trim();
  if (trimmed === "" || trimmed === "n/a") return 0n;
  let neg = false;
  let body = trimmed;
  if (body.startsWith("-")) {
    neg = true;
    body = body.slice(1);
  } else if (body.startsWith("+")) {
    body = body.slice(1);
  }
  // Handle exponent
  let exp = 0;
  const eIdx = body.search(/[eE]/);
  if (eIdx >= 0) {
    exp = parseInt(body.slice(eIdx + 1), 10);
    body = body.slice(0, eIdx);
  }
  const dot = body.indexOf(".");
  let intPart = dot < 0 ? body : body.slice(0, dot);
  let fracPart = dot < 0 ? "" : body.slice(dot + 1);
  if (intPart === "") intPart = "0";

  // Apply exponent by shifting the decimal point
  if (exp > 0) {
    if (fracPart.length >= exp) {
      intPart += fracPart.slice(0, exp);
      fracPart = fracPart.slice(exp);
    } else {
      intPart += fracPart + "0".repeat(exp - fracPart.length);
      fracPart = "";
    }
  } else if (exp < 0) {
    const shift = -exp;
    if (intPart.length > shift) {
      fracPart = intPart.slice(intPart.length - shift) + fracPart;
      intPart = intPart.slice(0, intPart.length - shift);
    } else {
      fracPart = "0".repeat(shift - intPart.length) + intPart + fracPart;
      intPart = "0";
    }
  }

  // Pad/truncate fractional part to SCALE_DIGITS
  if (fracPart.length > SCALE_DIGITS) fracPart = fracPart.slice(0, SCALE_DIGITS);
  else if (fracPart.length < SCALE_DIGITS) fracPart = fracPart + "0".repeat(SCALE_DIGITS - fracPart.length);

  const combined = (intPart + fracPart).replace(/^0+/, "") || "0";
  const big = BigInt(combined);
  return neg ? -big : big;
}

export function fxFromBigInt(v: bigint): Fixed {
  return v * SCALE;
}

export function fxToString(f: Fixed, decimals = SCALE_DIGITS): string {
  const neg = f < 0n;
  const abs = neg ? -f : f;
  const padded = abs.toString().padStart(SCALE_DIGITS + 1, "0");
  const intPart = padded.slice(0, padded.length - SCALE_DIGITS);
  const fracPart = padded.slice(padded.length - SCALE_DIGITS).slice(0, decimals);
  const trimmedInt = intPart.replace(/^0+/, "") || "0";
  const result = decimals > 0 ? `${trimmedInt}.${fracPart}` : trimmedInt;
  return neg ? "-" + result : result;
}

export function fxAdd(a: Fixed, b: Fixed): Fixed { return a + b; }
export function fxSub(a: Fixed, b: Fixed): Fixed { return a - b; }

export function fxMul(a: Fixed, b: Fixed): Fixed {
  // (a × b) / SCALE — use bankers rounding to match decimal.js ROUND_HALF_EVEN
  return roundHalfEven(a * b, SCALE);
}

export function fxDiv(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new Error("ref engine: divide by zero");
  return roundHalfEven(a * SCALE, b);
}

function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const q = numerator / denominator;
  const r = numerator % denominator;
  if (r === 0n) return q;
  const twiceR = (r < 0n ? -r : r) * 2n;
  if (twiceR < denominator) return q;
  if (twiceR > denominator) return numerator < 0n ? q - 1n : q + 1n;
  // Exactly half — round to even
  if (q % 2n === 0n) return q;
  return numerator < 0n ? q - 1n : q + 1n;
}

export function fxLt(a: Fixed, b: Fixed): boolean { return a < b; }
export function fxLte(a: Fixed, b: Fixed): boolean { return a <= b; }
export function fxGt(a: Fixed, b: Fixed): boolean { return a > b; }
export function fxGte(a: Fixed, b: Fixed): boolean { return a >= b; }
export function fxEq(a: Fixed, b: Fixed): boolean { return a === b; }

/** Floor a fixed-point to a whole-share BigInt (truncate toward zero of the integer part). */
export function fxFloorToShares(f: Fixed): bigint {
  if (f >= 0n) return f / SCALE;
  // Negative: round toward -inf
  const q = f / SCALE;
  const r = f % SCALE;
  return r === 0n ? q : q - 1n;
}

export const FX_ZERO: Fixed = 0n;
export const FX_ONE: Fixed = SCALE;
export const FX_HUNDRED: Fixed = 100n * SCALE;
