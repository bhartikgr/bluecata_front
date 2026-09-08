/**
 * WAVE 183 · ITEM B FIX 1b/1c — ONE client-side reading of the ledger-derived
 * portfolio payload, so four surfaces cannot each invent their own.
 *
 * `GET /api/investor/portfolio2` and `GET /api/investor/portfolio` used to serve
 * `server/mockData.ts`'s demo seed (in production: a hardcoded `[]`). They now
 * serve rows derived from the caller's committed cap-table entries. The wire
 * shape changed in three ways that matter, and every one of them is a
 * correctness change rather than a refactor:
 *
 *   1. MONEY ARRIVES AS INTEGER MINOR UNITS IN A STRING, WITH ITS CURRENCY.
 *      The seed sent `invested: 1_500_000` — a bare float with no currency, in
 *      major units, which is how a cap table ends up rendering HK$ beside
 *      unprefixed dollars. A minor-unit integer plus an ISO code cannot do that.
 *
 *   2. FIELDS THE LEDGER DOES NOT HOLD ARRIVE AS `null` PLUS A REASON.
 *      The seed had a `currentValue` for every position because someone typed
 *      one. The ledger has no marks service attached to this route, so
 *      `currentValueMinor` is `null` and `unknown` carries
 *      `CURRENT_VALUE_NO_MARK_RECORDED`. The platform's rule, quoted:
 *      "This is not the same as zero, and Capavate will not show a zero total
 *      for a figure it does not hold."
 *
 *   3. THERE IS NO `logoColor`. It was a hardcoded HSL string per seed row.
 *      A colour is presentation, not a datum, so it is derived here from the
 *      company id — deterministically, so it never changes between reloads, and
 *      visibly as a UI affordance rather than as anything read from a database.
 *
 * NOTHING IN THIS FILE PERFORMS MONEY ARITHMETIC. It formats and it refuses.
 * Comparisons and sums are the server's job and the server does them in
 * `bigint`. There is deliberately no `moic` helper here: a multiple needs a
 * mark, this payload has none, and a helper would be an invitation to
 * substitute cost for value.
 *
 * ---------------------------------------------------------------------------
 * QA-B4 AMENDMENT - ONE NARROW EXCEPTION, WITH ITS REASON STATED.
 * ---------------------------------------------------------------------------
 * The rule above is not being dropped and the sentence above is not deleted; it
 * is QUALIFIED, because a later wave created a case it did not anticipate.
 *
 * `DashboardSpinePanels.tsx` renders an invested TOTAL across the caller's
 * holdings. This route's payload is per-position: there is no server-side total
 * on it, and the analytics endpoint that does carry one answers a DIFFERENT
 * question ("Total committed", `Dashboard.tsx`) and must not be substituted.
 * With no total on the wire the panel invented one - and, reading two fields
 * this payload no longer carries, it produced a hardcoded $0 for EVERY investor.
 *
 * So ONE summing helper lives here, `totalInvested`, and it exists BECAUSE of
 * the rule above rather than in spite of it:
 *   - It sums in `bigint`, never `Number`, so no precision is lost.
 *   - IT REFUSES FAR MORE OFTEN THAN IT ADDS. More than one currency, any
 *     missing amount, any missing currency, any out-of-safe-range value - each
 *     returns a REFUSAL carrying the ratified sentence that explains it. It is
 *     a refusal with an addition in the last branch.
 *   - IT NEVER RETURNS ZERO FOR AN ABSENCE. A genuinely recorded zero still
 *     renders as zero; an unknown renders as the refusal. Never fabricate a
 *     zero, and never conceal a true one.
 *   - IT NEVER CONVERTS CURRENCY. This platform holds no exchange rate and this
 *     helper does not invent one.
 * Anything beyond a same-currency sum - multiples, marks, valuations, returns -
 * remains the server's job. Do not widen this exception without a stated reason.
 */
import { formatMinor, MONEY_NOT_ON_RECORD } from "@/lib/currency";
import { ApiError } from "@/lib/queryClient";

export type PortfolioUnknown =
  | "CURRENT_VALUE_NO_MARK_RECORDED"
  | "OWNERSHIP_PCT_NO_CAP_TABLE_DENOMINATOR"
  | "INVESTED_SPANS_CURRENCIES"
  | "CURRENCY_NOT_ON_RECORD"
  | "SECTOR_NOT_ON_RECORD"
  | "STAGE_NOT_ON_RECORD"
  | "INSTRUMENT_NOT_ON_RECORD"
  | "SHARES_NOT_ON_RECORD"
  | "MA_SIGNAL_NOT_ASSESSED";

