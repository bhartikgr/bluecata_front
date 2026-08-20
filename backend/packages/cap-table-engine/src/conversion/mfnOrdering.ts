/**
 * MFN (Most Favored Nation) resolution.
 *
 * If a SAFE has the MFN provision, before its conversion at a priced round we
 * check every SAFE issued AFTER it but before the priced round. If any later
 * SAFE has more favorable terms, the earlier MFN SAFE adopts THAT SAFE's terms.
 *
 * ── WAVE 71 · D13 — THE TERMS ARE ADOPTED AS A SET, FROM ONE INSTRUMENT ───────
 * THE DEFECT, measured. The previous implementation took the LOWEST cap and the
 * HIGHEST discount in two INDEPENDENT loops, and let the `type` follow the cap
 * donor. On the documented fixture — SAFE 1 at a $12,000,000 cap with NO discount
 * and MFN, SAFE 2 at an $8,000,000 cap with a 25% discount — it produced
 * `{ cap: "8000000", discount: "0.25" }`. That pairing is SAFE 2's, and on that
 * fixture the two agree; but the CONSTRUCTION was a best-of, and a best-of will
 * invent a pairing NEITHER instrument offered the moment three SAFEs exist (a
 * low cap from one and a high discount from another).
 *
 * WHY THAT IS WRONG AS A MATTER OF LAW, NOT OF OPTIMISATION. The MFN provision in
 * the Y Combinator SAFE (the "Most Favored Nation" variant, and clause 1(d) of
 * the standard forms) gives the holder the right to AMEND ITS SAFE TO INCLUDE THE
 * TERMS OF a subsequent convertible security — that is, to substitute another
 * instrument's terms as a package. It does not give the holder a right to compose
 * a new instrument out of the best clause of each. A cap and a discount are
 * negotiated against one another: a low cap is conceded BECAUSE there is no
 * discount, and vice versa. Splitting them creates a security no investor bought
 * and no company issued.
 *   Y Combinator, "Safe financing documents" and the accompanying user guide:
 *   https://www.ycombinator.com/documents
 *
 * HOW THE ONE SAFE IS CHOSEN. Every candidate — the holder's OWN terms included,
 * so MFN can never make a holder worse off — is priced with the same two-candidate
 * rule the real conversion uses (`min(cap-implied price, discounted round price)`)
 * and the candidate producing the LOWEST conversion price, i.e. the MOST shares,
 * wins. Its cap, its discount AND its cap convention are adopted together.
 *   · With a pricing context (`seriesPricePerShare` + `companyCapitalization`,
 *     which `compute.ts` now supplies at the conversion) that comparison is
 *     EXACT: it is the same arithmetic the conversion itself will perform.
 *   · WITHOUT a context, the fallback ranks candidates by cap alone, LOWEST cap
 *     first, and still adopts that ONE candidate's cap and discount together. It
 *     is a weaker rule; it is never a best-of. The absence of the context is
 *     stated in the return value rather than hidden.
 *
 * `safeCapType` / `type` TRAVELS WITH THE PAIR. Wave 70 made the cap convention
 * (`post_money_cap` / `pre_money_cap`) a stored, reachable term resolved by
 * `resolveSafeCapType`; adopting a cap without its convention would re-open D5 at
 * one remove, because the same cap means different share counts under the two.
 *
 * STILL AN OWNER / COUNSEL QUESTION, and it is recorded as one. Whether the
 * "most favourable" test is measured by conversion price (what this does) or by
 * some other yardstick is a legal reading of the holder's election right. What is
 * no longer in doubt is that the answer is ONE instrument's terms.
 */
import type { Security } from "../types.js";
import { D } from "../primitives/bigDecimal.js";

export type MfnContext = {
  candidates: Security[];   // SAFEs issued in date order, all before the priced round
  /* WAVE 71 · D13 — the round's solved price per share, as a decimal string.
     Supplied by `compute.ts` at the conversion, where it is known exactly.
     Absent = the cap-only fallback documented in the header. */
  seriesPricePerShare?: string;
  /* WAVE 71 · D13 — the company capitalisation the cap is divided by, i.e. the
     same denominator the conversion will use. Absent = the fallback. */
  companyCapitalization?: string;
};

/** Which instrument's terms an MFN election adopted, and how it was decided. */
export type MfnResolution = {
  readonly applied: boolean;
  /** The id of the SAFE whose terms were adopted. Equal to `s.id` when none was. */
  readonly adoptedFromSecurityId: string;
  /** `"conversion_price"` (exact) or `"lowest_cap_no_pricing_context"`. */
  readonly basis: "not_applicable" | "conversion_price" | "lowest_cap_no_pricing_context";
};

