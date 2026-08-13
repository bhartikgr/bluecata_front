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
 *      residual = 10001 − 9999 = 2. Remainders tie AND weights tie (all 1), so
 *      the comparator falls through to its final determinism fallback, index
 *      ASC, and the two residual units go to the two lowest payee-index
 *      positions. Result: [3334, 3334, 3333]. Sum = 10001.
 *
 *   2. 1 minor unit at 80/20 (weights 4, 1):
 *      floors = 0, 0; remainders = (1×4) mod 5 = 4 and (1×1) mod 5 = 1;
 *      residual = 1. The 80% payee wins on remainder (4 > 1), NOT on tie-break.
 *      Result: [1, 0]. Sum = 1.
 *
 *   3. JPY (exponent 0), ¥100 to three payees at 1/3 each:
 *      floors = 33, 33, 33; remainders = 1, 1, 1; residual = 1. Equal weights,
 *      so again index decides. Result: [34, 33, 33]. Sum = 100. NO /100
 *      formatting — the minor unit IS ¥1, which is why the exponent column
 *      exists.
 *
 *   4. WAVE 3D / ITEM 5 — tied remainders, UNEQUAL weights. 2 minor units,
 *      two payees with weights (1, 3): totalWeight = 4; products 2 and 6;
 *      floors = 0, 1; remainders = 2, 2 — a TIE; residual = 1.
 *        old rule (remainder DESC, index ASC):        [1, 1]
 *        new rule (remainder DESC, weight DESC, ...): [0, 2]
 *      The larger holder takes the residual cent. The total is unchanged (2)
 *      under both rules; only WHO receives the rounding changes.
 *
 * Tie-break rule (WAVE 3D / ITEM 5 — owner ruling 2026-08-10; supersedes the
 * index-ASC-only rule pinned per Opus v2 concern 8):
 *   Sort candidate indices by (remainder DESC, weight DESC, index ASC). The
 *   residual is distributed in that order, one unit per index, until the
 *   residual is zero.
 *
 *   WHY WEIGHT DESC. W3 REVIEW A measured the old rule over 100,000
 *   distributions with ten equal LPs: index 0 collected 19.996% of all residual
 *   cents and index 9 collected 0% — $900.80 of deterministic advantage. Fixed
 *   first-position ordering is an implementation artifact, not a policy, and is
 *   hard to defend in an audit. Awarding the residual to the LARGEST HOLDER is
 *   standard fund-admin practice: the rounding lands where it is least
 *   material.
 *
 *   HONEST LIMIT. When weights are EQUAL the weights tie too and the comparator
 *   falls through to index ASC, so the equal-weight bias the review measured is
 *   REDUCED (any unequal-weight register is now ordered by materiality) but NOT
 *   ELIMINATED. Fully removing it needs a persisted rotating residual cursor,
 *   which is deliberately not built in this wave.
 *
 *   The function stays PURE and reproducible: the comparator is a total order
 *   on (remainder, weight, index), so the same inputs always give the same
 *   outputs.
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

  // Build sorted index list: (remainder DESC, weight DESC, index ASC).
  // WAVE 3D / ITEM 5 (owner ruling 2026-08-10): when remainders tie, the LARGER
  // HOLDER takes the residual cent — standard fund-admin practice, because the
  // rounding lands where it is least material. `index ASC` remains ONLY as the
  // final determinism fallback so the function stays pure and reproducible.
  // See the tie-break block in this file's allocator doc comment for the
  // measured bias this replaces and for the honest limit (equal weights still
  // fall through to index).
  const order: number[] = weights.map((_, i) => i);
  order.sort((a, b) => {
    if (remainders[a] > remainders[b]) return -1;
    if (remainders[a] < remainders[b]) return 1;
    if (weights[a] > weights[b]) return -1; // weight DESC on remainder tie
    if (weights[a] < weights[b]) return 1;
    return a - b; // index ASC — final determinism fallback only
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

/* ══════════════════════════════════════════════════════════════════════════
 * WAVE 3B — MC-1 / P-5. Single-pass distribution allocation.
 *
 * WHY THIS EXISTS
 * ---------------
 * `spvEngineStore.recordDistribution` used to compute money like this:
 *
 *     gpCarryMinor       = Math.round(carryBase * gpCarryPct);
 *     platformCarryMinor = Math.round(carryBase * platCarryPct);
 *     grossShare_i       = Math.round(gross * ownershipPct_i);
 *     carryShare_i       = Math.round(totalCarry * ownershipPct_i);
 *
 * Five INDEPENDENT roundings against float percentages. Two consequences, both
 * on the persisted money path:
 *
 *   (1) CENTS ARE NOT CONSERVED. `sum_i grossShare_i` need not equal `gross`
 *       and `sum_i carryShare_i` need not equal `totalCarry`. Money is created
 *       or destroyed at the cent level on every distribution.
 *   (2) COMBINED CARRY CAN EXCEED THE BASE. `addFee` validates each carryPct
 *       in [0,1] separately and never checks the SUM, so 0.6 GP + 0.6 platform
 *       yields totalCarry = 1.2 × base, `distributable` goes negative, and so
 *       does every LP's `netMinor`.
 *
 * THE FIX — ONE NESTED PASS, NOT SEVERAL INDEPENDENT ONES
 * -------------------------------------------------------
 * Every split below is an integer largest-remainder allocation performed by
 * `allocateResidualCents` (tie-break: remainder DESC, weight DESC, index ASC —
 * WAVE 3D / ITEM 5, owner ruling 2026-08-10; the rule is documented in the
 * tie-break block of this file's allocator doc comment and implemented in the
 * `order.sort` comparator inside `allocateResidualCents`).
 *
 * NOTE ON THE DDL: `allocation_rule` carries
 * `CHECK (tie_break = 'remainder_desc_index_asc')` at
 * server/db/connection.ts:856-873. That table is created by DDL and is NEVER
 * read or written by any production code path — only tests insert into it — so
 * the rule change above has no behavioural conflict with it and needs no
 * migration. `connection.ts` is SACRED and was not touched. Wiring
 * `allocation_rule` to the allocator (and then reconciling its CHECK) is a real
 * follow-up, logged in build_log/WAVE3D_REPORT.md; it is net-new functionality
 * and the standing instruction is repair-only.
 * Each level takes its WEIGHTS FROM THE LEVEL ABOVE, which is what makes the
 * per-LP inequalities provable rather than hoped-for:
 *
 *   L1  carryBase          -> [gpCarry, platformCarry, retainedBase]
 *       weights [gpScaled, platScaled, SCALE - gpScaled - platScaled].
 *       Exactness: the three sum to carryBase by the allocator post-condition.
 *       Consequence: gpCarry + platformCarry <= carryBase ALWAYS. There is no
 *       second rounding that can push the pair past the base.
 *
 *   L2  gross              -> [g_1 .. g_n]   weights = LP commitments
 *       Exactness: sum_i g_i === gross.
 *
 *   L3  totalCarry         -> [c_1 .. c_n]   weights = the L2 result g_i
 *       Exactness: sum_i c_i === totalCarry.
 *       Per-LP safety: c_i <= g_i. Proof — with C = totalCarry, G = gross,
 *       C <= G. Largest-remainder gives c_i <= floor(C*g_i/G) + 1. If C < G
 *       then C*g_i/G < g_i so floor(C*g_i/G) <= g_i - 1 and c_i <= g_i. If
 *       C === G every remainder is 0, the residual is 0, and c_i === g_i.
 *       A weight of 0 receives 0, so g_i = 0 gives c_i = 0.
 *       THIS is the step that a second INDEPENDENT largest-remainder pass over
 *       ownership percentages gets wrong: two passes with the same weights can
 *       hand the residual cent of the carry pass to an LP that did not win the
 *       residual cent of the gross pass, producing c_i = g_i + 1 and a NEGATIVE
 *       net for that LP.
 *
 *   L4  gpCarry            -> [gp_1 .. gp_n] weights = the L3 result c_i
 *       platform_i = c_i - gp_i, which is >= 0 by the same proof as L3 and
 *       sums to totalCarry - gpCarry === platformCarry exactly. Both column
 *       sums and both row sums are therefore exact simultaneously.
 *
 *   net_i = g_i - c_i >= 0, and sum_i net_i === gross - totalCarry.
 *
 * Every one of those equalities is re-asserted at run time below. A violated
 * assertion THROWS. It does not log and continue: the caller
 * (`recordDistribution`) performs no write before this function returns, so a
 * throw aborts the distribution with nothing persisted.
 *
 * PERCENTAGES ARE FRACTIONS (owner's ruling): 0.2 means 20%. Nothing here
 * multiplies or divides by 100.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Fixed-point scale used to turn a fractional rate into an integer weight.
 *  1e9 keeps nine significant digits of a fraction — far finer than any rate a
 *  fee row can express — while staying inside Number.MAX_SAFE_INTEGER when
 *  multiplied by realistic minor-unit amounts inside BigInt math. */
export const CARRY_FRACTION_SCALE = 1000000000;

/** The number of decimal places CARRY_FRACTION_SCALE can represent EXACTLY.
 *  1e9 === 10^9, so nine. Anything finer is not representable on this scale
 *  and is REJECTED rather than silently rounded (WAVE 3D / ITEM 4). */
export const CARRY_FRACTION_DECIMALS = 9;

const B_SCALE = BigInt(CARRY_FRACTION_SCALE);
const B_TEN = BigInt(10);

/** 10^n as a bigint, without floating point. */
function pow10(n: number): bigint {
  let out = BigInt(1);
  for (let i = 0; i < n; i++) out *= B_TEN;
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * WAVE 3D / ITEM 4 — EXACT FIXED-SCALE RATE ARITHMETIC.
 *
 * THE DEFECT (W3 REVIEW A, "the cap accepts a mathematically over-cap decimal
 * pair", money.ts:322-359 in the reviewed artifact):
 *
 *     fractionToScaled(v) = BigInt(Math.round(v * CARRY_FRACTION_SCALE))
 *
 * `Math.round(0.5000000000000001 * 1e9)` is 500000000 and
 * `Math.round(0.5 * 1e9)` is 500000000, so the pair summed to exactly 1e9 and
 * was ACCEPTED, even though the two rates are mathematically 1.0000000000000001
 * — over a cap of 1. The binary double `0.5000000000000001` carries seventeen
 * significant decimal digits; the supported scale carries nine. The old code
 * silently rounded the excess away, which is precisely how an over-cap pair
 * walked through the guard.
 *
 * THE FIX: convert through the rate's SHORTEST EXACT DECIMAL representation
 * (`String(v)`, which round-trips the double uniquely) using integer/BigInt
 * arithmetic only, and THROW when the decimal carries more than
 * CARRY_FRACTION_DECIMALS fractional digits. No multiplication by 1e9 in binary
 * floating point happens anywhere on this path.
 *
 *   0.2                 -> "0.2"                -> 200000000  (exact, accepted)
 *   1                   -> "1"                  -> 1000000000 (exact, accepted)
 *   1e-9                -> "1e-9"               -> 1          (exact, accepted)
 *   0.5000000000000001  -> "0.5000000000000001" -> REJECTED
 *                          DISTRIBUTION_ALLOCATION_RATE_PRECISION_UNSUPPORTED
 *
 * Rejecting is the required behaviour: the reviewer's rule is "reject precision
 * beyond the supported scale rather than silently rounding it."
 * ══════════════════════════════════════════════════════════════════════════ */

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Exact decimal string -> integer on CARRY_FRACTION_SCALE. Pure BigInt.
 *
 * @throws `DISTRIBUTION_ALLOCATION_INVALID_RATE:<label>` — unparseable, signed
 *   negative, or outside [0,1].
 * @throws `DISTRIBUTION_ALLOCATION_RATE_PRECISION_UNSUPPORTED:<label>` — the
 *   value needs more than CARRY_FRACTION_DECIMALS fractional decimal digits.
 */
export function decimalStringToCarryScaled(s: string, label: string): bigint {
  const m = DECIMAL_RE.exec(s.trim());
  if (!m) throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_RATE:${label}`);
  const [, sign, intPartRaw, fracPartRaw, expRaw] = m;
  const intPart = intPartRaw ?? "";
  const fracPart = fracPartRaw ?? "";
  if (intPart === "" && fracPart === "") {
    throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_RATE:${label}`);
  }
  if (sign === "-" && /[1-9]/.test(intPart + fracPart)) {
    throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_RATE:${label}`);
  }
  const exp = expRaw ? parseInt(expRaw, 10) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 400) {
    throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_RATE:${label}`);
  }
  const digits = BigInt((intPart === "" ? "0" : intPart) + fracPart);

  // value = digits * 10^(exp - fracPart.length); we want value * 10^DECIMALS.
  const shift = exp - fracPart.length + CARRY_FRACTION_DECIMALS;
  let scaled: bigint;
  if (shift >= 0) {
    scaled = digits * pow10(shift);
  } else {
    const divisor = pow10(-shift);
    if (digits % divisor !== B_ZERO) {
      // Precision beyond the supported scale. REJECT — never round.
      throw new Error(`DISTRIBUTION_ALLOCATION_RATE_PRECISION_UNSUPPORTED:${label}`);
    }
    scaled = digits / divisor;
  }
  if (scaled < B_ZERO || scaled > B_SCALE) {
    throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_RATE:${label}`);
  }
  return scaled;
}

/**
 * A JS `number` rate in [0,1] -> an exact integer on CARRY_FRACTION_SCALE.
 *
 * Goes through `String(v)`, the shortest decimal that round-trips the double,
 * so the comparison downstream is exact fixed-scale integer arithmetic and
 * never a binary-float sum. Rates finer than CARRY_FRACTION_DECIMALS are
 * rejected, not rounded.
 */
export function exactFractionToCarryScaled(v: number, label: string): bigint {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_RATE:${label}`);
  }
  if (v < 0 || v > 1) throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_RATE:${label}`);
  return decimalStringToCarryScaled(String(v), label);
}

export interface DistributionAllocationInput {
  /** Total proceeds for the event, in minor units. Must be an integer >= 0. */
  grossMinor: number;
  /** The profit the carry is charged on, in minor units. 0 <= base <= gross. */
  carryBaseMinor: number;
  /** GP carry as a FRACTION (0.2 = 20%). */
  gpCarryFraction: number;
  /** Platform carry as a FRACTION (0.05 = 5%). */
  platformCarryFraction: number;
  /** Per-LP integer weights (commitment minor units), in register order. */
  lpWeightsMinor: readonly number[];
  /** Combined-carry cap as a FRACTION. Defaults to 1 (100% of the base).
   *  Prefer `combinedCarryCapScaled` — a DB-derived exact integer on
   *  CARRY_FRACTION_SCALE — for the persisted path (WAVE 3D / ITEM 3). */
  combinedCarryCapFraction?: number;
  /** WAVE 3D / ITEM 3 — the cap as an EXACT integer on CARRY_FRACTION_SCALE,
   *  as resolved from durable DB configuration. Takes precedence over
   *  `combinedCarryCapFraction` when supplied; no float ever touches it. */
  combinedCarryCapScaled?: number | bigint;
}

export interface DistributionLpAllocation {
  grossMinor: number;
  carryMinor: number;
  gpCarryMinor: number;
  platformCarryMinor: number;
  netMinor: number;
}

export interface DistributionAllocationResult {
  grossMinor: number;
  carryBaseMinor: number;
  gpCarryMinor: number;
  platformCarryMinor: number;
  /** carryBase left with the LPs after both carry legs. */
  retainedCarryBaseMinor: number;
  totalCarryMinor: number;
  /** gross - totalCarry. Guaranteed >= 0. */
  distributableMinor: number;
  perLp: DistributionLpAllocation[];
}

function requireIntMinor(v: number, label: string): bigint {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
    throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_INPUT:${label}`);
  }
  if (!Number.isSafeInteger(v)) throw new Error(`DISTRIBUTION_ALLOCATION_INVALID_INPUT:${label}`);
  return BigInt(v);
}

