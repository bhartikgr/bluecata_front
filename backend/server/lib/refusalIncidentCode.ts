/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 170 · R77 / R111 Q13 — THE TRACEABLE REFERENCE FOR A REFUSAL NOBODY
 * WROTE WORDS FOR.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS. `client/src/pages/partner/PartnerSpvDetail.tsx` renders the
 * failure of five GP actions (LP invite, LP commit, capital call, distribution,
 * add-to-CRM). When the refusal it receives HAS plain-language copy the GP now
 * reads a sentence — waves 162/164/166 attached those. When it does NOT, the
 * only honest thing to show is a plain sentence that names the next step, and
 * the next step is "quote this reference to support". Until this wave there was
 * no reference to quote.
 *
 * WHY IT IS A SHARED MODULE AND NOT A SECOND MECHANISM. Wave 148 established
 * this exact pattern for e-signature failures — `ESG-XXXXXXXX`, minted per
 * occurrence from crypto randomness, logged beside the internal code, returned
 * to the client as `incidentCode` (`server/lib/esignatureRoutes.ts`). Wave 170
 * needed the same token for the SPV refusal path. Copying the one-line minter
 * would have created a second authority for the format, so the format lives
 * here ONCE and wave 148's `mintEsignIncidentCode` delegates to it with prefix
 * `ESG`, producing a byte-identical shape for every existing consumer and test.
 *
 * WHY THE TOKEN IS SAFE TO RENDER (R77). It names no table, no column, no
 * internal code, no deployment and no user. It is 8 hex characters of
 * randomness behind a neutral prefix, so putting it in front of a paying client
 * discloses nothing about our internals — which is the whole reason it, and not
 * the internal code, is what the screen shows. The JOIN between the two is made
 * in the LOG, where R77 explicitly permits the internal identifier.
 *
 * WHAT THIS DOES NOT DO. It does not persist anything. A reference identifies
 * ONE throw at ONE moment through the log line written beside it; inventing a
 * durable incident table here would be a schema change no ruling asked for
 * (highest migration is 0210 and stays that way for this wave).
 */
import { randomBytes } from "crypto";

/** Prefixes in use. Neutral by construction — see the R77 note above. */
export type RefusalIncidentPrefix = "ESG" | "SPV";

/**
 * A fresh opaque reference, e.g. `SPV-1A2B3C4D`.
 *
 * 4 random bytes → 8 uppercase hex characters. Uppercase because a support
 * operator reads these off a screenshot and dictates them over a phone call.
 */
export function mintRefusalIncidentCode(prefix: RefusalIncidentPrefix): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** The shape every minted reference matches. Pinned by test, not by eye. */
export const REFUSAL_INCIDENT_CODE_PATTERN = /^(?:ESG|SPV)-[0-9A-F]{8}$/;
