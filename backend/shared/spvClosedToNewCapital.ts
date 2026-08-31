/**
 * WAVE 182 · ITEM A · R152 — A CLOSED VEHICLE DOES NOT TAKE NEW CAPITAL.
 *
 * THE DEFECT THIS MODULE EXISTS TO CLOSE. An SPV was moved Open -> Closed
 * ("Closed to new LPs" was reported to its limited partners), and a limited
 * partner was then committed to its cap table through the GP commit form. It
 * succeeded silently, and the close statement recomputed from 1 LP / $400,000 to
 * 2 LPs / $450,000 AFTER the close. A general partner who closes a vehicle and
 * reports that close is still accepting capital into it. That is a legal-state
 * defect, not a cosmetic one.
 *
 * WHY THE RULE LIVES IN `shared/` AND NOT AT THE ROUTE. Five write paths reach
 * three different sinks:
 *
 *   POST /api/partner/me/spv/:spvId/lp-commit        -> projectLpCommitted
 *   POST /api/partner/me/spv/:spvId/subscriptions    -> subscribe
 *   POST /api/partner/me/spvs/:id/positions          -> subscribe
 *   POST /api/partner/me/funds/:id/commitments       -> subscribe
 *   POST /api/partner/me/spvs/:id/commitments        -> spvFundStore.addCommitment
 *
 * A copy of the predicate at each one is how the poles drift apart: the next
 * wave fixes four of them and the fifth keeps taking money. There is ONE
 * spelling of "would this add capacity to a closed vehicle", and both the store
 * sinks and the route boundary call it.
 *
 * WHAT THE RULE IS, PRECISELY. While the vehicle's canonical status is `closed`:
 *   - a commitment for an investor holding NO non-withdrawn subscription is
 *     refused (that is new capacity), and
 *   - a commitment GREATER than that investor's existing non-withdrawn
 *     commitment is refused (that is an increase in capacity),
 *   - an equal or lower re-post of an existing subscription is ACCEPTED.
 *
 * The third clause is load-bearing, not a loophole. `POST .../lp-commit` is
 * documented as idempotent under a deterministic invitation id
 * (server/spvEngineRoutes.ts) and `projectLpCommitted` REPLACES an existing
 * row's amount rather than adding to it, so a replay of an already-recorded
 * commitment must not start failing the moment a vehicle closes. It adds nothing
 * to the vehicle by definition: the resulting total cannot rise.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT COVER.
 *   - Confirming funds received on an ALREADY-committed limited partner. That is
 *     settlement of capital committed BEFORE the close, and R152 item 5 requires
 *     it to keep working while closed. `confirmFundsReceived` writes no
 *     commitment amount and never calls this module.
 *   - Stage transitions of existing subscriptions (`advanceSubscription`,
 *     soft-circle, GP confirm, the legacy commitment transition). Those move a
 *     seat that already exists, and the `wire_funded` transition is a
 *     fee-accrual trigger: gating it would change WHEN a fee is charged, which
 *     R152.2 forbids outright.
 *   - `deployed`, `distributing` and `wound_down`. Only `closed` is tested, and
 *     that is deliberate: `canReopenClose` (server/lib/spvOfflineOps.ts) can
 *     reopen a `closed` vehicle and nothing else, so refusing commits in those
 *     three states would leave a general partner with no remedy on the surface.
 *     Reported to the owner as an open question rather than guessed at.
 *
 * MONEY. This module COMPARES two integer minor-unit values its callers already
 * hold. It performs no arithmetic, no scaling and no formatting, and it never
 * calls `Number()`, `parseInt` or `parseFloat`, so there is no boundary here for
 * a float to enter through and nothing for `server/lib/money.ts` to own.
 */

/** The machine code. Carried as the thrown `Error.message` so the route error
 *  mapper can key on it — it is NEVER the text a general partner reads. */
export const SPV_CLOSED_TO_NEW_CAPITAL_CODE = "SPV_CLOSED_TO_NEW_LPS";

/** The canonical status that means "closed to new limited partners". */
export const SPV_CLOSED_STATUS = "closed";

/** Why a commitment was refused. `null` means it was not refused. */
export type SpvClosedToNewCapitalReason = "new_limited_partner" | "increase";

export interface SpvClosedToNewCapitalDecision {
  refused: boolean;
  reason: SpvClosedToNewCapitalReason | null;
}

const NOT_REFUSED: SpvClosedToNewCapitalDecision = { refused: false, reason: null };

/** True when this vehicle status means the vehicle is closed to new limited
 *  partners. One spelling, so a second surface cannot invent a different set. */
export function spvIsClosedToNewCapital(status: string | null | undefined): boolean {
  return String(status ?? "") === SPV_CLOSED_STATUS;
}

