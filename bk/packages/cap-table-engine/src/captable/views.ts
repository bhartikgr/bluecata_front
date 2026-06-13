/**
 * Cap-table view computation.
 *
 * Basic        — only common + preferred (ignore options/SAFEs/notes/warrants).
 * Fully Diluted — count all options + warrants (vested + unvested) + reserved pool +
 *                 SAFEs/notes (estimated at their cap or current PPS).
 * As Converted — convert SAFEs/notes/preferred to common at their conversion price.
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
    const ownership: Decimal = total === 0n ? D(0) : D(v.shares.toString()).div(totalDec);
    return {
      holderId: v.sec.holderId,
      holderName: h?.name ?? v.sec.holderId,
      holderType: h?.type ?? "other",
      kind: v.sec.kind,
      series: v.sec.series,
      shares: v.shares,
      ownershipPercent: ownership.mul(100).toFixed(),
      invested: v.sec.investmentAmount,
      currency: v.sec.currency,
    };
  });
}

function estimateConvertibleShares(
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
