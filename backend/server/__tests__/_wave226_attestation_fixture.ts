/**
 * WAVE 226 · R202 — THE OPERATOR ATTESTATION, AS A REAL OPERATOR SUPPLIES IT.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Wave 211 made a typed operator attestation MANDATORY on four money events:
 *
 *   A1  POST /api/partner/me/spv/:spvId/distributions      (record a distribution)
 *   A2  POST /api/partner/me/spvs/:id/capital-calls        (record a capital call)
 *   A3  POST /api/partner/me/spv/:spvId/lp-invites         (invite an LP)
 *   A4  POST /api/partner/me/spv/:spvId/lp-commit          (commit an LP to the cap table)
 *
 * 42 existing tests across 17 files drove those routes without an attestation and
 * were refused 400. Owner ruling R202: THE GATE STAYS; the tests are re-pointed to
 * supply a valid attestation. "A test proving the old behaviour still works is
 * proving the defect still works."
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is NOT a bypass and must never become one. Read the four properties below
 * before changing anything here:
 *
 *   1. It sets nothing but the SEVEN body keys the client is allowed to supply
 *      (`W211_CLIENT_SUPPLIABLE_KEYS`). Every other piece of evidence — the signed
 *      timestamp, the observed IP, the user agent, the text and its digest — is
 *      produced by the SERVER and is not client-supplied (R187.1).
 *   2. The key names are IMPORTED from the shared module both the client and the
 *      server import. They are not re-typed here. Wave 211 records that these keys
 *      were once spelled two different ways in two places and the mismatch would
 *      have refused every honest submission; restating them in a fixture would
 *      reintroduce exactly that risk.
 *   3. No environment flag is set, no gate is relaxed or narrowed, and nothing here
 *      writes to a store in place of a route. A test using this fixture still POSTs
 *      the same HTTP route a real operator's browser POSTs.
 *   4. The ticks are the BOOLEAN `true`. Never `1`, never the string `"true"`. Wave
 *      211 refuses a truthy-but-not-true tick deliberately (no coercion) and
 *      `wave211_money_event_gate_http` proof B-6b exists to enforce that. A fixture
 *      that sent `1` would be leaning on a coercion the gate correctly refuses.
 *
 * The gate itself is proved over HTTP, against this same wire contract, in
 * `server/__tests__/wave211_money_event_gate_http.test.ts` and
 * `server/__tests__/wave211_no_verification_claim.test.ts`. Those two suites — not
 * this fixture — are the authority on whether the gate works. If this fixture ever
 * stops matching what the gate requires, those suites keep passing and every suite
 * using this fixture goes red, which is the correct direction for the failure to
 * point.
 *
 * WHY ONE MODULE AND NOT SEVENTEEN COPIES
 * ---------------------------------------
 * Wave 226's preflight planned a per-file literal, following wave 214's precedent
 * in `w186_audit_write_end_to_end.test.ts`. Seventeen files in, that shape gives
 * seventeen independent chances for a fixture to drift from the wire contract, and
 * a drifted fixture fails as a 400 that reads like a product defect. One module,
 * derived entirely from the shared constants, has one. The deviation from the
 * preflight is recorded in `build_log/wave226/W226_BUILD.md`.
 *
 * PER-SLOT SHAPE — read from `SLOTS` in `server/wave211MoneyEventAttestationStore.ts`,
 * not guessed:
 *
 *   | slot           | route | basis        | currency confirmation |
 *   |----------------|-------|--------------|-----------------------|
 *   | distribution   | A1    | REQUIRED     | stored                |
 *   | capital_call   | A2    | REQUIRED     | stored                |
 *   | lp_invitation  | A3    | not stored   | not stored            |
 *   | lp_commitment  | A4    | not stored   | stored                |
 */
import {
  W211_BODY_KEY_VERSION,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_BASIS,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
  W211_MONEY_EVENT_ATTESTATION_VERSION,
  W211_LP_INVITE_ATTESTATION_VERSION,
  W211_LP_COMMIT_ATTESTATION_VERSION,
} from "../../shared/wave211MoneyEventAttestation";

/** The name a test operator types. A real name, not a placeholder token: wave 211
 *  refuses an empty or whitespace-only name (proof B-4) and this must be a value
 *  that passes for the honest reason. */
export const W226_SIGNED_NAME = "Avi Managing";

/** The three ticks plus the typed name — the part every slot shares. */
const TICKS = {
  [W211_BODY_KEY_SIGNED_NAME]: W226_SIGNED_NAME,
  [W211_BODY_KEY_TICK_1]: true,
  [W211_BODY_KEY_TICK_2]: true,
  [W211_BODY_KEY_TICK_3]: true,
} as const;

/** A1 — record a distribution. Basis of determination is REQUIRED for a money event. */
export const W226_DISTRIBUTION_ATT = {
  [W211_BODY_KEY_VERSION]: W211_MONEY_EVENT_ATTESTATION_VERSION,
  ...TICKS,
  [W211_BODY_KEY_BASIS]:
    "Proceeds and cost basis taken from the executed sale documents for this vehicle.",
  [W211_BODY_KEY_CURRENCY_CONFIRMED]: true,
} as const;

/** A2 — record a capital call. Same money-event version and the same basis requirement. */
export const W226_CAPITAL_CALL_ATT = {
  [W211_BODY_KEY_VERSION]: W211_MONEY_EVENT_ATTESTATION_VERSION,
  ...TICKS,
  [W211_BODY_KEY_BASIS]:
    "Called amount taken from the signed capital call notice issued to the LPs of this vehicle.",
  [W211_BODY_KEY_CURRENCY_CONFIRMED]: true,
} as const;

/** A3 — invite an LP. An invitation is not a money event: no basis, no currency tick. */
export const W226_LP_INVITE_ATT = {
  [W211_BODY_KEY_VERSION]: W211_LP_INVITE_ATTESTATION_VERSION,
  ...TICKS,
} as const;

/** A4 — commit an LP to the cap table. No basis; the currency confirmation IS stored. */
export const W226_LP_COMMIT_ATT = {
  [W211_BODY_KEY_VERSION]: W211_LP_COMMIT_ATTESTATION_VERSION,
  ...TICKS,
  [W211_BODY_KEY_CURRENCY_CONFIRMED]: true,
} as const;
