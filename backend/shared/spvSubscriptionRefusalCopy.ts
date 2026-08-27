/**
 * WAVE 162 · BATCH 3 · ITEM B (B-4) — THE ONE AUTHORITY FOR "WHAT DOES A PERSON
 * READ WHEN THE SERVER REFUSES A SUBSCRIPTION MOVE", NOW READABLE BY THE SERVER.
 *
 * WHY THIS FILE EXISTS, AND WHY THE COPY MOVED HERE RATHER THAN BEING COPIED.
 * Wave 161 wrote plain-language copy for every code Item B could throw, ahead of
 * the throws, in `client/src/lib/serverRefusalMessage.ts` (R77, correctly). But
 * that module cannot be imported by the server: it imports `ApiError` from
 * `@/lib/queryClient`, which pulls `@tanstack/react-query` into whatever imports
 * it. So the copy was written and had ZERO reachable consumers — the route still
 * answered `{ error: "<CODE>" }` and nothing on the platform turned that code
 * into a sentence.
 *
 * The fix is a MOVE, not a second copy. The sentences live here, in `shared/`,
 * which both halves of the tree already import; `serverRefusalMessage.ts`
 * re-exports them so its public API is byte-identical and its existing consumers
 * (including `server/__tests__/wave161_itemA_aggregation_fence.test.ts:52`) are
 * unaffected. Two authorities for one sentence is the defect this project keeps
 * paying for, so there is exactly one.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THERE ARE TWO LENGTHS OF SENTENCE, AND IT IS NOT DECORATION.
 * ══════════════════════════════════════════════════════════════════════════════
 * `client/src/lib/queryClient.ts:60-65` accepts the server's `message` onto
 * `ApiError.message` ONLY when it "looks human", and one clause of that test is
 * `serverMessage.length < 240`. Measured, on the copy below:
 *
 *   FUNDS_CONFIRMATION_REQUIRES_COMMITMENT   512 chars
 *   ILLEGAL_SUBSCRIPTION_TRANSITION          511 chars
 *   SUBSCRIPTION_STATUS_REQUIRED             496 chars
 *   INVALID_SUBSCRIPTION_STATUS              433 chars
 *   SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR     431 chars
 *
 * So a route that answers with the FULL sentence has it silently replaced by
 * `friendlyMessageForStatus(400)` — "Some of the information was invalid. Please
 * review and try again." That is still a plain sentence rather than a raw code,
 * so it is not an R77 violation, but it throws away the reason, and the surfaces
 * that render `e.message` raw (`PartnerSpvDetail.tsx:267/:314`) are exactly the
 * ones that would show it.
 *
 * Wave 69 examined that 240-char gate and ruled it OUT OF SCOPE to change: it is
 * the tree-wide 4xx fallback for ~15 `ApiError` consumers (Wave 69 OQ-3). This
 * wave does not change it either. It reads AROUND it, the same way wave 69 did:
 *
 *   `message`  — a HEADLINE under 240 characters, which therefore survives the
 *                boundary intact and reaches `e.message`. States what was
 *                refused and why, in one or two sentences.
 *   `guidance` — the FULL sentence below, unabridged, on the response body for
 *                any surface that reads the payload rather than `e.message`.
 *
 * Nothing is truncated programmatically and no sentence is machine-derived from
 * the other: both are written, and `spvSubscriptionRefusalHeadlineLengthsAreSafe`
 * exists so a test fails the moment a headline grows past the boundary.
 *
 * NEITHER FORM MAY EVER BE A BARE CODE. That is the whole point of R77 here.
 */

/** The codes this module speaks for. Named so a test can enumerate them rather
 *  than trusting a hand-written list to stay in step with the maps. */
