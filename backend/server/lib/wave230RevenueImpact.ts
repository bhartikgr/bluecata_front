/**
 * WAVE 230 — THE MONEY. BEFORE AND AFTER, EXPLICITLY, NEVER SILENTLY.
 *
 * R228.2, in full:
 *
 *   "If those subscriptions are test data, then the platform's reported MRR is
 *    not real revenue — and that is a far more serious matter than a screen
 *    looking untidy, because a reported MRR figure is the kind of number that
 *    reaches an investor. Marking them excludes them from the figure, which will
 *    make reported MRR FALL, CORRECTLY.
 *    RULING: the wave must report the before-and-after MRR explicitly and
 *    prominently, and must never adjust a money figure silently. A dashboard
 *    number changing without explanation is how the eleven fabricated prices
 *    survived."
 *
 * This module exists so that the fall in reported revenue is a REPORTED RESULT
 * and not a side effect. It computes both figures and the difference, per
 * currency, and hands all three to the caller. A surface that shows the new
 * number without the old one is not using this module correctly.
 *
 * ── ARITHMETIC RULES, OBEYED LITERALLY ────────────────────────────────────────
 *  · All sums are `bigint`. There is no `Number()`, `parseInt` or `parseFloat`
 *    anywhere in this file, and no floating-point addition of a money value.
 *  · Every value read from the database is GATED against Number.MAX_SAFE_INTEGER
 *    before it is admitted, and a value that fails the gate is REPORTED as
 *    unreadable rather than silently coerced, truncated or skipped.
 *  · Currencies are NEVER summed together and NEVER converted. R230.1 records
 *    that a single ¥1,200,000 subscription once added 12,000 to "ARR in USD".
 *    Each currency is reported on its own line, in its own minor units.
 *  · No price is hardcoded. Every amount comes from the row's own
 *    `annual_amount_minor`.
 *
 * ── HONEST ABSENCE (R224.1) ───────────────────────────────────────────────────
 * `unreadable` is a COUNT, surfaced to the caller. If a row's amount could not
 * be admitted, the totals are still correct for the rows that could be — but the
 * caller is told that the picture is incomplete, so it can render that rather
 * than present a clean-looking total. A total that quietly omitted a row it
 * could not parse would be an absence rendering as reassurance.
 */

import { getDbDriver, rawDb } from "../db/connection";
import { log } from "./logger";
import { WAVE230_AT_COLUMN, wave230ColumnsPresent } from "./wave230TestDataFlags";

/** The statuses the platform counts as revenue today. Unchanged by this wave. */
const REVENUE_STATUSES = ["active", "trialing"] as const;

export interface Wave230CurrencyImpact {
  currency: string;
  /** Reported today: every revenue-status subscription. Minor units. */
  beforeMinor: bigint;
  /** Reported after exclusion. Minor units. Always <= beforeMinor. */
  afterMinor: bigint;
  /** beforeMinor - afterMinor. The correction, stated as its own number. */
  excludedMinor: bigint;
  /** How many subscriptions make up `excludedMinor`. */
  excludedCount: number;
  /** How many remain in `afterMinor`. */
  keptCount: number;
}

export interface Wave230RevenueImpact {
  /** False when migration 0229 has not reached this database. */
  installed: boolean;
  /** Per currency, never summed across. */
  byCurrency: Wave230CurrencyImpact[];
  /**
   * Rows whose amount failed the MAX_SAFE_INTEGER gate or was not an integer.
   * Reported, never silently dropped. A non-zero value means the totals below
   * are incomplete and the consuming surface must say so.
   */
  unreadable: number;
  /**
   * True when the figures could not be computed at all. The consuming surface
   * must render a dash, NEVER a zero — a fabricated zero here would read as
   * "there is no test revenue", which is the opposite of the finding.
   */
  undetermined: boolean;
}

/**
 * Admit one database value as a money amount, or refuse it.
 *
 * Returns `null` for anything that is not a safe integer. Refusing is the whole
 * job: a coerced value is a wrong money figure that looks right.
 */
