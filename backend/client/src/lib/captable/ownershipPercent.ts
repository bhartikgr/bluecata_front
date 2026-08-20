/**
 * WAVE 72 · DEFECT 2 — ONE PLACE THAT DECIDES WHAT AN UNDEFINED OWNERSHIP
 * PERCENTAGE LOOKS LIKE.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CONTRACT THIS SERVES. `packages/cap-table-engine/src/types.ts:143` declares
 *
 *     ownershipPercent: string | null;   // `null` = 0 ÷ 0, undefined.
 *
 * and Wave 71's D18 made the engine honest at the leaf: `0 shares / total 0`
 * yields `null`, `0 / 1` yields `"0"`, `1 / 1` yields `"100"`. THE ENGINE IS
 * CORRECT AND IS NOT TOUCHED. What was missing is the other half of a contract:
 * consumers that understand `null`.
 *
 * WHAT PRODUCTION ACTUALLY DID WITH IT, measured (`build_log/wave72/scratch/`,
 * and reproduced by final review 1 §5): `parseFloat(null)` is `NaN`,
 * `NaN.toFixed(2)` is the STRING `"NaN"`, so the founder cap-table page rendered
 * **`NaN%`** for a real holder, its group subtotal rendered `NaN%`, and the total
 * cell coerced `null` to `0` and then printed the note "rows shown to 2dp; exact
 * total is 100%" beneath a `0.00%` — a false statement about a total that is
 * undefined. That contradiction is exactly what Waves 58c/58d removed from the
 * empty-table branch of the same cell; it must not be reintroduced next door.
 *
 * WHY THE HELPERS ARE HERE AND NOT INLINE (R21 — one rule, one place). There were
 * two implementations of "print an ownership percentage" on two pages, and only
 * one of them (RoundDetail's) was null-aware. Two implementations is how the two
 * screens disagreed in the first place, so there is now ONE, imported by both.
 *
 * WHY NOTHING HERE WRITES `?? 0`, `|| 0` OR `Math.max(1, …)` (R54). Those are what
 * fabricated the original `0.00%`: the display layer ALREADY refuses undefined
 * values — `safeNumber()` returns `null` for anything failing `Number.isFinite`,
 * and every `fmt*` helper renders `—` for that `null`. The defect was arithmetic
 * performed on `null` BEFORE the formatter could see it (`parseFloat(null)`), so
 * these helpers do the null test FIRST and let the formatter do the rest.
 *
 * R47 — the rendered form of "undefined" is an em dash, the same character the
 * ownership tiles, the RoundDetail projection cell and every `fmt*` fallback
 * already use. `0` is NOT undefined: a genuine `"0"` still renders `0.00`.
 */
import { safeNumber } from "@/lib/format";

/** R47 — what an undefined quantity renders as, everywhere. */
export const OWNERSHIP_UNDEFINED = "—";

/** Ownership percentages render at 2dp on every founder/investor surface (R47). */
export const OWNERSHIP_PERCENT_DECIMALS = 2;

/**
 * The percentage, as displayed, WITHOUT its `%` sign — the callers keep the `%`
 * as a direct text child so the silent-drop guard's baselined cell shapes do not
 * move.
 *
 * `null`/`undefined`/`NaN`/`Infinity` → `—` (UNDEFINED, not zero).
 * A real `"0"` → `0.00`. That distinction is the whole point of D18.
 */
export function ownershipPercentCellText(
  value: string | number | null | undefined,
  digits: number = OWNERSHIP_PERCENT_DECIMALS,
): string {
  const n = safeNumber(value);
  return n === null ? OWNERSHIP_UNDEFINED : n.toFixed(digits);
}

/**
 * The CSS width for an ownership bar. An undefined percentage gets NO width —
 * the bar cannot draw a stripe for a quantity that does not exist, and a `0%`
 * stripe is the same picture a genuine 0% holder gets, which is honest for a real
 * zero and false for an undefined one (the tooltip states which it is).
 */
export function ownershipPercentBarWidth(value: string | number | null | undefined): string {
  const n = safeNumber(value);
  if (n === null) return "0%";
  return `${Math.min(100, n)}%`;
}

/**
 * Sum of a set of ownership percentages, or `null` when ANY member is undefined.
 *
 * WHY ONE UNDEFINED MEMBER MAKES THE WHOLE SUBTOTAL UNDEFINED, rather than being
 * skipped: a subtotal that silently omits a holder is a smaller number presented
 * as the group's share — a silent drop with a number on it. `null` propagates so
 * the caller must SAY the subtotal is undefined.
 */
export function sumOwnershipPercent(
  rows: ReadonlyArray<{ ownershipPercent?: string | number | null }>,
): number | null {
  let total = 0;
  for (const r of rows) {
    const n = safeNumber(r.ownershipPercent);
    if (n === null) return null;
    total += n;
  }
  return total;
}

/**
 * The value written into a CSV/XLSX ownership cell.
 *
 * FULL PRECISION IS PRESERVED for a real percentage — the export deliberately
 * carries the engine's exact string, not the 2dp display value, and this wave does
 * not change that. Only the undefined case moves: from an EMPTY cell (what
 * `[null].join(",")` produced) to `—`, so a reader of the file cannot mistake
 * "undefined" for "the exporter dropped it".
 */
export function ownershipPercentForExport(value: string | number | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === "") return OWNERSHIP_UNDEFINED;
  return String(value);
}
