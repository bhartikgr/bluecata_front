/* ============================================================================
 * WAVE 122 · FINDING 2 — A ROUND'S CURRENCY, OR AN HONEST REFUSAL. ONE
 * DECLARATION, READ BY BOTH INVESTOR-FACING INVITATION SURFACES.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * `client/src/pages/investor/Invitations.tsx:62-66` and
 * `client/src/pages/investor/InvitationDetail.tsx:113` declared no `currency`
 * field at all, so every money figure on both screens went through `fmtUSD`
 * with no currency argument and printed a US dollar sign. A €2,000,000 round
 * target was shown to a prospective investor as `$2,000,000`. `rounds.currency`
 * exists, is writable (`server/routes.ts:7765`), and the LIST projection was
 * already sending it (`server/routes.ts:4303`) — the information was thrown
 * away in the browser.
 *
 * WHY A MODULE AND NOT A LINE IN EACH PAGE. Two screens need the identical
 * decision — "may this figure be denominated, and if not, what sentence do we
 * print instead?" — and this platform's recurring failure is the SAME rule
 * written twice and then drifting (five separate committed registers were found
 * in one day). So the decision and the sentence are declared ONCE, here, in
 * `shared/`, exactly as Wave 114 declared the money-state vocabulary once in
 * `shared/roundMoneyOnRecordView.ts`.
 *
 * NO MONEY ARITHMETIC AND NO FORMATTING HAPPENS HERE. This file decides only
 * whether a currency is on record and hands back the code. There is no
 * `Number()`, `parseInt` or `parseFloat` anywhere in it — the amounts never
 * enter this module. Formatting stays where it already lives
 * (`client/src/lib/format.ts` `fmtUSD`, which accepts a `currency` option), so
 * no second formatter is created either.
 *
 * IT REFUSES INSTEAD OF GUESSING (owner ruling R6, and R5's "not all SPVs are
 * US based"). A round with no currency recorded produces
 * `canDenominate: false` and a sentence. The alternative — assuming USD — is
 * how a Canadian round became a US-dollar round on screen, and Wave 114's
 * derivation already treats an unresolvable denomination as a named refusal
 * (`mixed_currency`) rather than a licence to pick one.
 * ========================================================================== */

/** The sentence a screen prints INSTEAD of an amount when the round carries no
 *  recorded currency. It is a complete sentence, not a dash, because a dash
 *  looks like a missing value rather than a deliberate refusal. */
export const ROUND_CURRENCY_NOT_RECORDED_STATEMENT =
  "Not shown — this round has no currency recorded, and Capavate will not print an amount " +
  "in a denomination it is guessing.";

export interface RoundCurrencyView {
  /** True only when a currency code is genuinely on record. A screen may print
   *  a denominated amount ONLY when this is true. */
  canDenominate: boolean;
  /** The ISO code, upper-cased, or null when nothing is recorded. */
  currency: string | null;
  /** Always non-empty. What to print when `canDenominate` is false. */
  statement: string;
}

/**
 * Narrow an unknown wire value (`round.currency`) into a rendering decision.
 *
 * A currency code is accepted only when it is a three-letter alphabetic string,
 * because that is what `Intl.NumberFormat` can denominate and what every stored
 * value in this platform is. Anything else — null, `""`, a number, a stray word
 * — is treated as NOT RECORDED rather than passed through to a formatter that
 * would silently fall back to a dollar sign in its `catch` branch
 * (`client/src/lib/format.ts:42`).
 */
export function readRoundCurrency(value: unknown): RoundCurrencyView {
  if (typeof value === "string") {
    const code = value.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      return { canDenominate: true, currency: code, statement: "" };
    }
  }
  return {
    canDenominate: false,
    currency: null,
    statement: ROUND_CURRENCY_NOT_RECORDED_STATEMENT,
  };
}
