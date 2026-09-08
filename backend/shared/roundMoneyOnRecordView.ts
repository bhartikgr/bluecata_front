/* ============================================================================
 * WAVE 114 · FINDING 1 (ALL_OPEN_WAVES item 8) — THE WIRE SHAPE OF A ROUND'S
 * MONEY, AND THE ONE PLACE THAT DECIDES WHETHER A SCREEN MAY PRINT IT.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS IN `shared/`
 * ----------------------------------------------
 * The derivation itself lives in `server/lib/roundRaisedTotals.ts` because it
 * reads tables. But the TYPES it puts on the wire, the LABELS the figures must
 * be printed with, and the rule for what a screen does when the figure is not
 * determined are needed by BOTH sides — and the whole point of Finding 1 is that
 * a total must never appear without saying what it counts. If the client
 * re-declared the shape or re-invented the labels, the browser could print
 * "raised" next to a number the server counted as "soft-circled", which is the
 * exact class of defect this wave is closing.
 *
 * So the vocabulary is declared ONCE, here, and
 * `server/lib/roundRaisedTotals.ts` imports it and re-exports it for its own
 * existing importers. Server and client cannot disagree because there is only
 * one declaration. Wave 111 did the same thing for terms
 * (`shared/liquidationTermsReader.ts` as the ONE reader) and this follows that
 * precedent deliberately.
 *
 * THIS FILE TOUCHES NO MONEY ARITHMETIC. Amounts arrive preformatted
 * (`display`) and as exact integer minor-unit TEXT (`minor`). Nothing here calls
 * `Number()`, `parseInt` or `parseFloat` on an amount; the only numeric work is
 * on BASIS POINTS the server already computed, which are a ratio, not money.
 * ========================================================================== */

/** The three states a round's money can be in. Mutually exclusive: a figure is
 *  in exactly one bucket, so nothing is double-counted. */
export type RoundMoneyStateKey = "softCircled" | "committed" | "funded";

/** Why a total could not be stated. Every value names a REASON; none of them is
 *  a licence to print `0`. */
export type RoundMoneyRefusal =
  /** Nothing has been entered on this round at all. NOT the same as zero. */
  | "no_rows_on_record"
  /** The book carries more than one currency; adding them is meaningless. */
  | "mixed_currency"
  /** A row's amount could not be read as money. */
  | "amount_not_readable";

/** The on-screen label for each bucket. The label TRAVELS WITH THE FIGURE: a
 *  screen that shows a bucket's number shows these words next to it, so
 *  "soft-circled" can never be read as "raised". */
export const ROUND_MONEY_STATE_LABEL: Readonly<Record<RoundMoneyStateKey, string>> = Object.freeze({
  softCircled: "Soft-circled (non-binding)",
  committed: "Committed (signed, cash not received)",
  funded: "Funded (cash recorded)",
});

/** One-line explanation of what each bucket means, for the founder who has to
 *  act on the number. */
export const ROUND_MONEY_STATE_MEANING: Readonly<Record<RoundMoneyStateKey, string>> = Object.freeze({
  softCircled: "An investor has indicated an amount. Not a contract.",
  committed: "A signed, binding subscription. No money has arrived yet.",
  funded: "The wire is recorded, or the position is on the cap table.",
});

/** Bucket order for display: the ladder an investor climbs, weakest first. */
export const ROUND_MONEY_STATE_ORDER: readonly RoundMoneyStateKey[] = Object.freeze([
  "softCircled",
  "committed",
  "funded",
] as const);

export interface RoundMoneyBucket {
  key: RoundMoneyStateKey;
  /** The words that MUST appear next to the figure on screen. */
  label: string;
  meaning: string;
  /** Integer minor units as decimal TEXT. Never a JS number — the wire format
   *  keeps money exact all the way to the browser. */
  minor: string;
  /** Preformatted for display, so no client does float arithmetic on money. */
  display: string;
  count: number;
}

