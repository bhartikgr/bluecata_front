/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 164 · BATCH 3 · ITEM C — THE CAP SPLIT, AND TARGET-vs-CAP (R133.1, R130).
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. `spvEngineStore.subscribe` threw a BARE `EXCEEDS_CAP`, and
 * `spvEngineRoutes.err()` answered `{ error: "EXCEEDS_CAP" }` with no `message`.
 * `PartnerSpvDetail.tsx:267/:314` render `e.message` RAW, so a GP read the string
 * `EXCEEDS_CAP` on screen — an R77 violation. Worse, the ONE number the old
 * surfaces did show ("Committed now:") was the ALL-STAGES capacity total, so a GP
 * was told that soft-circled interest was committed capital.
 *
 * R133.1 SETTLES THE ARITHMETIC AND IT IS NOT CHANGED HERE. A soft-circle DOES
 * occupy cap capacity: a GP who has soft-circled the whole vehicle has no room
 * left to offer. So `capBasisCommittedMinorForSpv`, `computeCapImpact` and the
 * comparison in `subscribe` keep their arithmetic EXACTLY. What this module adds
 * is the DISCLOSURE: every refusal and every audit record now names, separately,
 *
 *   1. the cap                      — the maximum
 *   2. confirmed capital            — `status = 'committed'` only
 *   3. soft-circled interest        — `soft_circled` + `founder_confirmed` + `review`
 *   4. funds received, not committed — `wire_funded` (R135.1)
 *   5. the overage                  — resulting total minus cap
 *
 * so that no record can ever assert an overage that does not exist in capital,
 * and no reader can mistake interest for capital.
 *
 * TARGET RAISE IS NOT A CAP (R130). The target is a GOAL; exceeding it is good
 * news and MUST NEVER BLOCK. It gets its own reason code and its own durable key
 * so a target overage and a cap overage can never be conflated by a reader, a
 * query or a compliance export. Per R135.3 nothing here introduces a blocking
 * gate where none existed: the target path is warn-and-record only.
 *
 * MONEY TYPES. Formatting is BigInt-only via `formatSpvSplitMinor`; there is no
 * `Number()`, `parseInt` or `parseFloat` on money in this file. The ISO 4217
 * exponent is NOT duplicated here — each side passes its own
 * (`server/lib/money.ts` / `client/src/lib/currency.ts`), because a second
 * exponent table is exactly how a ¥ figure gets divided by 100.
 * ════════════════════════════════════════════════════════════════════════════ */

/** R130 — the machine reason code for a TARGET overage. Deliberately NOT
 *  `EXCEEDS_CAP`: a target overage is not a refusal and never blocks. */
export const TARGET_RAISE_EXCEEDED_CODE = "TARGET_RAISE_EXCEEDED" as const;

/** R130 — the durable `terms` key for target overages. Deliberately separate
 *  from `_capOverrides`: the two mean different things and one is not a refusal.
 *  Overloading one key would make a goal being beaten look like a breach. */
export const SPV_TARGET_OVERAGES_TERMS_KEY = "_targetOverages" as const;

/** The existing durable key for CAP overrides, named here so both keys are
 *  visible in one place and neither can be written to the other's bag. */
export const SPV_CAP_OVERRIDES_TERMS_KEY = "_capOverrides" as const;

/* ── R130.2 — THE WORDS. A target reads as a goal, a cap reads as a maximum, and
 *    a blank cap reads "no maximum". The original defect was a partner believing
 *    the target was a limit, so these are the sentences, written once. ── */

/** What a TARGET raise is, in words. Never "limit", never "maximum". */
export const SPV_TARGET_RAISE_GOAL_LABEL =
  "target raise — the fundraising goal for this vehicle, not a limit";

/** What a CAP is, in words. */
export const SPV_CAP_MAXIMUM_LABEL =
  "cap — the maximum this vehicle may accept in total";

/** What a BLANK cap means. Blank is NOT zero, and zero is NOT "no cap". */
export const SPV_CAP_BLANK_LABEL = "no maximum";

/* WAVE 198 · ITEM C · R166.2 — the ONE length discipline for refusal headlines. */
import { fitToGate, boundedFragment } from "./refusalHeadlineGate";

/** The one spelling of "we hold no figure for this", used instead of a bare
 *  em dash or "not recorded" so absence reads as absence rather than as zero. */
export const SPV_NOT_ON_RECORD_LABEL = "Not on record";

/** Exceeding the target is GOOD NEWS. The sentence says so, so a GP does not
 *  read a warning as a refusal. */
export const SPV_TARGET_EXCEEDED_IS_NOT_A_REFUSAL =
  "Passing the target raise is not a problem and nothing was blocked — the target is a goal, " +
  "not a limit. It is recorded here only so the raise can be reconciled against what was planned.";