/** The wire shape of `GET /api/investor/portfolio2`, mirrored from
 *  `server/lib/investorPortfolioProjection.ts`. */
export interface DerivedPosition {
  id: string;
  companyId: string;
  company: string;
  sector: string | null;
  stage: string | null;
  instrument: string | null;
  lastRoundLabel: string | null;
  lastRoundDate: string | null;
  investedMinor: string | null;
  currency: string | null;
  investedExceedsSafeRange: boolean;
  currentValueMinor: string | null;
  shares: string | null;
  ownershipPct: number | null;
  vintageYear: number | null;
  unknown: PortfolioUnknown[];
  matchedVia: "canonical" | "alias";
}

/**
 * The sentence for each missing fact.
 *
 * These are STATEMENTS, not apologies, and none of them asks the reader to
 * retry — that was the whole defect wave 183 exists to fix. Each one names the
 * fact the platform does not hold and, where there is one, who holds it.
 */
export const PORTFOLIO_UNKNOWN_COPY: Record<PortfolioUnknown, string> = {
  CURRENT_VALUE_NO_MARK_RECORDED:
    "No valuation mark is on record for this holding, so its current value is not stated. This is not a value of zero.",
  OWNERSHIP_PCT_NO_CAP_TABLE_DENOMINATOR:
    "Ownership percentage needs a fully-diluted share count for the company, which this position payload does not carry. It is not stated rather than estimated.",
  INVESTED_SPANS_CURRENCIES:
    "This holding's commitments are recorded in more than one currency, so no single invested total is stated. Adding them would invent a figure.",
  CURRENCY_NOT_ON_RECORD:
    "At least one commitment for this holding has no currency on record, so it is excluded from the invested total rather than assumed to be dollars.",
  SECTOR_NOT_ON_RECORD: "Sector is not on record for this company.",
  STAGE_NOT_ON_RECORD: "Stage is not on record for this company.",
  INSTRUMENT_NOT_ON_RECORD: "Instrument type is not on record for the most recent contributing round.",
  SHARES_NOT_ON_RECORD: "Share count is not on record for this holding.",
  MA_SIGNAL_NOT_ASSESSED: "No M&A signal has been assessed for this company.",
};

/** Text for a missing string field. Distinct from money, which has its own
 *  platform-wide wording in `MONEY_NOT_ON_RECORD`. */
export const FIELD_NOT_ON_RECORD = "Not on record";

/** QA-B4. Two sentences for two absences a TOTAL can have that a single
 *  position cannot. Plain statements in the same register as the ratified set
 *  above: they name the missing fact and they do not ask anyone to retry. */
export const NO_POSITIONS_COPY =
  "No funded positions are on record, so no invested total is stated.";
export const AMOUNT_MISSING_COPY =
  "At least one holding has no invested amount on record, so no total is stated. A total that left it out would understate what is held.";

export function hasUnknown(p: DerivedPosition, u: PortfolioUnknown): boolean {
  return Array.isArray(p.unknown) && p.unknown.indexOf(u) !== -1;
}

/**
 * Render a minor-unit money string.
 *
 * `formatMinor` takes a number, and `Number()` on money is banned by this
 * project's standing rule — so the conversion happens ONLY after an explicit
 * safe-range check, and a value outside that range renders as not-on-record
 * rather than as a silently-rounded approximation of itself. That is the
 * `MAX_SAFE_INTEGER`-gated boundary returning nothing, at the display edge.
 */
function renderMinor(minor: string | null, currency: string | null, exceedsSafe: boolean): string {
  if (minor === null || currency === null) return MONEY_NOT_ON_RECORD;
  if (exceedsSafe) return MONEY_NOT_ON_RECORD;
  if (!/^-?\d+$/.test(minor)) return MONEY_NOT_ON_RECORD;
  const asNumber = Number(minor);
  if (!Number.isSafeInteger(asNumber)) return MONEY_NOT_ON_RECORD;
  return formatMinor(asNumber, currency);
}

export function investedDisplay(p: DerivedPosition): string {
  return renderMinor(p.investedMinor, p.currency, p.investedExceedsSafeRange === true);
}