export const SPV_SUBSCRIPTION_REFUSAL_CODES = [
  "FUNDS_CONFIRMATION_REQUIRES_COMMITMENT",
  "ILLEGAL_SUBSCRIPTION_TRANSITION",
  "INVALID_SUBSCRIPTION_STATUS",
  "SUBSCRIPTION_STATUS_REQUIRED",
  "SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR",
  "INVALID_WIRED_MINOR",
  /* WAVE 164 · BATCH 3 ITEM C · R77 — `EXCEEDS_CAP` reached users as a BARE
     CODE. The refusal the GP actually sees is built per-request by
     `spvCapSplitRefusalSentence` (it must name the vehicle's own figures), and
     the entries below are the FLOOR: the sentence that is served when the split
     cannot be computed, so the code can never reach a screen naked again. */
  "EXCEEDS_CAP",
  /* ═════════════════════════════════════════════════════════════════════════
     WAVE 166 · BATCH 3 ITEM D (PATH 1) · R131.1 · R77 — THE OFFLINE CONFIRMATION.
     ═════════════════════════════════════════════════════════════════════════
     The owner's model: a GP confirms an LP's investment only "when the LP signs
     the proper subscription docs and the funds are in the bank account", and that
     is an OFFLINE process the platform cannot observe. So the platform cannot
     INFER it. These two codes are the refusals that keep the inference from
     happening, and their sentences are declared HERE, before the throw sites
     exist, because `spvEngineRoutes.err()` answers `{ error: CODE }` with no
     sentence of its own — throwing first would create an R77 violation. */
  "GP_OFFLINE_CONFIRMATION_REQUIRED",
  "GP_OFFLINE_CONFIRMATION_INCOMPLETE",
  /* WAVE 166 · ITEM D (PATH 2) · R77 — an LP origin outside wave 130's
     vocabulary. It lives in THIS module rather than a new one because
     `spvEngineRoutes.err()` reads exactly this map to attach a sentence to a
     code, and a second copy authority for the same route's refusals is how the
     server and the screen end up saying different things. */
  "LP_INVITE_INVALID_ORIGIN",
] as const;

export type SpvSubscriptionRefusalCode = (typeof SPV_SUBSCRIPTION_REFUSAL_CODES)[number];

/** The boundary at which `queryClient.ts` stops believing a server sentence is
 *  meant for a person. Declared here, next to the sentences it constrains, so
 *  the reason a headline is short is visible where the headline is written. */
export const SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS = 240;

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 161-162 · BATCH 3 · R77 — COPY BEFORE THE THROW.
 * ══════════════════════════════════════════════════════════════════════════════
 * `server/spvEngineRoutes.ts` answered a refusal with `{ error: CODE }` and NO
 * `message` field, so neither `serverRefusalMessage` nor `serverRefusalText`
 * could produce a sentence for a code that has none: they render the CODE.
 * `PartnerSpvDetail.tsx:267/:314` then put that raw string on screen.
 *
 * THEREFORE A NEW SERVER REFUSAL CODE WITHOUT AN ENTRY BELOW IS AN R77 VIOLATION
 * THE MOMENT IT IS THROWN — the GP reads `ILLEGAL_SUBSCRIPTION_TRANSITION`.
 *
 * Each sentence says WHAT was refused, WHY, and WHAT TO DO NEXT. None of them
 * apologises, and none of them invents a cause the server did not state.
 * ════════════════════════════════════════════════════════════════════════════ */