/** The candidate's effective conversion price, or `null` when it cannot be priced. */
function candidatePrice(
  sec: Security,
  seriesPricePerShare?: string,
  companyCapitalization?: string,
): ReturnType<typeof D> | null {
  if (!sec.safe) return null;
  if (!seriesPricePerShare || !companyCapitalization) return null;
  let pps: ReturnType<typeof D>;
  let cc: ReturnType<typeof D>;
  try {
    pps = D(seriesPricePerShare);
    cc = D(companyCapitalization);
  } catch {
    return null;
  }
  if (!pps.isFinite() || !pps.gt(0) || !cc.isFinite() || !cc.gt(0)) return null;
  /* The two candidate prices the real conversion compares, and nothing else. */
  const prices: ReturnType<typeof D>[] = [];
  if (sec.safe.cap) {
    try {
      const cap = D(sec.safe.cap);
      if (cap.isFinite() && cap.gt(0)) prices.push(cap.div(cc));
    } catch { /* an unreadable cap contributes no candidate price */ }
  }
  if (sec.safe.discount) {
    try {
      const d = D(sec.safe.discount);
      /* The engine wire is FRACTIONAL (R16): 0.2 is a 20% discount. A value
         outside [0,1) is REJECTED as a candidate, never rescaled. */
      if (d.isFinite() && d.gte(0) && d.lt(1)) prices.push(pps.mul(D(1).minus(d)));
    } catch { /* an unreadable discount contributes no candidate price */ }
  }
  if (prices.length === 0) return null;
  let lowest = prices[0];
  for (const p of prices) if (p.lt(lowest)) lowest = p;
  return lowest;
}

/**
 * Return a virtual SAFE record reflecting MFN-resolved terms for `s`, together
 * with WHICH instrument's terms were adopted.
 */
export function applyMfnResolved(s: Security, ctx: MfnContext): { security: Security; resolution: MfnResolution } {
  const notApplied: MfnResolution = { applied: false, adoptedFromSecurityId: s.id, basis: "not_applicable" };
  if (!s.safe || !s.safe.mfn) return { security: s, resolution: notApplied };

  const idx = ctx.candidates.findIndex((c) => c.id === s.id);
  const later = idx >= 0 ? ctx.candidates.slice(idx + 1) : [];
  /* The holder's OWN terms are always in the running, so an MFN election can
     never leave the holder worse off than the SAFE they actually signed. */
  const pool: Security[] = [s, ...later.filter((c) => !!c.safe)];

  const priced = ctx.seriesPricePerShare !== undefined && ctx.companyCapitalization !== undefined;

  let winner = s;
  let basis: MfnResolution["basis"] = priced ? "conversion_price" : "lowest_cap_no_pricing_context";

  if (priced) {
    let bestPrice = candidatePrice(s, ctx.seriesPricePerShare, ctx.companyCapitalization);
    for (const c of pool) {
      if (c.id === s.id) continue;
      const p = candidatePrice(c, ctx.seriesPricePerShare, ctx.companyCapitalization);
      if (p === null) continue;
      if (bestPrice === null || p.lt(bestPrice)) {
        bestPrice = p;
        winner = c;
      }
    }
    if (bestPrice === null) {
      /* Nothing in the pool could be priced. Fall back rather than guess, and say
         so in the returned basis so a caller can tell the two apart. */
      basis = "lowest_cap_no_pricing_context";
    }
  }

  if (basis === "lowest_cap_no_pricing_context") {
    let bestCap = s.safe.cap ? D(s.safe.cap) : null;
    winner = s;
    for (const c of pool) {
      if (c.id === s.id || !c.safe?.cap) continue;
      const cap = D(c.safe.cap);
      if (!bestCap || cap.lt(bestCap)) {
        bestCap = cap;
        winner = c;
      }
    }
  }

  if (winner.id === s.id || !winner.safe) {
    return { security: s, resolution: { applied: false, adoptedFromSecurityId: s.id, basis } };
  }

  return {
    security: {
      ...s,
      safe: {
        ...s.safe,
        /* ALL THREE TOGETHER — this is the whole fix. `type`, `cap` and
           `discount` come from ONE instrument, `winner`. A term the winner does
           not have is ABSENT on the resolved SAFE, not inherited from the loser:
           adopting SAFE 2's $8,000,000 cap and keeping SAFE 1's absence of a
           discount is exactly the composite this defect was about. */
        type: winner.safe.type,
        cap: winner.safe.cap,
        discount: winner.safe.discount,
      },
    },
    resolution: { applied: true, adoptedFromSecurityId: winner.id, basis },
  };
}

/** Return a virtual SAFE record reflecting MFN-resolved terms for `s`. */
export function applyMfn(s: Security, ctx: MfnContext): Security {
  return applyMfnResolved(s, ctx).security;
}
