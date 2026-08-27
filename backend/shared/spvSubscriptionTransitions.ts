/**
 * WAVE 162 · BATCH 3 · ITEM B — the ONE subscription transition-legality map.
 *
 * Modelled deliberately on `server/captableCommitStore.ts`'s `TRANSITIONS`
 * (SACRED, read-only, consulted not copied) so the platform has ONE house
 * pattern for "which stage may follow which": a `Record<state, state[]>` whose
 * terminal states map to an empty array.
 *
 * WHY THIS FILE EXISTS. Until this wave, `advanceSubscription` assigned
 * `req.body.to` straight onto the row. There was no zod schema and no enum check
 * at the route, and none in the store either. Two live consequences, both
 * verified before the fix:
 *
 *   1. Arbitrary garbage persisted as a status. A subscription reading
 *      `"committedd"` is neither `committed` nor `withdrawn`, so it silently
 *      joined every all-stages basis while being invisible to every
 *      committed-only one — the exact class of defect wave 161 fenced.
 *   2. `committed → soft_circled` was legal, which REMOVED confirmed capital
 *      from a vehicle with no reason, no record and no audit entry.
 *
 * BINDING RULING R135.2 — `soft_circled → wire_funded` is NOT permitted. An LP
 * who wires before signing does not skip the GP's confirmation: the funds are
 * recorded as received, but the commitment stays unconfirmed until the GP
 * affirms BOTH conditions (R131.1). Anything else lets cash arrival silently
 * manufacture a binding commitment.
 */
import { SPV_SUBSCRIPTION_STATUSES, type SpvSubscriptionStatus } from "./spvEngine";

/** The entry stage every newly created subscription lands in. */
export const SPV_SUBSCRIPTION_ENTRY_STATUS: SpvSubscriptionStatus = "review";

/** The one terminal exit available from any stage. A withdrawal is a RECORDED
 *  event, not a status downgrade. */
export const SPV_SUBSCRIPTION_WITHDRAWN_STATUS: SpvSubscriptionStatus = "withdrawn";

/**
 * The legal edges. `committed` may ONLY be withdrawn; `withdrawn` is terminal.
 *
 * `soft_circled` does NOT list `wire_funded` — that omission is R135.2 and it is
 * the single most important line in this file. Do not "complete the ladder" by
 * adding it.
 */
export const SPV_SUBSCRIPTION_TRANSITIONS: Record<
  SpvSubscriptionStatus,
  readonly SpvSubscriptionStatus[]
> = {
  review: ["soft_circled", "withdrawn"],
  soft_circled: ["founder_confirmed", "withdrawn"],
  founder_confirmed: ["wire_funded", "withdrawn"],
  wire_funded: ["committed", "withdrawn"],
  committed: ["withdrawn"],
  withdrawn: [],
};

/** Forward order of the flow, used to tell a SKIP (forward, several rungs at
 *  once) from a REVERSAL (backwards, or out of a terminal state). The two are
 *  different acts and this wave treats them differently — see
 *  `SPV_SUBSCRIPTION_FORWARD_SKIP_POLICY`. */
export const SPV_SUBSCRIPTION_LADDER: readonly SpvSubscriptionStatus[] = [
  "review",
  "soft_circled",
  "founder_confirmed",
  "wire_funded",
  "committed",
];

/**
 * WRITERS OF `spv_subscription.status` THAT DO NOT GO THROUGH
 * `advanceSubscription`, ALLOW-LISTED EXPLICITLY RATHER THAN EXEMPTED SILENTLY
 * (R135.9).
 *
 * `shadowCommitmentToEngine` is the FOURTH writer the V2 spec found and neither
 * reviewer caught. It is the legacy drain path: it writes `review` on create and
 * PRESERVES the existing status otherwise (verified in
 * `server/spvEngineStore.ts`, at the `status: existing?.status ?? "review"`
 * line). It is allow-listed here and NOT re-routed through `subscribe()`,
 * because re-routing a legacy drain path through the subscribe gates would make
 * a migration replay subject to KYC/accreditation/e-sign/cap gates it was never
 * subject to, and would fail closed on historical rows — a data-loss change
 * dressed up as a tidy-up.
 */
export const SPV_SUBSCRIPTION_STATUS_WRITER_ALLOWLIST: Readonly<
  Record<string, { readonly mayWrite: readonly SpvSubscriptionStatus[]; readonly why: string }>
