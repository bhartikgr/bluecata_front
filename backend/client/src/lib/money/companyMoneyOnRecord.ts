/* WAVE 116 · FINDING 1 — COMPANY-LEVEL TOTALS OVER WAVE 114'S DERIVED FIGURES.
 *
 * WHAT THIS FILE IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT.
 *
 * It is NOT a derivation of raised money. The derivation lives in exactly one
 * place, `server/lib/roundRaisedTotals.ts` (Wave 114), reaches the browser as
 * `round.moneyOnRecord` on `GET /api/rounds`, and is narrowed for rendering by
 * `readRoundMoneyOnRecord` in `shared/roundMoneyOnRecordView.ts`. This file adds
 * up figures that have ALREADY been derived and ALREADY been labelled, across
 * the rounds of one company, so that a founder dashboard tile can show a company
 * total without a second copy of the rules. Five separate "committed" registers
 * were already found in this platform; this adds none.
 *
 * WHY IT EXISTS AT ALL. The founder dashboard's headline tile is per-COMPANY, and
 * Wave 114 only shipped per-ROUND figures. The alternative was for the dashboard
 * to loop and add inline — which is how the false `$0` got there in the first
 * place, because an inline loop has nowhere to put a refusal.
 *
 * THE THREE RULES IT ENFORCES.
 *   1. Every bucket keeps Wave 114's own state key, label and meaning. The three
 *      money states — soft-circled, committed, funded — stay distinct all the way
 *      to the screen. Nothing here collapses them into one word.
 *   2. A partial total is a false total. If ANY counted round refused, the whole
 *      company figure refuses: printing the sum of the rounds that happened to
 *      work, labelled as the company's raise, is a false statement about money.
 *   3. Amounts are never turned into JS numbers. The wire format is integer
 *      minor units as decimal TEXT; addition is `bigint`; display is built by
 *      string construction. There is no `Number()`, `parseInt` or `parseFloat`
 *      on an amount anywhere below.
 *
 * OWNER RULING R6: a figure that was never entered is never printed as `$0`.
 * When this file cannot determine a total it returns a SENTENCE and no figure.
 * OWNER RULING R91: the state vocabulary here is Wave 114's MONEY-state
 * vocabulary, consumed verbatim. It is not the `soft_circle`/`soft_circled`
 * round-stage ladder and nothing here harmonises those.
 */

import {
  readRoundMoneyOnRecord,
  ROUND_MONEY_STATE_LABEL,
  ROUND_MONEY_STATE_MEANING,
  ROUND_MONEY_STATE_ORDER,
  type RoundMoneyStateKey,
} from "@shared/roundMoneyOnRecordView";

/* --------------------------------------------------------------- refusals */

/** Why a company-level figure must not be printed. Each is a distinct fact
 *  about the book, not a generic error, so the screen can say which one. */
export type CompanyMoneyRefusal =
  /** The company has no round whose money counts toward a company total. */
  | "no_rounds_on_record"
  /** At least one counted round's own derivation refused (Wave 114's
   *  `no_rows_on_record` / `mixed_currency` / `amount_not_readable`). */
  | "not_determined_on_some_rounds"
  /** The counted rounds are denominated in different currencies. There is no FX
   *  rate source in this repository, so adding them would invent one. */
  | "mixed_currency"
  /* ── WAVE 191 · ITEM C.3 ───────────────────────────────────────────
   * NOT ONE currency, and not TWO — NONE.
   *
   * WHAT WAS WRONG. Both readers below ended with
   *     const currency = currencies.size === 1 ? Array.from(currencies)[0] : "USD";
   * and the `mixed_currency` guard immediately above it only catches `size > 1`.
   * `size === 0` — no counted round names a currency at all — fell through the
   * ternary to the literal `"USD"`. At the time this was found, 1045 of 1045
   * rounds in the database had a NULL currency, so `size === 0` was not an edge
   * case: it was EVERY company. The dashboard target tile printed a US-dollar
   * figure for companies that had never recorded a denomination.
   *
   * WHY IT IS A SEPARATE REFUSAL AND NOT `mixed_currency`. "You used two
   * currencies" and "you have not said which currency" are different facts about
   * the book and have different remedies — the first needs a decision, the second
   * needs one field filled in. R156.2 requires naming the missing fact, not
   * reporting a nearby one. */
  | "currency_not_recorded";

