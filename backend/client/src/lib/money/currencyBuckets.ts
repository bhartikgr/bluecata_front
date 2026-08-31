/**
 * WAVE 180 · ITEM A — CLIENT-SIDE CROSS-CURRENCY BUCKETS.
 *
 * THE DEFECT THIS CLOSES. Several client pages computed a headline total by
 * reducing per-row minor units into one number while the row's own ISO 4217
 * code sat unread on the same object, then printed the result under a
 * hardcoded label. Adding 100 JPY to 100 USD-cents produces 200 of nothing.
 *
 * THE CONTRACT. This module is the client mirror of the server contract in
 * server/lib/currencyScalar.ts and obeys the same three rules:
 *
 *   1. Minor units are only ever added WITHIN one currency code.
 *   2. The authoritative shape is the per-currency breakdown. A single scalar
 *      is produced ONLY when exactly one currency is present; otherwise the
 *      caller receives an explicit unavailable state carrying the currencies
 *      involved, and must render that state rather than a substitute number.
 *   3. NO EXCHANGE RATE IS INVENTED. This platform has no FX rate source; a
 *      real converted total would need rate ingestion, as-of-date semantics
 *      and an audit trail. This module signals and stops.
 *
 * TWO DIFFERENCES FROM THE SERVER MODULE, both deliberate:
 *
 *   • Accumulation is `bigint`, not `number`, following the wave 178 pattern in
 *     server/partnerWorkspaceStore.ts. A boundary conversion back to `number`
 *     is gated on Number.MAX_SAFE_INTEGER and returns the unavailable state
 *     rather than a silently rounded double.
 *   • A row whose code is not three A-Z letters is COUNTED AND EXCLUDED rather
 *     than defaulted into an arbitrary bucket. The count is part of the
 *     result so the page can state what it left out.
 */

/** A per-currency bucket of integer minor units, accumulated in bigint. */
export type CurrencyBucketMap = Map<string, bigint>;

/** The scalar half of the contract: a real amount, or a stated refusal. */
export type ClientMoneyScalar =
  | {
      available: true;
      /** ISO 4217 code the `minor` value is denominated in. */
      currency: string;
      /** Integer minor units in `currency`, safe for Number arithmetic. */
      minor: number;
    }
  | {
      available: false;
      currency: null;
      minor: null;
      /**
       * `needs_fx_conversion` — two or more currencies are present and this
       *   platform has no rate source, so no honest single figure exists.
       * `no_data`           — nothing was recorded to total.
       * `over_safe_integer` — the true total exceeds Number.MAX_SAFE_INTEGER,
       *   so returning a number would return a WRONG number.
       */
      reason: "needs_fx_conversion" | "no_data" | "over_safe_integer";
      /** Every currency that contributed, sorted, for the renderer. */
      currencies: string[];
    };

/** One row of the authoritative breakdown. */
export interface CurrencyBucketRow {
  currency: string;
  minor: number | null;
}

const ISO_4217 = /^[A-Z]{3}$/;
const MAX_EXACT = BigInt(Number.MAX_SAFE_INTEGER);

/** Upper-case and trim a currency code. Does not validate. */
export function normalizeCode(code: unknown): string {
  return String(code ?? "").trim().toUpperCase();
}

/** True when `code` is a well-formed three-letter ISO 4217 code. */
export function isIsoCode(code: unknown): boolean {
  return ISO_4217.test(normalizeCode(code));
}

/** A fresh empty bucket map. */
export function newBuckets(): CurrencyBucketMap {
  return new Map<string, bigint>();
}

/**
 * Add `minor` into the bucket for `code`, never across codes.
 *
 * Returns `true` when the row was counted and `false` when it was EXCLUDED
 * because its currency code is not ISO 4217. A `false` return is a fact the
 * caller must surface, not swallow: the alternative — defaulting the row into
 * a USD bucket — is how a foreign amount silently becomes a domestic one.
 */