/** The five-part split every refusal and every audit record carries (R133.1).
 *  All figures are integer minor units. */
export interface SpvCapSplitFigures {
  /** The cap. `null` means NO CAP — blank, never coerced to 0. */
  capMinor: number | null;
  /** `status = 'committed'` only. The ONLY figure that is capital. */
  confirmedCapitalMinor: number;
  /** `soft_circled` + `founder_confirmed` + `review`. Interest, not capital. */
  softCircledInterestMinor: number;
  /** `wire_funded` — cash received, documents unsigned (R135.1). */
  wiredNotCommittedMinor: number;
  /** The amount being added by the request under consideration. */
  requestedMinor: number;
  /** Every non-withdrawn stage plus the request: the CAPACITY basis (R133.1). */
  resultingTotalMinor: number;
  /** Resulting total minus cap, or 0. Never negative. */
  overageMinor: number;
  currency: string;
}

/** BigInt-only minor-units → display string. `exponent` is supplied by the
 *  caller's own ISO 4217 source; this function never guesses 2. */
export function formatSpvSplitMinor(
  minor: number | null | undefined,
  exponent: number,
  currency: string,
): string {
  if (typeof minor !== "number" || !Number.isSafeInteger(minor)) return SPV_NOT_ON_RECORD_LABEL;
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const code = String(currency ?? "").trim().toUpperCase() || "USD";
  if (exponent <= 0) return `${neg ? "-" : ""}${grouped(abs.toString())} ${code}`;
  let divisor = BigInt(1);
  for (let i = 0; i < exponent; i += 1) divisor *= BigInt(10);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(exponent, "0");
  return `${neg ? "-" : ""}${grouped(whole.toString())}.${frac} ${code}`;
}

/** Thousands separators, inserted on the DECIMAL STRING rather than by way of a
 *  float. `140000.87` and `140,000.87` are the same number, but a GP reading a
 *  six-figure overage off an ungrouped run of digits is exactly the misreading
 *  this wave exists to prevent, so the grouping is not cosmetic. Deliberately not
 *  `toLocaleString`: that would require a Number, and no money value in this tree
 *  is allowed to pass through one. */
function grouped(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ",";
  }
  return out;
}

/** The four labelled figures, as label/value pairs, in a fixed order. Exported
 *  so a UI renders exactly the same set the refusal sentence names — a screen and
 *  a sentence that disagree about which figures exist is the defect this wave is
 *  fixing, so there is ONE list. */
export function spvCapSplitRows(
  figures: SpvCapSplitFigures,
  exponent: number,
): Array<{ key: string; label: string; value: string }> {
  const fmt = (m: number | null) => formatSpvSplitMinor(m, exponent, figures.currency);
  return [
    {
      key: "cap",
      label: "Cap (maximum this vehicle may accept)",
      value: figures.capMinor == null ? SPV_CAP_BLANK_LABEL : fmt(figures.capMinor),
    },
    {
      key: "confirmedCapital",
      label: "Confirmed capital (committed subscriptions only)",
      value: fmt(figures.confirmedCapitalMinor),
    },
    {
      key: "softCircledInterest",
      label: "Soft-circled interest (soft-circled, GP-confirmed or under review)",
      value: fmt(figures.softCircledInterestMinor),
    },
    {
      key: "wiredNotCommitted",
      label: "Funds received, not yet committed",
      value: fmt(figures.wiredNotCommittedMinor),
    },
    {
      key: "overage",
      label: "Overage above the cap",
      value: fmt(figures.overageMinor),
    },
  ];
}

/**
 * THE REFUSAL SENTENCE. A plain sentence naming the cap, confirmed capital,
 * soft-circled interest, funds received and the overage SEPARATELY, plus the
 * next step. No bare code, no total without its parts.
 *
 * Long by design: it is delivered as `guidance`. The short form that survives
 * `queryClient.ts`'s 240-character `looksHuman` gate is
 * `spvCapSplitRefusalHeadline` below.
 */
export function spvCapSplitRefusalSentence(
  figures: SpvCapSplitFigures,
  exponent: number,
): string {
  const fmt = (m: number | null) => formatSpvSplitMinor(m, exponent, figures.currency);
  const capText = figures.capMinor == null ? SPV_CAP_BLANK_LABEL : fmt(figures.capMinor);
  return (
    `This subscription was not accepted because it would take the vehicle past its cap. ` +
    `The cap is ${capText}. Of what the vehicle already holds, ` +
    `${fmt(figures.confirmedCapitalMinor)} is confirmed capital — subscriptions that reached ` +
    `committed — and ${fmt(figures.softCircledInterestMinor)} is soft-circled interest, which is ` +
    `soft-circled, GP-confirmed or under-review subscriptions and is NOT capital, though it does ` +
    `occupy capacity in the vehicle. A further ${fmt(figures.wiredNotCommittedMinor)} has been ` +
    `received as funds without a committed subscription. Adding ${fmt(figures.requestedMinor)} ` +
    `would bring the total occupying capacity to ${fmt(figures.resultingTotalMinor)}, which is ` +
    `${fmt(figures.overageMinor)} above the cap. Next step: reduce this subscription by at least ` +
    `${fmt(figures.overageMinor)}, withdraw or reduce a pre-commitment indication to free capacity, ` +
    `or raise the cap on the vehicle before subscribing again. Nothing was saved.`
  );
}

