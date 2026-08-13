/**
 * WAVE 21 · ITEM 2 (REVIEW A CRITICAL) — cross-currency scalars.
 *
 * THE DEFECT. Three independent server sites added raw minor-unit integers
 * from DIFFERENT currencies into one number and then shipped it as a single
 * scalar: `partnerConsortiumRoutes` (`totalCommittedMinor`,
 * `totalFundedMinor`, monthly + tier totals, and `commissionEarnedMinor`
 * derived from them), `partnerBillingStore.commissionPositionByKind()`
 * (`pendingMinor`/`paidMinor` stamped `currency: "USD"`), and
 * `reportingEngineRoutes` (mixed flows into `computeFundMetrics`, then
 * PERSISTED under the first row's currency). 100 JPY + 100 USD-cents is not
 * 200 of anything. A `mixed: true` flag next to the number does not make the
 * addition valid, and the UI rendered the number anyway.
 *
 * THE CONTRACT ESTABLISHED HERE.
 *   • Minor units are only ever added WITHIN one currency code.
 *   • The authoritative shape is always the per-currency breakdown.
 *   • Where a payload/DB column structurally requires ONE scalar, this module
 *     returns an explicit `available: false` state carrying the currencies
 *     involved. Callers must render/persist that state, never a substitute
 *     number, and never a currency label that was not the source currency.
 *
 * OUT OF SCOPE (reported, not invented): there is no FX rate source in this
 * repository. Producing a real converted total would require net-new rate
 * ingestion, as-of-date semantics and an audit trail. This module therefore
 * signals `needs_fx_conversion` and stops. No rate is fabricated anywhere.
 */

/** A per-currency bucket of integer minor units. Currency codes are upper-case. */
export type CurrencyBuckets = Record<string, number>;

/**
 * A monetary scalar that is either a real single-currency amount or an
 * explicit, renderable unavailability.
 */
export type MoneyScalar =
  | {
      available: true;
      /** ISO 4217 code the `minor` value is denominated in. */
      currency: string;
      /** Integer minor units in `currency`. */
      minor: number;
    }
  | {
      available: false;
      currency: null;
      minor: null;
      /**
       * `needs_fx_conversion` — two or more currencies are present and no FX
       * source exists, so no single scalar can be produced honestly.
       * `no_data` — nothing to total.
       */
      reason: "needs_fx_conversion" | "no_data";
      /** Every currency that contributed, sorted, for the renderer. */
      currencies: string[];
    };

/** Normalize a currency code. Empty/absent input is rejected by the caller. */
export function normalizeCurrency(code: string | null | undefined): string {
  const c = String(code ?? "").trim().toUpperCase();
  return c;
}

/** Add `minor` into `buckets[currency]`, never across currencies. */
export function addToBucket(
  buckets: CurrencyBuckets,
  currency: string | null | undefined,
  minor: number,
): void {
  const cur = normalizeCurrency(currency) || "USD";
  buckets[cur] = (buckets[cur] ?? 0) + (Number(minor) || 0);
}

/**
 * Collapse per-currency buckets to a single scalar IF AND ONLY IF exactly one
 * currency is present. Otherwise return the explicit unavailable state.
 *
 * `emptyCurrency` lets a caller say "if there is genuinely nothing, report
 * zero in this currency" (the safe zero case: 0 is 0 in every currency).
 * Buckets that are present but zero still count as a currency.
 */
export function singleCurrencyScalar(
  buckets: CurrencyBuckets,
  emptyCurrency?: string,
): MoneyScalar {
  const currencies = Object.keys(buckets).sort();
  if (currencies.length === 0) {
    const c = normalizeCurrency(emptyCurrency);
    if (c) return { available: true, currency: c, minor: 0 };
    return { available: false, currency: null, minor: null, reason: "no_data", currencies: [] };
  }
  if (currencies.length === 1) {
    const c = currencies[0]!;
    return { available: true, currency: c, minor: buckets[c] ?? 0 };
  }
  return {
    available: false,
    currency: null,
    minor: null,
    reason: "needs_fx_conversion",
    currencies,
  };
}

/**
 * Apply a rate/percentage to a scalar. Unavailable in ⇒ unavailable out; a
 * derived figure can never be more available than its input. This is what
 * `commissionEarnedMinor` must use — Review A's line 178 computed commission
 * from a mixed sum.
 */
export function scaleScalar(s: MoneyScalar, factor: number): MoneyScalar {
  if (!s.available) return s;
  return { available: true, currency: s.currency, minor: Math.floor(s.minor * factor) };
}

/** Apply a factor to every bucket independently (commission per currency). */
export function scaleBuckets(buckets: CurrencyBuckets, factor: number): CurrencyBuckets {
  const out: CurrencyBuckets = {};
  for (const [c, v] of Object.entries(buckets)) out[c] = Math.floor(v * factor);
  return out;
}

/** Sorted `[{currency, minor}]` — the authoritative wire shape. */
export function bucketsToArray(buckets: CurrencyBuckets): Array<{ currency: string; minor: number }> {
  return Object.entries(buckets)
    .map(([currency, minor]) => ({ currency, minor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Merge two bucket maps per-currency (never across). */
export function mergeBuckets(a: CurrencyBuckets, b: CurrencyBuckets): CurrencyBuckets {
  const out: CurrencyBuckets = { ...a };
  for (const [c, v] of Object.entries(b)) out[c] = (out[c] ?? 0) + v;
  return out;
}

/**
 * Guard for durable writes. A snapshot/row that carries a single
 * `currency` + `amount_minor` pair must NEVER be written from mixed input.
 * Throws so the caller fails loudly rather than persisting invented money.
 */
export function assertPersistableScalar(s: MoneyScalar, context: string): asserts s is Extract<MoneyScalar, { available: true }> {
  if (!s.available) {
    throw new Error(
      `CROSS_CURRENCY_PERSIST_BLOCKED: ${context} — refusing to persist a single-currency ` +
        `snapshot from ${s.reason === "needs_fx_conversion" ? `mixed currencies [${s.currencies.join(", ")}]` : "no data"}. ` +
        `No FX conversion source exists in this system; see server/lib/currencyScalar.ts.`,
    );
  }
}