> = {
  subscribe: {
    mayWrite: ["review"],
    why: "Creates the row at the entry stage. No transition is performed.",
  },
  shadowCommitmentToEngine: {
    mayWrite: ["review"],
    why:
      "W4, the legacy drain path. Writes `review` on create and preserves the existing status " +
      "on re-run. Allow-listed, NOT re-routed through subscribe (R135.9).",
  },
  projectLpCommitted: {
    mayWrite: ["committed"],
    why:
      "Projects an ALREADY-RECORDED cap-table commit (`commitFunded` ledger line) onto the " +
      "roster. R135.3: no new blocking gate is added here. The ledger, not this map, is the " +
      "authority for that fact.",
  },
  confirmFundsReceived: {
    mayWrite: ["wire_funded", "committed"],
    why:
      "Records receipt against a row that is ALREADY committed or wired. Wave 161 made it " +
      "refuse a pre-commitment row outright (FUNDS_CONFIRMATION_REQUIRES_COMMITMENT).",
  },
};

/**
 * POLICY FOR FORWARD SKIPS — RECORDED, NOT REFUSED. **THIS IS SETTLED, NOT OPEN:
 * R136.2 IS THE BINDING RULING AND IT SAYS "record".** W162-F1 is CLOSED.
 *
 * DO NOT FLIP THIS TO "refuse" TO "COMPLETE THE LADDER". It is the tempting edit
 * in this file and it is the wrong one, for a reason that is commercial rather
 * than stylistic.
 *
 * A REVERSAL (`committed → soft_circled`, anything out of `withdrawn`, any move
 * down the ladder) is REFUSED: that is the defect the spec names — it silently
 * removed confirmed capital from a vehicle with no reason, no record and no audit
 * entry — and no caller on the platform performs one. R135.2's
 * `soft_circled → wire_funded` is refused too, unconditionally, above.
 *
 * A FORWARD SKIP (`review → committed` in one PATCH) is RECORDED and permitted.
 * Refusing it is NOT a neutral tightening:
 *
 *   1. IT CHANGES WHEN MONEY OBLIGATIONS ARE CREATED. The only compliant route
 *      from `review` to `committed` runs through `wire_funded`, and
 *      `advanceSubscription` ACCRUES FUNDING FEE OBLIGATIONS on entering
 *      `wire_funded` (`accrueFundingFeeObligations`). Forcing every one-step
 *      commit through that stage would alter the point at which a partner incurs
 *      a charge. That is a commercial change disguised as a validation fix, and
 *      the owner's standing instruction is "do not break anything".
 *   2. NINE EXISTING MONEY AND ATOMICITY SUITES PERFORM `review → committed`.
 *      That is evidence of a legitimate, used path — not nine tests to update.
 *      Under R98 the suites are not rewritten to satisfy a stricter ladder
 *      nobody asked for.
 *   3. THE ACTUAL DEFECTS ARE CLOSED EITHER WAY. The dangerous edge was the
 *      reversal, and it is refused. Forward skips are permitted AND LOGGED at
 *      `advanceSubscription`, which is the R105 posture: warn and record, never
 *      silently.
 *
 * THE COST OF FLIPPING IT, MEASURED IN WAVE 162 RATHER THAN ESTIMATED. The value
 * was set to "refuse", the candidate suites were run, and the value was restored
 * and re-verified by sha256. Exactly NINE suites fail, and here they are, so a
 * future owner deciding this has the bill in front of them:
 *
 *     server/__tests__/wave1a_s2_fee_self_mark.test.ts          23 failed / 31
 *     server/__tests__/spvWaterfall.test.ts                      4 failed /  7
 *     server/__tests__/wave3e_settlement_authority_db.test.ts    24 failed / 39
 *     server/__tests__/wave3b_mc1_cent_conservation.test.ts       6 failed / 38
 *     server/__tests__/wave3f_item1_atomicity.test.ts             1 failed /  1
 *     server/__tests__/wave32_side_letter_waterfall.test.ts       5 failed / 23
 *     server/__tests__/spvEngine.test.ts                         18 failed / 34
 *     server/__tests__/w10_atomicity_repro.test.ts                2 failed /  2
 *     server/__tests__/spvFeeObligations.test.ts                  7 failed /  7
 *
 * So the change is ONE LINE — this one — PLUS those nine suites, five of which
 * are fee, cent-conservation, waterfall or atomicity suites, i.e. exactly the
 * money behaviour reason (1) describes. Recorded here so the choice stays
 * reversible and priced.
 */