export const SPV_SUBSCRIPTION_REFUSAL_COPY: Readonly<Record<string, string>> = {
  /* WAVE 166 · ITEM D (Path 2) — an unrecognised LP origin. */
  LP_INVITE_INVALID_ORIGIN:
    "This LP was not added, because the record of where they came from is not one this platform " +
    "recognises. An LP is either a founding holder, someone who already held a position before " +
    "this vehicle came onto the platform, or someone you are adding now. Choose one of those " +
    "three and add the LP again — nothing was saved, so nothing needs undoing.",
  /* WAVE 166 · ITEM D (Path 1) — a soft-circle must never drift to committed. */
  GP_OFFLINE_CONFIRMATION_REQUIRED:
    "This subscription cannot be recorded as committed capital yet, because nobody has confirmed " +
    "the two things that make it real: that the LP's subscription documents are signed, and that " +
    "the funds are in the bank account. Both happen off the platform, so the platform cannot " +
    "assume them. Open the subscription, confirm both statements, and it will move to committed.",
  GP_OFFLINE_CONFIRMATION_INCOMPLETE:
    "Nothing was changed, because only part of the confirmation was given. Committing an LP " +
    "requires BOTH that their subscription documents are signed and that their funds have been " +
    "received — a soft-circle with one of the two is still not a commitment. Confirm both " +
    "statements together, or leave the subscription where it is until both are true.",
  /* WAVE 161 · ITEM A (A-5) — funds confirmation against a pre-commitment row. */
  FUNDS_CONFIRMATION_REQUIRES_COMMITMENT:
    "This investor has not committed yet, so a wire cannot be recorded against them. " +
    "A soft-circle or a GP-confirmed indication is interest, not a subscription: there is no " +
    "expected amount to compare a wire to, and recording one here would present the indication as " +
    "capital. Advance the subscription to committed first, then record the wire.",
  /* WAVE 162 · ITEM B — the transition-legality map. */
  ILLEGAL_SUBSCRIPTION_TRANSITION:
    "That subscription cannot move from its current stage to the one requested. Subscription " +
    "stages run in one direction — under review, soft-circled, GP-confirmed, funds received, " +
    "committed — and a stage can only be withdrawn, never stepped backwards, because stepping " +
    "backwards would remove capital the vehicle has already counted. Reload the subscription to " +
    "see its current stage, or withdraw it if it should no longer stand.",
  INVALID_SUBSCRIPTION_STATUS:
    "The requested subscription stage is not one this platform recognises. Choose one of the " +
    "stages shown on the subscription — under review, soft-circled, GP-confirmed, funds received, " +
    "committed or withdrawn.",
  SUBSCRIPTION_STATUS_REQUIRED:
    "No target stage was supplied, so there is nothing to move this subscription to. Pick the " +
    "stage you want the subscription to reach and try again.",
  /* WAVE 161 · ITEM A (A-6) — the write chokepoint's own refusal. The server
     appends `:field:type:value` to this code, so the lookup is done on the code
     PREFIX by `spvSubscriptionRefusalCopy` below. */
  SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR:
    "The amount on this subscription is not a whole amount of money, so it was not saved. " +
    "Amounts are recorded in whole cents and cannot be text, a fraction of a cent or a negative " +
    "figure. Re-enter the amount and try again; nothing was changed on the subscription.",
  INVALID_WIRED_MINOR:
    "The funds-received amount is not a whole amount of money this platform can record. Enter the " +
    "amount received as a plain figure — no text, no negative value — and try again.",
  /* WAVE 164 · ITEM C — the cap refusal, without the vehicle's figures. The
     per-request sentence built by `spvCapSplitRefusalSentence` names the cap,
     confirmed capital, soft-circled interest, funds received and the overage
     separately and SUPERSEDES this one whenever the split is available; this is
     the floor so the bare code can never be what a GP reads. */
  EXCEEDS_CAP:
    "This subscription was not accepted because it would take the vehicle past its cap. The cap is " +
    "the maximum the vehicle may accept in total, and it counts every subscription that occupies " +
    "capacity — confirmed capital, and also soft-circled, GP-confirmed and under-review " +
    "indications, which are interest rather than capital. Reduce this subscription, withdraw or " +
    "reduce a pre-commitment indication to free capacity, or raise the cap on the vehicle before " +
    "subscribing again. Nothing was saved.",
};

/**
 * The HEADLINE for each code — the sentence that goes in the response `message`
 * and therefore the one a GP actually reads on a surface that renders
 * `e.message` raw. Every one of these is deliberately under
 * `SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS` so it survives
 * `queryClient.ts`'s `looksHuman` gate; the unabridged sentence above travels
 * beside it as `guidance`.
 *
 * Written, not truncated. A machine-cut sentence ends mid-clause and reads like
 * a bug, which is worse than the code it replaced.
 */
