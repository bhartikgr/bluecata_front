/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 92 · ITEM 3 — THE THREE NEGOTIATED TERMS A TERM SHEET MUST NOT INVENT.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG. `client/src/pages/founder/TermSheet.tsx` seeded the term-sheet
 * data with three LITERALS:
 *
 *     liqPrefMultiple: 1
 *     participating: false
 *     capParticipation: "non-participating"
 *
 * They sat immediately beside `fdSharesPreMoney`, `poolSize` and `poolTiming` —
 * which Wave 58b had already made read the round — under a comment in that same
 * block declaring "ALL THREE NOW READ THE ROUND". So a company with **2×
 * participating, capped at 3×** on record generated a term sheet asserting **1×
 * non-participating**, and the third literal was a WORD sitting in a slot the
 * template renders as a MULTIPLE: `templates.ts:136` emits *"subject to a
 * participation cap of ${x.capParticipation}× the Original Issue Price"*, which
 * with the seeded value reads *"a participation cap of non-participating× the
 * Original Issue Price"*. It was invisible only because the clause is gated on
 * `participating`, which was hardcoded `false`.
 *
 * **A term sheet is a document a founder sends to an investor.** Open item `N-3`,
 * raised as `OQ-W94-2`. The liquidation preference is also the single term the exit
 * waterfall computes from, so the platform could print one liquidation term while
 * modelling another.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ABSENT MEANS ABSENT. THAT IS THE WHOLE RULE.
 * ─────────────────────────────────────────────────────────────────────────────
 * Every function here returns `null` when the round does not record the term, and
 * the templates print a NAMED BLANK rather than a default. This is the rule Wave
 * 58b established for `fdSharesPreMoney` in this same object, and the rule Waves
 * 88, 91 and 94 established for the waterfall: **a wrong number is worse than "we
 * cannot tell you", and it is far worse in a document than on a screen.**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MIRRORS THE SERVER READER RATHER THAN IMPORTING IT, AND HOW R21 IS KEPT
 * ─────────────────────────────────────────────────────────────────────────────
 * The authority for what a stored liquidation preference MEANS is
 * `server/lib/roundStoredTerms.ts` (`roundStoredTerms`, lines ~360-480) — the one
 * and only reader, which the exit waterfall, the round-math route and the cap
 * table all go through. It cannot be imported into the browser bundle: it reads the
 * database directly through `roundsStore`.
 *
 * So the PARSING RULES are reproduced here, deliberately and narrowly, and the
 * duplication is FENCED rather than hoped about: `W92-T-01` in
 * `client/src/lib/termsheet/__tests__/w92_term_sheet_reads_the_round.test.ts` runs
 * a table of inputs — including every shape the server reader documents as
 * refused — through BOTH this module and a transcription of the server's own
 * regular expressions, and asserts they agree on every row. If a later wave changes
 * the server reader's domain, that test goes red and names this file.
 *
 * The alternative — publishing the parsed terms on an endpoint and reading them
 * here — is the better long-term answer and is recorded as `OQ-W92-2`. It was not
 * done in this wave because it adds a server surface to a wave that already changes
 * a legal document, and the mirroring is provable today.
 *
 * ONE MORE THING THIS FILE DOES NOT DO: it does not read the PAYMENT ORDER between
 * preference classes, and it reads nothing at all from the projections / round-math
 * path, whose ranking field is hardcoded to `0` on every preferred class
 * (`shared/roundMathEngineAdapter.ts:1962`) and is READ NOWHERE in the engine. That
 * field must never become a second source of truth (R21). The term sheet describes
 * the terms of ONE round; the order between rounds belongs to the exit waterfall.
 */

/** The domain of a liquidation preference multiple, from the server reader:
 *  `(0, 10]`. A value outside it is a typing error, not a term, and becomes
 *  absent — the server reader's own words. */
const LP_MULTIPLE_MAX = 10;

/** The domain of a participation cap multiple, `PARTICIPATION_CAP_MAX` in
 *  `server/lib/roundStoredTerms.ts`: `(0, 10]`, fractions allowed. */
const PARTICIPATION_CAP_MAX = 10;

/** A round as the client holds it. Only the two fields this module reads are
 *  named; everything else on the round is irrelevant here. */
export type NegotiatedTermsSource = {
  /** The round's free-text liquidation preference — "1x non-participating",
   *  "2x participating, capped at 3x". */
  liquidationPreference?: unknown;
  /** The round's own participation-cap key, written by the round wizard and by
   *  the two terms editors, and validated at all three (Wave 94). */
  capParticipation?: unknown;
};