function admitMinor(v: unknown): bigint | null {
  if (typeof v === "bigint") {
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return v;
  }
  if (typeof v === "number") {
    if (!Number.isInteger(v)) return null;
    if (!Number.isSafeInteger(v)) return null;
    return BigInt(v);
  }
  if (typeof v === "string") {
    /* An exact decimal integer string only. No parseInt, which would happily
       accept "12abc" and return 12. */
    if (!/^-?\d+$/.test(v)) return null;
    try {
      const b = BigInt(v);
      if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
      return b;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The before-and-after revenue picture.
 *
 * "Before" is what the platform reports today. "After" is what it will report
 * once the marked subscriptions are excluded. Both are computed in the same
 * pass over the same rows, so they cannot disagree about the population.
 *
 * A subscription is excluded from "after" when ITS OWN row is marked, or when
 * the company it belongs to is marked. Both are per-record row flags (R230.6);
 * the union is used because revenue attributed to an excluded company is not
 * real revenue either. It remains per-record in both directions: marking a
 * company does not mark its rounds, and marking a round does not touch its
 * company.
 */
export function wave230RevenueImpact(): Wave230RevenueImpact {
  const empty: Wave230RevenueImpact = {
    installed: false,
    byCurrency: [],
    unreadable: 0,
    undetermined: true,
  };
  if (getDbDriver() !== "sqlite") return empty;
  const installed = wave230ColumnsPresent("subscriptions");
  if (!installed) {
    /* Not installed is a KNOWN state, not an unreadable one: nothing is marked,
       so before and after are equal. That is reported honestly below rather than
       as an error, but `installed:false` tells the caller why. */
  }

  const placeholders = REVENUE_STATUSES.map(() => "?").join(", ");
  try {
    const db: any = rawDb();

    /* The company-side flag is only joinable once the columns exist. Without
       them the query must not reference the column at all, or it throws. */
    const companiesInstalled = wave230ColumnsPresent("companies");
    const subMark = installed ? `s.${WAVE230_AT_COLUMN}` : "NULL";
    const coMark = companiesInstalled ? `c.${WAVE230_AT_COLUMN}` : "NULL";

    const rows = db
      .prepare(
        `SELECT s.annual_amount_minor AS amt,
                s.currency            AS ccy,
                ${subMark}            AS sub_mark,
                ${coMark}             AS co_mark
           FROM subscriptions s
           LEFT JOIN companies c ON c.id = s.company_id
          WHERE s.deleted_at IS NULL
            AND s.status IN (${placeholders})`,
      )
      .all(...REVENUE_STATUSES) as Array<{
      amt: unknown;
      ccy: unknown;
      sub_mark: unknown;
      co_mark: unknown;
    }>;

    const acc = new Map<string, Wave230CurrencyImpact>();
    let unreadable = 0;

    for (const r of rows) {
      const minor = admitMinor(r.amt);
      if (minor === null) {
        /* Counted and surfaced. Never coerced, never quietly skipped. */
        unreadable += 1;
        continue;
      }
      const ccy = typeof r.ccy === "string" && r.ccy.length > 0 ? r.ccy.toUpperCase() : "USD";
      let e = acc.get(ccy);
      if (!e) {
        e = {
          currency: ccy,
          beforeMinor: BigInt(0),
          afterMinor: BigInt(0),
          excludedMinor: BigInt(0),
          excludedCount: 0,
          keptCount: 0,
        };
        acc.set(ccy, e);
      }
      const marked =
        (typeof r.sub_mark === "string" && r.sub_mark.length > 0) ||
        (typeof r.co_mark === "string" && r.co_mark.length > 0);

      e.beforeMinor += minor;
      if (marked) {
        e.excludedMinor += minor;
        e.excludedCount += 1;
      } else {
        e.afterMinor += minor;
        e.keptCount += 1;
      }
    }

    const byCurrency = Array.from(acc.values()).sort((a, b) =>
      a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0,
    );

    /* An arithmetic self-check, in bigint. If before !== after + excluded for any
       currency the figures are internally inconsistent, and reporting them would
       be worse than reporting nothing. */
    for (const e of byCurrency) {
      if (e.beforeMinor !== e.afterMinor + e.excludedMinor) {
        log.warn(
          `[wave230] revenue self-check failed for ${e.currency}; refusing to report a figure that does not reconcile`,
        );
        return { installed, byCurrency: [], unreadable, undetermined: true };
      }
    }

    return { installed, byCurrency, unreadable, undetermined: false };
  } catch (err) {
    log.warn("[wave230] revenue impact read failed:", (err as Error).message);
    return { installed, byCurrency: [], unreadable: 0, undetermined: true };
  }
}

/**
 * Format a minor-unit bigint for display in its OWN currency.
 *
 * The exponent is per currency and is NOT hardcoded to 2: JPY and KRW have no
 * minor unit, and dividing them by 100 is the exact defect R230.1 describes.
 * The digits are produced by integer string surgery on the bigint, so no
 * floating-point value ever holds a money amount.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "XAF", "XOF", "XPF"]);

export function wave230FormatMinor(minor: bigint, currency: string): string {
  const ccy = currency.toUpperCase();
  const exponent = ZERO_DECIMAL_CURRENCIES.has(ccy) ? 0 : 2;
  const negative = minor < BigInt(0);
  const abs = negative ? -minor : minor;
  const digits = abs.toString();
  let whole: string;
  let frac = "";
  if (exponent === 0) {
    whole = digits;
  } else {
    const padded = digits.padStart(exponent + 1, "0");
    whole = padded.slice(0, padded.length - exponent);
    frac = padded.slice(padded.length - exponent);
  }
  /* Thousands separators, inserted by string walk rather than by toLocaleString
     on a Number, which would round large values. */
  let grouped = "";
  for (let i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += ",";
    grouped += whole[i];
  }
  const body = exponent === 0 ? grouped : `${grouped}.${frac}`;
  return `${negative ? "-" : ""}${body} ${ccy}`;
}
