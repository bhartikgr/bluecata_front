/* ============================================================================
 * WAVE 114 · FINDING 1 (ALL_OPEN_WAVES item 8) — A ROUND'S RAISED TOTAL,
 * DERIVED FROM THE AUTHORITATIVE ROWS INSTEAD OF FROM A COLUMN NOBODY WRITES.
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * `rounds.raised_amount` is declared `REAL NOT NULL DEFAULT 0`
 * (`server/db/connection.ts:3550`, `shared/schema.ts:183`), is initialised to
 * `0` by `createRound`, is read in eleven places — and is NEVER WRITTEN by any
 * product code path. The only non-zero values in the tree are the demo seed in
 * `server/mockData.ts` and a handful of tests that patch it deliberately, which
 * is exactly why the bug is invisible in the demo and total in production.
 *
 * Two consequences, both real:
 *   1. Every real round printed "$0 soft-circled" no matter how much had been
 *      committed. A printed $0 that means "unknown" is a FALSE STATEMENT ABOUT
 *      MONEY (owner ruling R6).
 *   2. `sweepClosedRounds` compared that permanent zero with the target, so
 *      `targetMet` could never be true and A ROUND COULD NEVER CONCLUDE ON ITS
 *      OWN.
 *
 * THE DECISION: DERIVE, DO NOT STORE. (build_log/wave114/W114_PREFLIGHT.md §1.3)
 * A stored total is a second copy of a fact that already exists, and it needs a
 * writer at EVERY mutation site — createSoftCircle, updateSoftCircleStatus,
 * deleteSoftCircle, the wire-funded route, commitFunded, commitFundedBatch,
 * late-acceptance grants, admin corrections — several of them inside a SACRED
 * file that may not be edited. Any site that forgets is a silent wrong number
 * about money. Wave 111 hit the same class of defect on TERMS today and its fix
 * was to delete the second copy, not to synchronise it. A single REAL column
 * also cannot hold three distinct states, cannot hold a currency, and cannot
 * express "not recorded" — `NOT NULL DEFAULT 0` makes unknown and zero the same
 * value, which IS the false statement on screen.
 *
 * Nothing is deleted: the column, its default and every existing reader stay.
 * NO MIGRATION — this module only reads tables and columns that already exist.
 * Migrations stay at canonical 173, highest 0192.
 *
 * THE THREE STATES ARE DISTINGUISHED AND LABELLED. A soft circle is not a
 * commitment; a commitment is not a funded contribution. The buckets are
 * mutually exclusive, so nothing is double-counted, and each carries the label
 * the screen must print. The vocabulary is the platform's own, read out of the
 * code rather than invented:
 *   intent    -> SOFT-CIRCLED. RoundDetail.tsx says it on screen: "A non-binding
 *                commitment ... signing the subscription docs is what makes it
 *                real."
 *   confirmed -> COMMITTED. `captableCommitStore.ts:999` refuses to mark
 *                anything wire-funded unless the soft-circle is exactly
 *                `confirmed`, so this is the signed, binding, cash-NOT-received
 *                state.
 *   wired     -> FUNDED. Set right after `enqueueFunded` at
 *                `captableCommitStore.ts:1059`.
 *   committed -> FUNDED. The position has reached the cap-table ledger.
 *   declined  -> excluded from every total.
 *
 * An unfunded commitment therefore NEVER lands in the funded bucket. Another
 * wave established today that NAV returning "no holdings" and a tax form
 * refusing on an unfunded commitment are both CORRECT; this module agrees with
 * them by construction and does not "fix" either.
 *
 * MONEY IS EXACT. Every total is accumulated as `bigint` MINOR UNITS. There is
 * no `Number()`, `parseInt` or `parseFloat` applied to money anywhere in this
 * file. `soft_circles.amount_minor` is already integer minor units and is used
 * directly; a legacy row that carries `amount_minor = 0` next to a non-zero
 * `amount` (the demo seed rows have neither `amount_minor` nor `currency`) is
 * converted with the platform's own `toMinor` — the identical call
 * `createSoftCircle` makes when it writes that column — and counted in
 * `legacyMajorUnitRows` so the fallback is VISIBLE rather than assumed. Ledger
 * amounts are exact decimal TEXT and go through `decimalStringToMinor`, which
 * never rounds.
 *
 * IT REFUSES INSTEAD OF GUESSING. No rows at all, a mixed-currency book, or an
 * unreadable amount all produce `determined: false` with a named refusal and a
 * sentence the screen prints verbatim. That is the honest half: a screen that
 * admits it does not know beats a confident $0.
 * ========================================================================== */

