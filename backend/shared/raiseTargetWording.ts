/* WAVE 165 · R130.2 / R139.4 — THE ONE VOCABULARY FOR "TARGET RAISE" AND "CAP".
 *
 * THE DEFECT THIS EXISTS TO END. A consortium partner read a $5,000,000 target
 * raise as the amount the vehicle would accept, and committed $10,000,000 into
 * it. Nothing on screen contradicted him: every surface printed a number under
 * the bare word "target" and left the reader to guess whether it was a goal or
 * a ceiling. R130.1 fixes the meanings —
 *
 *     target raise  = the amount being AIMED FOR. Exceeding it warns and is
 *                     recorded. It NEVER blocks; oversubscription is healthy.
 *     cap           = the MAXIMUM the vehicle may accept. Optional.
 *     blank cap     = NO MAXIMUM. Blank is not zero, and zero is not blank.
 *
 * — and R130.2 makes the wording an equal part of the fix: "This needs to be
 * described properly for all users on the platform." R139.4 closes the loop:
 * ALL surfaces, located by CONTENT rather than by the spec's stale coordinates.
 *
 * WHY A MODULE AND NOT A COMPONENT. The silent-drop guard identifies copy by
 * literal JSX text nodes and panel children positionally. Wave 165 verified
 * this empirically: converting one existing text node into `{expr}` moved the
 * guard's copy count 8459 → 8458, i.e. it scored a REPLACED text node as a
 * REMOVED copy string, exactly as three previous builders were told. Every
 * clarifier below is therefore rendered as an ADDITIONAL sibling carrying a
 * literal text node, and no existing literal is touched. A shared component
 * would have made each call site one `{expr}` child and dropped copy platform
 * wide, so this ships as constants that each surface renders in its own
 * literal-bearing element.
 *
 * PartnerFundDetail.tsx's `partner-fund-target-basis` note (wave 127) was the
 * one surface already correct before this wave — S4 in the spec's inventory —
 * and its phrasing is the model the sentences below are built from, so the
 * platform reads consistently rather than saying the same thing nine ways.
 */

/** The one spelling of "we hold no figure for this" (R77 / R111 Q13). Never a
 *  bare dash, never `$0.00` — both of those are false statements about money.
 *  Re-exported rather than re-declared so there is a single source. */
export { SPV_NOT_ON_RECORD_LABEL as NOT_ON_RECORD } from "./spvCapSplitDisclosure";

/** Full sentence pair for a prominent, single-value target readout — a detail
 *  page hero tile, a wizard review row. Modelled on S4. */
export const TARGET_RAISE_IS_A_GOAL_NOTE =
  "This is the fundraising goal being aimed for, not a limit. Commitments are never blocked for " +
  "passing it — going over is recorded so the raise can be reconciled against what was planned.";

/** Compact variant for list rows, cards and progress lines, where a full
 *  sentence would crowd the figure out. Same claim, fewer words. */
export const TARGET_RAISE_IS_A_GOAL_SHORT = "fundraising goal, not a limit";

/** For a money-entry field that collects a target. Says what will happen after
 *  the number is saved, which is the part the wizard never stated. */
export const TARGET_RAISE_INPUT_NOTE =
  "The fundraising goal for this vehicle. It is not a limit: commitments may exceed it and are " +
  "never refused for doing so. The maximum, if you want one, is the separate cap.";

/** For a cap readout. */
export const CAP_IS_THE_MAXIMUM_NOTE =
  "The cap is the maximum this vehicle may accept in total. It is optional — left blank there is " +
  "no maximum.";

/** Compact cap variant. */
export const CAP_IS_THE_MAXIMUM_SHORT = "maximum accepted in total; blank means no maximum";

/** Rendered where a target is shown and NO cap is set, so a reader is not left
 *  to infer that the target must therefore be the ceiling — the exact
 *  inference that produced the live defect. */
export const NO_CAP_SET_NOTE =
  "No cap is set on this vehicle, so there is no maximum. The target above is a goal, not a " +
  "ceiling.";

/** Round-flavoured wording. A "round size" or "round target" is a founder-side
 *  target raise and means the same thing; saying so keeps the silos from
 *  diverging, which R130.2 names as the cause of the original divergence. */
export const ROUND_TARGET_IS_A_GOAL_NOTE =
  "The round's fundraising goal, not a limit and not the amount still available. Commitments are " +
  "never blocked for passing it.";

export const ROUND_TARGET_IS_A_GOAL_SHORT = "goal, not a limit";

/** The phrase list a fence test uses to decide whether a surface has explained
 *  itself. Any ONE of these appearing beside a rendered target or cap satisfies
 *  R130.2; a surface with none of them is an unexplained surface, which R139.4
 *  says IS the original defect surviving. */
export const TARGET_EXPLANATION_PHRASES: readonly string[] = [
  "not a limit",
  "goal, not a limit",
  "fundraising goal",
  "goal being aimed for",
];

export const CAP_EXPLANATION_PHRASES: readonly string[] = [
  "maximum",
  "no maximum",
];
