/* ═══════════════════════════════════════════════════════════════════════════════
   WAVE 125 · FINDING 1 — "NO FOUNDER ROW ON RECORD" IS NOT "THE FOUNDER OWNS 0%".
   ═══════════════════════════════════════════════════════════════════════════════
   THE DEFECT THIS MODULE EXISTS TO CLOSE. On the live cap table for
   `BluePrint Catalyst Limited` — 150 total shares, one investor holding all 150,
   NO founder row at all — `/founder/captable` printed

       FOUNDER OWNERSHIP    0.00%
                            0 shares

   while `/founder/dashboard` printed `—` for the same quantity on the same data.
   Two screens, two answers, and the cap table's answer was a FABRICATION: the
   founder's holding is not on record, so the platform does not know it. A founder
   reading `0.00% · 0 shares` on his own cap table would reasonably conclude he had
   been wiped out.

   `server/lib/founderOwnershipEngine.ts:158-171` ALREADY gets this right — it
   returns `{ fraction: null, reason: "no_founder_holding_on_record" }` and its
   comment names this very screen. The renderers did not ask it. They summed an
   EMPTY founder set to `0n` (`CapTable.tsx:425` `sumByType("founder")`,
   `CapitalizationJourney.tsx:551` `sumOwnershipPercent([]) === 0`) and published
   the result as a confident number.

   This module is the engine's rule, restated once for the renderers, so that a
   refusal cannot be re-derived (or forgotten) a third time. It re-implements no
   arithmetic: it decides ONLY whether there is anything to publish.

   ── THE DISTINCTION THE WHOLE FIX TURNS ON ──────────────────────────────────
   Three states that all produce a founder share-sum of zero, and MUST NOT be
   rendered the same way:

     A. NO ROW ON RECORD, register populated.  rows exist, total > 0, no founder
        row.  → REFUSE. No percentage, no share count, and say why.
        (This is BluePrint Catalyst. It is what this wave fixes.)

     B. A ROW RECORDING ZERO.  a founder row exists whose `shares` is `0`.
        → PUBLISH `0.00%` and `0 shares`. That is a recorded fact.
        Pinned by `w61a_captable_zero_shares_percent`; it must stay green.

     C. AN EMPTY REGISTER.  no securities at all, total 0 shares.
        → UNCHANGED. `w61a_captable_zero_shares_percent` pins the existing
        treatment (`—` for the percentage, `0 shares` for the count, beside the
        screen's own "No securities recorded yet."), and the engine's own
        `zero_total_shares` refusal already covers the ratio. Nothing here
        contradicts a founder about a populated cap table, so this wave does not
        change it — widening the refusal into state C would have broken the very
        test that protects state B.

   The discriminator is therefore ROW PRESENCE, never the value of a sum. A sum
   cannot tell A from B; `rows.some(isFounderRow)` can.
   ══════════════════════════════════════════════════════════════════════════════ */

/** The only shape this module needs from an engine row. */
export type FounderHoldingRow = { holderType: string };

/** The engine's own reason code, re-exported so no renderer invents a second one.
 *  Source of truth: `server/lib/founderOwnershipEngine.ts:167`. */
export const NO_FOUNDER_HOLDING_ON_RECORD = "no_founder_holding_on_record" as const;

/** Plain English, in the platform's refusal house style ("Not shown — …"), naming
 *  the missing input and what the founder can do about it. Deliberately says
 *  nothing about how much anybody owns. */
export const FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT =
  "Not shown — this cap table records holdings, but no founder holding is on " +
  "record, so the founders' share is not known. It is not zero: add the founders' " +
  "shares to the cap table to see it.";

export type FounderHoldingVerdict = {
  /** `true` ⟺ state A above. When `true`, publish NEITHER a percentage NOR a
   *  share count for founders — show `statement` instead. */
  refuse: boolean;
  /** Present when, and only when, `refuse` is `true`. */
  statement: string | null;
  /** The engine's reason code when refusing; `null` otherwise. */
  reason: typeof NO_FOUNDER_HOLDING_ON_RECORD | null;
  /** How many founder rows are on record. `0` in states A and C. Exposed so a
   *  caller can tell A from C without re-deriving the rule. */
  founderRowCount: number;
};

const PUBLISHABLE: FounderHoldingVerdict = { refuse: false, statement: null, reason: null, founderRowCount: 0 };

/**
 * Decide whether a founder ownership figure may be published for a recorded set
 * of holdings.
 *
 * @param rows        the engine's rows for the view being rendered — NOT raw
 *                    securities. Empty means "nothing on record".
 * @param totalShares the engine's own denominator for the same view. Accepts the
 *                    `bigint` the cap table holds and the `number` the journey
 *                    holds; it is only ever compared against zero, so no money or
 *                    share arithmetic is performed on it and no coercion of a
 *                    monetary string occurs anywhere in this module.
 */
export function founderHoldingVerdict(
  rows: readonly FounderHoldingRow[] | null | undefined,
  totalShares: bigint | number,
): FounderHoldingVerdict {
  const list = rows ?? [];
  const founderRowCount = list.filter((r) => r.holderType === "founder").length;
  /* State B — a founder row is on record. Whatever it records, including zero,
     is a fact and is published. */
  if (founderRowCount > 0) return { ...PUBLISHABLE, founderRowCount };
  /* State C — nothing on record at all. Left exactly as it was; see the header. */
  const totalIsPositive = typeof totalShares === "bigint" ? totalShares > BigInt(0) : totalShares > 0;
  if (list.length === 0 || !totalIsPositive) return { ...PUBLISHABLE, founderRowCount: 0 };
  /* State A — the register is populated and no holding of it is a founder's. */
  return {
    refuse: true,
    statement: FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT,
    reason: NO_FOUNDER_HOLDING_ON_RECORD,
    founderRowCount: 0,
  };
}
