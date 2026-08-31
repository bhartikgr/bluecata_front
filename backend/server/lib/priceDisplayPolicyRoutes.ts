// server/lib/priceDisplayPolicyRoutes.ts
//
// WAVE 199 · ITEM B · R173.6 — "there really should not be a displayed as monthly",
// and "these are ALL 100% dynamic from the admin area".
//
// THE OWNER'S WORDS
//   "In the admin area, I did not intend to set a monthly price. The platform is
//    annual and/or fixed only. Therefore there really should not be a displayed as
//    monthly. These are ALL 100% dynamic from the admin area and dynamically
//    updated/displayed in the frontend."
//
// WHAT THIS FILE IS, IN ONE SENTENCE
//   A READ-ONLY door onto the billing-period offer the admin already controls, open
//   to any authenticated persona, so that a frontend surface can stop hardcoding the
//   assumption that monthly is something worth showing.
//
// WHY IT HAD TO EXIST AT ALL
//   Wave 188 shipped the whole mechanism: `partner_pricing_model_config` holds
//   `monthly_purchasable` / `annual_purchasable` / `forbid_x12_derivation`, the shipped
//   row is already monthly=0 annual=1, `readBillingPeriodOffer()` reads it, an admin
//   writer sets it, and Admin → Fees shows the switches. What wave 188 did NOT do was
//   let anyone but an admin read it: the only reader was
//   `GET /api/admin/billing-period-offer` (server/lib/partnerFeeAdminRoutes.ts). So
//   every monthly figure on every founder, partner and Collective surface rendered
//   regardless of what the admin had decided — the admin setting was real and the
//   frontend could not see it. That gap, not the absence of a policy, is the R173.6
//   defect.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   - It does NOT write. There is no PUT here; the writer stays admin-only in
//     partnerFeeAdminRoutes.ts, where it is attributed to a named actor.
//   - It does NOT delete, disable or un-price monthly. Monthly stays fully
//     implemented in the stores that derive it, in the schema columns that hold it and
//     in the admin controls that manage it. This endpoint only reports whether the
//     admin currently OFFERS it.
//   - It does NOT decide any charge. Nothing here is consulted by
//     resolveChargeTier(), assertTierPurchasable(), partnerBillingStore.ts or any
//     subscription path. It is a display fact, exactly like the wave-188 module it
//     reads (see that file's header for the same fence).
//   - It hardcodes no price, no currency and no cadence (R156.2). Every field is the
//     row's own value; the only literals here are JSON key names.
//   - It derives nothing. `forbidX12Derivation` is passed through so a client can be
//     told NOT to divide an annual figure by twelve; this file never divides anything
//     (R156.1 / R156.2).
//
// FAIL-CLOSED
//   A read failure answers 200 with `monthlyDisplayAllowed: false` and names the
//   failure in `unavailableReason`. Two reasons. First, the fail-closed answer is the
//   shipped state of the row anyway (monthly not offered), so this cannot invent a
//   policy the admin did not set. Second, a 500 here would make a *pricing screen*
//   fail because a *display policy* was unreadable, and the annual price on those
//   screens is fine — hiding the monthly extras is the safe degradation, blanking the
//   page is not.
//
// RULING: R173.6, R156.2, R159.3 (display ≠ charge), R3.

import type { Express, Request, Response } from "express";
import { readBillingPeriodOffer } from "./partnerFeeAdminDisplayPolicy";
/* WAVE 202 · ITEM A · R178.1 — "the admin area pricing section should allow me to
 * choose between annual and/or monthly pricing. Whatever I choose should be
 * dynamically displayed in the frontend."
 *
 * WAVE 199 IS NOT DELETED, IT IS MADE CONFIGURABLE. Everything above stays exactly
 * as it was: the fail-closed reader below is still the mechanism, and the global
 * `partner_pricing_model_config` answer it produces is still what this endpoint
 * reports at the top level. What is ADDED is a per-price layer, because R178.1 asks
 * for the period to be the owner's choice PER PRICE rather than one platform rule.
 *
 * The DTO is EXTENDED, never narrowed: every field wave 199 shipped keeps its name,
 * its type and its value, so no existing consumer or test changes meaning. A caller
 * that asks about a specific price gets the owner's choice for that price; a caller
 * that does not gets the platform-wide answer, unchanged.
 *
 * `price_period_offer` ships with ZERO rows, so on the day this lands every scope
 * resolves to the platform-wide answer and no screen behaves differently. Monthly
 * cannot re-appear until the owner deliberately chooses it. */
