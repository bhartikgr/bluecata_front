/* ══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 306 — ONE AUTHORITY FOR THE FEE-OBLIGATION RULE AND THE SENTENCES
 *  THAT DESCRIBE IT.
 * ══════════════════════════════════════════════════════════════════════════ *
 *
 *  Three of W306's four parts need the SAME two facts, on both sides of the
 *  wire, and before this module each of them was either hardcoded in one place
 *  or written nowhere at all:
 *
 *    1. HOW LONG A WAIVE REASON MUST BE. The admin screen disabled its button
 *       below ten characters (`AdminPartnerBillingOps.tsx`, placeholder
 *       "Reason (required, min 10 chars)"). THE SERVER CHECKED NOTHING: the
 *       waive route read `String((req.body ?? {}).reason ?? "")` and passed it
 *       straight through, so `curl -d '{}'` waived a money obligation with no
 *       stated reason at all. A disabled button is cosmetic.
 *
 *    2. WHICH OBLIGATION IS ACTUALLY BLOCKING. `spvEngineStore.hasUnsettledFixedFees`
 *       decides this, and it is the only opinion that matters, because it is the
 *       one that throws `FEES_UNPAID`. Screens had been describing it from
 *       memory — the admin tab's own "blocking" flag is `state === "pending" &&
 *       timing === "funding"`, which MISSES a `failed` obligation that does in
 *       fact still block.
 *
 *  ── WHY THE COPY LIVES HERE TOO ────────────────────────────────────────────
 *
 *  W306 has to say the same thing at three places on two different screens (the
 *  GP's fee panel, the wizard's fee-type step, and the wizard's review step,
 *  because the wizard is non-linear and a GP can reach the end without passing
 *  the middle). Three copies of a sentence are three sentences that can drift
 *  apart, and this platform has paid for that before —
 *  `shared/spvSubscriptionRefusalCopy.ts` exists for exactly this reason. There
 *  is one of each sentence, written once, here.
 *
 *  ── WHY EVERY SENTENCE BELOW IS HEDGED THE WAY IT IS (R254.3) ──────────────
 *
 *  Copy must be TRUE IN EVERY BRANCH THAT CAN REACH IT. These were measured in
 *  the tree before being written, and each hedge is load-bearing:
 *
 *  · A fixed or hybrid fee with NO fixed amount (blank, or zero) accrues nothing
 *    and blocks nothing: `accrueFundingFeeObligations` does `if (amt <= 0)
 *    continue`, and `hasUnsettledFixedFees` does
 *    `if ((fee.fixedAmountMinor ?? 0) <= 0) continue`. So the wizard sentence
 *    says "IF you set a fixed fee amount" and never "a fixed fee blocks".
 *
 *  · The gate does NOT stand in front of every commitment path. It fires at
 *    `advanceSubscription` when the target status is `committed`, at
 *    `createDeployment`, at `advanceDeployment` and at the cap-table ledger
 *    commit. `projectLpCommitted` is NOT gated (deferred by owner ruling — a new
 *    restriction is the owner's call, not a wave's). So no sentence here claims
 *    that nothing can be committed; they name what is refused instead.
 *
 *  · Nothing here promises the GP can clear the block himself. The partner-side
 *    charge route answers 503 by deliberate design (`paymentGatewayAdapter.ts`
 *    is frozen under WAIVER-8 and its refusal is correct), so today an
 *    administrator is the only way through, and that is what the sentences say.
 *
 *  PURE. No imports, no reads, no writes, no money arithmetic, no currency, no
 *  price and no figure of any kind. Unit-testable without a database, which is
 *  the point: the predicate can be exercised against the store's real gate
 *  across states the seeded database will not produce on demand.
 */

/**
 * The minimum length of a stated waive reason, in characters, AFTER trimming.
 *
 * TEN IS NOT A NEW RULE AND THIS MODULE DID NOT CHOOSE IT. It is the number the
 * admin screen has always enforced in the browser
 * (`(reason[o.id] ?? "").trim().length < 10` disables the button, and the input
 * placeholder says "min 10 chars"). W306 was told to match the existing rule
 * exactly and not to invent a stricter one: an over-tight server rule that
 * refuses a waiver a legitimate administrator is entitled to make is worse than
 * the hole it closes, because the hole at least leaves the vehicle usable.
 *
 * The admin screen keeps its own literal — that file was explicitly out of
 * scope for this wave — so `w306_waive_reason_rule_binding` asserts that the
 * literal on the screen and this constant are still the same number.
 */
export const SPV_FEE_WAIVE_REASON_MIN_LENGTH = 10;

/**
 * Does this reason satisfy the rule? Trims first, exactly as the browser does,
 * so whitespace cannot buy length in one place and not the other.
 *
 * Deliberately accepts `unknown`: the server's caller is an untyped JSON body,
 * and a non-string reason (a number, an array, `null`, a nested object) must be
 * REFUSED rather than coerced into a plausible-looking string. `String([])` is
 * `""` and `String({})` is `"[object Object]"` — fifteen characters that would
 * have passed a naive length check.
 */
export function spvFeeWaiveReasonIsAcceptable(reason: unknown): boolean {
  if (typeof reason !== "string") return false;
  return reason.trim().length >= SPV_FEE_WAIVE_REASON_MIN_LENGTH;
}