export const SPV_SUBSCRIPTION_FORWARD_SKIP_POLICY: "record" | "refuse" = "record";

export type SpvSubscriptionTransitionVerdict =
  | { readonly ok: true; readonly kind: "adjacent" | "withdrawal" | "same_stage" }
  | { readonly ok: true; readonly kind: "forward_skip"; readonly skipped: readonly SpvSubscriptionStatus[] }
  | { readonly ok: false; readonly code: "ILLEGAL_SUBSCRIPTION_TRANSITION"; readonly kind: "reversal" | "terminal" | "forward_skip"; readonly detail: string };

/** Is this a status this platform recognises? No coercion, no trimming — an
 *  unrecognised value is a refusal, never a repair. */
export function isSpvSubscriptionStatus(value: unknown): value is SpvSubscriptionStatus {
  return typeof value === "string" && (SPV_SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** Is this a whole, non-negative amount of minor units? Used for `wiredMinor`,
 *  which a JSON string could previously reach unchecked. No `Number()`,
 *  `parseInt` or `parseFloat` — a value that is not already an integer is
 *  refused, not converted. */
export function isSpvMoneyMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function ladderIndex(status: SpvSubscriptionStatus): number {
  return SPV_SUBSCRIPTION_LADDER.indexOf(status);
}

/**
 * The ONE legality decision. Every caller — route, store, test — asks this
 * function; there is no second copy of the rule.
 */
export function spvSubscriptionTransitionLegality(
  from: SpvSubscriptionStatus,
  to: SpvSubscriptionStatus,
): SpvSubscriptionTransitionVerdict {
  if (from === to) return { ok: true, kind: "same_stage" };

  if (from === SPV_SUBSCRIPTION_WITHDRAWN_STATUS) {
    return {
      ok: false,
      code: "ILLEGAL_SUBSCRIPTION_TRANSITION",
      kind: "terminal",
      detail: `${from}:${to}:withdrawn_is_terminal`,
    };
  }

  if (to === SPV_SUBSCRIPTION_WITHDRAWN_STATUS) return { ok: true, kind: "withdrawal" };

  if ((SPV_SUBSCRIPTION_TRANSITIONS[from] as readonly string[]).includes(to)) {
    return { ok: true, kind: "adjacent" };
  }

  const fromIdx = ladderIndex(from);
  const toIdx = ladderIndex(to);
  if (fromIdx < 0 || toIdx < 0 || toIdx < fromIdx) {
    return {
      ok: false,
      code: "ILLEGAL_SUBSCRIPTION_TRANSITION",
      kind: "reversal",
      detail: `${from}:${to}:stages_run_in_one_direction`,
    };
  }

  /* R135.2 — the one forward move that is refused OUTRIGHT, whatever the skip
     policy says. Wiring before the GP confirms does not confirm anything. */
  if (from === "soft_circled" && to === "wire_funded") {
    return {
      ok: false,
      code: "ILLEGAL_SUBSCRIPTION_TRANSITION",
      kind: "forward_skip",
      detail: `${from}:${to}:gp_confirmation_required_R135_2`,
    };
  }

  const skipped = SPV_SUBSCRIPTION_LADDER.slice(fromIdx + 1, toIdx);
  if (SPV_SUBSCRIPTION_FORWARD_SKIP_POLICY === "refuse") {
    return {
      ok: false,
      code: "ILLEGAL_SUBSCRIPTION_TRANSITION",
      kind: "forward_skip",
      detail: `${from}:${to}:skipped_${skipped.join("+")}`,
    };
  }
  return { ok: true, kind: "forward_skip", skipped };
}

/** May this allow-listed writer set this status directly? Unknown writers get
 *  `false` — the allow-list is a list, not a suggestion. */
export function spvSubscriptionWriterMayWriteStatus(
  writer: string,
  status: SpvSubscriptionStatus,
): boolean {
  const entry = SPV_SUBSCRIPTION_STATUS_WRITER_ALLOWLIST[writer];
  return !!entry && (entry.mayWrite as readonly string[]).includes(status);
}
