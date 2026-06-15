/**
 * MFN (Most Favored Nation) resolution.
 *
 * If a SAFE has the MFN provision, before its conversion at a priced round we
 * check every SAFE issued AFTER it but before the priced round. If any later
 * SAFE has more favorable terms (lower cap, higher discount), the earlier MFN
 * SAFE adopts those terms.
 *
 * Reference: YC SAFE primer §"Most Favored Nation".
 */
import type { Security } from "../types.js";
import { D } from "../primitives/bigDecimal.js";

export type MfnContext = {
  candidates: Security[];   // SAFEs issued in date order, all before the priced round
};

/** Return a virtual SAFE record reflecting MFN-resolved terms for `s`. */
export function applyMfn(s: Security, ctx: MfnContext): Security {
  if (!s.safe || !s.safe.mfn) return s;

  const idx = ctx.candidates.findIndex((c) => c.id === s.id);
  const later = idx >= 0 ? ctx.candidates.slice(idx + 1) : [];

  let bestCap = s.safe.cap ? D(s.safe.cap) : null;
  let bestDiscount = s.safe.discount ? D(s.safe.discount) : D(0);
  let bestType = s.safe.type;

  for (const other of later) {
    if (!other.safe) continue;
    if (other.safe.cap) {
      const c = D(other.safe.cap);
      if (!bestCap || c.lt(bestCap)) {
        bestCap = c;
        bestType = other.safe.type;
      }
    }
    if (other.safe.discount) {
      const d = D(other.safe.discount);
      if (d.gt(bestDiscount)) bestDiscount = d;
    }
  }

  return {
    ...s,
    safe: {
      ...s.safe,
      type: bestType,
      cap: bestCap ? bestCap.toFixed() : undefined,
      discount: bestDiscount.gt(0) ? bestDiscount.toFixed() : undefined,
    },
  };
}