export type NegotiatedTerms = {
  /** The multiple, or `null` when it is not on record. */
  liqPrefMultiple: number | null;
  /** `true` participating, `false` non-participating, `null` NOT STATED.
   *  The three are different and the middle one is not the default. */
  participating: boolean | null;
  /** The participation cap multiple as text for the template's `×` slot, or `""`
   *  when no cap is on record. NEVER a word, and never a default. */
  capParticipation: string;
  /** Where the cap was found, so the document can say. */
  capSource: "capParticipation" | "liquidationPreference" | null;
  /** The stored wording, verbatim, so a founder reading a blank clause can be
   *  shown what IS on the round and told why it was not enough. */
  liquidationPreferenceRaw: string | null;
};

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * The multiple, parsed exactly as the server reader parses it:
 * `/(^|[^0-9.])([0-9]+(?:\.[0-9]+)?)\s*x\b/` on the lower-cased wording, accepted
 * only inside `(0, 10]`.
 *
 * NOTE the leading `(^|[^0-9.])` group. It is load-bearing and it is the server's:
 * without it "capped at 3x" inside "1x participating, capped at 3x" could be picked
 * up as the preference multiple depending on which match won. The expression takes
 * the FIRST such token, which is the preference.
 */
export function readLiqPrefMultiple(liquidationPreference: unknown): number | null {
  const raw = text(liquidationPreference);
  if (raw === null) return null;
  const m = /(^|[^0-9.])([0-9]+(?:\.[0-9]+)?)\s*x\b/.exec(raw.toLowerCase());
  if (!m) return null;
  const n = Number(m[2]);
  /* NOT MONEY. R72's no-`Number()` rule is about MONEY, which is exact decimal
     text; a liquidation multiple is a small negotiated ratio the server itself
     carries as a JSON `number` and compares with `Number.isFinite`. Parsing it the
     same way the server does is what keeps the two in agreement. */
  if (!Number.isFinite(n) || n <= 0 || n > LP_MULTIPLE_MAX) return null;
  return n;
}

/**
 * Participation, read STRICTLY: only an explicit, unambiguous statement counts,
 * and "non-participating" is tested BEFORE "participating" because the second is a
 * substring of the first. Anything else is `null`, which the template states as a
 * blank rather than assuming either answer.
 */
export function readParticipating(liquidationPreference: unknown): boolean | null {
  const raw = text(liquidationPreference);
  if (raw === null) return null;
  const lp = raw.toLowerCase();
  if (/non[-\s]?participating/.test(lp)) return false;
  if (/participating/.test(lp)) return true;
  return null;
}

/** The cap multiple from the round's own cap key. A trailing "x" is accepted,
 *  matching `validateParticipationCapStored`. */
function readCapFromKey(capParticipation: unknown): number | null {
  const raw = text(capParticipation);
  if (raw === null) return null;
  const stripped = /^[0-9]+(\.[0-9]+)?\s*x?$/i.test(raw) ? raw.replace(/\s*x$/i, "") : null;
  if (stripped === null) return null;
  const n = Number(stripped);
  if (!Number.isFinite(n) || n <= 0 || n > PARTICIPATION_CAP_MAX) return null;
  return n;
}

/** The cap written into the free-text wording — "capped at 2x", "2x cap",
 *  "participation cap of 2x". The phrases the server reader recognises. */
function readCapFromText(liquidationPreference: unknown): number | null {
  const raw = text(liquidationPreference);
  if (raw === null) return null;
  const lp = raw.toLowerCase();
  const m =
    /(?:capped\s+at|cap\s+of|participation\s+cap\s+of)\s*([0-9]+(?:\.[0-9]+)?)\s*x\b/.exec(lp) ??
    /([0-9]+(?:\.[0-9]+)?)\s*x\s*(?:participation\s*)?cap\b/.exec(lp);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > PARTICIPATION_CAP_MAX) return null;
  return n;
}

/**
 * The three terms, read from the round. Nothing here defaults, and a CONFLICT is
 * reported as absent rather than resolved: when the cap key and the free-text
 * wording both carry a cap and they DISAGREE, choosing between them would be
 * inventing which one the parties negotiated. The waterfall refuses that case by
 * name (`participationCapConflict`), and the document must not quietly pick a
 * winner where the calculation refuses to.
 */
export function readNegotiatedTerms(round: NegotiatedTermsSource): NegotiatedTerms {
  const raw = text(round.liquidationPreference);
  const fromKey = readCapFromKey(round.capParticipation);
  const fromText = readCapFromText(round.liquidationPreference);
  let cap: number | null = null;
  let capSource: NegotiatedTerms["capSource"] = null;
  if (fromKey !== null && fromText !== null) {
    if (fromKey === fromText) { cap = fromKey; capSource = "capParticipation"; }
    /* else: two caps on record that disagree — absent, and the clause says so. */
  } else if (fromKey !== null) { cap = fromKey; capSource = "capParticipation"; }
  else if (fromText !== null) { cap = fromText; capSource = "liquidationPreference"; }

  return {
    liqPrefMultiple: readLiqPrefMultiple(round.liquidationPreference),
    participating: readParticipating(round.liquidationPreference),
    capParticipation: cap === null ? "" : String(cap),
    capSource,
    liquidationPreferenceRaw: raw,
  };
}