export const COMPANY_MONEY_REFUSAL_STATEMENT: Readonly<Record<CompanyMoneyRefusal, string>> =
  Object.freeze({
    no_rounds_on_record:
      "Not recorded — no round on this company has any amount on record yet, so there is no total to show.",
    not_determined_on_some_rounds:
      "Not shown — at least one of this company's rounds could not have its amounts determined, and a total that leaves a round out would understate the raise.",
    mixed_currency:
      "Not shown — this company's rounds are recorded in more than one currency, and this platform holds no exchange rate to add them with.",
    /* WAVE 191 · ITEM C.3 — names the ONE missing field, and says the sentence the
       platform says everywhere else so that nobody reads a refusal as a zero. */
    currency_not_recorded:
      "Not shown — no round on this company records which currency it is raised in, so there is no denomination to state this total in. This is not the same as zero, and Capavate will not show a zero total for a figure it does not hold. Set a currency on a round to see this figure.",
  });

/** The words that must accompany the company figure, so that nobody reads it as
 *  a calendar-period figure. `moneyOnRecord` carries no per-row dates, so no
 *  honest surface can call any of this "this year". */
export const COMPANY_MONEY_BASIS_LABEL =
  "On record across this company's rounds (all time, not a calendar period)";

export const COMPANY_MONEY_SUBSCRIBED_LABEL = "Subscribed (committed + funded)";

/* ------------------------------------------------------------ the shapes */

export interface CompanyMoneyBucketTotal {
  key: RoundMoneyStateKey;
  /** Wave 114's label, unchanged. MUST be rendered next to the figure. */
  label: string;
  meaning: string;
  /** Integer minor units as decimal text. Never a JS number. */
  minor: string;
  display: string;
  /** How many book rows across the company are in this state. */
  count: number;
  /** How many rounds contributed a non-zero amount in this state. */
  roundsWithAmount: number;
}

export interface CompanyMoneyOnRecord {
  /** False whenever no figure may be printed. */
  determined: boolean;
  refusal: CompanyMoneyRefusal | null;
  /** A complete sentence. Printed INSTEAD of a number when not determined. */
  statement: string;
  currency: string | null;
  /** Weakest state first, per `ROUND_MONEY_STATE_ORDER`. Empty when refused. */
  buckets: CompanyMoneyBucketTotal[];
  /** committed + funded. Soft circles excluded on purpose — Wave 114's rule. */
  subscribedMinor: string;
  subscribedDisplay: string;
  /** All three states together. Labelled as such; it is NOT "raised". */
  onBookMinor: string;
  onBookDisplay: string;
  /** How many rounds were counted, and which. Named so the reader can check. */
  roundsCounted: number;
  roundIdsCounted: string[];
  /** Rounds deliberately excluded from the company total, and why. */
  roundsExcluded: Array<{ roundId: string; reason: string }>;
  basisLabel: string;
  /**
   * A MACHINE TOKEN naming the derivation this total came out of, for logs and
   * for tests that need to prove a screen did not grow a second derivation.
   *
   * WAVE 116 FOLLOW-UP — this used to be a sentence containing two repository
   * paths, and `npm run lint:internal-language-fence` was right to reject it:
   * a provenance string is one refactor away from being rendered, and R44/R77
   * allow the identifier to survive only as a machine-readable value. It is now
   * a stable token with no paths in it. Nothing renders this field; the words a
   * founder reads about provenance are `basisLabel`.
   */
  source: CompanyMoneySource;
}

/** The one derivation any company money total in this platform may come from. */
export type CompanyMoneySource = "round_money_on_record_summed_per_company";

export const COMPANY_MONEY_SOURCE: CompanyMoneySource = "round_money_on_record_summed_per_company";

/* -------------------------------------------------- exact display, no floats */

/** The currency's minor-unit exponent, from the platform runtime's own ISO 4217
 *  table via `Intl`, so this file carries no second currency table. Falls back
 *  to 2 only when the runtime cannot resolve the code. */
