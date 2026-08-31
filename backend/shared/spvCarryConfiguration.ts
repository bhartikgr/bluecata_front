/**
 * WAVE 182 · ITEM C · R152.4 (item 4) — THE CARD PROMISED A CARRY THAT DOES NOT EXIST.
 *
 * WHAT WAS ON SCREEN. The SPV card on the partner engine list reads
 * `… · Carry: Per deployment` for "Asian Biotech", whose Fees tab shows exactly
 * one fee — `management: fixed CA$10.00` — and no carry at all. The same for
 * "SPV for vintage TECH daeals.", whose card reads `Carry: Whole SPV` and whose
 * Fees tab shows `fixed $10,000.00` and no carry.
 *
 * WHY IT IS WRONG WITHOUT ANYTHING BEING BROKEN. `SpvDTO.carryBasis` is a REAL,
 * required field, collected by the launch wizard, and the card renders it
 * correctly. The defect is what the label MEANS. `carryBasis` answers
 * "IF a carry is charged, over what is it computed?" — per deployment, or over the
 * whole vehicle. The card presents that answer as though it were
 * "a carry IS charged". Fee truth lives in an entirely different record,
 * `SpvFeeDTO { layer, feeType: "fixed" | "carry" | "hybrid", fixedAmountMinor,
 * carryPct }`, and `SpvDTO` carries none of it. So the card had no way to know,
 * and stated a fee basis that is not configured.
 *
 * THE RULE THIS MODULE ENCODES. A carry is CONFIGURED when some effective fee
 * layer has `feeType` of `carry` or `hybrid` AND a non-null `carryPct`. Both
 * halves are load-bearing: a `hybrid` layer with a null `carryPct` has a flat
 * component and no carry percentage anyone agreed to, and calling that "carry
 * configured" would put the same dead promise back on the card.
 *
 * NEVER FABRICATE 0%. An unconfigured carry and a 0% carry are DIFFERENT FACTS,
 * and the difference matters to a limited partner reading a term sheet. So:
 *   · no state below reports a percentage,
 *   · no state below reports a money amount,
 *   · the "not configured" state says the carry is not configured — it does not
 *     say the carry is zero,
 *   · and when the fee view cannot be trusted, the module refuses to claim EITHER
 *     way, because a failed read is not evidence that a vehicle is fee-free.
 * Stating no number at all also keeps this surface entirely clear of money
 * formatting: there is no minor-unit value here to scale, round or mis-exponent.
 *
 * FOUR STATES, AND ONLY FOUR. Anything a caller cannot place in one of them is a
 * fact this module does not have, and it says so rather than choosing the
 * flattering answer.
 */

export const SPV_CARRY_CONFIGURATION_STATES = [
  "configured",
  "not_configured",
  "no_fee_schedule",
  "unreadable",
] as const;
export type SpvCarryConfigurationState = (typeof SPV_CARRY_CONFIGURATION_STATES)[number];

/** The shape a fee row must expose to be classified. Deliberately narrower than
 *  `SpvFeeDTO` so this module can be unit-tested without the engine. */
export interface SpvCarryFeeInput {
  feeType: string;
  carryPct: number | null;
}

export interface SpvCarryConfiguration {
  state: SpvCarryConfigurationState;
  /** Plain-language statement of the ACTUAL configured fee structure. Never a
   *  percentage, never an amount, never a machine code. */
  statement: string;
}

/**
 * Classify. Pure: no reads, no writes, no throws, no formatting.
 *
 * `feeViewUnreliable` is passed in rather than inferred from an empty list,
 * because "no fee rows" and "the fee table could not be read" look identical from
 * the outside and must NOT be reported the same way — reporting an unreadable fee
 * schedule as "no carry configured" is how a database failure becomes a claim
 * about a vehicle's terms.
 */
export function spvCarryConfiguration(args: {
  fees: readonly SpvCarryFeeInput[];
  feeViewUnreliable: boolean;
}): SpvCarryConfiguration {
  if (args.feeViewUnreliable) {
    return {
      state: "unreadable",
      statement:
        "Fee schedule could not be read, so whether a carry is configured is not shown here. " +
        "This is not a statement that there is no carry — open the Fees tab.",
    };
  }
  if (args.fees.length === 0) {
    return {
      state: "no_fee_schedule",
      statement:
        "No fee schedule is recorded for this vehicle yet, so no carry is configured. " +
        "The basis above is the basis a carry would use once one is set.",
    };
  }
  const carrying = args.fees.filter(
    (f) => (f.feeType === "carry" || f.feeType === "hybrid") && f.carryPct !== null,
  );
  if (carrying.length === 0) {
    return {
      state: "not_configured",
      statement:
        "No carry is configured on this vehicle. The basis above describes how a carry would be " +
        "computed if one were set; it is not a carry that is being charged.",
    };
  }
  const hybrid = carrying.some((f) => f.feeType === "hybrid");
  return {
    state: "configured",
    statement: hybrid
      ? "Carry is configured, on this basis, alongside a flat fee. See the Fees tab for the agreed figures."
      : "Carry is configured, on this basis. See the Fees tab for the agreed figure.",
  };
}
