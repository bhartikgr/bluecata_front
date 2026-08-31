/**
 * Sprint 5 — institutional-grade currency utilities.
 *
 * Region → currency-symbol mapping (matches the formula-region set in
 * `@capavate/cap-table-engine` types.ts) and a thin formatter so every cap-table
 * surface, round screen, and admin page renders the right symbol.
 *
 * Display contract (R200 §10):
 *   • instrument-native amount (whatever the security was issued in)
 *   • tenant-base (rendered as $/£/€/¥/₹/A$/C$/HK$ depending on region)
 *   • USD reference (always shown alongside non-USD values for institutional comparability)
 */
import type { Region } from "@capavate/cap-table-engine";

export function currencySymbol(region: Region | string | undefined | null): string {
  switch (region) {
    case "US":
    case "SG":
      return "$";
    case "HK":
      return "HK$";
    case "CA":
      return "C$";
    case "AU":
      return "A$";
    case "UK":
      return "£";
    case "JP":
      return "¥";
    case "IN":
      return "₹";
    case "CN":
      return "¥"; // CNY uses ¥ sign — distinct context from JPY
    default:
      return "$";
  }
}

export function currencyCode(region: Region | string | undefined | null): string {
  switch (region) {
    case "US": return "USD";
    case "SG": return "SGD";
    case "HK": return "HKD";
    case "CA": return "CAD";
    case "AU": return "AUD";
    case "UK": return "GBP";
    case "JP": return "JPY";
    case "IN": return "INR";
    case "CN": return "CNY";
    default:   return "USD";
  }
}

/* ===========================================================================
 * v25.37 — ISO 4217 minor-unit exponent awareness.
 *
 * BLOCKER B-Currency: every client formatter historically assumed a `/100`
 * (2-decimal) minor-units conversion. That is WRONG for zero-decimal
 * currencies (JPY, KRW, …) and three-decimal currencies (BHD, JOD, KWD, …).
 * This block introduces an ISO 4217 exponent table + a shared `formatMinor` /
 * `toMinor` so display + math derive the divisor from the currency, never a
 * hardcoded 100. `fmtCurrency` above is intentionally LEFT UNCHANGED for
 * backward compatibility.
 *
 * SCOPE NOTE (v25.37): only ONE high-impact client surface
 * (admin/CollectivePaymentSchedules.tsx) is migrated to `formatMinor` in this
 * wave. The ~20+ remaining inline `minor / 100` formatters are catalogued for
 * the v25.38 sweep — see v25_37_implementation_report.md.
 * ========================================================================= */

/** ISO 4217 minor-unit exponents that differ from the default of 2.
 * 0-decimal (no minor unit), 3-decimal, and 4-decimal currencies. Codes are
 * upper-case. Values match ISO 4217 canonical exponents — investor-grade
 * global best practice (Wave 0 Increment 1 review correction, Aug 2026).
 *
 * MUST stay byte-identical to server/lib/currency.ts CURRENCY_EXPONENT_OVERRIDES. */
const CURRENCY_EXPONENT_OVERRIDES: Record<string, number> = {
  // --- 0-decimal currencies (no minor unit) ---
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0,
  XPF: 0,
  // --- 3-decimal currencies ---
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  // --- 4-decimal currencies (ISO 4217 canonical) ---
  CLF: 4, UYW: 4,
  // HUF, TWD, and other 2-decimal currencies use the default (2).
};

/** ISO 4217 minor-unit exponent for a currency code. Defaults to 2 for any
 * unknown / unlisted code (the common 2-decimal case: USD, EUR, GBP, …). */
export function currencyExponent(code: string | null | undefined): number {
  if (!code) return 2;
  const c = String(code).toUpperCase();
  const e = CURRENCY_EXPONENT_OVERRIDES[c];
  return e === undefined ? 2 : e;
}

/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 147 — UNKNOWN MONEY IS NOT ZERO.
   ══════════════════════════════════════════════════════════════════════════════
   Owner ruling R111 Q13 fixes the platform-wide wording for a monetary value the
   platform does not hold: exactly **"Not on record"**. Never a bare dash, never
   `0`, never `$0.00`, never a raw code. This is the single definition; every
   other unavailable-money constant on the client now points at it.

   A genuine numeric `0` is NOT unknown and keeps rendering `$0.00`.
   ══════════════════════════════════════════════════════════════════════════════ */
export const MONEY_NOT_ON_RECORD = "Not on record";