/** A fraction in [0,1] -> an EXACT integer weight on CARRY_FRACTION_SCALE.
 *  WAVE 3D / ITEM 4: this used to be `BigInt(Math.round(v * SCALE))`, which
 *  silently rounded unsupported precision away and let an over-cap decimal pair
 *  through. It now rejects that input. See the block comment above
 *  `decimalStringToCarryScaled`. */
function fractionToScaled(v: number, label: string): bigint {
  return exactFractionToCarryScaled(v, label);
}

/** Resolve the cap to an exact scaled integer, preferring the DB-derived
 *  integer over the legacy fractional form. */
function resolveCapScaled(input: DistributionAllocationInput): bigint {
  if (input.combinedCarryCapScaled !== undefined && input.combinedCarryCapScaled !== null) {
    const raw = input.combinedCarryCapScaled;
    const asBig = typeof raw === "bigint" ? raw : BigInt(Math.trunc(raw));
    if (typeof raw === "number" && !Number.isSafeInteger(raw)) {
      throw new Error("DISTRIBUTION_ALLOCATION_INVALID_RATE:combinedCarryCapScaled");
    }
    if (asBig < B_ZERO || asBig > B_SCALE) {
      throw new Error("DISTRIBUTION_ALLOCATION_INVALID_RATE:combinedCarryCapScaled");
    }
    return asBig;
  }
  return fractionToScaled(
    input.combinedCarryCapFraction === undefined ? 1 : input.combinedCarryCapFraction,
    "combinedCarryCapFraction",
  );
}

