/**
 * server/lib/money.ts — Wave 0 deliverable 0-1 part 3.
 *
 * Arithmetic primitives for money and allocation math. Does NOT touch the DB;
 * these are pure functions used by Wave D/E ledger writers and by Wave 0's
 * allocator test vectors (acceptance 0-B).
 *
 * Design constraints:
 *   1. Basis points are integers (ADR-5 rule 3). No REAL, no floats in this module.
 *   2. `allocateResidualCents` is the deterministic largest-remainder allocator
 *      per V7 §4.1 Wave 0 acceptance 0-B. Tie-break rule: (remainder DESC,
 *      index ASC) — pinned per Opus v2 concern 8.
 *   3. Re-exports `currencyExponent`, `toMinor`, `fromMinor`, `formatMinor`
 *      from server/lib/currency.ts so callers can migrate one at a time. Wave 0
 *      changes ZERO existing call sites. That is Wave L's L-4 sweep.
 *   4. Does NOT introduce `assertMinor` or bigint-only enforcement in Wave 0
 *      (Opus v1 B-8 deferral). Those tighten during Wave L when call sites
 *      migrate.
 *   5. Uses `BigInt(...)` constructor calls rather than `Nn` literal syntax
 *      because the project's tsconfig.json has no explicit `target` and
 *      TypeScript defaults to ES3 where BigInt literals raise TS2737. Changing
 *      the compilation target is out of Wave 0 scope (would ripple across 617+
 *      files). The runtime is Node 20, which supports BigInt natively — the
 *      constructor form works identically.
 *
 * D-4-Rev note: this module reads exponents from server/lib/currency.ts, which
 * remains the single truth source per V7 §12.10. The `currency_ref` DB table
 * (Wave 0 migration 0121) is the FK-target reference for schema integrity;
 * runtime math still uses currency.ts. When Wave J ships currency governance
 * (Wave J or Wave L extension), this module can gain a `db`-aware overload
 * that reads currency_ref for the is_active flag.
 */

import {
  currencyExponent,
  toMinor,
  fromMinor,
  formatMinor,
} from "./currency";

export { currencyExponent, toMinor, fromMinor, formatMinor };

// BigInt constants, computed once. Avoids repeated `BigInt(0)` calls inside
// hot loops and lets the code read close to the natural `0n` / `1n` form.
const B_ZERO = BigInt(0);
const B_ONE = BigInt(1);
const B_TWO = BigInt(2);
const B_TEN_K = BigInt(10000);

/**
 * Basis points: integer (numerator, denominator) form. 100 bps = 1%.
 *
 * V7 ADR-5 rule 3: rates are integer `_bps` columns with range CHECKs; never
 * REAL. This helper returns the integer bps value for `(num / den) * 10000`,
 * rounded to nearest with banker's-round tie-break (round half to even).
 *
 * Not intended for money multiplication — use `allocateResidualCents` for that.
 * This is only for surfacing a rate as an integer bps for storage / display.
 *
 * @throws {RangeError} when `den <= 0`.
 * @throws {RangeError} when result would exceed 10000 (100%) or be negative.
 */
export function basisPoints(num: bigint, den: bigint): number {
  if (den <= B_ZERO) {
    throw new RangeError("basisPoints: denominator must be positive");
  }
  if (num < B_ZERO) {
    throw new RangeError("basisPoints: numerator must be non-negative");
  }
  // Compute (num * 10000) / den, rounded half-to-even.
  const scaled = num * B_TEN_K;
  const q = scaled / den;
  const r = scaled % den;
  const twoR = r * B_TWO;
  let rounded: bigint;
  if (twoR < den) {
    rounded = q;
  } else if (twoR > den) {
    rounded = q + B_ONE;
  } else {
    // Exact half — banker's round: nearest even.
    rounded = (q % B_TWO === B_ZERO) ? q : q + B_ONE;
  }
  if (rounded > B_TEN_K) {
    throw new RangeError(`basisPoints: result ${rounded} exceeds 10000 (100%)`);
  }
  return Number(rounded);
}