/**
 * The whole rule. Pure: reads nothing, writes nothing, throws nothing.
 *
 * `existingCommitmentMinor` is the investor's CURRENT non-withdrawn commitment
 * in minor units, or `null` when they hold no non-withdrawn subscription on this
 * vehicle. `requestedMinor` is the commitment being asked for, in minor units.
 */
export function spvClosedToNewCapitalDecision(args: {
  status: string | null | undefined;
  existingCommitmentMinor: number | null;
  requestedMinor: number;
}): SpvClosedToNewCapitalDecision {
  if (!spvIsClosedToNewCapital(args.status)) return NOT_REFUSED;
  if (args.existingCommitmentMinor === null) {
    return { refused: true, reason: "new_limited_partner" };
  }
  /* A comparison of two integers the caller already holds. Not arithmetic. */
  if (args.requestedMinor > args.existingCommitmentMinor) {
    return { refused: true, reason: "increase" };
  }
  return NOT_REFUSED;
}

/** The name to print when the vehicle has none recorded. Never a blank quote,
 *  and never an identifier — a general partner reading a refusal should not have
 *  to recognise an internal id. */
export const SPV_CLOSED_UNNAMED_VEHICLE = "This vehicle";

/* WAVE 198 · ITEM C · R166.2 — the ONE length discipline for refusal headlines.
   Dependency-free by design: this module is imported by the client
   (`client/src/pages/partner/PartnerSpvDetail.tsx`). */
import { fitToGate, boundedFragment, NAME_FRAGMENT_BUDGETS } from "./refusalHeadlineGate";

function vehicleName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  return trimmed.length > 0 ? trimmed : SPV_CLOSED_UNNAMED_VEHICLE;
}

/**
 * The SHORT form. Sized to survive `client/src/lib/queryClient.ts`'s 240-char
 * `looksHuman` gate, which silently substitutes a generic sentence for anything
 * longer — the same reason `spvCapSplitRefusalHeadline` exists. It still names
 * the vehicle and states the fact, because a headline that says less than the
 * code it replaces is not an improvement.
 */
/* ── WAVE 198 · ITEM C · R166.2 ──────────────────────────────────────────────────
   Measured: 91 characters of fixed prose, so any vehicle name over 148 characters
   silences this refusal on the client. Less exposed than its sibling in
   `spvCanonicalCommitmentResolution.ts`, but the same defect, and the sweep's whole
   point is to fix the class rather than the reported instance. Prose byte-unchanged
   (R143.1); only the name is bounded, on the wide ladder so normal names are
   untouched. */
export function spvClosedToNewCapitalHeadline(spvName: string | null | undefined): string {
  return fitToGate(
    (b) =>
      `${boundedFragment(vehicleName(spvName), b)} is closed to new limited partners, so this commitment was not accepted. Nothing was saved.`,
    NAME_FRAGMENT_BUDGETS,
  );
}

/**
 * The PROACTIVE statement, for the commit surface itself.
 *
 * WHY IT IS SEPARATE FROM THE REFUSAL. The refusal above is past tense: it
 * explains a commitment that was declined. This one is present tense and is
 * rendered BEFORE the general partner types anything, because the honest place to
 * say "this vehicle is closed" is on the form, not in a toast after the attempt.
 * A transient toast is not a state; this sentence is always in the document while
 * the vehicle is closed, and empty while it is open.
 *
 * IT IS A STATEMENT, NOT AN ENFORCEMENT. The form's submit control is deliberately
 * NOT disabled by this wave — a disabled button is not enforcement, and the
 * refusal that matters lives at the store and route layers. This only means a GP
 * is never surprised by it.
 */
export function spvClosedToNewCapitalNotice(spvName: string | null | undefined): string {
  return (
    `${vehicleName(spvName)} is closed to new limited partners. A new commitment, or an increase to an existing one, ` +
    "will not be accepted while it is closed. Funds already committed can still be confirmed as received. To take more " +
    "capital, reopen the vehicle for a rolling close first."
  );
}

/**
 * The UNABRIDGED sentence. States four facts and no code: which vehicle, that it
 * is closed to new limited partners, that capital already committed can still be
 * confirmed as received, and that the vehicle can be reopened for a rolling
 * close if the general partner does intend to take more capital.
 */
export function spvClosedToNewCapitalSentence(args: {
  spvName: string | null | undefined;
  reason: SpvClosedToNewCapitalReason;
}): string {
  const name = vehicleName(args.spvName);
  const what =
    args.reason === "increase"
      ? `${name} is closed to new limited partners, so an existing commitment cannot be increased on it.`
      : `${name} is closed to new limited partners, so a new commitment cannot be accepted on it.`;
  return (
    `${what} Nothing was saved, and the close statement already reported to the limited partners is unchanged. ` +
    "Funds already committed before the close can still be confirmed as received — closing the vehicle does not " +
    "block settlement of capital it already holds. If more capital is genuinely intended, reopen the vehicle for a " +
    "rolling close first and then commit; the original close date is kept on the record."
  );
}
