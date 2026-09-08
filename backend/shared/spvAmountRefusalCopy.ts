/**
 * shared/spvAmountRefusalCopy.ts — WAVE 342 · W296.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS FILE EXISTS TO FIX
 * ─────────────────────────────────────────────────────────────────────────────
 * TWELVE separate refusals on the SPV money paths all reached the general
 * partner as ONE sentence — "Amount must be greater than zero."
 * (`client/src/components/partner/SpvDetailTabs.tsx:251`) — because that screen's
 * local translation of the code `INVALID_AMOUNT` wins over whatever the server
 * said. So a GP who typed a figure with a decimal point, a figure past the
 * platform's exact-integer range, or a figure the vehicle's currency cannot
 * represent, was told their amount was not greater than zero. For four of those
 * refusals that sentence is simply FALSE, and none of the twelve told the person
 * what to do next.
 *
 * SIX of the twelve sites had no sentence AT ALL — they threw the bare code
 * `INVALID_AMOUNT` (`server/spvEngineStore.ts:735, 737, 738, 741, 3136, 4452`),
 * which fell through the route mapper's copy lookup to the generic tail and
 * arrived with an incident reference and no words. This module is where their
 * words now live.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULES THESE SENTENCES OBEY
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. NOTHING INTERNAL. No stack trace, no table name, no column name, no id, no
 *    ALL_CAPS_UNDERSCORE code, no file or line. The machine-readable part of a
 *    refusal travels in `error` and `amountError` (R77: an identifier may stay a
 *    VALUE, never text a person reads).
 * 2. EVERY SENTENCE SAYS WHAT TO DO. A refusal that only reports a state leaves
 *    the person stuck.
 * 3. EVERY SENTENCE SAYS WHETHER ANYTHING HAPPENED, on the paths that touch
 *    money. "Nothing has been deployed" / "Nothing has been transferred" is the
 *    fact a GP most needs and cannot see.
 * 4. NO CURRENCY IS NAMED, CONVERTED OR ASSUMED. This platform is
 *    multi-currency; the copy speaks of "the vehicle's own currency" and never
 *    of cents, dollars, or a converted equivalent.
 * 5. THE HEADLINES STAY SHORT. `client/src/lib/queryClient.ts:60-64` only
 *    prefers a server message under 240 characters, so anything longer would be
 *    silently replaced by a generic status sentence. `guidance` carries the
 *    unabridged version. `spvAmountRefusalHeadlinesAreShortEnough()` below is
 *    asserted by the test, so this cannot regress unnoticed.
 *
 * SHARED, not server-local, for the same reason `shared/spvSubscriptionRefusalCopy.ts`
 * is: the client keeps a fallback copy of the same sentences, and a page-local
 * re-spelling is how two surfaces come to disagree about the same refusal.
 */

/** The distinct amount-refusal conditions. One key per thing a person did. */
export type SpvAmountRefusalReason =
  | "not_a_number"
  | "fractional"
  | "negative"
  | "too_large"
  | "not_positive"
  | "transfer_not_whole_or_negative";

/** Machine field keys, used in `amountError.field` and to pick the human label. */
export type SpvAmountField =
  | "target_raise"
  | "minimum_check"
  | "cap"
  | "deployment_amount"
  | "transfer_amount";

/** The words a PERSON reads for each field. Never the machine key. */
export const SPV_AMOUNT_FIELD_LABEL: Record<SpvAmountField, string> = {
  target_raise: "The target raise",
  minimum_check: "The minimum check size",
  cap: "The cap",
  deployment_amount: "The deployment amount",
  transfer_amount: "The transfer amount",
};

/** Fallback label when a field key arrives that this build does not know. */
export const SPV_AMOUNT_FIELD_LABEL_FALLBACK = "That amount";

export const SPV_AMOUNT_REFUSAL_HEADLINE_MAX_CHARS = 200;

interface ReasonCopy {
  /** Short sentence, under the 240-character client gate. Takes the field label. */
  headline: (label: string) => string;
  /** The unabridged version. May be longer; shown as secondary guidance. */
  guidance: (label: string) => string;
}