/** The boundary-safe headline. Still names the cap, the resulting total and the
 *  overage, and still says what to do — it is written short, never truncated.
 *
 *  ── WAVE 198 · ITEM C · R166.2 — "WRITTEN SHORT" WAS AN ASSUMPTION, AND IT IS
 *  MEASURABLY WRONG AT THE BOUNDARY. The fixed prose is 139 characters and there
 *  are FOUR interpolated money fragments. Each carries the vehicle's RECORDED
 *  currency code, and wave 198's Item A established that the code is an
 *  unvalidated database string — a vehicle whose currency column holds a phrase
 *  rather than a three-letter code is a shape the platform accepts. Four
 *  24-character fragments already reach 235 characters, five short of the client's
 *  gate; four 40-character fragments reach 299 and the refusal disappears. That is
 *  a cap breach going unreported to the person subscribing over the cap.
 *
 *  The prose is byte-unchanged (R143.1). The four figures are the SUBSTANCE of the
 *  refusal, so the first rung is deliberately wide at 40 characters — every
 *  ordinary formatted amount (about 17) renders exactly as it does today, and only
 *  a pathological currency string is tightened. */
export function spvCapSplitRefusalHeadline(
  figures: SpvCapSplitFigures,
  exponent: number,
): string {
  const fmt = (m: number | null) => formatSpvSplitMinor(m, exponent, figures.currency);
  const capText = figures.capMinor == null ? SPV_CAP_BLANK_LABEL : fmt(figures.capMinor);
  return fitToGate(
    (b) =>
      `Not accepted: this would put the vehicle ${boundedFragment(fmt(figures.overageMinor), b)} over its cap of ` +
      `${boundedFragment(capText, b)}. Confirmed capital ${boundedFragment(fmt(figures.confirmedCapitalMinor), b)}, soft-circled interest ` +
      `${boundedFragment(fmt(figures.softCircledInterestMinor), b)}. Reduce the amount or free capacity.`,
    [40, 24, 16, 8, 0],
  );
}

/** R130 — the TARGET-raise warning. Warns, records, and says plainly that
 *  nothing was blocked. Never a refusal, so it never says "not accepted". */
export function spvTargetRaiseWarningSentence(
  figures: SpvCapSplitFigures & { targetRaiseMinor: number },
  exponent: number,
): string {
  const fmt = (m: number | null) => formatSpvSplitMinor(m, exponent, figures.currency);
  const targetOverage = Math.max(0, figures.resultingTotalMinor - figures.targetRaiseMinor);
  return (
    `This vehicle has passed its target raise. The target raise is ${fmt(figures.targetRaiseMinor)} ` +
    `— the fundraising goal for this vehicle, not a limit. Confirmed capital is ` +
    `${fmt(figures.confirmedCapitalMinor)}, soft-circled interest is ` +
    `${fmt(figures.softCircledInterestMinor)}, and funds received without a committed subscription ` +
    `are ${fmt(figures.wiredNotCommittedMinor)}, bringing the total to ` +
    `${fmt(figures.resultingTotalMinor)}, which is ${fmt(targetOverage)} above the target. ` +
    `${SPV_TARGET_EXCEEDED_IS_NOT_A_REFUSAL} ` +
    (figures.capMinor == null
      ? `This vehicle has ${SPV_CAP_BLANK_LABEL}, so there is no cap to breach.`
      : `The cap, which IS a maximum, is ${fmt(figures.capMinor)} and has not been changed.`)
  );
}

/** The durable target-overage record. Carries the same five-part split as a cap
 *  override so the two records can be read side by side, plus the target and the
 *  reason code, and an explicit `blocked: false` so no reader can infer that a
 *  goal being beaten stopped anything. */
export interface SpvTargetOverageRecord {
  reasonCode: typeof TARGET_RAISE_EXCEEDED_CODE;
  investorId: string;
  targetRaiseMinor: number;
  capMinor: number | null;
  confirmedCapitalMinor: number;
  softCircledInterestMinor: number;
  wiredNotCommittedMinor: number;
  resultingTotalMinor: number;
  targetOverageMinor: number;
  currency: string;
  writer: string;
  actor: string;
  blocked: false;
  recordedAt: string;
}