/**
 * WAVE 3D / ITEM 2 — the per-LP net post-condition, EXTRACTED SO IT CAN BE
 * KILLED BY A TEST.
 *
 * W3 REVIEW A's mutation matrix found that deleting this assertion in place
 * left all 22 tests green (`net_assertion_deleted` SURVIVED), and that combined
 * with a de-nested L3 it produced a NEGATIVE net that the suite still accepted.
 *
 * THE HONEST DIFFICULTY. When the allocator is correct this assertion is
 * UNREACHABLE: the L3 nesting invariant proves c_i <= g_i, so `net` is never
 * negative and no input can make the inline `if` fire. A behavioural test
 * therefore CANNOT kill an inline deletion of it — that is a property of
 * defence-in-depth code, not a gap in the tests.
 *
 * Extracting it into this named, exported function converts an untestable
 * inline branch into two things that ARE testable, which together cover both
 * ways the protection can be removed:
 *
 *   (a) DELETING THE LOGIC — killed behaviourally by MONEY-NET-ASSERT-* in
 *       server/__tests__/wave3b_mc1_cent_conservation.test.ts, which calls this
 *       function directly with a negative net and requires the throw.
 *   (b) DELETING THE CALL SITE — killed by the source assertion in the same
 *       suite, which requires `assertPerLpNetNonNegative(i, g, c);` to appear
 *       inside the per-LP loop of `allocateDistributionMinor`.
 *
 * The thrown message and its shape are UNCHANGED from the inline version, so
 * nothing downstream that matches on `DISTRIBUTION_ALLOCATION_NET_NEGATIVE` is
 * affected.
 *
 * @param index Payee index, echoed into the error for triage.
 * @param grossMinor  The LP's allocated gross, in minor units.
 * @param carryMinor  The LP's allocated carry, in minor units.
 * @throws {Error} `DISTRIBUTION_ALLOCATION_NET_NEGATIVE:index=..:gross=..:carry=..`
 *         when carry exceeds gross, i.e. when the LP would be paid a negative net.
 */
