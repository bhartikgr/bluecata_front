/* ============================================================================
 * WAVE 114 · FINDING 2 (ALL_OPEN_WAVES item 31) — THE FOUR GOVERNANCE TERMS
 * THAT WERE PRINTED AS NEGOTIATED WITH NOTHING BEHIND THEM.
 *
 * WHAT WAS WRONG. `client/src/pages/founder/RoundDetail.tsx` printed four rows
 * on every round's terms panel as flat string literals, identical on every
 * round in the platform:
 *
 *   Board composition   "1 founder, 1 investor, 1 mutual"
 *   Information rights  "Quarterly financials + KPI dashboard"
 *   Drag-along          "Yes — majority of preferred + majority of common"
 *   ROFR / Co-Sale      "Yes — standard NVCA form"
 *
 * Wave 31 converged the liquidation-preference readers and reported these four
 * as still hardcoded because NO STORAGE EXISTED for them. A term sheet that
 * asserts a drag-along nobody agreed to is a legal statement the platform cannot
 * support, and printing an invented value is worse than printing nothing.
 *
 * WHAT THIS MODULE IS. One reader and one write fence for all four, in `shared/`
 * so the founder screen and the route CANNOT word them differently. Wave 111
 * spent a whole wave deleting a duplicated terms reader after measuring 8 of 16
 * term shapes disagreeing across the copies; a new term is not introduced with
 * two readers.
 *
 * STORAGE IS ADDITIVE AND THERE IS NO MIGRATION. All four round-trip through
 * `extras_json`, which `POST /api/rounds` already stashes for any non-column
 * field and which `roundsStore.rowToRound` already re-spreads on hydrate — the
 * precedent set by `optionPoolPostPercent` (Wave 58b), `safeType` (Wave 70),
 * `seniority` (Wave 81) and `capParticipation` (Wave 94). Migrations stay at
 * canonical 173, highest `0192`.
 *
 * THE FENCE SHIPS WITH THE WHITELIST ENTRY, NEVER A WAVE LATER. Wave 76 shipped
 * a whitelist entry ahead of its validator and an unvalidated value sat on the
 * row; Wave 81 refused to repeat that and neither does this.
 *
 * THREE STATES, the same model every other term on this route uses, so a founder
 * has ONE mental model:
 *   · ABSENT from the body  → UNTOUCHED. Never defaulted, never invented (R6).
 *   · `null` or `""`        → EXPLICIT REMOVAL. The row then states that the term
 *                             is not recorded, which is the honest outcome of
 *                             deleting it.
 *   · text (or a boolean on
 *     the two yes/no terms) → VALIDATED, then stored.
 *
 * SCOPE, STATED RATHER THAN LEFT TO BE DISCOVERED. These four are storable over
 * the API and READ HONESTLY on screen, but Wave 114 adds NO control for them on
 * the Edit-terms dialog — exactly the position `seniority` was left in by
 * Wave 81. Finding 3's participation-cap control was the mandated control for
 * this wave and four more inputs in an already very large dialog is more risk
 * than one wave should carry. This is NOT a dead promise: there is no control
 * that appears to work, and the panel says plainly that the value is not
 * recorded. Carried as OQ-W114-3.
 * ========================================================================== */

export const GOVERNANCE_TERM_KEYS = [
  "boardComposition",
  "informationRights",
  "dragAlong",
  "rofrCoSale",
] as const;

export type GovernanceTermKey = (typeof GOVERNANCE_TERM_KEYS)[number];

/** The row label on the terms panel. Kept here so the screen and the refusal
 *  message name the term identically. */
export const GOVERNANCE_TERM_LABEL: Readonly<Record<GovernanceTermKey, string>> = Object.freeze({
  boardComposition: "Board composition",
  informationRights: "Information rights",
  dragAlong: "Drag-along",
  rofrCoSale: "ROFR / Co-Sale",
});

/** The two terms that are ordinarily a yes/no with a qualifier. A boolean is
 *  accepted for these and recorded as the founder's own answer. */
const YES_NO_TERMS: ReadonlySet<string> = new Set<string>(["dragAlong", "rofrCoSale"]);