const REASON_COPY: Record<SpvAmountRefusalReason, ReasonCopy> = {
  not_a_number: {
    headline: (l) => `${l} is not a number. Retype it using digits only and try again.`,
    guidance: (l) =>
      `${l} was not accepted because it is not a number. Retype it using digits only — ` +
      `no currency symbol, no spaces and no thousands separators — and save again. ` +
      `Nothing was saved.`,
  },
  fractional: {
    headline: (l) => `${l} must be a whole amount, with no fraction. Round it and try again.`,
    guidance: (l) =>
      `${l} was not accepted because it contains a fraction. Amounts are recorded as whole ` +
      `units of the vehicle's own currency, so a partial unit cannot be stored exactly. ` +
      `Remove the decimal part and save again. Nothing was saved.`,
  },
  negative: {
    headline: (l) => `${l} cannot be negative. Enter a positive amount, or leave it blank.`,
    guidance: (l) =>
      `${l} was not accepted because it is below zero. Enter a positive amount, or clear the ` +
      `field if it does not apply to this vehicle — a blank field stays blank and is not ` +
      `treated as zero. Nothing was saved.`,
  },
  too_large: {
    headline: (l) => `${l} is too large to be recorded exactly. Enter a smaller amount.`,
    guidance: (l) =>
      `${l} was not accepted because it is beyond the largest whole amount this platform can ` +
      `record without losing precision. An amount that cannot be stored exactly is refused ` +
      `rather than rounded. Enter a smaller amount. Nothing was saved.`,
  },
  not_positive: {
    headline: (l) => `${l} must be greater than zero. Nothing has been recorded.`,
    guidance: (l) =>
      `${l} was not accepted because it is zero, blank or not a number. Enter the amount you ` +
      `intend to record, in the vehicle's own currency, and try again. Nothing has been ` +
      `recorded and no money has moved.`,
  },
  transfer_not_whole_or_negative: {
    headline: (l) =>
      `${l} must be a whole, positive amount. Correct it and try again — nothing has been transferred.`,
    guidance: (l) =>
      `${l} was not accepted: a transfer amount must be a whole, positive amount in the ` +
      `vehicle's own currency, with no fraction. Correct the amount, or record the transfer ` +
      `as a units percentage instead. Nothing has been transferred.`,
  },
};

export function isSpvAmountRefusalReason(v: unknown): v is SpvAmountRefusalReason {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REASON_COPY, v);
}

function labelFor(field: unknown): string {
  if (typeof field === "string" && Object.prototype.hasOwnProperty.call(SPV_AMOUNT_FIELD_LABEL, field)) {
    return SPV_AMOUNT_FIELD_LABEL[field as SpvAmountField];
  }
  return SPV_AMOUNT_FIELD_LABEL_FALLBACK;
}

/**
 * The short sentence for one refusal, or `null` when this build has no copy for
 * the reason. NEVER invents a sentence: an unknown reason returns null and the
 * caller keeps whatever it had, which is how a code with no copy stays honest
 * instead of acquiring a made-up explanation.
 */
export function spvAmountRefusalHeadline(reason: unknown, field?: unknown): string | null {
  if (!isSpvAmountRefusalReason(reason)) return null;
  return REASON_COPY[reason].headline(labelFor(field));
}

/** The unabridged sentence, or `null` when this build has no copy for the reason. */
export function spvAmountRefusalGuidance(reason: unknown, field?: unknown): string | null {
  if (!isSpvAmountRefusalReason(reason)) return null;
  return REASON_COPY[reason].guidance(labelFor(field));
}

/** Every reason key this build has copy for. Used by the test to assert the count. */
export const SPV_AMOUNT_REFUSAL_REASONS = Object.keys(REASON_COPY) as SpvAmountRefusalReason[];

/**
 * Build the thrown message for a refusal: `INVALID_AMOUNT:<reason>:<field>`.
 *
 * The CODE STAYS `INVALID_AMOUNT` in the response body (the route mapper strips
 * the suffix), so nothing that keys on the code changes — R44, add, do not
 * substitute. The suffix exists only so the route can tell the twelve refusals
 * apart, which is the whole defect.
 */
export const SPV_AMOUNT_REFUSAL_CODE = "INVALID_AMOUNT";

export function spvAmountRefusalThrowMessage(
  reason: SpvAmountRefusalReason,
  field: SpvAmountField,
): string {
  return `${SPV_AMOUNT_REFUSAL_CODE}:${reason}:${field}`;
}

/** Parse a thrown message back into its parts. Returns null when it is not one. */
export function parseSpvAmountRefusalMessage(
  msg: unknown,
): { reason: SpvAmountRefusalReason; field: string | null } | null {
  if (typeof msg !== "string") return null;
  if (!msg.startsWith(`${SPV_AMOUNT_REFUSAL_CODE}:`)) return null;
  const parts = msg.split(":");
  const reason = parts[1];
  if (!isSpvAmountRefusalReason(reason)) return null;
  return { reason, field: parts[2] ?? null };
}

/** True when every headline fits under the client's 240-character gate. */
export function spvAmountRefusalHeadlinesAreShortEnough(): boolean {
  for (const reason of SPV_AMOUNT_REFUSAL_REASONS) {
    for (const field of Object.keys(SPV_AMOUNT_FIELD_LABEL) as SpvAmountField[]) {
      const h = spvAmountRefusalHeadline(reason, field);
      if (!h || h.length > SPV_AMOUNT_REFUSAL_HEADLINE_MAX_CHARS) return false;
    }
  }
  return true;
}