export function assertPerLpNetNonNegative(
  index: number,
  grossMinor: bigint,
  carryMinor: bigint,
): void {
  if (grossMinor - carryMinor < B_ZERO) {
    throw new Error(
      `DISTRIBUTION_ALLOCATION_NET_NEGATIVE:index=${index}:gross=${grossMinor}:carry=${carryMinor}`,
    );
  }
}

/**
 * WAVE 3B / MC-1 — the ONE allocation pass. Pure: no DB, no clock, no IO.
 *
 * @throws {Error} `COMBINED_CARRY_EXCEEDS_CAP` when gpCarryFraction +
 *   platformCarryFraction exceeds the cap (default 1). The caller must invoke
 *   this BEFORE writing anything, so the throw is the rejection.
 * @throws {Error} `CARRY_BASE_EXCEEDS_GROSS` when the carry base is larger than
 *   the proceeds it is charged against.
 * @throws {Error} `DISTRIBUTION_ZERO_LP_WEIGHT` when there is money to allocate
 *   but every LP weight is zero (money would silently vanish).
 * @throws {Error} `DISTRIBUTION_ALLOCATION_NOT_CONSERVED` / `..._NET_NEGATIVE`
 *   when a post-condition fails. These abort the write; they never warn.
 */
export function allocateDistributionMinor(
  input: DistributionAllocationInput,
): DistributionAllocationResult {
  const gross = requireIntMinor(input.grossMinor, "grossMinor");
  const carryBase = requireIntMinor(input.carryBaseMinor, "carryBaseMinor");
  if (carryBase > gross) throw new Error("CARRY_BASE_EXCEEDS_GROSS");

  const gpScaled = fractionToScaled(input.gpCarryFraction, "gpCarryFraction");
  const platScaled = fractionToScaled(input.platformCarryFraction, "platformCarryFraction");
  const capScaled = resolveCapScaled(input);

  // ── THE COMBINED-CARRY REJECTION. Before any allocation, before any write. ──
  if (gpScaled + platScaled > capScaled) {
    throw new Error("COMBINED_CARRY_EXCEEDS_CAP");
  }

  const weights: bigint[] = [];
  for (let i = 0; i < input.lpWeightsMinor.length; i++) {
    weights.push(requireIntMinor(input.lpWeightsMinor[i], `lpWeightsMinor[${i}]`));
  }
  if (weights.length === 0) throw new Error("DISTRIBUTION_ZERO_LP_WEIGHT");
  const weightTotal = weights.reduce((a, w) => a + w, B_ZERO);
  if (weightTotal === B_ZERO && gross > B_ZERO) throw new Error("DISTRIBUTION_ZERO_LP_WEIGHT");

  // L1 — carry base into [gp, platform, retained]. One allocation, so the two
  //      carry legs can never jointly exceed the base.
  //      The third weight is the LPs' retained share of the base, so the three
  //      weights always sum to CARRY_FRACTION_SCALE and the split is exact.
  const retainedScaled = B_SCALE - gpScaled - platScaled;
  const [gpCarry, platCarry, retained] = allocateResidualCents(carryBase, [
    gpScaled,
    platScaled,
    retainedScaled,
  ]);
  const totalCarry = gpCarry + platCarry;

  // L2 — gross across LPs by commitment weight.
  const lpGross = gross === B_ZERO
    ? weights.map(() => B_ZERO)
    : allocateResidualCents(gross, weights);

  // L3 — total carry across LPs, WEIGHTED BY THE L2 RESULT. This is what makes
  //      c_i <= g_i provable rather than accidental.
  const lpCarry = totalCarry === B_ZERO
    ? lpGross.map(() => B_ZERO)
    : allocateResidualCents(totalCarry, lpGross);

  // L4 — the GP leg across LPs, WEIGHTED BY THE L3 RESULT; the platform leg is
  //      the exact complement, so both column sums stay exact.
  const lpGpCarry = gpCarry === B_ZERO
    ? lpCarry.map(() => B_ZERO)
    : allocateResidualCents(gpCarry, lpCarry);

  const perLp: DistributionLpAllocation[] = [];
  let sumGross = B_ZERO;
  let sumCarry = B_ZERO;
  let sumGp = B_ZERO;
  let sumPlat = B_ZERO;
  let sumNet = B_ZERO;
  for (let i = 0; i < weights.length; i++) {
    const g = lpGross[i];
    const c = lpCarry[i];
    const gp = lpGpCarry[i];
    const pl = c - gp;
    const net = g - c;
    // Per-LP assertions. Each ABORTS.
    assertPerLpNetNonNegative(i, g, c);
    if (pl < B_ZERO || gp < B_ZERO) {
      throw new Error(`DISTRIBUTION_ALLOCATION_NET_NEGATIVE:index=${i}:carryLeg`);
    }
    if (gp + pl !== c) {
      throw new Error(`DISTRIBUTION_ALLOCATION_NOT_CONSERVED:lpCarryLegs:index=${i}`);
    }
    sumGross += g;
    sumCarry += c;
    sumGp += gp;
    sumPlat += pl;
    sumNet += net;
    perLp.push({
      grossMinor: Number(g),
      carryMinor: Number(c),
      gpCarryMinor: Number(gp),
      platformCarryMinor: Number(pl),
      netMinor: Number(net),
    });
  }

  // ── EXACT-SUM ASSERTIONS. Every component sums EXACTLY to its total. ──
  const distributable = gross - totalCarry;
  const checks: Array<[string, bigint, bigint]> = [
    ["lpGross", sumGross, gross],
    ["lpCarry", sumCarry, totalCarry],
    ["lpGpCarry", sumGp, gpCarry],
    ["lpPlatformCarry", sumPlat, platCarry],
    ["lpNet", sumNet, distributable],
    ["carryBase", gpCarry + platCarry + retained, carryBase],
  ];
  for (let i = 0; i < checks.length; i++) {
    const [label, got, want] = checks[i];
    if (got !== want) {
      throw new Error(`DISTRIBUTION_ALLOCATION_NOT_CONSERVED:${label}:got=${got}:want=${want}`);
    }
  }
  if (distributable < B_ZERO) {
    throw new Error(`DISTRIBUTION_ALLOCATION_NET_NEGATIVE:distributable=${distributable}`);
  }

  return {
    grossMinor: Number(gross),
    carryBaseMinor: Number(carryBase),
    gpCarryMinor: Number(gpCarry),
    platformCarryMinor: Number(platCarry),
    retainedCarryBaseMinor: Number(retained),
    totalCarryMinor: Number(totalCarry),
    distributableMinor: Number(distributable),
    perLp,
  };
}

