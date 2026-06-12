/**
 * Convertible Note → Preferred conversion.
 *
 * Outstanding = Principal + Accrued Interest
 *   simple:    interest = principal × rate × yearsElapsed
 *   compounded:interest = principal × ((1 + rate)^yearsElapsed − 1)
 *
 * Conversion price = min(Discount Price, Cap Price, round PPS)
 *   Discount Price = Series PPS × (1 − discount)
 *   Cap Price      = Cap / Company Capitalization
 *
 * Note Shares = Outstanding / Conversion Price (floored to whole shares)
 *
 * References:
 *   - NVCA Convertible Note primer
 *   - Pulley convertible-note guide: https://pulley.com/guides/convertible-notes
 */
import { D, Decimal } from "../primitives/bigDecimal.js";
import { decimalToShares, type Shares } from "../primitives/shareCount.js";
import type { TraceStep, Region } from "../types.js";
import { hashFormulaDef } from "../primitives/hash.js";

export type NoteConversionInput = {
  principal: Decimal | string;
  interestRate: Decimal | string;       // annual rate, e.g. "0.06"
  interestKind: "simple" | "compounded";
  yearsElapsed: Decimal | string;
  cap?: Decimal | string;
  discount?: Decimal | string;
  seriesPricePerShare: Decimal | string;
  companyCapitalization: Decimal | string;
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
};

export type NoteConversionOutput = {
  outstanding: string;
  conversionPrice: string;
  noteShares: Shares;
  binding: "cap" | "discount" | "round_price";
  trace: TraceStep;
};

export function convertNoteToPreferred(input: NoteConversionInput): NoteConversionOutput {
  const principal = D(input.principal);
  const rate = D(input.interestRate);
  const years = D(input.yearsElapsed);
  let outstanding: Decimal;
  if (input.interestKind === "simple") {
    outstanding = principal.plus(principal.mul(rate).mul(years));
  } else {
    // compounded: P × (1 + r)^t
    const factor = D(1).plus(rate).pow(years);
    outstanding = principal.mul(factor);
  }

  const seriesPps = D(input.seriesPricePerShare);
  const discount = input.discount !== undefined ? D(input.discount) : D(0);
  const cap = input.cap !== undefined ? D(input.cap) : undefined;
  const capCap = D(input.companyCapitalization);

  const discountPrice = seriesPps.mul(D(1).minus(discount));
  const capPrice = cap && capCap.gt(0) ? cap.div(capCap) : null;

  const candidates: { price: Decimal; binding: "cap" | "discount" | "round_price" }[] = [
    { price: seriesPps, binding: "round_price" },
  ];
  if (capPrice) candidates.push({ price: capPrice, binding: "cap" });
  if (discount.gt(0)) candidates.push({ price: discountPrice, binding: "discount" });

  const rank: Record<string, number> = { cap: 0, discount: 1, round_price: 2 };
  candidates.sort((a, b) => {
    const c = a.price.cmp(b.price);
    if (c !== 0) return c;
    return rank[a.binding] - rank[b.binding];
  });
  const winner = candidates[0];
  const conversionPrice = winner.price;
  const sharesDec = outstanding.div(conversionPrice);
  const noteShares: Shares = decimalToShares(sharesDec);

  const extra: Record<string, string> = {};
  if (input.region === "CN") {
    extra.safe_circular_37_required = "true";
  }
  if (input.region === "IN") {
    // Indian convertible-note equivalent is the CCD (Compulsorily Convertible Debenture).
    extra.in_ccd_required = "true";
    extra.in_fema_filing_required = "true";
    extra.in_stamp_duty_applicable = "true";
  }
  if (input.region === "AU") {
    extra.au_corporations_act_filing = "true";
  }

  const trace: TraceStep = {
    formulaId: input.formulaId,
    formulaVersion: input.formulaVersion,
    region: input.region,
    inputs: {
      principal: principal.toFixed(),
      interestRate: rate.toFixed(),
      interestKind: input.interestKind,
      yearsElapsed: years.toFixed(),
      cap: cap ? cap.toFixed() : "",
      discount: discount.toFixed(),
      seriesPricePerShare: seriesPps.toFixed(),
      companyCapitalization: capCap.toFixed(),
    },
    outputs: {
      outstanding: outstanding.toFixed(),
      conversionPrice: conversionPrice.toFixed(),
      noteShares: noteShares.toString(),
      binding: winner.binding,
      ...extra,
    },
    defHash: hashFormulaDef(input.formulaDef),
  };

  return {
    outstanding: outstanding.toFixed(),
    conversionPrice: conversionPrice.toFixed(),
    noteShares,
    binding: winner.binding,
    trace,
  };
}