import {
  ROUND_MONEY_STATE_LABEL as STATE_LABEL,
  ROUND_MONEY_STATE_MEANING as STATE_MEANING,
  type RoundMoneyStateKey,
  type RoundMoneyRefusal,
  type RoundMoneyBucket,
  type RoundMoneyOnRecord,
} from "@shared/roundMoneyOnRecordView";
import { toMinor, currencyExponent } from "./currency";
import { decimalStringToMinor } from "./money";

/* BigInt constants computed once. The build targets below ES2020, so the `0n`
 * literal form is unavailable — the same convention `server/lib/money.ts:45`
 * already uses. */
const B_ZERO = BigInt(0);

/* ---------------------------------------------------------------- vocabulary */

/* THE VOCABULARY IS DECLARED ONCE, IN `shared/`, AND IMPORTED HERE.
 *
 * `shared/roundMoneyOnRecordView.ts` holds the wire types, the bucket LABELS and
 * the rule a screen follows when a figure is not determined, because the founder
 * client needs all three and a second declaration is exactly how "soft-circled"
 * ends up printed as "raised". They are re-exported below so every existing
 * importer of this module keeps working unchanged.
 *
 * Wave 111 established this pattern for terms (`shared/liquidationTermsReader.ts`
 * as the ONE reader, with the duplicate deleted). This follows it. */
export {
  ROUND_MONEY_STATE_LABEL,
  ROUND_MONEY_STATE_MEANING,
  ROUND_MONEY_STATE_ORDER,
} from "@shared/roundMoneyOnRecordView";
export type {
  RoundMoneyStateKey,
  RoundMoneyRefusal,
  RoundMoneyBucket,
  RoundMoneyOnRecord,
} from "@shared/roundMoneyOnRecordView";

/** soft_circles.status -> bucket. `declined` and anything unrecognised are
 *  excluded (and counted), never quietly folded into a total. */
const STATUS_TO_BUCKET: Readonly<Record<string, RoundMoneyStateKey>> = Object.freeze({
  intent: "softCircled",
  confirmed: "committed",
  wired: "funded",
  committed: "funded",
});

/* ------------------------------------------------------------------- shapes */

/** The minimum a row needs for this module to count it. Deliberately loose so
 *  BOTH the live DB rows (`softCircleStore.SoftCircleRow`) and the legacy seed
 *  rows in `server/mockData.ts` — which have no `amountMinor` and no
 *  `currency` — can be fed in unchanged, and the round header therefore agrees
 *  with the soft-circle book listed underneath it by construction. */
export interface RoundMoneyRowInput {
  id?: unknown;
  roundId?: unknown;
  status?: unknown;
  /** Legacy major-unit REAL column. Used only as a fallback (see file header). */
  amount?: unknown;
  /** Integer minor units. Authoritative when present and non-zero. */
  amountMinor?: unknown;
  currency?: unknown;
  deletedAt?: unknown;
}

/** A cap-table ledger row, narrowed to what the funded cross-check needs. */
export interface RoundMoneyLedgerInput {
  roundId?: unknown;
  amount?: unknown;
  currency?: unknown;
  state?: unknown;
}

/* The wire shapes `RoundMoneyBucket` and `RoundMoneyOnRecord` are DECLARED ONCE
 * in `shared/roundMoneyOnRecordView.ts` and re-exported at the top of this file.
 * They used to be declared here as well; the founder client needs them, and a
 * second declaration of a money shape is how a bucket ends up rendered under the
 * wrong label. One declaration, two consumers. */


/* ------------------------------------------------------------------ helpers */

