/**
 * WAVE 193 · R165.1 — THE ONE PLACE THAT DECIDES WHETHER A SET OF MONEY AMOUNTS
 * IS COMMENSURABLE.
 *
 * R156.1 is an owner ruling: the platform converts NO currency, anywhere, ever.
 * The consequence is that any total, sum or reduction over money amounts is
 * either (a) over one single unit, in which case it is arithmetic, or (b) over
 * two different units, in which case there is no honest number to return and
 * the computation must REFUSE with a stated reason. A refused cap table is safe;
 * a wrong one is not.
 *
 * THE JUDGEMENT CALL, MADE ONCE, HERE, SO IT CANNOT DRIFT BETWEEN CALL SITES.
 * "Not all identical" is NOT the refusal condition. The refusal condition is
 * "two or more DISTINCT STATED currencies". An ABSENT currency is read as
 * "not yet stated", never as a currency of its own, for two reasons:
 *
 *   1. Every round on the platform is currently NULL currency (R165.4 §2Bic
 *      census: rounds 1045/1045 NULL, vehicles 6 NULL). If absence triggered a
 *      refusal, every cap table and every priced-round projection on the
 *      platform would refuse from the moment this file shipped, in exchange for
 *      no correctness gain whatsoever — a set with no stated unit is not a set
 *      with two units.
 *   2. Those 1045 NULL rounds are corrected ONE AT A TIME through the round
 *      edit dialog. Halfway through, a company legitimately holds one round
 *      stated GBP and three still unstated. Refusing THAT would break the
 *      platform precisely for the founder who is in the middle of doing the
 *      right thing, and would teach founders to stop stating currencies.
 *
 * So: zero stated codes -> commensurable. One stated code (however many absent
 * siblings) -> commensurable, and the arithmetic that runs is exactly the
 * arithmetic that runs today. Two or more stated codes -> a positive, RECORDED
 * contradiction, and the only honest output is a refusal.
 *
 * NO CURRENCY IS NAMED IN THIS FILE (R156.2). Codes are handled as opaque
 * strings that arrive from the data; none is defaulted, assumed or written as a
 * literal, and nothing here converts, rescales or compares AMOUNTS.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 198 · ITEM A · R170 — A FALSE REFUSAL IS THE DANGEROUS DIRECTION OF THIS
 * GUARD.
 * ══════════════════════════════════════════════════════════════════════════════
 * Wave 194 measured and pinned (its ADV-4) that two SAFEs recording `"usd"` and
 * `"USD"` were read here as TWO distinct stated codes, so a genuinely
 * single-currency cap table REFUSED to compute. A wrong cap table is dangerous;
 * a cap table that refuses to compute at all blocks the owner's real work, and
 * that is the harm weighted hardest.
 *
 * `statedCurrencies` already trimmed (so `" USD "` and `"USD"` were one code and
 * ADV-6 was green); it did not fold case. It does now.
 *
 * WHAT NORMALISATION MEANS HERE, EXACTLY, AND WHAT IT DOES NOT (R156.1).
 * Two operations and no third: `trim()` and `toUpperCase()`. There is NO alias
 * table, NO code mapping, NO spelling correction and NO conversion. Case and
 * surrounding whitespace are TRANSCRIPTION differences — the same code typed on
 * two screens — and cannot carry a second meaning. Anything beyond them would be
 * the platform deciding what a recorded value means, which is not a read.
 *
 * PRECEDENT, NOT INVENTION. Wave 195 already resolves a round's recorded currency
 * with exactly `raw.trim().toUpperCase()` before testing its shape
 * (`server/lib/wave195CommitCurrencyDeclaration.ts`). This file now agrees with
 * that read instead of being stricter than it.
 *
 * SHAPE IS STILL NOT VALIDATED, DELIBERATELY (Item A.2). A present-but-
 * unrecognised value — `"US Dollars"`, `"$"` — is still counted as a STATED code
 * and can still trigger a refusal. Wave 195 chose to refuse a malformed currency
 * on the reasoning that a malformed value is a CONTRADICTION rather than an
 * absence, and this wave agrees, because the alternative is worse in the exact
 * direction that matters: if an unrecognised code were reclassified as ABSENT,
 * then a set like `["US Dollars", <a real code>]` would become a
 * single-currency set and would COMPUTE A NUMBER by adding two units. Refusing
 * withholds a number; reclassifying invents one. Under R156.1 that settles it.
 *
 * THIS CHANGE CANNOT CAUSE A NEW REFUSAL. Folding case can only make two codes
 * compare EQUAL that previously compared unequal, so `statedCurrencies` returns
 * a list of the same length or SHORTER, and `isMixedCurrency` can only go from
 * `true` to `false`, never the reverse. It is monotonically safe by construction.
 */

/**
 * The distinct STATED currency codes in `values`, in first-appearance order.
 * `undefined`, `null` and the empty string are "not stated" and are omitted.
 *
 * Deliberately returns a plain array built with `indexOf` rather than a `Set`:
 * `for...of` over a `Set` or `Map` raises TS2802 under this tree's target, and
 * the caller needs a stable, orderable list to name in a refusal sentence.
 */
export function statedCurrencies(values: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    /* WAVE 198 · ITEM A — case AND whitespace, and nothing else. See the header. */
    const code = normaliseCurrencyForComparison(v);
    if (code === "") continue;
    if (out.indexOf(code) === -1) out.push(code);
  }
  return out;
}

/**
 * WAVE 198 · ITEM A — THE ONE DEFINITION OF "THESE TWO CODES ARE THE SAME CODE".
 *
 * Exported so that every OTHER surface in the platform that compares currency
 * codes can fold case and whitespace the same way, instead of each one inventing
 * its own comparison and this false refusal reappearing on a sibling screen. The
 * sweep that found those surfaces is recorded in `build_log/wave198/`.
 *
 * A non-string (`null`, `undefined`, a number) normalises to the empty string,
 * which callers read as "not stated". It is returned rather than dropped so that
 * a call site which deliberately counts absence as a set member — several do, and
 * changing that would be a behaviour change beyond case and whitespace — keeps
 * exactly the member count it has today.
 *
 * NO CURRENCY IS NAMED (R156.2). NOTHING IS MAPPED OR CONVERTED (R156.1).
 */
export function normaliseCurrencyForComparison(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * True when `values` holds two or more distinct STATED currency codes — the one
 * condition under which a sum over the corresponding amounts must refuse.
 */
export function isMixedCurrency(values: ReadonlyArray<string | null | undefined>): boolean {
  return statedCurrencies(values).length > 1;
}

/**
 * The list of codes as it should appear inside a founder-facing refusal
 * sentence: sorted so the sentence is stable across ledger orderings, and joined
 * with a word rather than a bare comma so the sentence reads as English.
 */
export function describeStatedCurrencies(values: ReadonlyArray<string | null | undefined>): string {
  const codes = statedCurrencies(values).slice().sort();
  if (codes.length === 0) return "none stated";
  if (codes.length === 1) return codes[0];
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}