export interface RoundMoneyOnRecord {
  roundId: string;
  /** False whenever the figures must not be printed as fact. */
  determined: boolean;
  refusal: RoundMoneyRefusal | null;
  /** A complete sentence. When `determined` is false the screen prints THIS
   *  instead of a number. */
  statement: string;
  currency: string | null;
  buckets: Record<RoundMoneyStateKey, RoundMoneyBucket>;
  /** committed + funded — the part of the target that is actually subscribed.
   *  Soft circles are excluded on purpose: they are not subscriptions. */
  subscribedMinor: string;
  subscribedDisplay: string;
  /** All three buckets together — every amount on the book, whatever its state.
   *  Labelled as such; it is NOT "raised". */
  onBookMinor: string;
  onBookDisplay: string;
  /** Every distinct currency seen on the round's rows. */
  currenciesSeen: string[];
  /** Rows whose money had to be converted from the legacy major-unit column. */
  legacyMajorUnitRows: number;
  /** Rows excluded because their status is not part of the ladder. */
  unrecognisedStatusRows: number;
  /** Rows excluded because their status is `declined`. */
  declinedRows: number;
  /** Named so nobody has to grep for where the figure came from. */
  source: string;
  /** The funded total derived INDEPENDENTLY from the hash-chained cap-table
   *  ledger. Its only purpose is to EXPOSE disagreement, never to hide it. */
  ledgerFunded: {
    available: boolean;
    minor: string;
    display: string;
    count: number;
    agreesWithBook: boolean;
    note: string;
    /* ── QA-B3, ADDITIVE. Nothing above changes. ────────────────────────────
       THE LEDGER-ONLY POPULATION: money on the cap-table ledger for this round
       that never passed through the round's subscription book. It is exactly
       `ledgerMinor - funded`, it was ALREADY COMPUTED, and it was simply never
       named on screen - which is the whole of blocker B3.

       These fields exist so a founder can be told WHERE the difference comes
       from instead of being shown two numbers and left to guess. THEY ARE NOT
       A THIRD TOTAL AND THEY MUST NEVER BE ADDED TO SUBSCRIBED: in the normal
       flow a soft circle reaches funded AND gets a ledger row, so summing the
       two double-counts every ordinary investor. That is precisely why
       `agreesWithBook` tests the IDENTITY `ledger === funded` rather than
       adding them.

       `null` when there is nothing to explain - the ledger is unreadable, or
       it does not exceed the book. A zero here would be a figure; null is an
       absence, and this is an absence. */
    ledgerOnlyMinor: string | null;
    ledgerOnlyDisplay: string | null;
  };
  /** Progress against the round's target, in BASIS POINTS (1% = 100bp), or null
   *  when there is no usable target to divide by. Basis points because the
   *  division happens on the server where the target's minor-unit conversion
   *  lives, and because an integer ratio cannot be mistaken for an amount. */
  progressBp?: {
    /** (committed + funded) / target. */
    subscribed: number | null;
    /** everything on the book / target. */
    onBook: number | null;
    /** funded only / target — the only one that means cash. */
    funded: number | null;
    targetDetermined: boolean;
    targetNote: string;
  } | null;
}

/* ------------------------------------------------------------------ the rule */

/** What a founder screen prints when the platform has no projection at all —
 *  an older response, a failed read, a round the caller cannot see the book
 *  for. It is a SENTENCE, not `$0`.
 *
 *  Owner ruling R6: a never-entered figure is never printed as `0` / `$0` /
 *  `0.00%`. A printed `$0` that means "unknown" is a false statement about
 *  money, and `rounds.raised_amount` — which every one of these screens used to
 *  print — is a `NOT NULL DEFAULT 0` column with no writer, so it produced
 *  exactly that false statement on every real round. */
export const ROUND_MONEY_UNAVAILABLE_STATEMENT =
  "Not recorded — this round's raised total is not available from the server.";

/** The heading a screen uses over the three labelled figures. Deliberately not
 *  the word "raised": "raised" is ambiguous between three different states, and
 *  that ambiguity is what put a wrong number on the founder's front page. */