function str(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

/** Integer minor units for one book row, as `bigint`.
 *
 *  `amount_minor` is authoritative when present and non-zero. Otherwise the
 *  legacy major-unit column is converted with the platform's own `toMinor` —
 *  the SAME call `createSoftCircle` uses to populate `amount_minor` — so a seed
 *  row and a live row of the same size produce the same figure. Returns null
 *  when the row carries nothing readable as money, which makes the whole total
 *  refuse rather than silently under-count.
 *
 *  No `Number()` / `parseInt` / `parseFloat` on money: `amountMinor` and
 *  `amount` are already numeric columns, and the only text path
 *  (`decimalStringToMinor`) is exact. */
function rowMinor(row: RoundMoneyRowInput, currency: string): { minor: bigint; legacy: boolean } | null {
  const am = row.amountMinor;
  if (typeof am === "number" && Number.isFinite(am) && Number.isInteger(am) && am !== 0) {
    return { minor: BigInt(am), legacy: false };
  }
  if (typeof am === "bigint" && am !== B_ZERO) {
    return { minor: am, legacy: false };
  }
  /* Exact decimal TEXT (the cap-table ledger's representation). */
  if (typeof am === "string" && am.trim() !== "") {
    try {
      return { minor: decimalStringToMinor(am.trim(), currency, "softCircle.amountMinor"), legacy: false };
    } catch {
      return null;
    }
  }
  const a = row.amount;
  if (typeof a === "number" && Number.isFinite(a)) {
    /* Legacy major-unit REAL column, or a seed row with no minor column at all.
       A genuine 0 lands here too and is a legitimate zero-amount row. */
    return { minor: BigInt(toMinor(a, currency)), legacy: a !== 0 };
  }
  if (typeof a === "string" && a.trim() !== "") {
    try {
      return { minor: decimalStringToMinor(a.trim(), currency, "softCircle.amount"), legacy: true };
    } catch {
      return null;
    }
  }
  if (typeof am === "number" && am === 0 && (a === undefined || a === null)) {
    return { minor: B_ZERO, legacy: false };
  }
  return null;
}

/** EXACT DISPLAY, WITHOUT PUTTING MONEY THROUGH `Number()`.
 *
 *  The platform's `formatMinor` takes a JS *number*, which would mean converting
 *  a money total to a double before printing it — the one thing the money rule in
 *  this codebase forbids. So the digits are rendered from the bigint itself and
 *  only the CURRENCY SHELL (symbol, symbol placement, decimal separator, sign
 *  position) is borrowed from `Intl`, by formatting the literal `0` — not money —
 *  and substituting our exact digits into its parts. Nothing here is arithmetic.
 */
function displayMinor(minor: bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = minor < B_ZERO;
  const digits = (neg ? -minor : minor).toString().padStart(exp + 1, "0");
  const whole = digits.slice(0, digits.length - exp) || "0";
  const fracDigits = exp > 0 ? digits.slice(digits.length - exp) : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const plain = `${neg ? "-" : ""}${currency} ${grouped}${fracDigits ? "." + fracDigits : ""}`;
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).formatToParts(0);
    let out = "";
    let integerSeen = false;
    for (const part of parts) {
      if (part.type === "integer") {
        if (!integerSeen) { out += grouped; integerSeen = true; }
        continue;
      }
      if (part.type === "group") continue;
      if (part.type === "fraction") { out += fracDigits; continue; }
      out += part.value;
    }
    if (!integerSeen) return plain;
    return `${neg ? "-" : ""}${out}`;
  } catch {
    return plain;
  }
}

function bucket(
  key: RoundMoneyStateKey,
  minor: bigint,
  count: number,
  currency: string,
): RoundMoneyBucket {
  return {
    key,
    label: STATE_LABEL[key],
    meaning: STATE_MEANING[key],
    minor: minor.toString(),
    display: displayMinor(minor, currency),
    count,
  };
}

/* ---------------------------------------------------------------- aggregate */

