/**
 * SAFE → Preferred conversion.
 *
 * References:
 *   - YC SAFE (post-money) v1.2 user guide:
 *     https://www.ycombinator.com/documents
 *     https://www.ycombinator.com/blog/announcing-the-post-money-safe
 *     https://www.ycombinator.com/safe/safe_post_money_user_guide.pdf
 *   - YC SAFE (pre-money) primer (legacy):
 *     https://www.ycombinator.com/documents
 *
 * Post-money cap definition (per YC primer):
 *   Conversion Price = min(
 *     Discount Price = (Series A PPS) × (1 - Discount),
 *     SAFE Price (post-money) = Post-Money Valuation Cap / Company Capitalization (post-money)
 *   )
 *   SAFE Shares = Purchase Amount / Conversion Price
 *
 * Pre-money cap definition:
 *   SAFE Price (pre-money) = Pre-Money Valuation Cap / Company Capitalization (pre-money)
 *
 * MFN: if `mfn=true` and a later-issued SAFE has more favorable terms, MFN is resolved
 * before this routine is invoked (see mfnOrdering.ts).
 */
import { D, Decimal } from "../primitives/bigDecimal.js";
import { decimalToShares, type Shares } from "../primitives/shareCount.js";
import type { TraceStep, Region } from "../types.js";
import { hashFormulaDef } from "../primitives/hash.js";

export type SafeConversionInput = {
  purchaseAmount: Decimal | string;
  capType: "post_money_cap" | "pre_money_cap" | "uncapped" | "discount_only";
  cap?: Decimal | string;
  discount?: Decimal | string;
  seriesPricePerShare: Decimal | string;
  companyCapitalization: Decimal | string;
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
};

export type SafeConversionOutput = {
  conversionPrice: string;
  safeShares: Shares;
  binding: "cap" | "discount" | "round_price";
  trace: TraceStep;
};

export function convertSafeToPreferred(input: SafeConversionInput): SafeConversionOutput {
  const purchase = D(input.purchaseAmount);
  const seriesPps = D(input.seriesPricePerShare);
  const cap = input.cap !== undefined ? D(input.cap) : undefined;
  const discount = input.discount !== undefined ? D(input.discount) : D(0);
  const capCap = D(input.companyCapitalization);

  // Discount price
  const discountPrice = seriesPps.mul(D(1).minus(discount));

  // Cap price
  let capPrice: Decimal | null = null;
  if ((input.capType === "post_money_cap" || input.capType === "pre_money_cap") && cap && capCap.gt(0)) {
    capPrice = cap.div(capCap);
  }

  // Pick lowest price (most shares to investor). Tie-breaker: prefer cap > discount > round_price.
  const candidates: { price: Decimal; binding: "cap" | "discount" | "round_price" }[] = [
    { price: seriesPps, binding: "round_price" },
  ];
  if (capPrice) candidates.push({ price: capPrice, binding: "cap" });
  if (discount.gt(0)) candidates.push({ price: discountPrice, binding: "discount" });

  // Sort ascending by price; on tie, prefer cap > discount > round_price.
  const rank: Record<string, number> = { cap: 0, discount: 1, round_price: 2 };
  candidates.sort((a, b) => {
    const c = a.price.cmp(b.price);
    if (c !== 0) return c;
    return rank[a.binding] - rank[b.binding];
  });
  const winner = candidates[0];
  const conversionPrice = winner.price;

  const sharesDec = purchase.div(conversionPrice);
  const safeShares: Shares = decimalToShares(sharesDec);

  // Region-specific trace flags
  const note: Record<string, string> = {};
  if (input.region === "CN") {
    note.safe_circular_37_required = "true";
    note.samr_filing_required = "true";
  }
  if (input.region === "HK") {
    note.hk_no_capital_controls = "true";
  }
  if (input.region === "IN") {
    // CCPS structure mandatory (Companies Act 2013 §55) — pure-discretionary SAFEs forbidden.
    note.in_ccps_required = "true";
    // Cross-border subscriptions trigger FEMA Form FC-GPR within 30 days of allotment.
    note.in_fema_filing_required = "true";
    // Indian Stamp Act 1899 (uniform post-2020): 0.005% on issue.
    note.in_stamp_duty_applicable = "true";
    // §56(2)(viib) angel-tax exposure unless company is DPIIT-recognized (FA 2024 rationalized).
    note.in_dpiit_recognition_required = "true";
  }
  if (input.region === "JP") {
    // J-KISS template (Coral Capital open-source) is the AU-equivalent SAFE in Japan.
    note.jp_jkiss_template_used = "true";
    // Class shares (種類株式) Companies Act §107-108 must be designated in the articles.
    note.jp_class_shares_required = "true";
  }
  if (input.region === "AU") {
    // Form 484 lodgement with ASIC within 28 days of allotment (Corporations Act §254A).
    note.au_corporations_act_filing = "true";
  }

  const trace: TraceStep = {
    formulaId: input.formulaId,
    formulaVersion: input.formulaVersion,
    region: input.region,
    inputs: {
      purchaseAmount: purchase.toFixed(),
      capType: input.capType,
      cap: cap ? cap.toFixed() : "",
      discount: discount.toFixed(),
      seriesPricePerShare: seriesPps.toFixed(),
      companyCapitalization: capCap.toFixed(),
    },
    outputs: {
      conversionPrice: conversionPrice.toFixed(),
      safeShares: safeShares.toString(),
      binding: winner.binding,
      ...note,
    },
    defHash: hashFormulaDef(input.formulaDef),
  };

  return {
    conversionPrice: conversionPrice.toFixed(),
    safeShares,
    binding: winner.binding,
    trace,
  };
}