/* ===========================================================================
 * WAVE 18 (ORP-040) — exact decimal-string → integer minor units.
 *
 * WHY THIS EXISTS. `captableCommitStore.LedgerEntry.amount` is a decimal string
 * in MAJOR units ("1500000.00"), while every display path in this project takes
 * integer MINOR units and renders through `formatMinor` (ISO-4217 exponent
 * aware). Wiring the investor activity feed (`GET /api/investor/activity`,
 * server/routes.ts) therefore needed a conversion, and the two obvious ones are
 * both forbidden here:
 *
 *   • `Number(amount) * 100`        — hardcodes a 2-decimal exponent. JPY (0)
 *                                     would be inflated 100×, KWD (3) shrunk.
 *   • `toMinor(Number(amount), cur)`— routes the value through a binary double
 *                                     and then a `Math.round`. Fine for a
 *                                     user-typed number, wrong for a ledger
 *                                     value that is already exact in decimal.
 *
 * This function is pure BigInt string arithmetic: no float ever holds the value,
 * and a value carrying MORE fractional digits than the currency can represent is
 * REJECTED rather than rounded. Rounding a ledger amount to make it displayable
 * is exactly the class of silent corruption this codebase keeps paying for.
 *
 * Signed values are accepted (unlike `decimalStringToCarryScaled`, which is a
 * rate parser bounded to [0,1]); a ledger can legitimately carry a negative.
 * ======================================================================== */