import {
  resolvePricePeriodOffer,
  listPricePeriodOffers,
  type PricePeriodOffer,
} from "./pricePeriodOffer";

export interface PriceDisplayPolicyDto {
  /** May a surface print a monthly price figure or offer a monthly cadence? */
  monthlyDisplayAllowed: boolean;
  annualOffered: boolean;
  monthlyOffered: boolean;
  /** 'flat_annual' | 'tiered', straight from the admin row. */
  model: string;
  /** True when a client must not divide an annual figure by twelve. */
  forbidX12Derivation: boolean;
  updatedAt: string | null;
  /** Set only when the policy could not be read; null on the happy path. */
  unavailableReason: string | null;
  /**
   * WAVE 202 · R178.1 — every per-price choice the owner has actually recorded.
   *
   * ADDITIVE. An empty array means he has made no per-price choice, which is the
   * shipped state, and every surface then uses the platform-wide fields above. A
   * surface that wants the answer for ONE price reads it from here and falls back to
   * `monthlyDisplayAllowed` when its scope is absent — which is precisely what
   * `resolvePricePeriodOffer()` does server-side, so client and server can never
   * disagree.
   */
  scopes: PricePeriodOffer[];
}

/**
 * The one place that turns the admin's offer row into the display verdict.
 *
 * `monthlyDisplayAllowed` is deliberately NOT a second setting. It IS
 * `monthlyOffered` — what the platform sells is what the platform may advertise.
 * Giving display its own switch would let the two drift, and a screen advertising a
 * cadence checkout refuses is precisely the confusion R173.6 was raised about.
 */
export function readPriceDisplayPolicy(): PriceDisplayPolicyDto {
  /* WAVE 202 — read OUTSIDE the try below, and fail-soft to an empty list, so that
     an unreadable per-price table can never turn wave 199's working platform-wide
     answer into the fail-closed one. An empty list means "no per-price choice",
     which resolves every scope to the platform-wide answer. */
  let scopes: PricePeriodOffer[] = [];
  try {
    scopes = listPricePeriodOffers();
  } catch {
    scopes = [];
  }
  try {
    const offer = readBillingPeriodOffer();
    return {
      monthlyDisplayAllowed: offer.monthlyOffered,
      annualOffered: offer.annualOffered,
      monthlyOffered: offer.monthlyOffered,
      model: offer.model,
      forbidX12Derivation: offer.forbidX12Derivation,
      updatedAt: offer.updatedAt,
      unavailableReason: null,
      scopes,
    };
  } catch {
    return {
      monthlyDisplayAllowed: false,
      annualOffered: true,
      monthlyOffered: false,
      model: "flat_annual",
      forbidX12Derivation: true,
      updatedAt: null,
      scopes,
      unavailableReason:
        "The billing-period policy could not be read on this request, so monthly figures are not being shown. Annual and fixed prices are unaffected. An administrator sets this in Admin → Fees.",
    };
  }
}

export function registerPriceDisplayPolicyRoutes(app: Express): void {
  /* Open to any authenticated persona, for the same reason
     GET /api/collective/member-tier is: the surfaces that must obey the policy
     include ones a prospective buyer sees before they belong to anything. It
     exposes no figure, no identity and no partner-specific fact — three booleans, a
     model name and a timestamp the admin themselves set. */
  app.get("/api/price-display-policy", (_req: Request, res: Response) => {
    res.json({ ok: true, policy: readPriceDisplayPolicy() });
  });

  /* WAVE 202 · ITEM A · R178.1 — THE SAME READ, NARROWED TO ONE PRICE.
     ADDED beside the route above, never replacing it: the four surfaces wave 199
     gated read the platform-wide answer and must keep working byte-for-byte. A scope
     with no recorded choice answers with the platform-wide values, so this route can
     never be MORE permissive than wave 199 was. Read-only — the writer stays
     admin-only in pricePeriodOfferAdminRoutes.ts, attributed to a named actor. */
  app.get("/api/price-display-policy/scope/:scopeKey", (req: Request, res: Response) => {
    const scopeKey = String(req.params.scopeKey ?? "");
    res.json({ ok: true, offer: resolvePricePeriodOffer(scopeKey) });
  });
}