export const GOVERNANCE_TERM_MAX_LENGTH = 500;

/** The ONE sentence a terms row prints when nothing is stored. It says what is
 *  true — the term is not on record — instead of asserting a term (R6). */
export const GOVERNANCE_TERM_NOT_RECORDED = "Not recorded on this round";

/** The longer explanation, for the tooltip / helper line under the panel. */
export const GOVERNANCE_TERM_NOT_RECORDED_DETAIL =
  "Capavate has no stored value for this term on this round, so it is not shown as negotiated. " +
  "Until it is recorded, treat the signed documents as the only source.";

export function isGovernanceTermKey(k: unknown): k is GovernanceTermKey {
  return typeof k === "string" && (GOVERNANCE_TERM_KEYS as ReadonlyArray<string>).includes(k);
}

export type GovernanceTermReading =
  | { readonly recorded: true; readonly key: GovernanceTermKey; readonly label: string; readonly text: string }
  | { readonly recorded: false; readonly key: GovernanceTermKey; readonly label: string; readonly statement: string };

/**
 * THE ONE READER. Takes the round object as it arrives from the API (the round
 * shape carries an `[extra: string]` index signature, so an `extras_json` key
 * appears as a plain property) and answers either the stored text or an explicit
 * refusal. It NEVER substitutes a default.
 *
 * A stored boolean is rendered as the founder's own yes/no. A whitespace-only
 * stored value counts as not recorded — a blank is not a negotiated term.
 */
export function readGovernanceTerm(round: unknown, key: GovernanceTermKey): GovernanceTermReading {
  const label = GOVERNANCE_TERM_LABEL[key];
  const bag = (round ?? {}) as Record<string, unknown>;
  const raw = bag[key];
  if (typeof raw === "boolean") {
    return { recorded: true, key, label, text: raw ? "Yes" : "No" };
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { recorded: true, key, label, text: String(raw) };
  }
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "") {
    return { recorded: false, key, label, statement: GOVERNANCE_TERM_NOT_RECORDED };
  }
  return { recorded: true, key, label, text: s };
}

/** Every one of the four, in panel order. */
export function readGovernanceTerms(round: unknown): GovernanceTermReading[] {
  return GOVERNANCE_TERM_KEYS.map((k) => readGovernanceTerm(round, k));
}

export type GovernanceTermVerdict =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly error: string; readonly field: string; readonly message: string };

function refusalMessage(key: GovernanceTermKey): string {
  const label = GOVERNANCE_TERM_LABEL[key];
  const extra = YES_NO_TERMS.has(key)
    ? ` It may be sent as true / false, or as text describing the threshold that was agreed (for example ` +
      `"Yes — majority of preferred and majority of common").`
    : "";
  return (
    `${label} must be text of at most ${GOVERNANCE_TERM_MAX_LENGTH} characters describing what was actually ` +
    `negotiated on this round.${extra} Send null or an empty value to remove it, after which Capavate states ` +
    `that the term is not recorded rather than printing one. It is never defaulted: an invented governance ` +
    `term is a legal statement the platform cannot support.`
  );
}

/**
 * THE ONE WRITE FENCE. Shape first, then length — a boolean is only meaningful
 * on the two yes/no terms, and an object or an array is a client bug rather than
 * a term. `String([])` is `""`, so removal is tested on the LITERAL value and
 * never on `String(raw).trim()`: that is the trap the seniority fence was caught
 * by on its first run in Wave 81.
 */
export function validateGovernanceTermStored(key: GovernanceTermKey, raw: unknown): GovernanceTermVerdict {
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, value: null }; // explicit removal
  }
  if (typeof raw === "boolean") {
    if (!YES_NO_TERMS.has(key)) {
      return { ok: false, error: `invalid_${key}`, field: key, message: refusalMessage(key) };
    }
    return { ok: true, value: raw ? "Yes" : "No" };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: `invalid_${key}`, field: key, message: refusalMessage(key) };
  }
  const s = raw.trim();
  if (s.length > GOVERNANCE_TERM_MAX_LENGTH) {
    return { ok: false, error: `invalid_${key}`, field: key, message: refusalMessage(key) };
  }
  return { ok: true, value: s };
}
