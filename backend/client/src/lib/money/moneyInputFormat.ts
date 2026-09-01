/* ─────────────────────────────────────────────────────────────────────────────
 * WAVE 245 — THE PLATFORM'S ONE MONEY-INPUT FORMATTING BEHAVIOUR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * The investor decision tab's "Investment amount (USD)" input showed a raw
 * `50000` while the attestation sentence and the submit button directly beneath
 * it rendered `$50,000` for the same figure. The founder round wizard had
 * already solved this — `client/src/pages/founder/RoundNew.tsx` grouped its
 * money inputs live as the founder typed. Wave 245's instruction was to pick
 * the behaviour the founder wizard already uses and apply it to the investor
 * input, extending the existing formatter and never writing a second one.
 *
 * So `formatMoneyInputDisplay` below is `RoundNew.tsx`'s `formatWithCommas`,
 * MOVED here character-for-character. Nothing about its behaviour changed;
 * `RoundNew.tsx` now imports it under its original name so every one of its
 * eight call sites is untouched. This is a move, not a rewrite, and not a
 * deletion.
 *
 * THE CONTRACT — AND THE REASON IT IS ABSOLUTE
 * ────────────────────────────────────────────
 * These two functions are a matched pair and they exist to keep FORMATTING
 * from ever becoming PARSING:
 *
 *   • `formatMoneyInputDisplay` is for the `value` prop ONLY — what the human
 *     reads in the box.
 *   • `stripMoneyInputGrouping` runs on the way back in, so the value stored in
 *     React state is ALWAYS a plain, comma-free numeric string.
 *
 * That second half is load-bearing. The investor page reads the amount as
 * `Number(amount) || 0` in five separate places — the attestation sentence, the
 * PATCH body, the signature payload and two emitted event payloads. If a
 * grouped string such as `"50,000"` ever reached React state, `Number("50,000")`
 * is `NaN`, `NaN || 0` is `0`, and the platform would silently record a
 * soft-circle of ZERO DOLLARS in the attestation text, in the persisted payload
 * and in the event stream. Grouping the display without stripping on input is
 * therefore not a cosmetic shortcut — it is a money defect.
 *
 * `RoundNew.tsx` states the same contract in its own words at the top of
 * `FormattedNumberInput`: "The stored `value` stays a plain numeric string so
 * downstream parsing is unchanged." This module makes that contract shared
 * rather than a property of one page.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ────────────────────────────
 *  • NO ARITHMETIC. Nothing here adds, subtracts, scales, rounds or compares
 *    money. It rearranges characters in a string and nothing else.
 *  • NO CURRENCY. No symbol, no code, no locale, no conversion, no exponent.
 *    It never turns 100 of one currency into 100 of another because it has no
 *    concept of currency at all. The `(USD)` in a field label and the `fmtUSD`
 *    used for on-record display are entirely separate concerns.
 *  • NO PARSING FOR VALUE. `stripMoneyInputGrouping` returns a STRING. It never
 *    calls `Number`, `parseInt` or `parseFloat`, so it cannot lose precision
 *    above `MAX_SAFE_INTEGER` and cannot silently produce `NaN`. Digits in,
 *    digits out.
 *
 * RELATED CODE THAT IS DELIBERATELY NOT TOUCHED BY WAVE 245
 * ────────────────────────────────────────────────────────
 *  • `client/src/pages/founder/Rounds.tsx` `formatMoney` (~line 285) is a THIRD
 *    grouping implementation, near-identical to this one but without the
 *    leading-minus handling, and its `MoneyInput` wrapper is bound to a `number`
 *    rather than a string. Consolidating it would change a money-bound
 *    component's type on a path wave 245 was not asked to touch, so it is
 *    reported to the owner instead of altered here.
 *  • `client/src/lib/money/companyMoneyOnRecord.ts` `displayCompanyMinor` groups
 *    digits too, but it is a different job: `bigint` MINOR units rendered with a
 *    currency shell for amounts ON RECORD. It is not an input formatter and must
 *    not be merged with this file.
 * ────────────────────────────────────────────────────────────────────────── */

/** Group the integer part of a money-input string with thousands separators for
 *  DISPLAY. Decimals are preserved untouched, a trailing "." is kept so the
 *  human can carry on typing, and a leading "-" survives. Pure string work: the
 *  numeric magnitude of the input is never read, so nothing can round or
 *  overflow.
 *
 *  Moved verbatim from `client/src/pages/founder/RoundNew.tsx` (wave 245),
 *  INCLUDING its quirks, because this wave must change no behaviour:
 *   • `rest.join("")` — note the EMPTY separator. A human who types "1.2.3" gets
 *     back "1.23": every dot after the first is swallowed rather than preserved.
 *     That is the founder wizard's existing behaviour on eight money fields, so
 *     it is reproduced here exactly. Writing the more "obvious" `join(".")`
 *     would have quietly changed how eight existing inputs treat a second
 *     decimal point — a behaviour change smuggled in under a formatting wave.
 *     The first draft of this file did exactly that and it was caught by diffing
 *     against the original; W245-6 now fences it.
 *   • The negative sign is detected on the RAW string but stripped by the
 *     `[^\d.]` clean, then re-prefixed, so "abc-5" formats as "5" while "-5"
 *     formats as "-5". Also preserved as-is. */
export function formatMoneyInputDisplay(raw: string): string {
  if (raw == null || raw === "") return "";
  const negative = raw.trim().startsWith("-");
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (cleaned === "") return negative ? "-" : "";
  const [intPart, ...rest] = cleaned.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimal = rest.length > 0 ? "." + rest.join("") : (cleaned.endsWith(".") ? "." : "");
  return (negative ? "-" : "") + grouped + decimal;
}

/** Remove the characters `formatMoneyInputDisplay` adds — grouping commas,
 *  whitespace and a currency `$` a human may paste — so the value committed to
 *  state is a clean numeric string.
 *
 *  Returns a STRING, deliberately. Callers store this and any existing numeric
 *  read downstream sees exactly the characters it saw before this wave.
 *
 *  Character-identical to the strip written inline in the `onChange` of
 *  `FormattedNumberInput` in `client/src/pages/founder/RoundNew.tsx`
 *  (`e.target.value.replace(/[,\s$]/g, "")`). That inline copy is deliberately
 *  LEFT IN PLACE: rewriting a live money handler's expression retires its
 *  silent-drop-guard event key, which is not a risk worth taking to save one
 *  line in a display-formatting wave. Test W245-7 fences the two together — it
 *  asserts this function agrees with that regex across a table of inputs AND
 *  that the regex is still present in `RoundNew.tsx`'s source, so the pair cannot
 *  drift unnoticed. */
export function stripMoneyInputGrouping(displayed: string): string {
  if (displayed == null) return "";
  return String(displayed).replace(/[,\s$]/g, "");
}
