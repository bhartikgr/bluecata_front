/**
 * WAVE 217 — TEST HELPER: THE COMPLIANCE DECLARATION EVERY PUBLIC APPLICATION
 * NOW CARRIES.
 *
 * The two public apply routes refuse an application with no compliance
 * declaration (422). That is the whole point of the wave, so the pre-existing
 * fixtures across this suite each have to supply one, exactly as the real screen
 * does. This mirrors `_w212RoundAttestation.ts`, which wave 212 added for the
 * same reason.
 *
 * They go through THIS ONE HELPER rather than each test spelling the four fields
 * out, so that:
 *   · a later change to the declaration's payload shape is one edit, not seven;
 *   · `grep _w217ComplianceFixture` names every test that leans on it; and
 *   · no test can drift into asserting a DIFFERENT sentence than the one the
 *     platform requires — the text is BUILT by the shared builder here, never
 *     retyped, so a paraphrase cannot creep into a fixture.
 *
 * IT DOES NOT WEAKEN THE GATE. It adds the same three inputs an applicant gives:
 * a tick, a regulatory status, and the sentence the screen displayed. The
 * timestamp, the IP, the user agent and the stored text are all still derived by
 * the server, and the tests that prove the gate REFUSES an undeclared or forged
 * application deliberately DO NOT use this helper.
 */
import {
  PARTNER_COMPLIANCE_ATTESTATION_VERSION,
  complianceAttestationText,
} from "@shared/wave217PartnerComplianceAttestation";

/**
 * Add the compliance declaration to a public-apply body.
 *
 * `organizationName` and `agreementSignedName` are read off the body, because the
 * sentence is per-organisation and per-signer and must match what the server
 * rebuilds. When the body carries no signature the declaration is signed with the
 * contact's name, which is what the screen does.
 *
 * Anything already on the body wins, so a test that wants to send its own status
 * or a deliberately wrong version can pass it and this helper will not overwrite
 * it.
 */
export function w217Declare<T extends Record<string, unknown>>(body: T): T {
  const org = String(body.organizationName ?? "");
  const signer = String(body.agreementSignedName ?? body.contactName ?? "");
  return {
    complianceAttested: true,
    complianceAttestationText: complianceAttestationText(org, signer),
    complianceAttestationVersion: PARTNER_COMPLIANCE_ATTESTATION_VERSION,
    regulatoryStatus: "licensed",
    // A signature is required alongside the declaration: the sentence says "I am
    // authorised to make this declaration", and an unsigned one names nobody.
    agreementSignedName: signer,
    ...body,
    // ...but the signature must be present even when the caller's body omitted
    // it, which the spread above would have restored to undefined.
    ...(body.agreementSignedName == null ? { agreementSignedName: signer } : {}),
  } as unknown as T;
}
