/**
 * WAVE 71 · D8 — THE INTEREST CLOCK, IN EXACT ARITHMETIC, IN EXACTLY ONE PLACE.
 *
 * WHAT WAS WRONG. `compute.ts` computed
 *
 *     (closeDate.getTime() - issued.getTime()) / (365.25 * 24 * 3600 * 1000)
 *
 * in IEEE-754 doubles and then truncated the result with `.toFixed(8)`. It was
 * the ONLY float in the conversion path, in a codebase whose stated rule is that
 * no float touches money (`spec/PERCENT_POLICY_v2.md`; owner ruling R29). Wave 70
 * then REPRODUCED that expression character-for-character inside
 * `asConvertedConvertibleShares` in `shared/roundMathEngineAdapter.ts` so the two
 * paths could not disagree — deliberately duplicating a defect rather than
 * letting D4 come back. Its own comment said Wave 71 must fix BOTH SITES
 * TOGETHER. This function is how: there is now ONE implementation and both
 * callers import it, so there is no second site to forget.
 *
 * WHAT DID NOT CHANGE, AND WHY THAT IS THE POINT. The CONVENTION is untouched: a
 * 365.25-day year, and the result stated to 8 decimal places. Only the ARITHMETIC
 * changed, from binary floating point to `decimal.js` at the package's declared
 * 38-digit precision. The millisecond difference is an exact integer, so the
 * division is now exact to 38 significant digits before it is stated to 8 — where
 * before it was exact to about 16 before being stated to 8. No number a founder
 * has ever seen moves: `1.2128679` on the documented note fixture is `1.2128679`
 * after this change, and the harness proves it at both poles.
 *
 * WHY 365.25 AND NOT 365, stated rather than assumed. 365.25 is the average
 * Julian year and is the convention the platform has always used; changing the
 * day-count basis (to ACT/365, ACT/360 or 30/360) would move every note's accrued
 * interest and is a TERM of the note document, not an implementation detail. It
 * is recorded as an OWNER QUESTION in `build_log/wave71/`, not decided here.
 *
 * NEGATIVE ELAPSED TIME IS CLAMPED TO ZERO, not carried. A note whose issue date
 * is after the conversion date has accrued nothing; it has not accrued a negative
 * amount. The adapter already clamped; the engine did not, and the two now agree.
 */
import { D } from "./bigDecimal.js";

/** The day-count basis, named so it can be cited and so a change is visible. */
export const INTEREST_YEAR_DAYS = "365.25" as const;
/** Decimal places the elapsed-time figure is stated to. Declared, not incidental. */
export const INTEREST_YEARS_DP = 8 as const;

const MS_PER_YEAR = D(INTEREST_YEAR_DAYS).mul(24).mul(3600).mul(1000);

/**
 * Years elapsed between two instants, in exact decimal arithmetic, stated to 8
 * decimal places. Returns `"0.00000000"` when `to` is not after `from`.
 */
export function exactYearsElapsedString(from: Date, to: Date): string {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    /* An unparseable date is not silently treated as "issued today". The caller
       gets zero elapsed time, which under-states interest rather than inventing
       it — and the note's own trace carries the figure so it is visible. */
    return D(0).toFixed(INTEREST_YEARS_DP);
  }
  const deltaMs = toMs - fromMs;
  if (deltaMs <= 0) return D(0).toFixed(INTEREST_YEARS_DP);
  /* `deltaMs` is an exact integer number of milliseconds. Both operands enter
     decimal.js exactly, so the quotient is exact to the package's declared
     precision before it is stated to 8 dp. */
  return D(String(deltaMs)).div(MS_PER_YEAR).toFixed(INTEREST_YEARS_DP);
}
