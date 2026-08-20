/**
 * WAVE 52b — INVARIANT I-1's INDEPENDENT SIDE.
 *
 * §11.4.5 I-1: "`T` from transaction conservation equals `T` from rendered rows.
 * `T_conserved = opening + Σ issues + Σ conversions − Σ cancellations`, with
 * transfers netting to zero, ASSEMBLED IN A MODULE THAT DOES NOT IMPORT
 * `computeView`. … the two sides are built from different data (event stream vs
 * render rows), so an omitted row breaks equality."
 *
 * THIS MODULE IMPORTS NOTHING FROM THE ENGINE. Not `compute.ts`, not
 * `computeView`, not `currentFullyDilutedShares`, not the `Decimal` wrapper, not
 * `types.ts`. It walks a transaction list with `bigint` and its own local shapes.
 * That is the whole point: if it imported the engine's own reducer, both sides
 * would share the engine's bug and would agree perfectly, which is exactly the
 * tautology §11.4.5 withdrew `Σ holder_shares == T` for.
 *
 * WHY `bigint` AND NOT `Decimal`. §11.4.6 item 3 requires a different numeric
 * representation from production. Shares are integers; a share count that needs
 * a decimal library is a share count that has already gone wrong.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not derive a price, a conversion
 * share count or a pool top-up. Those are the engine's outputs, and taking them
 * as INPUTS (rather than recomputing them) is what makes this an independent
 * conservation check on the event stream rather than a second implementation that
 * could be wrong in the same direction. Only raw business inputs plus the
 * engine's own emitted issue/conversion EVENTS are consumed — §11.4.6 item 2.
 */

/** One share-moving event, in the vocabulary of conservation rather than of a view. */
export type ConservationEvent =
  | { kind: "issue"; holderId: string; securityId: string; shares: bigint; dilutive: boolean }
  | { kind: "conversion"; holderId: string; fromSecurityId: string; toSecurityId: string; shares: bigint }
  | { kind: "cancellation"; holderId: string; securityId: string; shares: bigint }
  | { kind: "transfer"; fromHolderId: string; toHolderId: string; securityId: string; shares: bigint };

export interface ConservationResult {
  /** opening + Σ issues + Σ conversions − Σ cancellations. */
  totalShares: bigint;
  opening: bigint;
  issued: bigint;
  converted: bigint;
  cancelled: bigint;
  /** Must be exactly 0n: a transfer moves a holding, it does not create one. */
  transferNet: bigint;
  /** holderId → shares, so I-2 can compare SETS and not only sums. */
  byHolder: Map<string, bigint>;
  /** securityId → shares, the element-wise set I-2 compares. */
  bySecurity: Map<string, bigint>;
}

/**
 * `T_conserved`. Every branch is explicit; there is no default case that silently
 * ignores an event kind it does not recognise, because an ignored event is a lost
 * share.
 */
export function conserve(
  events: readonly ConservationEvent[],
  opening: bigint = BigInt(0),
): ConservationResult {
  let issued = BigInt(0);
  let converted = BigInt(0);
  let cancelled = BigInt(0);
  let transferNet = BigInt(0);
  const byHolder = new Map<string, bigint>();
  const bySecurity = new Map<string, bigint>();

  const bump = (m: Map<string, bigint>, k: string, d: bigint) =>
    m.set(k, (m.get(k) ?? BigInt(0)) + d);

  for (const e of events) {
    switch (e.kind) {
      case "issue":
        issued += e.shares;
        bump(byHolder, e.holderId, e.shares);
        bump(bySecurity, e.securityId, e.shares);
        break;
      case "conversion":
        /* A conversion RETIRES the instrument and ISSUES shares. The retired
           instrument carried no share count of its own (a SAFE is a promise, not
           a holding), so conservation counts only the issued side — and that is
           precisely why an omitted conversion event breaks the equality rather
           than cancelling itself out. */
        converted += e.shares;
        bump(byHolder, e.holderId, e.shares);
        bump(bySecurity, e.toSecurityId, e.shares);
        bump(bySecurity, e.fromSecurityId, BigInt(0));
        break;
      case "cancellation":
        cancelled += e.shares;
        bump(byHolder, e.holderId, -e.shares);
        bump(bySecurity, e.securityId, -e.shares);
        break;
      case "transfer":
        transferNet += BigInt(0);
        bump(byHolder, e.fromHolderId, -e.shares);
        bump(byHolder, e.toHolderId, e.shares);
        break;
      default: {
        const never: never = e;
        throw new Error(`unhandled conservation event: ${JSON.stringify(never)}`);
      }
    }
  }

  return {
    totalShares: opening + issued + converted - cancelled,
    opening,
    issued,
    converted,
    cancelled,
    transferNet,
    byHolder,
    bySecurity,
  };
}

/**
 * INVARIANT I-2's comparator. SET EQUALITY, element-wise — not sum equality.
 *
 * "a missing class fails even though percentages still sum to 100%." A sum
 * comparison cannot see a removed unallocated-pool row when the total is reduced
 * from the same rows; a set comparison can, and names it.
 */
export function compareSecuritySets(
  expected: Map<string, bigint>,
  rendered: Map<string, bigint>,
): { equal: boolean; missing: string[]; unexpected: string[]; differing: Array<{ id: string; expected: string; rendered: string }> } {
  const missing: string[] = [];
  const unexpected: string[] = [];
  const differing: Array<{ id: string; expected: string; rendered: string }> = [];

  for (const [id, shares] of expected) {
    if (!rendered.has(id)) {
      missing.push(id);
      continue;
    }
    const got = rendered.get(id)!;
    if (got !== shares) differing.push({ id, expected: shares.toString(), rendered: got.toString() });
  }
  for (const id of rendered.keys()) if (!expected.has(id)) unexpected.push(id);

  missing.sort();
  unexpected.sort();
  differing.sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    equal: missing.length === 0 && unexpected.length === 0 && differing.length === 0,
    missing,
    unexpected,
    differing,
  };
}