export const SPV_SUBSCRIPTION_REFUSAL_HEADLINE: Readonly<Record<string, string>> = {
  LP_INVITE_INVALID_ORIGIN:
    "This LP was not added, because the record of where they came from is not one this platform " +
    "recognises. Choose a founding holder, an existing holder, or a new direct add, and try again.",
  GP_OFFLINE_CONFIRMATION_REQUIRED:
    "This subscription cannot become committed capital until someone confirms that the LP's " +
    "documents are signed and their funds have been received. Open it and confirm both.",
  GP_OFFLINE_CONFIRMATION_INCOMPLETE:
    "Nothing was changed. Committing an LP needs BOTH the signed documents and the received " +
    "funds confirmed together, not one of the two.",
  FUNDS_CONFIRMATION_REQUIRES_COMMITMENT:
    "This investor has not committed yet, so a wire cannot be recorded against them. Advance the " +
    "subscription to committed first, then record the wire.",
  ILLEGAL_SUBSCRIPTION_TRANSITION:
    "That subscription cannot move from its current stage to the one requested. Stages run in one " +
    "direction, and a committed subscription can only be withdrawn — never stepped backwards.",
  INVALID_SUBSCRIPTION_STATUS:
    "That is not a subscription stage this platform recognises, so nothing was changed. Choose one " +
    "of the stages shown on the subscription.",
  SUBSCRIPTION_STATUS_REQUIRED:
    "No target stage was supplied, so there is nothing to move this subscription to. Pick the " +
    "stage you want it to reach and try again.",
  SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR:
    "The amount on this subscription is not a whole amount of money, so it was not saved. Amounts " +
    "are recorded in whole cents and cannot be text, a fraction, or negative.",
  INVALID_WIRED_MINOR:
    "The funds-received amount is not a whole amount of money this platform can record, so nothing " +
    "was changed. Enter the amount received as a plain figure.",
  EXCEEDS_CAP:
    "Not accepted: this would take the vehicle past its cap, which counts confirmed capital and " +
    "soft-circled interest alike. Reduce the amount or free capacity, then try again.",
};

/** Look a code up in a map, tolerating the `CODE:detail:detail` form the server
 *  uses when the diagnosis is in the detail. The detail is never rendered into
 *  the sentence: it names an internal field and belongs in the operator's log,
 *  not on a GP's screen. */
function lookup(map: Readonly<Record<string, string>>, code: unknown): string | null {
  if (typeof code !== "string") return null;
  const key = code.trim();
  const exact = map[key];
  if (exact) return exact;
  const head = key.split(":")[0];
  return (head && map[head]) || null;
}

/**
 * The plain-language sentence for a refusal CODE, or `null` when there is none.
 *
 * `null`, and never a generic apology, is deliberate: a caller keeps its own
 * existing fallback for an unmapped code, and this function cannot make a new
 * unmapped code look explained when it is not.
 */
export function spvSubscriptionRefusalCopy(code: unknown): string | null {
  return lookup(SPV_SUBSCRIPTION_REFUSAL_COPY, code);
}

/** The boundary-safe headline for a refusal CODE, or `null` when there is none.
 *  Same contract as above: absence is reported, not filled in. */
export function spvSubscriptionRefusalHeadline(code: unknown): string | null {
  return lookup(SPV_SUBSCRIPTION_REFUSAL_HEADLINE, code);
}

/** Every headline is short enough to survive `queryClient.ts`'s 240-char gate.
 *  Exported as a function rather than asserted at module load so a test can name
 *  the offender instead of a whole app failing to boot. */
export function spvSubscriptionRefusalHeadlinesOverLimit(): string[] {
  return Object.entries(SPV_SUBSCRIPTION_REFUSAL_HEADLINE)
    .filter(([, text]) => text.length >= SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS)
    .map(([code, text]) => `${code}:${text.length}`);
}