export const ROUND_MONEY_SECTION_LABEL = "On record for this round";

export interface RoundMoneyView {
  /** True only when there is a projection AND it determined the figures. Any
   *  screen may print `buckets` / `subscribedDisplay` ONLY when this is true. */
  canPrintFigures: boolean;
  /** The sentence to show when `canPrintFigures` is false. Always non-empty. */
  statement: string;
  /** Present only when `canPrintFigures`. Ordered weakest state first. */
  buckets: RoundMoneyBucket[];
  /** The projection itself when there is one, for callers that need detail. */
  money: RoundMoneyOnRecord | null;
  /** Why there are no figures: `"absent"` when the server sent no projection,
   *  the server's own refusal otherwise, `null` when figures are printable. */
  reason: "absent" | RoundMoneyRefusal | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Narrow an unknown `round.moneyOnRecord` into something a screen may render.
 *
 *  DEFENSIVE ON PURPOSE. This is the boundary between a JSON response and a
 *  money figure on a founder's screen, and the failure mode being fixed is a
 *  confident zero. Anything that is not a complete, determined projection comes
 *  back as `canPrintFigures: false` with a sentence — never as a number. */
export function readRoundMoneyOnRecord(value: unknown): RoundMoneyView {
  if (!isRecord(value)) {
    return {
      canPrintFigures: false,
      statement: ROUND_MONEY_UNAVAILABLE_STATEMENT,
      buckets: [],
      money: null,
      reason: "absent",
    };
  }
  const money = value as unknown as RoundMoneyOnRecord;
  const statement =
    typeof money.statement === "string" && money.statement.trim() !== ""
      ? money.statement
      : ROUND_MONEY_UNAVAILABLE_STATEMENT;
  const rawBuckets = isRecord(money.buckets) ? money.buckets : null;
  if (money.determined !== true || !rawBuckets) {
    return {
      canPrintFigures: false,
      statement,
      buckets: [],
      money,
      reason: (money.refusal ?? "absent") as "absent" | RoundMoneyRefusal,
    };
  }
  const buckets: RoundMoneyBucket[] = [];
  for (const key of ROUND_MONEY_STATE_ORDER) {
    const b = rawBuckets[key];
    if (!isRecord(b)) continue;
    buckets.push({
      key,
      /* The server's label wins; the shared constant is the fallback. They are
         the same string from the same declaration, so this can only differ if a
         response is older than the client. */
      label: typeof b.label === "string" && b.label ? b.label : ROUND_MONEY_STATE_LABEL[key],
      meaning: typeof b.meaning === "string" && b.meaning ? b.meaning : ROUND_MONEY_STATE_MEANING[key],
      minor: typeof b.minor === "string" ? b.minor : "0",
      display: typeof b.display === "string" ? b.display : "",
      count: typeof b.count === "number" ? b.count : 0,
    });
  }
  /* A determined projection with no renderable bucket is not printable either.
     Refusing here is cheaper than printing an empty row that reads as zero. */
  if (buckets.length === 0) {
    return { canPrintFigures: false, statement, buckets: [], money, reason: "absent" };
  }
  return { canPrintFigures: true, statement, buckets, money, reason: null };
}

/** Basis points -> a percentage number for a progress bar, or null when the
 *  server could not divide. NEVER returns 0 as a stand-in for "unknown": a
 *  caller that gets null must print words, not a bar at 0%.
 *
 *  Operates on a ratio the server already computed, so no money is parsed. */
export function progressPercentFromBp(bp: number | null | undefined): number | null {
  if (typeof bp !== "number" || !Number.isFinite(bp)) return null;
  return bp / 100;
}

/** The percentage a progress bar should fill, clamped to [0, 100], or null when
 *  there is nothing honest to draw. */
export function progressBarPercent(bp: number | null | undefined): number | null {
  const pct = progressPercentFromBp(bp);
  if (pct === null) return null;
  return Math.max(0, Math.min(100, pct));
}
