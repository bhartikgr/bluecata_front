/**
 * Cap-table view computation.
 *
 * ── WAVE 71 · D3 — THIS HEADER DESCRIBED BEHAVIOUR THE PIPELINE DOES NOT HAVE ──
 * The previous text read, for Fully Diluted: "count all options + warrants
 * (vested + unvested) + reserved pool + SAFEs/notes (estimated at their cap or
 * current PPS)". EXECUTED: adding a $2,000,000 SAFE to an 8,000,000-share company
 * with a 1,000,000-share pool leaves the fully-diluted view BYTE-IDENTICAL at
 * 9,000,000 shares and two rows. `computeCapTable` calls `computeView` with
 * `estimatedPps: undefined` (`compute.ts`, the `rows` computation), and
 * `estimateConvertibleShares` returns `0n` immediately when `estPps` is absent —
 * so the SAFE/note clause described a code path the primary pipeline never takes.
 * A comment asserting behaviour that does not exist is a dead promise (R44: the
 * comment was FALSE, which is what justifies replacing it rather than preserving
 * it), and the SCREEN's own `DENOMINATOR_DEFINITION` text
 * (`client/src/pages/founder/CapTable.tsx`) was already correct and already stated
 * the exclusion. So the comment was the only thing wrong. It now says what the
 * code does, and says WHERE the converted figures actually come from.
 *
 * Basic         — common + preferred only. Options, SAFEs, notes and warrants are
 *                 excluded entirely.
 * Fully Diluted — common + preferred + ALL option-plan shares (granted and
 *                 unallocated alike — see D5b/B-8, they are one figure in the data
 *                 model) + warrants' underlying shares. **UNCONVERTED SAFEs AND
 *                 NOTES ARE EXCLUDED.** They are excluded because there is no
 *                 conversion price until a round is priced, and Capavate will not
 *                 substitute one. Carta and Wilson Sonsini include an estimate
 *                 here; the departure is deliberate and is disclosed on screen.
 * As Converted  — identical to Fully Diluted for the rows this function can see.
 *                 The As-Converted figures a founder is shown are produced by
 *                 running the REAL conversion (`convertSafeToPreferred` /
 *                 `convertNoteToPreferred`) through `runEngine` in
 *                 `shared/roundMathEngineAdapter.ts` (Wave 70 · D4: as-converted
 *                 is ONE engine computation, and a company with convertibles and
 *                 no priced round REFUSES rather than assuming $1.00 per share).
 *
 * `estimatedPps` / `estimatedCompanyCap` and `estimateConvertibleShares` below are
 * the OPTIONAL estimation path. It is live for any caller that supplies a price;
 * the primary pipeline deliberately does not, per the paragraph above.
 */
import type { Security, View, CapTableHolderRow, Holder } from "../types.js";
import { D, Decimal } from "../primitives/bigDecimal.js";
import { decimalToShares } from "../primitives/shareCount.js";

export type ViewComputeInput = {
  view: View;
  securities: Security[];
  holders: Holder[];
  // Used by FD/AC views to estimate SAFE/note shares
  estimatedPps?: string;
  estimatedCompanyCap?: bigint;
};