/** The machine code the waive route answers with. */
export const SPV_FEE_WAIVE_REASON_REFUSAL_CODE = "WAIVE_REASON_REQUIRED";

/**
 * What a person reads when the server refuses the waive (R77 — never a bare
 * code). Kept under the 240-character boundary in
 * `client/src/lib/queryClient.ts`, which silently replaces a longer `message`
 * with a generic 4xx sentence and throws the reason away.
 */
export const SPV_FEE_WAIVE_REASON_REFUSAL_MESSAGE =
  "Nothing was waived. A waiver permanently forgives money this vehicle owes, so it has to carry a written reason of at least " +
  `${SPV_FEE_WAIVE_REASON_MIN_LENGTH} characters. Say why, and send it again.`;

/**
 * The shape the blocking predicate needs. Narrower than `SpvFeeObligationDTO`
 * on purpose, so this module carries no dependency on the store and the client
 * can pass a row straight off the API without a cast.
 */
export interface SpvFeeObligationBlockingInput {
  timing?: unknown;
  portion?: unknown;
  state?: unknown;
}

/**
 * Is THIS obligation row one of the ones that makes the platform refuse?
 *
 * This mirrors, field for field, the first clause of
 * `spvEngineStore.hasUnsettledFixedFees`:
 *
 *     obs.some((o) => o.timing === "funding" && o.portion === "fixed"
 *                     && o.state !== "paid" && o.state !== "waived")
 *
 * `w306_blocking_predicate_agrees_with_the_gate` drives the real store gate over
 * a matrix of rows and asserts this function agrees with it on every one, so
 * this is a shared reading of one rule rather than a second rule that happens to
 * look similar. If the gate ever changes and this does not, that test fails.
 *
 * NOTE WHAT IT DOES NOT CLAIM. `hasUnsettledFixedFees` has a SECOND clause: a
 * fixed/hybrid fee CONFIGURED with a positive fixed amount for which no settled
 * funding obligation exists also blocks, EVEN WITH NO ROW AT ALL. A row-level
 * predicate cannot see that, and does not pretend to: this answers "is this row
 * blocking", never "is this vehicle clear".
 */
export function spvFeeObligationIsBlocking(o: SpvFeeObligationBlockingInput): boolean {
  return (
    o.timing === "funding" &&
    o.portion === "fixed" &&
    o.state !== "paid" &&
    o.state !== "waived"
  );
}

/**
 * PART 3 — the marker beside a blocking obligation on the GP's own fee panel.
 *
 * The panel already renders the amount and the currency honestly and already
 * renders absence as "None"; the gap was that nothing said the pending
 * obligation was STOPPING anything. Two words, appended beside the state that is
 * already there.
 */
export const SPV_FEE_OBLIGATION_BLOCKING_MARKER = "blocking commitments";

/**
 * PART 3 — the sentence that explains the marker, rendered as a SIBLING above
 * the obligation list rather than inside any row, because the row it describes
 * can be re-rendered or gone and the explanation has to outlive it.
 *
 * TRUE IN EVERY BRANCH THAT CAN REACH IT: it is rendered only when at least one
 * row satisfies `spvFeeObligationIsBlocking`, which is the gate's own condition,
 * and it names the three things the gate actually refuses instead of claiming
 * that nothing at all can happen.
 */
export const SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION =
  "At least one fee obligation below is still outstanding, and it is blocking this vehicle: while it stands, " +
  "Capavate refuses to confirm a subscription as committed, to create or advance a deployment, and to commit the " +
  "cap-table ledger. Only a Capavate administrator can clear it, by settling it or waiving it — Capavate cannot " +
  "collect it for you today.";

/**
 * PARTS 4 — the disclosure, shown at the fee-type select AND on the review step
 * of the SPV creation wizard. THE SAME SENTENCE AT BOTH, from here, because the
 * wizard is non-linear: a GP can change the fee type on step 2 and never look at
 * it again, or arrive at review having skipped it.
 *
 * READ THE HEDGES BEFORE EDITING THIS.
 *
 * · "If you set a fixed fee amount" — because a fixed or hybrid fee with a
 *   blank or zero amount accrues nothing and blocks nothing. Without the
 *   conditional this sentence is FALSE for every zero-amount fixed fee.
 * · "when an LP's funding is recorded" — the accrual fires on the transition to
 *   `wire_funded`, and again (idempotently) at the commit itself.
 * · "before Capavate will confirm that commitment or record a deployment" —
 *   what the gate actually refuses. It does NOT say no commitment can be
 *   recorded, because `projectLpCommitted` is not gated.
 * · "a Capavate administrator has to settle or waive it" — true today: the
 *   partner-side charge route answers 503 by design.
 * · Nothing here states or implies an amount, a currency or a fee rate.
 */
export const SPV_FEE_SETTLEMENT_DISCLOSURE =
  "If you set a fixed fee amount, Capavate raises it as a fee obligation on this vehicle when an LP's funding is " +
  "recorded, and a Capavate administrator has to settle or waive that obligation before Capavate will confirm that " +
  "commitment or record a deployment. Capavate cannot collect it automatically, and you cannot clear it yourself — " +
  "so allow for that step before you promise an LP a closing date.";