export interface AggregateRoundMoneyInput {
  roundId: string;
  /** The round's soft-circle book: live DB rows and seed rows together, exactly
   *  as `GET /api/rounds/:id/soft-circles` merges them, so the header total and
   *  the listed book cannot disagree. */
  rows: ReadonlyArray<RoundMoneyRowInput>;
  /** Cap-table ledger rows, for the independent funded cross-check. Optional:
   *  when absent the cross-check reports itself unavailable rather than
   *  pretending to agree. */
  ledger?: ReadonlyArray<RoundMoneyLedgerInput>;
  /** The round's own currency, used when a row does not name one. */
  fallbackCurrency?: string;
}

/**
 * PURE. No DB, no clock, no I/O — so a test can hand it rows and assert the
 * arithmetic and the refusals directly.
 */
export function aggregateRoundMoneyOnRecord(input: AggregateRoundMoneyInput): RoundMoneyOnRecord {
  const roundId = str(input.roundId);
  const fallbackCurrency = (str(input.fallbackCurrency) || "USD").toUpperCase();

  const live = (input.rows ?? []).filter((r) => {
    if (!r) return false;
    if (r.deletedAt !== undefined && r.deletedAt !== null && str(r.deletedAt) !== "") return false;
    if (r.roundId !== undefined && str(r.roundId) !== "" && str(r.roundId) !== roundId) return false;
    return true;
  });

  const currencies = new Set<string>();
  for (const r of live) {
    const c = str(r.currency).toUpperCase();
    if (c) currencies.add(c);
  }
  const currency = currencies.size === 1 ? Array.from(currencies)[0]! : fallbackCurrency;
  const currenciesSeen = Array.from(currencies).sort();

  const totals: Record<RoundMoneyStateKey, bigint> = { softCircled: B_ZERO, committed: B_ZERO, funded: B_ZERO };
  const counts: Record<RoundMoneyStateKey, number> = { softCircled: 0, committed: 0, funded: 0 };
  let legacyMajorUnitRows = 0;
  let unrecognisedStatusRows = 0;
  let declinedRows = 0;
  let unreadableRows = 0;

  for (const r of live) {
    const status = str(r.status).toLowerCase();
    if (status === "declined") { declinedRows += 1; continue; }
    const key = STATUS_TO_BUCKET[status];
    if (!key) { unrecognisedStatusRows += 1; continue; }
    const m = rowMinor(r, str(r.currency).toUpperCase() || currency);
    if (m === null) { unreadableRows += 1; continue; }
    totals[key] += m.minor;
    counts[key] += 1;
    if (m.legacy) legacyMajorUnitRows += 1;
  }

  /* ---- the independent funded cross-check, from the hash-chained ledger ---- */
  let ledgerMinor = B_ZERO;
  let ledgerCount = 0;
  let ledgerAvailable = false;
  let ledgerUnreadable = 0;
  if (Array.isArray(input.ledger)) {
    ledgerAvailable = true;
    for (const e of input.ledger) {
      if (!e) continue;
      if (str(e.roundId) !== roundId) continue;
      const st = str(e.state).toLowerCase();
      /* Only states in which cash has actually landed. `signed` and earlier are
         commitments, not funded contributions. */
      if (st !== "funded" && st !== "committed") continue;
      const cur = str(e.currency).toUpperCase() || currency;
      const raw = str(e.amount).trim();
      if (!raw) { ledgerUnreadable += 1; continue; }
      try {
        ledgerMinor += decimalStringToMinor(raw, cur, "captableCommits.amount");
        ledgerCount += 1;
      } catch {
        ledgerUnreadable += 1;
      }
    }
  }

  const bookRows = counts.softCircled + counts.committed + counts.funded;
  const subscribed = totals.committed + totals.funded;
  const onBook = totals.softCircled + subscribed;

  /* ------------------------------ refuse, or state ------------------------- */
  let refusal: RoundMoneyRefusal | null = null;
  let statement = "";

  if (currencies.size > 1) {
    refusal = "mixed_currency";
    statement =
      `Not totalled — this round's book mixes ${currenciesSeen.join(" and ")}. ` +
      `Amounts in different currencies cannot be added, so Capavate is not showing a single figure.`;
  } else if (unreadableRows > 0 && bookRows === 0) {
    refusal = "amount_not_readable";
    statement =
      `Not recorded — ${unreadableRows} row${unreadableRows === 1 ? "" : "s"} on this round ` +
      `carr${unreadableRows === 1 ? "ies" : "y"} no amount Capavate can read as money.`;
  } else if (bookRows === 0) {
    refusal = "no_rows_on_record";
    statement =
      "Not recorded — no soft circle, commitment or funded contribution has been entered on this round. " +
      "This is not the same as zero, and Capavate will not show a zero total for a figure it does not hold.";
  } else {
    statement =
      `${bucket("softCircled", totals.softCircled, counts.softCircled, currency).display} soft-circled (non-binding), ` +
      `${bucket("committed", totals.committed, counts.committed, currency).display} committed (signed, cash not received), ` +
      `${bucket("funded", totals.funded, counts.funded, currency).display} funded (cash recorded).`;
  }

  const determined = refusal === null;

  const ledgerAgrees = ledgerAvailable && ledgerUnreadable === 0 ? ledgerMinor === totals.funded : false;

  /* QA-B3 - THE DIFFERENCE, NAMED. Money on the cap-table ledger for this round
     that never passed through the round's subscription book: `commitFunded()`
     wrote a `captable_commits` row ("Record existing investors") and no
     `soft_circles` row exists for it, so it is correctly absent from every
     bucket above.

     SUBTRACTION ONLY, IN bigint, AND ONLY WHERE IT IS MEANINGFUL. No total
     above changes; nothing is added to anything. Computed only when the ledger
     was actually read cleanly AND exceeds the book - otherwise there is nothing
     to explain and the answer is `null`, an absence, never a zero. */
  const ledgerReadable = ledgerAvailable && ledgerUnreadable === 0;
  const ledgerOnly = ledgerReadable && ledgerMinor > totals.funded ? ledgerMinor - totals.funded : null;
  const ledgerNote = !ledgerAvailable
    ? "Cap-table ledger not read for this projection; the funded figure above comes from the round's book only."
    : ledgerUnreadable > 0
      ? `${ledgerUnreadable} cap-table ledger row${ledgerUnreadable === 1 ? "" : "s"} carried an amount Capavate could not read, so the ledger cross-check is inconclusive.`
      : ledgerAgrees
        ? "The round's book and the hash-chained cap-table ledger report the same funded total."
        : `The round's book reports ${displayMinor(totals.funded, currency)} funded and the hash-chained cap-table ledger reports ${displayMinor(ledgerMinor, currency)}. Capavate is showing both rather than choosing one.`;

  return {
    roundId,
    determined,
    refusal,
    statement,
    currency: determined ? currency : currencies.size > 1 ? null : currency,
    buckets: {
      softCircled: bucket("softCircled", totals.softCircled, counts.softCircled, currency),
      committed: bucket("committed", totals.committed, counts.committed, currency),
      funded: bucket("funded", totals.funded, counts.funded, currency),
    },
    subscribedMinor: subscribed.toString(),
    subscribedDisplay: displayMinor(subscribed, currency),
    onBookMinor: onBook.toString(),
    onBookDisplay: displayMinor(onBook, currency),
    currenciesSeen,
    legacyMajorUnitRows,
    unrecognisedStatusRows,
    declinedRows,
    source: "soft_circles (the round's book) + captable_commits (the hash-chained cap-table ledger, cross-check only)",
    ledgerFunded: {
      available: ledgerAvailable,
      minor: ledgerMinor.toString(),
      display: displayMinor(ledgerMinor, currency),
      count: ledgerCount,
      agreesWithBook: ledgerAgrees,
      note: ledgerNote,
      ledgerOnlyMinor: ledgerOnly === null ? null : ledgerOnly.toString(),
      ledgerOnlyDisplay: ledgerOnly === null ? null : displayMinor(ledgerOnly, currency),
    },
  };
}

