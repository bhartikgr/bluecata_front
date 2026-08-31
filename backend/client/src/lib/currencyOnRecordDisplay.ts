/* ============================================================================
 * WAVE 190 · ITEM A — PRINT AN AMOUNT ONLY WHEN A CURRENCY IS ON RECORD.
 *
 * WHAT WENT WRONG
 * ---------------
 * `currencySymbol()` in `client/src/lib/currency.ts` takes a REGION and ends
 * `default: return "$"`. Three surfaces therefore told three different stories
 * about the same company:
 *
 *   · the founder cap table read `company_profile.legal.region` → printed `HK$`
 *   · the founder round screens read `rounds.region` — NULL on 1045 of 1045
 *     rows — fell back to `?? "US"` and printed a bare `$`
 *   · the investor invitation surfaces read `rounds.currency` through
 *     `shared/roundCurrencyOnRecordView.ts` and REFUSED, honestly
 *
 * Only the third was correct. A region is not a currency: a Hong Kong company
 * can be denominated in USD, and a British Virgin Islands vehicle was observed
 * on the live site displaying `CA$1,200.00`.
 *
 * WHY THIS MODULE
 * ---------------
 * The correct decision already existed — `readRoundCurrency()` in
 * `shared/roundCurrencyOnRecordView.ts` — but it hands back a code, and the
 * founder surfaces need a SYMBOL plus the sentence to print when there is not
 * one. Rather than let each screen invent that pairing (this platform's
 * recurring failure is the same rule written twice and then drifting), the
 * pairing is declared ONCE here and read by both founder surfaces. The
 * validator is not duplicated: `readRoundCurrency` remains the single arbiter of
 * "is a currency on record", and `currencySymbolForCurrency` the single
 * code→glyph map.
 *
 * THE CONTRACT
 * ------------
 *   · a currency on record  → the symbol for that currency
 *   · no currency on record → `null`, and the caller prints a stated refusal
 *   · NEVER a fabricated `"$"`, NEVER a blank
 *
 * NO CONVERSION (R156.1, owner verbatim: "If an SPV or a round is in one
 * currency, it is up to the investor to deliver exactly in that currency").
 * Nothing here reads an FX rate, performs arithmetic, or calls `Number()`,
 * `parseInt` or `parseFloat`. The amounts arrive ALREADY FORMATTED as strings
 * and are only ever concatenated with a glyph. This module changes which symbol
 * is shown, never an amount.
 * ========================================================================== */
import { readRoundCurrency } from "@shared/roundCurrencyOnRecordView";
import { currencySymbolForCurrency } from "./currency";

/**
 * The SHORT form, for a table cell where a full sentence would not fit. Matches
 * the string the investor invitation detail screen already uses
 * (`client/src/pages/investor/InvitationDetail.tsx:667`) byte for byte, so the
 * founder and the investor read the same words about the same absence.
 */
export const NO_CURRENCY_ON_RECORD_CELL = "Not shown — no currency on record";

/* ── WAVE 191 · ITEM C.2 / C.3 (R156.1) ───────────────────────────────────────
 * THE OTHER REASON A FIGURE CANNOT BE PRINTED: there are TWO currencies, not
 * none. Waves 178/180/190 established the "no currency on record" refusal; this
 * is its sibling, and it is a DIFFERENT fact with a different remedy. "Nobody
 * said which currency" is fixed by filling in a field. "These amounts are in
 * different currencies" cannot be fixed at all — there is no exchange rate in
 * this repository and R156.1 forbids inventing one — so the honest output is
 * each currency stated separately and no combined figure anywhere.
 *
 * The SHORT form is for a cell; the LONG form names the currencies involved so
 * the reader knows exactly which book they are looking at. */
export const MIXED_CURRENCY_ON_RECORD_CELL = "Not shown — more than one currency";

/**
 * @param currencies the distinct ISO codes found, in the order they should be
 *   read. Interpolated, never chosen: this function invents no currency.
 */
export function mixedCurrencyStatement(currencies: readonly string[]): string {
  return (
    `Not shown as one figure — these amounts are recorded in ${currencies.join(" and ")}. ` +
    `Capavate holds no exchange rate and will not invent one, so each currency is shown ` +
    `separately below. This is not the same as zero, and Capavate will not show a zero ` +
    `total for a figure it does not hold.`
  );
}

/**
 * The LONG form, for a header or a banner that has room to name the missing
 * fact and say why nothing is printed. Re-exported from the shared declaration
 * rather than restated, so there is exactly one sentence in the platform.
 */
export { ROUND_CURRENCY_NOT_RECORDED_STATEMENT } from "@shared/roundCurrencyOnRecordView";

/**
 * Resolve a display symbol from a stored CURRENCY value, or `null`.
 *
 * @param currency the value of a `currency` column (`rounds.currency`,
 *   `company_default_currency.currency`), or any unknown wire value.
 *
 * A region token can never produce a symbol here: `readRoundCurrency` accepts
 * only `/^[A-Z]{3}$/`, and every region code in this platform ("US", "HK",
 * "CA", "AU", "UK", "JP", "IN", "CN", "SG") is two letters.
 */
export function symbolOnRecord(currency: unknown): string | null {
  const view = readRoundCurrency(currency);
  if (!view.canDenominate || view.currency === null) return null;
  return currencySymbolForCurrency(view.currency);
}

/**
 * Print an already-formatted amount with its symbol, or the stated refusal.
 *
 * @param sym the result of `symbolOnRecord` — `null` means "no currency on
 *   record", which is a refusal and not a licence to pick one.
 * @param formatted the amount, ALREADY turned into a string by the caller. No
 *   number enters this function, so no rounding or precision decision is taken
 *   here and no money arithmetic can hide in it.
 */
export function moneyOnRecord(sym: string | null, formatted: string): string {
  if (sym === null) return NO_CURRENCY_ON_RECORD_CELL;
  return `${sym}${formatted}`;
}

/* ----------------------------------------------------------------------------
 * THE TWO-CHILD FORM, FOR A TABLE CELL THE DROP GUARD INVENTORIES.
 *
 * Two `td` cells in the tree were written `{sym}{amount}` — TWO expression
 * children — and the silent-drop guard records that child count and order as part
 * of the panel's identity (`child={expr}#2`, `childorder={expr}|{expr}`).
 * Collapsing them into a single `{moneyOnRecord(...)}` is read as a REMOVED panel
 * body, which is the wave-182 renumbering trap wearing different clothes.
 *
 * So those two cells keep exactly two expression children, and the pair below
 * splits the same decision across them. The rendered text is IDENTICAL to
 * `moneyOnRecord`, because it is the same two branches — this is a JSX shape
 * concession, not a second rule, and it must stay that way: if the refusal
 * wording ever changes it changes in `moneyOnRecord` and here reads through the
 * same constant.
 * -------------------------------------------------------------------------- */

/** First child: the symbol, or the whole stated refusal when there is none. */
export function symbolCellOnRecord(sym: string | null): string {
  return sym === null ? NO_CURRENCY_ON_RECORD_CELL : sym;
}

/**
 * Second child: the already-formatted amount, or an EMPTY string when there is
 * no currency on record — because the first child has already said, in words,
 * that nothing is being shown, and printing a bare number after that sentence
 * would be the fabricated denomination this wave exists to remove.
 */
export function amountCellOnRecord(sym: string | null, formatted: string): string {
  return sym === null ? "" : formatted;
}
