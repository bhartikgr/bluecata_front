/**
 * WAVE 21 · ITEM 2 / ITEM 5 — client money display helpers.
 *
 * NEW FILE (not an edit to the shared `client/src/lib/currency.ts`, which is
 * left byte-identical so Wave 20 can work in the same tree).
 *
 * Two rules encoded here, both from Review A:
 *
 *  1. A monetary scalar that the server could not produce (because the data
 *     spans currencies and no FX source exists) must RENDER AS UNAVAILABLE.
 *     It must never fall back to `0`, and never to a currency label that was
 *     not the source currency. `formatMinor(null, "USD")` would print "$0.00",
 *     which is a lie; `formatMinorOrUnavailable(null, null)` prints "—".
 *
 *  2. Everything monetary goes through `formatMinor`, which is ISO-4217
 *     exponent aware. A hardcoded `/ 100` misstates JPY (exponent 0) by 100×
 *     and BHD/KWD/JOD (exponent 3) by 10×.
 */
import { formatMinor, currencyExponent } from "./currency";
import { NOT_PROVIDED } from "./wave4Display"; /* WAVE 42 · R6 — see the R6 block below. */

/** Rendered in place of a number that does not exist. */
export const MONEY_UNAVAILABLE = "—";

/**
 * Format an integer minor-unit amount, or render an explicit unavailable
 * marker when the amount or its currency is absent.
 *
 * `minor === null | undefined`  → the server said "no single-currency value".
 * `currency === null | undefined` → we do not know the denomination, so we
 * must not pick one. Both cases render `MONEY_UNAVAILABLE`, never `$0.00`.
 */
export function formatMinorOrUnavailable(
  minor: number | null | undefined,
  currency: string | null | undefined,
  opts: { locale?: string; placeholder?: string } = {},
): string {
  const placeholder = opts.placeholder ?? MONEY_UNAVAILABLE;
  /* WAVE 42 · R6 — LATENT DEFECT FOUND BY THE R6 BOTH-POLE TEST (finding
   * W42-F2). The original guard was:
   *
   *     if (minor === null || minor === undefined || !Number.isFinite(Number(minor)))
   *
   * `Number("")` is `0`, and `0` IS finite. So an EMPTY STRING — the single most
   * common representation of "the user never typed anything in this field" —
   * slipped past all three checks and rendered "$0.00". This is exactly the R6
   * defect, sitting inside the helper written to prevent it, since Wave 21.
   * It was never caught because the existing tests only passed `null`.
   *
   * Delegating to `isUnknownNumber` closes the hole and keeps ONE definition of
   * "unknown" for the whole module. A genuine numeric `0` is still formatted —
   * `isUnknownNumber(0) === false` — so no real zero is affected. */
  if (isUnknownNumber(minor)) return placeholder;
  const cur = String(currency ?? "").trim().toUpperCase();
  if (!cur) return placeholder;
  return formatMinor(Number(minor), cur, { locale: opts.locale });
}

/**
 * ITEM 5 replacement for the `(minor / 100).toFixed(2)` idiom that Review A
 * found across ~15 client surfaces. Returns the MAJOR-unit numeric string with
 * the currency's own number of fraction digits — `12345` JPY → `"12345"`, not
 * `"123.45"`. Use `formatMinor` when you want a symbol; use this only where a
 * bare number is required (inputs, CSV cells, chart axes).
 */
export function minorToMajorString(
  minor: number | null | undefined,
  currency: string | null | undefined,
): string {
  /* WAVE 42 · R6 / W42-F2 — same empty-string hole as `formatMinorOrUnavailable`
   * above, in the helper that feeds INPUTS and CSV CELLS. `Number("")` is 0, so
   * an untouched amount field round-tripped as the string "0.00" and a blank CSV
   * cell exported as a hard zero. Now returns "" for every unknown, which is the
   * correct value for an empty input and an empty cell. A real 0 still yields
   * "0.00". */
  if (isUnknownNumber(minor)) return "";
  const exp = currencyExponent(currency ?? "USD");
  return (Number(minor) / Math.pow(10, exp)).toFixed(exp);
}

/* ==========================================================================
 * WAVE 42 · OWNER RULING R6 — "no surface may render 0 when it means
 * 'we do not know'."
 *
 *   > "Go with your recommendation. Apply it everywhere as this seems to be an
 *   >  investor grade best practice globally."   — the owner, 2026-08-13
 *
 * This block is an EXTENSION of the module that already encodes the
 * honest-refusal rule for money (Wave 21, above). It is deliberately NOT a new
 * parallel helper: the brief for this wave is explicit that a second vocabulary
 * is itself the defect ("six sinks of this class have now been found across
 * four sweeps, each fixed individually"). Everything R6 goes through here.
 *
 * ── THE TWO POLES, WHICH ARE EQUALLY LOAD-BEARING ─────────────────────────
 *   NEVER ENTERED  → an explicit refusal string ("Not provided").
 *   A GENUINE ZERO → "0" / "$0.00" / "0%", and it MEANS zero.
 *
 * A helper that returned the refusal for 0 as well would be a WORSE bug than
 * the one R6 fixes: it would make a deliberate zero unsayable. Every function
 * below therefore tests `== null` / non-finite ONLY, and lets 0 through. Both
 * poles are asserted for every function in
 * `client/src/lib/__tests__/wave42_r6_display.test.ts`.
 *
 * ── MONEY ─────────────────────────────────────────────────────────────────
 * Minor-unit money goes through `formatMinorOrUnavailable` (above), which
 * delegates to the ISO-4217-exponent-aware `formatMinor`. There is no `/ 100`
 * and no `* 100` anywhere in this file. JPY (exponent 0) is covered by a
 * fixture in the test file, because no JPY data exists live and the test is the
 * only place that path executes.
 *
 * Some legacy columns (`rounds.pre_money`, `rounds.post_money`,
 * `rounds.min_ticket`) are stored in MAJOR units, not minor. Those use
 * `moneyMajorOrNotProvided`, which formats and does NOT convert. Converting
 * them here would be exactly the "one screen converts and another forgets"
 * defect that `spec/PERCENT_POLICY_v2.md` was written to end.
 *
 * ── PERCENT (owner ruling R16) ────────────────────────────────────────────
 * PERCENT IS AS-WRITTEN. `1` is 1%. `100` is 100%. NO CONVERSION ANYWHERE.
 * (OR-1, 2026-08-09: "1=1%. 100=100%." — restated as binding in R16 after an
 * earlier brief stated it backwards.) `pctOrNotProvided` therefore never
 * multiplies or divides by 100. A `ratio` is NOT a percentage — it is a
 * multiple, so an LTV/CAC of 3 is "3×", never "300%": use `ratioOrNotProvided`.
 * ========================================================================== */