/** Always `MONEY_NOT_ON_RECORD` on this payload today, and deliberately routed
 *  through the same function so the day a mark arrives it renders correctly
 *  without a second code path being written. */
export function currentValueDisplay(p: DerivedPosition): string {
  return renderMinor(p.currentValueMinor, p.currency, false);
}

/* ==========================================================================
   QA-B4 - THE INVESTED TOTAL, AND THE CURRENT-VALUE TOTAL THAT REFUSES.
   ========================================================================== */

/**
 * The result of asking this payload for a total.
 *
 * `null` is NOT one of the cases. A caller must be handed either an amount it
 * can print or a SENTENCE saying why there is none - which is what stops the
 * next implementer from writing `?? 0` at the call site and re-creating the
 * exact defect this replaces.
 */
export type PortfolioTotal =
  | { kind: "amount"; text: string; currency: string }
  | { kind: "unknown"; note: string };

/** The absence wording shown in a figure slot, distinct from the explanation. */
export const TOTAL_NOT_STATED = MONEY_NOT_ON_RECORD;

/**
 * Sum `investedMinor` across positions - or refuse, with the reason.
 *
 * REFUSES when: there are no positions; any position carries no currency; the
 * positions span more than one currency; any amount is missing, non-integer, or
 * flagged beyond safe range. ADDS only when every position is present, integral
 * and in the SAME currency. The addition is `bigint`, so a large book is exact.
 */
export function totalInvested(positions: DerivedPosition[]): PortfolioTotal {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { kind: "unknown", note: NO_POSITIONS_COPY };
  }

  /* Currency first. Mixing is the one failure that would silently produce a
     plausible wrong number, so it is rejected before any addition happens. */
  const currencies: string[] = [];
  for (const p of positions) {
    if (p.currency === null || String(p.currency).trim() === "") {
      return { kind: "unknown", note: PORTFOLIO_UNKNOWN_COPY.CURRENCY_NOT_ON_RECORD };
    }
    if (currencies.indexOf(p.currency) === -1) currencies.push(p.currency);
  }
  if (currencies.length > 1) {
    return { kind: "unknown", note: PORTFOLIO_UNKNOWN_COPY.INVESTED_SPANS_CURRENCIES };
  }

  let sum = 0n;
  for (const p of positions) {
    if (p.investedExceedsSafeRange === true) {
      return { kind: "unknown", note: PORTFOLIO_UNKNOWN_COPY.CURRENCY_NOT_ON_RECORD };
    }
    if (p.investedMinor === null || !/^-?\d+$/.test(p.investedMinor)) {
      return { kind: "unknown", note: AMOUNT_MISSING_COPY };
    }
    sum += BigInt(p.investedMinor);
  }

  /* Format through the SAME gate every single figure goes through, so a total
     can never be rendered by a path a single position would have refused. */
  const text = renderMinor(sum.toString(), currencies[0], false);
  if (text === MONEY_NOT_ON_RECORD) {
    return { kind: "unknown", note: AMOUNT_MISSING_COPY };
  }
  return { kind: "amount", text, currency: currencies[0] };
}

/**
 * The current-value total.
 *
 * On this route `currentValueMinor` is `null` for every position because no
 * marks service is attached, so in practice this always refuses. It is written
 * as a real function rather than a constant so that the day marks arrive it
 * totals them correctly instead of a second code path being invented.
 */
export function totalCurrentValue(positions: DerivedPosition[]): PortfolioTotal {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { kind: "unknown", note: NO_POSITIONS_COPY };
  }
  const currencies: string[] = [];
  for (const p of positions) {
    if (p.currentValueMinor === null || !/^-?\d+$/.test(p.currentValueMinor)) {
      return { kind: "unknown", note: PORTFOLIO_UNKNOWN_COPY.CURRENT_VALUE_NO_MARK_RECORDED };
    }
    if (p.currency === null || String(p.currency).trim() === "") {
      return { kind: "unknown", note: PORTFOLIO_UNKNOWN_COPY.CURRENCY_NOT_ON_RECORD };
    }
    if (currencies.indexOf(p.currency) === -1) currencies.push(p.currency);
  }
  if (currencies.length > 1) {
    return { kind: "unknown", note: PORTFOLIO_UNKNOWN_COPY.INVESTED_SPANS_CURRENCIES };
  }
  let sum = 0n;
  for (const p of positions) sum += BigInt(p.currentValueMinor as string);
  const text = renderMinor(sum.toString(), currencies[0], false);
  if (text === MONEY_NOT_ON_RECORD) {
    return { kind: "unknown", note: PORTFOLIO_UNKNOWN_COPY.CURRENT_VALUE_NO_MARK_RECORDED };
  }
  return { kind: "amount", text, currency: currencies[0] };
}