/** Format an integer minor-unit amount for display, using the correct number
 * of fraction digits for the currency's ISO 4217 exponent (NOT a hardcoded
 * `/100`). Falls back to a plain `CODE 1.23` string if Intl throws on an
 * unknown currency. */
export function formatMinor(
  minor: number,
  currency: string,
  opts: { locale?: string } = {},
): string {
  // v25.38 round-2 (per GPT-5.5): default `locale` to `undefined` (caller's
  // runtime locale via Intl) so this drop-in replacement preserves prior
  // `new Intl.NumberFormat(undefined, ...)` behavior across browsers. Callers
  // that need a pinned locale can still pass `opts.locale: "en-US"`.
  /* WAVE 147 · R111 Q13 — THE COERCION THAT PRINTED A CONFIDENT ZERO.
     This used to be `const major = (Number(minor) || 0) / …`, so `null`,
     `undefined` and `NaN` all became `0` and were published as `$0.00` — a
     false statement about money, made by the one formatter every money surface
     goes through.

     The declared parameter type stays `minor: number` ON PURPOSE. Widening it to
     `number | null` would make the ~9 non-test call sites that coerce with
     `?? 0` compile silently and hide exactly the sites that must be audited
     one by one (AdminFeesConsolidated.tsx:3092/:3463 are the cases the reviewer
     named). TypeScript keeps pointing at them; this guard is the runtime
     backstop for the `any`-typed and JSON-shaped values that reach here anyway.

     `0` IS finite, so a real zero is untouched: `formatMinor(0, "USD")` is
     still `$0.00`.

     A numeric STRING is still accepted and still formatted, exactly as the old
     `Number(minor)` did — several callers are typed `number` but carry a
     JSON-shaped `"5000"`, and turning those into "Not on record" would be a new
     defect, not a fix. What is refused is only genuinely-absent input: `null`,
     `undefined`, `""`, whitespace and `NaN` / ±Infinity. (`Number("")` is `0`
     and `0` is finite — the WAVE 42 · R6 trap — so the empty string is refused
     explicitly rather than left to `Number.isFinite`.) */
  const asNumber =
    typeof minor === "number"
      ? minor
      : minor === null || minor === undefined || String(minor).trim() === ""
        ? Number.NaN
        : Number(minor);
  if (!Number.isFinite(asNumber)) return MONEY_NOT_ON_RECORD;
  const exp = currencyExponent(currency);
  const major = asNumber / Math.pow(10, exp);
  const locale = opts.locale; // undefined => runtime default (matches legacy)
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(exp)}`;
  }
}

/** Convert a major-unit amount to integer minor units using the currency's
 * ISO 4217 exponent (mirror of `formatMinor`; NOT a hardcoded `* 100`). */
export function toMinor(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  const exp = currencyExponent(currency);
  return Math.round(amount * Math.pow(10, exp));
}

/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 159 · R126.5 — ONE MONEY PARSER FOR TYPED AMOUNTS.
   ══════════════════════════════════════════════════════════════════════════════
   `toMinor` above is correct about SCALE (it is ISO-4217 exponent aware, never
   `* 100`) but it takes a `number`, so every caller had to turn the admin's typed
   TEXT into a number first — and they all reached for `parseFloat` / `Number()`.
   Both of those SALVAGE input instead of refusing it:

     parseFloat("125abc")  -> 125      the trailing rubbish vanishes
     parseFloat("125.5.5") -> 125.5    the second decimal point vanishes
     Number("")            -> 0        an EMPTY FIELD BECOMES A ZERO PRICE
     toMinor(10.005,"USD") -> 1001     half a cent, silently rounded UP

   The independent review proved the last one live: `10.005` USD typed on the
   consolidated fees screen was accepted and stored as `1001`, while the very same
   amount typed on the Collective schedules screen was refused by the server — two
   admin screens writing one table with opposite money semantics.

   This is the client mirror of `server/lib/money.ts :: decimalStringToMinor`:
   pure BigInt string arithmetic (no float ever holds the value), exponent aware
   per currency, and a value carrying MORE fractional digits than the currency can
   represent is REFUSED rather than rounded. It THROWS, because there is no honest
   number to return for "125abc", and returning `0` is how blank fields became
   free memberships in the first place.

   Kept deliberately: the scaling path. USD/JPY/KWD/BHD handling is verified
   correct and must not regress to `* 100`.
   ══════════════════════════════════════════════════════════════════════════════ */

/** Same grammar as the server parser: optional sign, digits, optional fraction,
 *  optional exponent — and NOTHING else. No thousands separators, no currency
 *  symbols, no trailing text. */
const CLIENT_DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function clientPow10(n: number): bigint {
  let out = BigInt(1);
  for (let i = 0; i < n; i++) out *= BigInt(10);
  return out;
}

/**
 * Exact decimal string in MAJOR units -> integer MINOR units for `currency`.
 *
 * Use this for EVERY money value an admin types. Never `parseFloat`, never
 * `Number()`, never `* 100`.
 *
 * @throws `MONEY_DECIMAL_INVALID:<label>` — empty, blank or unreadable.
 * @throws `MONEY_DECIMAL_PRECISION_UNSUPPORTED:<label>` — more fractional digits
 *   than the currency's ISO-4217 exponent allows. NEVER rounded.
 * @throws `MONEY_DECIMAL_OUT_OF_RANGE:<label>` — beyond exact integer range.
 */
export function decimalStringToMinor(
  s: string | null | undefined,
  currency: string,
  label = "amount",
): number {
  const m = CLIENT_DECIMAL_RE.exec(String(s ?? "").trim());
  if (!m) throw new Error(`MONEY_DECIMAL_INVALID:${label}`);
  const sign = m[1];
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  const expRaw = m[4];
  if (intPart === "" && fracPart === "") throw new Error(`MONEY_DECIMAL_INVALID:${label}`);
  const exp = expRaw ? Number.parseInt(expRaw, 10) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 400) {
    throw new Error(`MONEY_DECIMAL_INVALID:${label}`);
  }
  const digits = BigInt((intPart === "" ? "0" : intPart) + fracPart);
  const shift = exp - fracPart.length + currencyExponent(currency);
  let scaled: bigint;
  if (shift >= 0) {
    scaled = digits * clientPow10(shift);
  } else {
    const divisor = clientPow10(-shift);
    if (digits % divisor !== BigInt(0)) {
      /* e.g. "0.005" in USD (exponent 2) — half a cent. REJECT, never round. */
      throw new Error(`MONEY_DECIMAL_PRECISION_UNSUPPORTED:${label}`);
    }
    scaled = digits / divisor;
  }
  const signed = sign === "-" ? -scaled : scaled;
  /* The wire carries a JSON number, so refuse anything a double cannot hold
     exactly rather than shipping a rounded amount. */
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`MONEY_DECIMAL_OUT_OF_RANGE:${label}`);
  }
  return Number(signed);
}

/**
 * WAVE 159 — the plain sentence an admin should see when `decimalStringToMinor`
 * refuses. R77: no raw codes on screen.
 */
export function moneyInputRefusalMessage(err: unknown, currency: string): string {
  const code = err instanceof Error ? err.message : String(err);
  const exp = currencyExponent(currency);
  if (code.startsWith("MONEY_DECIMAL_PRECISION_UNSUPPORTED")) {
    return exp === 0
      ? `${currency} amounts cannot have decimal places, so this amount cannot be stored exactly. Enter a whole number.`
      : `This amount has more decimal places than ${currency} uses (${exp}), so it cannot be stored exactly. Re-enter it with at most ${exp}.`;
  }
  if (code.startsWith("MONEY_DECIMAL_OUT_OF_RANGE")) {
    return "This amount is too large to record. Check it and enter a smaller amount.";
  }
  const example = exp > 0 ? `1500.${"0".repeat(exp)}` : "1500";
  return `Enter the amount as digits with up to ${exp} decimal place${exp === 1 ? "" : "s"} — for example ${example}. No currency symbols, letters or thousands separators.`;
}

/** v25.38 — convert integer minor units to a major-unit NUMBER using the
 * currency's ISO 4217 exponent (the inverse of `toMinor`; NOT a hardcoded
 * `/ 100`). Use this for editable input fields that need the raw numeric major
 * value (e.g. `String(fromMinor(aumMinor, currency))`) rather than a formatted
 * currency string. For DISPLAY use `formatMinor` instead. */
export function fromMinor(minor: number, currency: string): number {
  const exp = currencyExponent(currency);
  return (Number(minor) || 0) / Math.pow(10, exp);
}

/**
 * 1a — Canonical thousands-separator formatter for COUNTS (share counts, unit
 * counts, any integer quantity) across the ENTIRE platform (Consortium
 * Partners, Collective, Investor, Capavate/founder, Admin). Currency amounts
 * should use `formatMinor` (which already groups via Intl); this is the
 * matching primitive for NON-currency quantities so shares/units never render
 * as a bare ungrouped number (e.g. "1000000" → "1,000,000").
 *
 * Groups by thousands using the en-US locale for a stable, deterministic
 * presentation (matches the existing `formatMinor({ locale: "en-US" })` call
 * convention used across the app). Fractional inputs keep up to `maxFraction`
 * digits (default 0 — shares are whole). Null/NaN → "—".
 */
export function formatShares(
  value: number | string | null | undefined,
  opts: { maxFraction?: number } = {},
): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: opts.maxFraction ?? 0,
    minimumFractionDigits: 0,
  });
}

/** 1a — alias of `formatShares` for generic integer counts (non-share
 * quantities). Same grouping behavior; separate name for call-site clarity. */
export function formatCount(
  value: number | string | null | undefined,
  opts: { maxFraction?: number } = {},
): string {
  return formatShares(value, opts);
}

/** Format a value with the region's currency symbol. */
export function fmtCurrency(n: number | null | undefined, region: Region | string | undefined | null = "US", opts: { compact?: boolean; digits?: number } = {}): string {
  if (n == null || isNaN(n as number)) return "—";
  const symbol = currencySymbol(region);
  if (opts.compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${symbol}${(n / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000)     return `${symbol}${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000)         return `${symbol}${(n / 1_000).toFixed(1)}K`;
    return `${symbol}${n.toFixed(opts.digits ?? 0)}`;
  }
  const digits = opts.digits ?? 0;
  return `${symbol}${n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

/* ============================================================================
 * WAVE 190 · ITEM A — A SYMBOL MAY ONLY EVER COME FROM A CURRENCY.
 *
 * `currencySymbol()` above takes a REGION and ends `default: return "$"`. That
 * is how one company came to show three different currency truths on three
 * screens: the cap table read `company_profile.legal.region` ("HK") and printed
 * `HK$`; the round screens read `rounds.region`, which is NULL on 1045 of 1045
 * rows, fell back to `?? "US"` and printed a bare `$`; and only the investor
 * invitation surface — which reads `rounds.currency` through
 * `shared/roundCurrencyOnRecordView.ts` — refused honestly.
 *
 * A REGION IS NOT A CURRENCY. A Hong Kong company can be denominated in USD; a
 * BVI vehicle was observed displaying `CA$`. So this resolver accepts ONLY an
 * ISO-4217 currency code and returns `null` for everything else — including
 * every region token this file knows about, all of which are two letters and
 * therefore cannot pass the three-letter test. That is not incidental: it is the
 * negative control, enforced by the shape of the input rather than by a list of
 * things to reject.
 *
 * IT RETURNS `null`, NEVER `"$"` AND NEVER `""`. A caller that cannot get a
 * symbol must print a stated refusal naming the missing fact (R6). A silent `$`
 * on a non-USD figure is the most dangerous display defect this platform has;
 * a blank is the second most dangerous, because it reads as a rendering bug and
 * invites the reader to supply their own assumption.
 *
 * NOTHING HERE CONVERTS ANYTHING (R156.1, owner verbatim: "If an SPV or a round
 * is in one currency, it is up to the investor to deliver exactly in that
 * currency"). This maps a currency to the glyph that denotes it. No rate, no
 * arithmetic, no `Number()`/`parseInt`/`parseFloat`, no amount enters this
 * function.
 *
 * The mapping is TYPOGRAPHIC, not commercial, so it is not a hardcoded price or
 * currency choice under R156.2: it answers "which glyph denotes CAD", never
 * "which currency is this vehicle in" — that always comes from the stored row.
 * A currency with no distinct glyph in this table falls back to its own ISO code
 * plus a space, which is honest and unambiguous ("BRL 1,200.00"), rather than to
 * a dollar sign.
 * ========================================================================== */

/** ISO-4217 code → the glyph that denotes it. Codes only; never a region. */
const CURRENCY_CODE_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  USD: "$",
  CAD: "C$",
  GBP: "£",
  EUR: "€",
  SGD: "S$",
  HKD: "HK$",
  CNY: "¥",
  CNH: "¥",
  AUD: "A$",
  JPY: "¥",
  INR: "₹",
});

/**
 * Resolve a display symbol from a CURRENCY CODE, or `null` when there is no
 * currency on record.
 *
 * @param code an ISO-4217 alphabetic code, or any unknown wire value.
 * @returns the symbol, or `null`. **Never `"$"` by default and never `""`.**
 *
 * Every region token used anywhere in this file ("US", "HK", "CA", "AU", "UK",
 * "JP", "IN", "CN", "SG") is two letters and therefore returns `null` here.
 */
export function currencySymbolForCurrency(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const iso = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso)) return null;
  return CURRENCY_CODE_SYMBOLS[iso] ?? `${iso} `;
}