/* WAVE 42 · R6 — re-exported so a call site needs exactly one import to obey
 * R6. The string itself is owned by `wave4Display.ts` (COS-1, Wave 4) and is
 * pinned there by test; it is NOT re-spelled here, because two spellings of one
 * refusal is how "Not reported" came to exist in the SPV/NAV/K-1 code and
 * nowhere else. */
export { NOT_PROVIDED };

/**
 * The second honest-refusal wording, already used by the SPV / NAV / K-1
 * surfaces (`client/src/components/admin/FounderChannelsPanel.tsx:77`) whose
 * vocabulary the 2026-08-13 live audit found had "no instance anywhere on
 * founder surfaces". Use this when the value is a MEASUREMENT that nobody has
 * taken yet (a score, an assessment), as distinct from a FIELD nobody has
 * filled in — where `NOT_PROVIDED` reads better.
 */
export const NOT_REPORTED = "Not reported" as const;

/** True only for a value that was never entered. A genuine 0 is NOT unknown. */
export function isUnknownNumber(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  return !Number.isFinite(Number(v));
}

/**
 * R6 money, MINOR units. `null`/unset → refusal; a genuine `0` → "$0.00".
 * Exponent-aware through `formatMinor`, so JPY 0 renders "¥0" (no fraction
 * digits) and never "¥0.00".
 */
export function moneyOrNotProvided(
  minor: number | null | undefined,
  currency: string | null | undefined,
  opts: { locale?: string; placeholder?: string } = {},
): string {
  return formatMinorOrUnavailable(minor, currency, {
    locale: opts.locale,
    placeholder: opts.placeholder ?? NOT_PROVIDED,
  });
}

/**
 * R6 money, MAJOR units — for the legacy round-valuation columns only
 * (`pre_money`, `post_money`, `min_ticket`). NO unit conversion is performed:
 * the stored number is already major, and multiplying it here to reuse the
 * minor-unit path would be a silent reinterpretation of stored data.
 *
 * `null`/unset → refusal. A genuine `0` → "$0" and it means zero.
 */
export function moneyMajorOrNotProvided(
  major: number | null | undefined,
  currency: string | null | undefined,
  opts: { locale?: string; placeholder?: string; compact?: boolean } = {},
): string {
  const placeholder = opts.placeholder ?? NOT_PROVIDED;
  if (isUnknownNumber(major)) return placeholder;
  const n = Number(major);
  const cur = String(currency ?? "").trim().toUpperCase() || "USD";
  const exp = currencyExponent(cur);
  try {
    return new Intl.NumberFormat(opts.locale, {
      style: "currency",
      currency: cur,
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: opts.compact ? undefined : exp,
      maximumFractionDigits: opts.compact ? 1 : exp,
    }).format(n);
  } catch {
    return `${cur} ${n.toFixed(exp)}`;
  }
}

/**
 * R6 percent — **AS WRITTEN (R16)**. The input IS the percentage: `1` renders
 * "1.0%", `100` renders "100.0%". This function contains no `* 100` and no
 * `/ 100` and must never acquire one.
 *
 * `null`/unset → refusal. A genuine `0` → "0.0%" and it means zero percent.
 */
export function pctOrNotProvided(
  pct: number | null | undefined,
  digits: number = 1,
  opts: { placeholder?: string } = {},
): string {
  if (isUnknownNumber(pct)) return opts.placeholder ?? NOT_PROVIDED;
  return `${Number(pct).toFixed(digits)}%`;
}

/**
 * R6 ratio — a MULTIPLE, not a percentage (R16: "an LTV/CAC of `3` means 3×,
 * never 300%"). `null`/unset → refusal. A genuine `0` → "0.0×".
 */
export function ratioOrNotProvided(
  ratio: number | null | undefined,
  digits: number = 1,
  opts: { placeholder?: string } = {},
): string {
  if (isUnknownNumber(ratio)) return opts.placeholder ?? NOT_PROVIDED;
  return `${Number(ratio).toFixed(digits)}\u00d7`;
}

/**
 * R6 count. `null`/unset → refusal. A genuine `0` → "0", which is the honest
 * answer for "a company with no directors on file yet has told us there are
 * none". The two are different statements and this is the whole ruling.
 */
export function countOrNotProvided(
  n: number | null | undefined,
  opts: { placeholder?: string; locale?: string } = {},
): string {
  if (isUnknownNumber(n)) return opts.placeholder ?? NOT_PROVIDED;
  return Number(n).toLocaleString(opts.locale ?? "en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