/* ------------------------------------------------------- comparison helpers */

/**
 * Is the round's FUNDED total at or above `targetAmount`?
 *
 * Used by the close cascade. Returns `null` when the derivation refused — an
 * unknown total is NOT evidence that a target was met, so the caller must not
 * close a round on the strength of it.
 *
 * `targetAmount` is the round's major-unit target column; it is converted with
 * the platform's own `toMinor`, never with `parseFloat`.
 */
export function fundedMeetsTarget(
  money: RoundMoneyOnRecord,
  targetAmount: unknown,
): boolean | null {
  if (!money.determined) return null;
  if (typeof targetAmount !== "number" || !Number.isFinite(targetAmount) || targetAmount <= 0) return null;
  const currency = money.currency ?? "USD";
  const targetMinor = BigInt(toMinor(targetAmount, currency));
  if (targetMinor <= B_ZERO) return null;
  return BigInt(money.buckets.funded.minor) >= targetMinor;
}

/**
 * Progress against the round's target, in BASIS POINTS (1% = 100bp).
 *
 * WHY BASIS POINTS AND WHY HERE. A progress bar needs a ratio, and computing it
 * on the client would mean the browser dividing a money figure — which either
 * re-parses an amount into a float (forbidden) or invents its own minor-unit
 * conversion for the target (a second copy of a rule). The division happens once,
 * here, where `toMinor` already lives, and an integer basis-point count cannot be
 * mistaken for an amount by the code that renders it.
 *
 * EVERY FIELD IS NULLABLE AND NULL MEANS "DO NOT DRAW A BAR". A round with no
 * usable target, or a book that refused, returns `targetDetermined: false` and
 * nulls — NOT `0`. `0%` and "unknown" are different statements, and conflating
 * them is the defect this wave exists to fix (R6).
 */