/**
 * Exact decimal string in MAJOR units -> integer MINOR units for `currency`.
 *
 * @throws `MONEY_DECIMAL_INVALID:<label>` — unparseable or empty.
 * @throws `MONEY_DECIMAL_PRECISION_UNSUPPORTED:<label>` — more fractional
 *   digits than the currency's ISO-4217 exponent allows. NEVER rounded.
 */
export function decimalStringToMinor(
  s: string,
  currency: string,
  label = "amount",
): bigint {
  const m = DECIMAL_RE.exec(String(s).trim());
  if (!m) throw new Error(`MONEY_DECIMAL_INVALID:${label}`);
  const [, sign, intPartRaw, fracPartRaw, expRaw] = m;
  const intPart = intPartRaw ?? "";
  const fracPart = fracPartRaw ?? "";
  if (intPart === "" && fracPart === "") {
    throw new Error(`MONEY_DECIMAL_INVALID:${label}`);
  }
  const exp = expRaw ? parseInt(expRaw, 10) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 400) {
    throw new Error(`MONEY_DECIMAL_INVALID:${label}`);
  }
  const digits = BigInt((intPart === "" ? "0" : intPart) + fracPart);
  // value = digits * 10^(exp - fracLen); we want value * 10^currencyExponent.
  const shift = exp - fracPart.length + currencyExponent(currency);
  let scaled: bigint;
  if (shift >= 0) {
    scaled = digits * pow10(shift);
  } else {
    const divisor = pow10(-shift);
    if (digits % divisor !== B_ZERO) {
      // e.g. "0.005" in USD (exponent 2) — half a cent. REJECT, never round.
      throw new Error(`MONEY_DECIMAL_PRECISION_UNSUPPORTED:${label}`);
    }
    scaled = digits / divisor;
  }
  return sign === "-" ? -scaled : scaled;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 35 · F5 — CROSS-CURRENCY MINOR-UNIT CONVERSION
 *
 * An entirely unexamined defect class, found by Review A. Four shipped sites
 * did:
 *
 *     Math.round(amountMinor * fxRate)
 *
 * That is only correct when BOTH currencies have the SAME ISO-4217 exponent.
 * An FX rate quotes MAJOR units per MAJOR unit (1 JPY = 0.0067 USD), so the
 * conversion has to re-scale by BOTH exponents:
 *
 *     minorB = minorA / 10^expA * rate * 10^expB
 *            = minorA * rate * 10^(expB - expA)
 *
 * ¥1,000,000 (JPY, exponent 0 → 1,000,000 minor) at rate 0.0067:
 *     WRONG: round(1_000_000 * 0.0067)            =     6_700  → $67.00
 *     RIGHT: round(1_000_000 * 0.0067 * 10^(2-0)) =   670_000  → $6,700.00
 * Off by exactly 100×.
 *
 * WHY IT HID: the EUR→USD pole (exponent 2 → 2) has a scale factor of
 * 10^0 = 1, so every same-exponent test passes against the defect AND against
 * the fix. Two of the four sites are LIVE WRITE PATHS that persist an SPV's
 * `totalCommittedMinor`.
 *
 * THE SECOND HALF OF THE DEFECT: all four sites fell back to the RAW amount
 * when no rate was supplied — silently adding ¥ to a $ total. Adding two
 * different currencies is not a rounding error, it is a meaningless number.
 * This helper REFUSES; the caller must surface the refusal.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ConvertMinorResult =
  | {
      ok: true;
      /** Integer minor units denominated in `toCurrency`. */
      minor: number;
      /** 10^(expTo - expFrom). 1 when the exponents match — which is exactly
       *  why the EUR→USD pole never revealed the defect. */
      exponentScale: number;
      /** True when no conversion was needed (same currency). */
      identity: boolean;
    }
  | {
      ok: false;
      /**
       * `missing_rate`  — the currencies differ and no usable rate was given.
       *                   The caller must NOT raw-sum; it must refuse.
       * `invalid_amount`— the source amount is not a finite integer.
       */
      reason: "missing_rate" | "invalid_amount";
      fromCurrency: string;
      toCurrency: string;
      message: string;
    };