export function addMinor(
  buckets: CurrencyBucketMap,
  code: unknown,
  minor: number | bigint | null | undefined,
): boolean {
  const c = normalizeCode(code);
  if (!ISO_4217.test(c)) return false;
  let delta: bigint;
  if (typeof minor === "bigint") delta = minor;
  else {
    const n = Number(minor ?? 0);
    if (!Number.isFinite(n)) return false;
    delta = BigInt(Math.trunc(n));
  }
  buckets.set(c, (buckets.get(c) ?? BigInt(0)) + delta);
  return true;
}

/**
 * Collapse buckets to one scalar IF AND ONLY IF exactly one currency is
 * present and the total is exactly representable as a Number.
 *
 * `emptyCurrency` lets a caller say "if genuinely nothing was recorded, report
 * zero in this currency" — 0 is 0 in every currency, so that zero is honest.
 * A bucket that exists but holds 0 still counts as a currency.
 */
export function singleScalar(
  buckets: CurrencyBucketMap,
  emptyCurrency?: string,
): ClientMoneyScalar {
  /* No `for…of` / spread over a Map anywhere in this module: tsconfig.json sets
   * no `target`, so Map iteration would need --downlevelIteration. `forEach` is
   * the shape that compiles unchanged under the tree's existing settings. */
  const currencies: string[] = [];
  buckets.forEach((_v, k) => { currencies.push(k); });
  currencies.sort();
  if (currencies.length === 0) {
    const c = normalizeCode(emptyCurrency);
    if (ISO_4217.test(c)) return { available: true, currency: c, minor: 0 };
    return { available: false, currency: null, minor: null, reason: "no_data", currencies: [] };
  }
  if (currencies.length > 1) {
    return {
      available: false,
      currency: null,
      minor: null,
      reason: "needs_fx_conversion",
      currencies,
    };
  }
  const only = currencies[0]!;
  const total = buckets.get(only) ?? BigInt(0);
  if (total > MAX_EXACT || total < -MAX_EXACT) {
    return {
      available: false,
      currency: null,
      minor: null,
      reason: "over_safe_integer",
      currencies,
    };
  }
  return { available: true, currency: only, minor: Number(total) };
}

/**
 * The authoritative breakdown: sorted `[{currency, minor}]`. A bucket whose
 * total exceeds Number.MAX_SAFE_INTEGER yields `minor: null` for that row
 * ALONE, so one unrepresentable currency does not erase the others.
 */
export function bucketRows(buckets: CurrencyBucketMap): CurrencyBucketRow[] {
  const out: CurrencyBucketRow[] = [];
  buckets.forEach((total, currency) => {
    out.push({
      currency,
      minor: total > MAX_EXACT || total < -MAX_EXACT ? null : Number(total),
    });
  });
  return out.sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Divide a bucket total by a whole number of periods, rounding half-up, with
 * no floating point anywhere. This replaces `sum(minor / 12)` accumulated as
 * doubles, which loses cents at scale and then hides the loss behind a single
 * trailing Math.round.
 */
export function dividedBuckets(buckets: CurrencyBucketMap, divisor: number): CurrencyBucketMap {
  const zero = BigInt(0);
  const d = BigInt(Math.trunc(divisor));
  const out = newBuckets();
  if (d === zero) return out;
  const half: bigint = d / BigInt(2);
  buckets.forEach((v, c) => {
    const q: bigint = v >= zero ? (v + half) / d : zero - ((zero - v + half) / d);
    out.set(c, q);
  });
  return out;
}

/** Merge two bucket maps per-currency (never across). */
export function mergeBucketMaps(a: CurrencyBucketMap, b: CurrencyBucketMap): CurrencyBucketMap {
  const out: CurrencyBucketMap = new Map<string, bigint>();
  a.forEach((v, c) => { out.set(c, v); });
  b.forEach((v, c) => { out.set(c, (out.get(c) ?? BigInt(0)) + v); });
  return out;
}