export function roundProgressBasisPoints(
  money: RoundMoneyOnRecord,
  targetAmount: unknown,
): NonNullable<RoundMoneyOnRecord["progressBp"]> {
  const noTarget = (note: string) => ({
    subscribed: null,
    onBook: null,
    funded: null,
    targetDetermined: false,
    targetNote: note,
  });
  if (!money.determined) {
    return noTarget("No progress shown: the amounts on this round could not be determined.");
  }
  if (typeof targetAmount !== "number" || !Number.isFinite(targetAmount) || targetAmount <= 0) {
    return noTarget("No progress shown: this round has no target amount recorded to measure against.");
  }
  const currency = money.currency ?? "USD";
  const targetMinor = BigInt(toMinor(targetAmount, currency));
  if (targetMinor <= B_ZERO) {
    return noTarget("No progress shown: this round has no target amount recorded to measure against.");
  }
  /* Integer basis points, truncated. `bigint` throughout, so a large round in a
     zero-decimal currency cannot overflow a double on the way to a ratio. */
  const bp = (minorText: string): number | null => {
    let m: bigint;
    try {
      m = BigInt(minorText);
    } catch {
      return null;
    }
    if (m < B_ZERO) return null;
    return Number((m * BigInt(10000)) / targetMinor);
  };
  return {
    subscribed: bp(money.subscribedMinor),
    onBook: bp(money.onBookMinor),
    funded: bp(money.buckets.funded.minor),
    targetDetermined: true,
    targetNote: `Measured against this round's recorded target (${displayMinor(targetMinor, currency)}).`,
  };
}

/* --------------------------------------------------------- DB-reading entry */

/**
 * The DB-reading wrapper. Kept separate from the pure aggregator so routes,
 * the close cascade and the tests all share ONE derivation.
 *
 * `ledger` may be pre-fetched and passed in by a caller that sweeps many rounds
 * (the close cascade does), so a platform-wide ledger read happens once rather
 * than per round.
 */
export function roundMoneyOnRecord(args: {
  roundId: string;
  rows: ReadonlyArray<RoundMoneyRowInput>;
  ledger?: ReadonlyArray<RoundMoneyLedgerInput>;
  fallbackCurrency?: string;
  /* When supplied, the projection carries `progressBp` so a screen never has to
     divide money itself. Omitted -> `progressBp: null`, which the client reads
     as "draw no bar" rather than as 0%. */
  targetAmount?: unknown;
}): RoundMoneyOnRecord {
  const money = aggregateRoundMoneyOnRecord(args);
  return {
    ...money,
    progressBp:
      args.targetAmount === undefined ? null : roundProgressBasisPoints(money, args.targetAmount),
  };
}