/**
 * Deterministic largest-remainder residual-cent allocator.
 *
 * V7 §4.1 Wave 0 acceptance 0-B — the three test vectors:
 *
 *   1. 10001 minor units, three payees at 1/3 each:
 *      floors = 3333, 3333, 3333; remainders (10001×1) mod 3 = 2 for each;
 *      residual = 10001 − 9999 = 2. Two residual units go to the two lowest
 *      payee-index positions (all remainders tied → tie-break by index ASC).
 *      Result: [3334, 3334, 3333]. Sum = 10001.
 *
 *   2. 1 minor unit at 80/20 (weights 4, 1):
 *      floors = 0, 0; remainders = (1×4) mod 5 = 4 and (1×1) mod 5 = 1;
 *      residual = 1. The 80% payee wins on remainder (4 > 1), NOT on tie-break.
 *      Result: [1, 0]. Sum = 1.
 *
 *   3. JPY (exponent 0), ¥100 to three payees at 1/3 each:
 *      floors = 33, 33, 33; remainders = 1, 1, 1; residual = 1.
 *      Result: [34, 33, 33]. Sum = 100. NO /100 formatting — the minor unit
 *      IS ¥1, which is why the exponent column exists.
 *
 * Tie-break rule (pinned per Opus v2 concern 8):
 *   Sort candidate indices by (remainder DESC, index ASC). The residual is
 *   distributed in that order, one unit per index, until the residual is zero.
 *
 * @param totalMinor Total minor units to allocate. Must be ≥ 0.
 * @param weights   Integer weights per payee. Must all be ≥ 0. Length ≥ 1.
 *                  A weight of 0 gets exactly 0 allocated.
 * @returns Array of integer minor units, same length as weights.
 *          Guaranteed: sum(result) === totalMinor, and each result[i] ≥ 0.
 * @throws {RangeError} when inputs violate the preconditions above.
 */
export function allocateResidualCents(
  totalMinor: bigint,
  weights: readonly bigint[],
): bigint[] {
  if (totalMinor < B_ZERO) {
    throw new RangeError("allocateResidualCents: totalMinor must be non-negative");
  }
  if (weights.length === 0) {
    throw new RangeError("allocateResidualCents: weights must be non-empty");
  }
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] < B_ZERO) {
      throw new RangeError(`allocateResidualCents: weights[${i}] must be non-negative`);
    }
  }
  const totalWeight = weights.reduce((acc, w) => acc + w, B_ZERO);
  if (totalWeight === B_ZERO) {
    // Everyone gets 0. If totalMinor > 0 with zero weight, throw — the caller
    // must not lose money silently.
    if (totalMinor !== B_ZERO) {
      throw new RangeError(
        "allocateResidualCents: totalMinor > 0 with zero total weight would drop money",
      );
    }
    return weights.map(() => B_ZERO);
  }

  // Step 1: floor allocation (Hamilton method).
  const floors: bigint[] = new Array(weights.length);
  const remainders: bigint[] = new Array(weights.length);
  let allocated = B_ZERO;
  for (let i = 0; i < weights.length; i++) {
    const product = totalMinor * weights[i];
    floors[i] = product / totalWeight;
    remainders[i] = product % totalWeight;
    allocated += floors[i];
  }

  // Step 2: residual = totalMinor - sum(floors). Distribute one unit each to
  // the indices with the largest remainders. Tie-break: index ASC.
  const residual = totalMinor - allocated;
  if (residual < B_ZERO) {
    // Should be impossible by construction, but guard anyway.
    throw new Error("allocateResidualCents: internal invariant violated (residual < 0)");
  }
  if (residual >= BigInt(weights.length)) {
    // Also impossible: residual is strictly less than n. If floors were all zero
    // and weights all positive, residual == totalMinor and total*weight[i]/totalWeight
    // is strictly less than totalMinor/1 == totalMinor when there are >=2 payees.
    // The single-payee case is the only place residual can equal 0-or-total, and
    // there residual is always 0 (floor divides exactly).
    throw new Error("allocateResidualCents: internal invariant violated (residual >= n)");
  }

  // Build sorted index list: (remainder DESC, index ASC).
  const order: number[] = weights.map((_, i) => i);
  order.sort((a, b) => {
    if (remainders[a] > remainders[b]) return -1;
    if (remainders[a] < remainders[b]) return 1;
    return a - b; // index ASC on tie
  });

  const result = [...floors];
  const residualN = Number(residual);
  for (let k = 0; k < residualN; k++) {
    result[order[k]] += B_ONE;
  }

  // Post-condition: sum matches totalMinor.
  const sum = result.reduce((acc, v) => acc + v, B_ZERO);
  if (sum !== totalMinor) {
    throw new Error(
      `allocateResidualCents: post-condition violated — sum ${sum} !== totalMinor ${totalMinor}`,
    );
  }
  return result;
}
