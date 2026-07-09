/* GROUP E (1b) — DISPLAY-ONLY agreement labelling.
 *
 * The stored/enforced agreement version id lives in
 * shared/consortiumAgreement.ts (CONSORTIUM_AGREEMENT_VERSION, currently
 * "CPA-v0.1-DRAFT"). That id is what the server stamps and what the sign
 * gate compares — it MUST NOT change, or already-signed partners would be
 * forced to re-sign.
 *
 * This module is purely cosmetic: it maps whatever internal version id the
 * server returns into a professional, human-facing label for the partner
 * agreement page. It never alters, parses-for-enforcement, or persists the
 * id. Callers keep passing the raw server id into the POST body.
 */

/** Professional public product name for the agreement (display only). */
export const AGREEMENT_DISPLAY_NAME = "Consortium Partner Agreement";

/** Public-facing version shown to partners (display only). */
export const AGREEMENT_DISPLAY_VERSION = "1.0";

/**
 * Human-facing label for the agreement, e.g.
 *   "Consortium Partner Agreement · Version 1.0"
 *
 * DISPLAY ONLY. The `storedVersion` argument (the internal server id such as
 * "CPA-v0.1-DRAFT") is accepted so callers can pass through the value they
 * already hold, but it does NOT change what is displayed and is NEVER used for
 * signing/enforcement here — that logic still compares the raw id upstream.
 */
export function displayAgreementLabel(_storedVersion?: string | null): string {
  return `${AGREEMENT_DISPLAY_NAME} · Version ${AGREEMENT_DISPLAY_VERSION}`;
}

/**
 * Short version token for compact placements, e.g. "Version 1.0".
 * DISPLAY ONLY — same guarantees as displayAgreementLabel().
 */
export function displayAgreementVersion(_storedVersion?: string | null): string {
  return `Version ${AGREEMENT_DISPLAY_VERSION}`;
}
