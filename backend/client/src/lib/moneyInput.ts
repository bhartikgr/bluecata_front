/**
 * WAVE 24 — ONE exponent-aware major→minor parser for admin money inputs.
 *
 * WHY IT IS A MODULE AND NOT THREE COPIES. Wave 24 wired three admin surfaces
 * that take a money amount typed by a human (invoice lines, commission basis,
 * company fair value). Each one needs the same conversion at the same place:
 * ONCE, at the edge, on the way in. Three private copies is how the JPY branch
 * gets fixed in one of them and stays broken in the other two — which is the
 * shape of the four cross-currency defects this build already paid for.
 *
 * THE RULE IT ENFORCES. `/100` is not a currency conversion. The ISO-4217
 * exponent is per-currency: USD/EUR/GBP are 2, and JPY is 0 — a yen has NO
 * minor unit. So:
 *   · the number of decimal places allowed is `currencyExponent(currency)`;
 *   · for an exponent-0 currency, ANY decimal point is rejected outright;
 *   · nothing is rounded, floored or truncated. An amount that had to be
 *     rounded to fit the currency is an amount nobody authorised, so the
 *     parser REFUSES it (`undefined`) and the caller must keep the control
 *     disabled rather than send a silently-altered figure.
 *
 * RETURN CONTRACT. A safe integer in MINOR units, or `undefined` for "this is
 * not a valid amount in this currency". `undefined` is never coerced to 0 by
 * any caller — a refused amount and a zero amount are different claims.
 *
 * SIGN. Default is NON-NEGATIVE, because most inputs are. Invoice lines pass
 * `allowNegative` because an adjustment or a refund line is legitimately
 * negative and silently rejecting it would push operators into a workaround.
 * A fair-value mark does NOT pass it: the persist route itself refuses a
 * negative (`FAIR_VALUE_REQUIRED`, reportingEngineRoutes.ts:489), and the
 * control should refuse what the server refuses rather than round-trip a 400.
 */
import { toMinor, currencyExponent } from "./currency";

export function majorToMinorExact(
  raw: string,
  currency: string,
  opts?: { allowNegative?: boolean },
): number | undefined {
  const s = (raw ?? "").trim();
  if (s === "") return undefined;
  const neg = opts?.allowNegative === true ? "-?" : "";
  const exp = currencyExponent(currency);
  /* Exponent 0 ⇒ integers only. A "1.5" JPY does not exist, and accepting it
     under a `/100` assumption would post 1 yen or 150 yen depending on which
     wrong thing the code did. */
  const re = exp === 0 ? new RegExp(`^${neg}\\d+$`) : new RegExp(`^${neg}\\d+(\\.\\d{1,${exp}})?$`);
  if (!re.test(s)) return undefined;
  const minor = toMinor(Number(s), currency);
  if (!Number.isSafeInteger(minor)) return undefined;
  if (minor < 0 && opts?.allowNegative !== true) return undefined;
  return minor;
}