function exponentFor(currency: string): number {
  try {
    const opts = new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions();
    const digits = opts.maximumFractionDigits;
    return typeof digits === "number" && digits >= 0 && digits <= 4 ? digits : 2;
  } catch {
    return 2;
  }
}

/** Integer minor units -> a display string, by STRING CONSTRUCTION.
 *
 *  The digits of the amount are never divided, multiplied or parsed: they are
 *  sliced into a whole part and a fraction part and grouped with a regex. Only
 *  the currency shell — symbol, placement, separators — comes from `Intl`, and it
 *  is obtained by formatting the literal `0`, never the amount. This is the same
 *  technique, for the same reason, as the server-side `displayMinor` in
 *  `server/lib/roundRaisedTotals.ts`; that one is module-private and lives under
 *  `server/`, so it cannot be imported into the browser bundle.
 *
 *  This is FORMATTING, not derivation. It changes no value. */
/* W6c · D1 — THE THIRD MONEY FORMATTER ON THE SPV SURFACE.

   The SPV Overview tile builds its raised-vs-target line from TWO different
   formatters: this one for the raised half (a bigint sum) and `fmt()` for the
   target half. That line is the literal `$0.00 / $100,000.00` QA reported, so
   naming the currency in only one of the two would have left the defect half
   fixed — which is exactly what a sweep across all sixteen tabs caught.

   `opts.currencyDisplay: "code"` returns the `plain` string this function ALREADY
   builds as its own Intl fallback: `${currency} ${grouped}.${fraction}`,
   constructed digit by digit with no division and no parsing, which is the whole
   point of this module. No new formatting logic is introduced here — an existing,
   already-tested branch is simply made reachable on request.

   The parameter is OPTIONAL and every existing caller is byte-for-byte unchanged. */
export function displayCompanyMinor(
  minor: bigint,
  currency: string,
  opts: { currencyDisplay?: "symbol" | "code" } = {},
): string {
  const exp = exponentFor(currency);
  const negative = minor < BigInt(0);
  const digits = (negative ? -minor : minor).toString().padStart(exp + 1, "0");
  const whole = digits.slice(0, digits.length - exp) || "0";
  const fraction = exp > 0 ? digits.slice(digits.length - exp) : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const plain = `${negative ? "-" : ""}${currency} ${grouped}${fraction ? "." + fraction : ""}`;
  /* W6c · D1 — the ISO-code rendering IS `plain`. Returned before the Intl shell
     is consulted at all, so the code path cannot pick up a symbol or a U+00A0. */
  if (opts.currencyDisplay === "code") return plain;
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
        if (!integerSeen) {
          out += grouped;
          integerSeen = true;
        }
        continue;
      }
      if (part.type === "group") continue;
      if (part.type === "fraction") {
        out += fraction;
        continue;
      }
      out += part.value;
    }
    if (!integerSeen) return plain;
    return negative ? `-${out}` : out;
  } catch {
    return plain;
  }
}

/** A PLOTTING-ONLY major-unit value for a chart axis, or `null` when it cannot be
 *  produced exactly enough to plot.
 *
 *  Charting libraries take `number`, so a bar or line of money needs one
 *  conversion somewhere. It happens HERE, once, on the INTEGER MINOR-UNIT value
 *  — integer minor units as a `number` is this platform's ratified money-scalar
 *  representation (`server/lib/currencyScalar.ts`, `MoneyScalar.minor: number`)
 *  — and it refuses above `Number.MAX_SAFE_INTEGER` rather than silently losing
 *  precision. It parses no money text: `BigInt` is exact, and `parseFloat` /
 *  `parseInt` never touch an amount.
 *
 *  IT MUST NOT BE USED FOR A DISPLAYED FIGURE. Displayed figures use
 *  `displayCompanyMinor`, which does no arithmetic at all. */