export function computeView(input: ViewComputeInput): CapTableHolderRow[] {
  const holderById = new Map(input.holders.map((h) => [h.id, h]));

  const visible: { sec: Security; shares: bigint }[] = [];

  for (const sec of input.securities) {
    if (input.view === "basic") {
      if (sec.kind === "common" || sec.kind === "preferred") {
        if (sec.shares !== undefined) visible.push({ sec, shares: sec.shares });
      }
      continue;
    }

    if (sec.kind === "common" || sec.kind === "preferred") {
      if (sec.shares !== undefined) visible.push({ sec, shares: sec.shares });
    } else if (sec.kind === "option") {
      if (sec.option) visible.push({ sec, shares: sec.option.grantedShares });
    } else if (sec.kind === "warrant") {
      if (sec.warrant) visible.push({ sec, shares: sec.warrant.underlyingShares });
    } else if (sec.kind === "safe" || sec.kind === "note") {
      // Estimate share count
      if (input.view === "fully_diluted" || input.view === "as_converted") {
        const est = estimateConvertibleShares(sec, input.estimatedPps, input.estimatedCompanyCap);
        if (est > 0n) visible.push({ sec, shares: est });
      }
    }
  }

  const total = visible.reduce<bigint>((s, v) => s + v.shares, 0n);
  const totalDec = D(total.toString());

  return visible.map((v) => {
    const h = holderById.get(v.sec.holderId);
    /* ── WAVE 71 · D18 — 0 / 0 IS UNDEFINED AND IS RETURNED AS SUCH ───────────
       This line read `total === 0n ? D(0) : …`, so a zero-share holder on a
       zero-share cap table was told, in a string, that they own `0`. R47: "a
       percentage of zero shares is undefined, not zero." The `—` a founder sees
       on `/founder/captable` today comes from the client's own
       `totalSharesNum > 0` gate, not from here, so every other consumer of this
       function received a confident `"0"`. `null` is now returned instead: it
       cannot be summed by accident, it cannot be formatted as `0.00%` by
       accident, and it crosses JSON as `null`. See `types.ts` for the contract. */
    const ownershipUndefined = total === 0n;
    const ownership: Decimal | null = ownershipUndefined ? null : D(v.shares.toString()).div(totalDec);
    return {
      holderId: v.sec.holderId,
      holderName: h?.name ?? v.sec.holderId,
      holderType: h?.type ?? "other",
      kind: v.sec.kind,
      series: v.sec.series,
      shares: v.shares,
      ownershipPercent: ownership === null ? null : ownership.mul(100).toFixed(),
      invested: v.sec.investmentAmount,
      currency: v.sec.currency,
    };
  });
}

/**
 * The OPTIONAL convertible-estimation path (WAVE 71 · D3).
 *
 * NOT dead code, and not the primary pipeline either. It is a complete function
 * that returns `0n` unless BOTH `estPps` and `estCap` are supplied, and
 * `computeCapTable` deliberately supplies neither (it passes
 * `estimatedPps: undefined`). Exported so that its reachability is a caller's
 * decision rather than a fact hidden inside this module, and so a test can
 * exercise both poles.
 *
 * WHY THE PRIMARY PIPELINE DOES NOT USE IT: it picks the LOWEST of {round price,
 * cap-implied price, discount price} using a PRE-money cap denominator, whereas
 * the real conversion (`safeToPreferred.ts`) re-bases a post-money SAFE's cap
 * against the post-SAFE capitalisation. The two disagree — that was finding D4,
 * measured at 2,500,000 vs 2,250,000 shares on one SAFE — and Wave 70 resolved it
 * by making the real conversion the single authority. Any caller that supplies a
 * price here is asking for the ESTIMATE, and must say so on screen.
 */
export function estimateConvertibleShares(
  sec: Security,
  estPps?: string,
  estCap?: bigint,
): bigint {
  if (!estPps || !estCap) return 0n;
  const pps = D(estPps);
  const capCap = D(estCap.toString());
  if (sec.kind === "safe" && sec.safe) {
    const purchase = D(sec.investmentAmount ?? "0");
    const cap = sec.safe.cap ? D(sec.safe.cap) : null;
    const discount = sec.safe.discount ? D(sec.safe.discount) : D(0);
    const discountPrice = pps.mul(D(1).minus(discount));
    const capPrice = cap ? cap.div(capCap) : null;
    const candidates = [pps];
    if (capPrice) candidates.push(capPrice);
    if (discount.gt(0)) candidates.push(discountPrice);
    let chosen = candidates[0];
    for (const c of candidates) if (c.lt(chosen)) chosen = c;
    return decimalToShares(purchase.div(chosen), "floor");
  }
  if (sec.kind === "note" && sec.note) {
    const principal = D(sec.note.principal);
    const cap = sec.note.cap ? D(sec.note.cap) : null;
    const discount = sec.note.discount ? D(sec.note.discount) : D(0);
    const discountPrice = pps.mul(D(1).minus(discount));
    const capPrice = cap ? cap.div(capCap) : null;
    const candidates = [pps];
    if (capPrice) candidates.push(capPrice);
    if (discount.gt(0)) candidates.push(discountPrice);
    let chosen = candidates[0];
    for (const c of candidates) if (c.lt(chosen)) chosen = c;
    return decimalToShares(principal.div(chosen), "floor");
  }
  return 0n;
}