export function sharesDisplay(p: DerivedPosition): string {
  if (p.shares === null || !/^-?\d+$/.test(p.shares)) return FIELD_NOT_ON_RECORD;
  const n = Number(p.shares);
  if (!Number.isSafeInteger(n)) return p.shares;
  return n.toLocaleString("en-US");
}

export function ownershipDisplay(p: DerivedPosition): string {
  return p.ownershipPct === null ? FIELD_NOT_ON_RECORD : `${p.ownershipPct.toFixed(2)}%`;
}

export function textOrNotOnRecord(v: string | null | undefined): string {
  return v && v.trim().length > 0 ? v : FIELD_NOT_ON_RECORD;
}

export function vintageDisplay(p: DerivedPosition): string {
  return p.vintageYear === null ? FIELD_NOT_ON_RECORD : String(p.vintageYear);
}

/** Every applicable missing-fact sentence for a position, in payload order. */
export function unknownNotes(p: DerivedPosition): string[] {
  if (!Array.isArray(p.unknown)) return [];
  const out: string[] = [];
  for (const u of p.unknown) {
    const s = PORTFOLIO_UNKNOWN_COPY[u];
    if (s && out.indexOf(s) === -1) out.push(s);
  }
  return out;
}

/**
 * A stable presentational colour for a company avatar.
 *
 * The seed shipped `logoColor: "hsl(184 98% 22%)"` per row; the ledger holds no
 * such column and inventing one server-side would have put a made-up value in a
 * payload this wave is cleaning up. Derived here instead, from a cheap
 * deterministic hash of the company id, so it is identical on every reload and
 * unmistakably a UI choice rather than data.
 */
export function positionLogoColor(companyId: string): string {
  let h = 0;
  for (let i = 0; i < companyId.length; i += 1) {
    h = (h * 31 + companyId.charCodeAt(i)) % 360;
  }
  return `hsl(${h} 42% 34%)`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIX 1c — CLASSIFYING THE REFUSAL INSTEAD OF CALLING IT A LOAD FAILURE.

   `gate("investor.hasAnyCapTable")` (`server/routes.ts`) returns HTTP 403
   `CAP_TABLE_REQUIRED` when the caller has no cap-table position. Before this
   wave the Portfolio page rendered that 403 through `LoadFailedRefusal`, so an
   LP read "We couldn't load your portfolio positions." and a retry button, for a
   condition that no number of retries can change.

   This function returns the STATED FACT for a deterministic refusal, and `null`
   for everything else — a 500, a 429, a dropped connection, a paused query. When
   it returns `null` the existing transient copy stands alone, byte-verbatim,
   which is exactly what ITEM C requires.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The 403 that means "your account has no cap-table position on record". */
export const CAP_TABLE_REQUIRED_DETAIL =
  "The missing fact is a cap-table position: this account has no committed holding on record, so the portfolio surface is not unlocked yet. If you invested before you had an account, use \u201cI invested before I had an account\u201d to link those positions \u2014 retrying this page will not change it.";

/** The 401 that means the session is gone. Also not transient. */
export const PORTFOLIO_SIGNED_OUT_DETAIL =
  "The missing fact is a signed-in session: this request was not authenticated. Sign in again \u2014 retrying this page will not change it.";

export function portfolioFailureDetail(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const payload = error.payload as { error?: string } | null | undefined;
  const code = (payload && typeof payload === "object" ? payload.error : null) ?? error.code ?? null;
  if (error.status === 403 && code === "CAP_TABLE_REQUIRED") return CAP_TABLE_REQUIRED_DETAIL;
  if (error.status === 401) return PORTFOLIO_SIGNED_OUT_DETAIL;
  /* Everything else — including 500 PORTFOLIO_DERIVATION_FAILED — really is a
     load failure, and the existing copy is already the right thing to say. */
  return null;
}
