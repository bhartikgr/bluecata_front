/**
 * WAVE 212 — TEST HELPER: THE AUTHORISED SIGN-OFF EVERY ROUND-CREATE NOW CARRIES.
 *
 * `POST /api/rounds` refuses a round with no authorised sign-off (R186.2). That is
 * the point of the wave, so the seventy-odd existing creates across this suite each
 * have to supply one, exactly as the wizard does.
 *
 * They go through THIS ONE HELPER rather than each test spelling the two fields out,
 * so that:
 *   · a later change to the sign-off's payload shape is one edit, not seventy;
 *   · `grep _w212RoundAttestation` names every test that leans on the sign-off; and
 *   · no test can accidentally drift into asserting a DIFFERENT signature than the
 *     one the platform requires.
 *
 * IT DOES NOT WEAKEN THE GATE. It adds the same two inputs a founder types. The
 * version, the wording, the timestamp, the identity, the address and the user agent
 * are all still derived by the server, and the tests that prove the gate refuses an
 * unsigned create deliberately DO NOT use this helper.
 */

/** The name the suite signs with, when the test does not care which name it is. */
export const W212_TEST_SIGNED_NAME = "Test Founder";

/**
 * Add the authorised sign-off to a round-create body.
 *
 * Anything already on the body wins, so a test that wants to send its own name or
 * to send `accepted: false` can pass it and this helper will not overwrite it.
 */
export function w212Attest<T extends Record<string, unknown>>(body: T): T & {
  creationAttestationSignedName: string;
  creationAttestationAccepted: boolean;
} {
  return {
    creationAttestationSignedName: W212_TEST_SIGNED_NAME,
    creationAttestationAccepted: true,
    ...body,
  } as T & { creationAttestationSignedName: string; creationAttestationAccepted: boolean };
}