/**
 * Convert an integer minor-unit amount from one currency to another, re-scaling
 * by BOTH ISO-4217 exponents. Returns a discriminated result rather than a
 * number so that "I cannot convert this" is impossible to ignore: there is no
 * value to accidentally add to a total.
 *
 * @param amountMinor integer minor units in `fromCurrency`
 * @param fromCurrency ISO-4217 code of the amount
 * @param toCurrency   ISO-4217 code to convert into (e.g. the vehicle's base)
 * @param rate         MAJOR-per-MAJOR FX rate; may be a decimal string
 */
export function convertMinorUnits(
  amountMinor: number,
  fromCurrency: string | null | undefined,
  toCurrency: string | null | undefined,
  rate: number | string | null | undefined,
): ConvertMinorResult {
  const from = String(fromCurrency ?? "").toUpperCase();
  const to = String(toCurrency ?? "").toUpperCase();

  if (!Number.isFinite(amountMinor) || !Number.isInteger(amountMinor)) {
    return {
      ok: false,
      reason: "invalid_amount",
      fromCurrency: from,
      toCurrency: to,
      message: `amountMinor must be a finite integer (got ${String(amountMinor)}).`,
    };
  }

  /* Same currency (or an unknown/absent target we cannot distinguish from the
     source): nothing to convert. A rate is irrelevant and is ignored — it can
     never silently rescale a same-currency amount. */
  if (from === to || !from || !to) {
    return { ok: true, minor: amountMinor, exponentScale: 1, identity: true };
  }

  const rateNum = typeof rate === "string" ? Number(rate) : rate;
  if (rateNum == null || !Number.isFinite(rateNum) || rateNum <= 0) {
    return {
      ok: false,
      reason: "missing_rate",
      fromCurrency: from,
      toCurrency: to,
      message:
        `Cannot convert ${from} into ${to}: no usable FX rate was supplied. ` +
        `Raw-summing across currencies would produce a meaningless total, so ` +
        `this amount is refused rather than silently added.`,
    };
  }

  const expFrom = currencyExponent(from);
  const expTo = currencyExponent(to);
  const exponentScale = Math.pow(10, expTo - expFrom);

  return {
    ok: true,
    minor: Math.round(amountMinor * rateNum * exponentScale),
    exponentScale,
    identity: false,
  };
}