export function chartMajorFromMinor(minor: bigint, currency: string): number | null {
  if (minor < BigInt(0) || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  let divisor = BigInt(1);
  for (let i = 0; i < exponentFor(currency); i += 1) divisor *= BigInt(10);
  const whole = minor / divisor;
  const remainder = minor % divisor;
  return globalThis.Number(whole) + globalThis.Number(remainder) / globalThis.Number(divisor);
}

/** Parse the wire's minor-unit text into a `bigint`, or `null` when it is not an
 *  integer string. `BigInt()` is exact and rejects fractions — it is not a
 *  float parse, which is why it is the only conversion permitted on money. */
export function minorTextToBigInt(text: unknown): bigint | null {
  if (typeof text !== "string" || !/^-?\d+$/.test(text.trim())) return null;
  try {
    return BigInt(text.trim());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- what counts as a round */

/** The rounds whose money belongs in a company total.
 *
 *  A `draft` is a round the founder has not opened; an archived round is one the
 *  founder has explicitly set aside. Neither represents money the company is
 *  raising, and both were silently included in the dashboard's old sums. */
export function roundCountsTowardCompanyMoney(round: unknown): { counts: boolean; reason: string } {
  if (typeof round !== "object" || round === null) return { counts: false, reason: "not a round record" };
  const r = round as Record<string, unknown>;
  if (typeof r.archivedAt === "string" && r.archivedAt.trim() !== "") {
    return { counts: false, reason: "archived by the founder" };
  }
  const state = typeof r.state === "string" ? r.state.toLowerCase() : "";
  if (state === "draft") return { counts: false, reason: "still a draft" };
  if (state === "cancelled" || state === "canceled") return { counts: false, reason: "cancelled" };
  return { counts: true, reason: "" };
}

function roundIdOf(round: unknown, index: number): string {
  const r = round as Record<string, unknown> | null;
  const id = r && typeof r.id === "string" ? r.id : "";
  return id || `#${index + 1}`;
}

/* ------------------------------------------------------------- the aggregation */

function refuse(refusal: CompanyMoneyRefusal, extra: Partial<CompanyMoneyOnRecord> = {}): CompanyMoneyOnRecord {
  return {
    determined: false,
    refusal,
    statement: COMPANY_MONEY_REFUSAL_STATEMENT[refusal],
    currency: null,
    buckets: [],
    subscribedMinor: "0",
    subscribedDisplay: "",
    onBookMinor: "0",
    onBookDisplay: "",
    roundsCounted: 0,
    roundIdsCounted: [],
    roundsExcluded: [],
    basisLabel: COMPANY_MONEY_BASIS_LABEL,
    source: COMPANY_MONEY_SOURCE,
    ...extra,
  };
}

/**
 * Sum one company's already-derived, already-labelled round money.
 *
 * Returns a refusal with a sentence — never a zero — when the total cannot be
 * stated as fact.
 */
export function readCompanyMoneyOnRecord(rounds: readonly unknown[] | null | undefined): CompanyMoneyOnRecord {
  const list = Array.isArray(rounds) ? rounds : [];
  const excluded: Array<{ roundId: string; reason: string }> = [];
  const counted: unknown[] = [];
  const countedIds: string[] = [];

  list.forEach((round, i) => {
    const verdict = roundCountsTowardCompanyMoney(round);
    if (!verdict.counts) {
      excluded.push({ roundId: roundIdOf(round, i), reason: verdict.reason });
      return;
    }
    counted.push(round);
    countedIds.push(roundIdOf(round, i));
  });

  if (counted.length === 0) return refuse("no_rounds_on_record", { roundsExcluded: excluded });

  const totals = new Map<RoundMoneyStateKey, { minor: bigint; count: number; roundsWithAmount: number }>();
  for (const key of ROUND_MONEY_STATE_ORDER) totals.set(key, { minor: BigInt(0), count: 0, roundsWithAmount: 0 });

  const currencies = new Set<string>();

  for (const round of counted) {
    const view = readRoundMoneyOnRecord((round as Record<string, unknown>).moneyOnRecord);
    /* Rule 2: one undetermined round makes the company total undeterminable. */
    if (!view.canPrintFigures || !view.money) {
      return refuse("not_determined_on_some_rounds", { roundsExcluded: excluded });
    }
    const currency = typeof view.money.currency === "string" && view.money.currency ? view.money.currency : "";
    if (currency) currencies.add(currency);
    if (currencies.size > 1) return refuse("mixed_currency", { roundsExcluded: excluded });

    for (const bucket of view.buckets) {
      const slot = totals.get(bucket.key);
      if (!slot) continue;
      const amount = minorTextToBigInt(bucket.minor);
      /* An unreadable amount is not a zero. Refuse the company total. */
      if (amount === null) return refuse("not_determined_on_some_rounds", { roundsExcluded: excluded });
      slot.minor += amount;
      slot.count += bucket.count;
      if (amount !== BigInt(0)) slot.roundsWithAmount += 1;
    }
  }

  if (currencies.size > 1) return refuse("mixed_currency", { roundsExcluded: excluded });
  /* WAVE 191 · ITEM C.3 — the `size === 0` hole. See `currency_not_recorded`. */
  if (currencies.size === 0) return refuse("currency_not_recorded", { roundsExcluded: excluded });
  const currency = Array.from(currencies)[0]!;

  const buckets: CompanyMoneyBucketTotal[] = ROUND_MONEY_STATE_ORDER.map((key) => {
    const slot = totals.get(key) ?? { minor: BigInt(0), count: 0, roundsWithAmount: 0 };
    return {
      key,
      label: ROUND_MONEY_STATE_LABEL[key],
      meaning: ROUND_MONEY_STATE_MEANING[key],
      minor: slot.minor.toString(),
      display: displayCompanyMinor(slot.minor, currency),
      count: slot.count,
      roundsWithAmount: slot.roundsWithAmount,
    };
  });

  const bucketMinor = (key: RoundMoneyStateKey): bigint => totals.get(key)?.minor ?? BigInt(0);
  const subscribed = bucketMinor("committed") + bucketMinor("funded");
  const onBook = subscribed + bucketMinor("softCircled");

  return {
    determined: true,
    refusal: null,
    statement: "",
    currency,
    buckets,
    subscribedMinor: subscribed.toString(),
    subscribedDisplay: displayCompanyMinor(subscribed, currency),
    onBookMinor: onBook.toString(),
    onBookDisplay: displayCompanyMinor(onBook, currency),
    roundsCounted: counted.length,
    roundIdsCounted: countedIds,
    roundsExcluded: excluded,
    basisLabel: COMPANY_MONEY_BASIS_LABEL,
    source: COMPANY_MONEY_SOURCE,
  };
}

/* ---------------------------------------------------------------- the target */

/** Why a company target denominator must not be printed. */
export type CompanyTargetRefusal =
  | "no_rounds_on_record"
  | "no_target_recorded"
  | "mixed_currency"
  | "target_not_representable"
  /* WAVE 191 · ITEM C.3 — the `currencies.size === 0` hole, in the TARGET reader's
     own vocabulary. See the long note on `CompanyMoneyRefusal` above. */
  | "currency_not_recorded";

export const COMPANY_TARGET_REFUSAL_STATEMENT: Readonly<Record<CompanyTargetRefusal, string>> =
  Object.freeze({
    no_rounds_on_record:
      "No target shown — this company has no round that counts toward a target.",
    no_target_recorded:
      "No target shown — none of this company's counted rounds has a target amount recorded.",
    mixed_currency:
      "No target shown — this company's rounds record targets in more than one currency, and this platform holds no exchange rate to add them with.",
    target_not_representable:
      "No target shown — a recorded target amount could not be read exactly.",
    /* WAVE 191 · ITEM C.3 — the tile this replaced was printing a DOLLAR target for
       a company with no currency on record anywhere. */
    currency_not_recorded:
      "No target shown — no round on this company records which currency its target is in, so there is no denomination to state it in. This is not the same as zero, and Capavate will not show a zero total for a figure it does not hold. Set a currency on a round to see this figure.",
  });

/** What the target denominator actually sums, stated to the reader. The old
 *  dashboard denominator summed EVERY round ever created — drafts, archived and
 *  closed rounds alike, across mixed currencies — and printed it beside a
 *  figure labelled "this year". */
export const COMPANY_TARGET_BASIS_LABEL =
  "target across live and closed rounds (drafts and archived rounds excluded)";

export interface CompanyTargetOnRecord {
  determined: boolean;
  refusal: CompanyTargetRefusal | null;
  statement: string;
  currency: string | null;
  minor: string;
  display: string;
  roundsCounted: number;
  roundIdsCounted: string[];
  roundsExcluded: Array<{ roundId: string; reason: string }>;
  basisLabel: string;
}

/** A non-negative major-unit amount as an exact minor-unit `bigint`.
 *
 *  `rounds.target_amount` is a SQLite `real` column, so the value arrives as a
 *  JS number and there is no exact text to read. It is converted by taking the
 *  number's own decimal representation and MOVING THE POINT with string slicing
 *  — no multiplication, no `parseFloat`, no `Math.round`. A value that cannot be
 *  represented exactly in the currency's minor unit (more fraction digits than
 *  the currency has, or exponent notation) is REFUSED rather than rounded. */
function majorNumberToMinorExact(amount: unknown, currency: string): bigint | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
  const text = String(amount);
  if (!/^\d+(\.\d+)$|^\d+$/.test(text)) return null;
  const exp = exponentFor(currency);
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? "" : text.slice(dot + 1);
  if (fraction.length > exp) return null;
  const padded = fraction.padEnd(exp, "0");
  try {
    return BigInt(`${whole}${padded}`);
  } catch {
    return null;
  }
}

function refuseTarget(
  refusal: CompanyTargetRefusal,
  excluded: Array<{ roundId: string; reason: string }>,
): CompanyTargetOnRecord {
  return {
    determined: false,
    refusal,
    statement: COMPANY_TARGET_REFUSAL_STATEMENT[refusal],
    currency: null,
    minor: "0",
    display: "",
    roundsCounted: 0,
    roundIdsCounted: [],
    roundsExcluded: excluded,
    basisLabel: COMPANY_TARGET_BASIS_LABEL,
  };
}

/**
 * The company's target denominator, over the SAME round population as
 * `readCompanyMoneyOnRecord` — so numerator and denominator can never disagree
 * about which rounds they are talking about.
 */
export function readCompanyTargetOnRecord(
  rounds: readonly unknown[] | null | undefined,
): CompanyTargetOnRecord {
  const list = Array.isArray(rounds) ? rounds : [];
  const excluded: Array<{ roundId: string; reason: string }> = [];
  const counted: Array<{ id: string; round: Record<string, unknown> }> = [];

  list.forEach((round, i) => {
    const verdict = roundCountsTowardCompanyMoney(round);
    if (!verdict.counts) {
      excluded.push({ roundId: roundIdOf(round, i), reason: verdict.reason });
      return;
    }
    counted.push({ id: roundIdOf(round, i), round: round as Record<string, unknown> });
  });

  if (counted.length === 0) return refuseTarget("no_rounds_on_record", excluded);

  const currencies = new Set<string>();
  for (const { round } of counted) {
    const money = round.moneyOnRecord;
    const fromMoney =
      typeof money === "object" && money !== null && typeof (money as Record<string, unknown>).currency === "string"
        ? ((money as Record<string, unknown>).currency as string)
        : "";
    const declared = typeof round.currency === "string" ? round.currency : "";
    const currency = fromMoney || declared;
    if (currency) currencies.add(currency);
  }
  if (currencies.size > 1) return refuseTarget("mixed_currency", excluded);
  /* WAVE 191 · ITEM C.3 — the same hole, in the TARGET reader. This is the one the
     live founder dashboard was actually hitting: a target tile denominated in a
     currency nobody had recorded. */
  if (currencies.size === 0) return refuseTarget("currency_not_recorded", excluded);
  const currency = Array.from(currencies)[0]!;

  let total = BigInt(0);
  const withTarget: string[] = [];
  for (const { id, round } of counted) {
    const raw = round.targetAmount;
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "number" && raw === 0) continue;
    const minor = majorNumberToMinorExact(raw, currency);
    if (minor === null) return refuseTarget("target_not_representable", excluded);
    total += minor;
    withTarget.push(id);
  }

  if (withTarget.length === 0 || total === BigInt(0)) return refuseTarget("no_target_recorded", excluded);

  return {
    determined: true,
    refusal: null,
    statement: "",
    currency,
    minor: total.toString(),
    display: displayCompanyMinor(total, currency),
    roundsCounted: withTarget.length,
    roundIdsCounted: withTarget,
    roundsExcluded: excluded,
    basisLabel: COMPANY_TARGET_BASIS_LABEL,
  };
}
