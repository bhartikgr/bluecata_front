/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 209 · ITEM A · §209.2 — SIGNER METADATA THAT ONLY EVER STATES WHAT WAS
 * ACTUALLY OBSERVED.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG. `./ses.ts:70` computed the signer's IP address as
 * `` `198.51.100.${…charCodeAt(4) + …charCodeAt(5) …}` `` — RFC 5737
 * documentation space, derived from a browser tab identifier, in a module citing
 * the ESIGN Act, UETA and eIDAS Article 25. `signSES()` hashes the canonical
 * JSON of the whole payload, so the invented address was sealed INSIDE the
 * signature hash. R187.1 calls this the most serious single finding of the
 * project, and the reason is not pedantry: a missing disclosure is a gap, but an
 * invented field inside the one artefact whose only purpose is to be believed
 * later discredits the whole record, and every other signature beside it.
 *
 * THE TWO HONEST OPTIONS, AND WHICH ONE EACH FLOW GETS. A browser cannot observe
 * its own public address; only the server can state it. On all five signing
 * flows the signature is computed BEFORE any response exists, so a client-side
 * "capture" could only ever be an assertion the client is not entitled to make.
 * Therefore:
 *
 *   • THE CLIENT-SIDE FIELD IS ALWAYS THE EXPLICIT SENTINEL. Every SES payload
 *     this platform builds in a browser carries `"not captured"` in `ipAddress`,
 *     because that is the truth about what the browser observed.
 *
 *   • WHERE THE SIGNATURE IS SUBMITTED TO THE SERVER, THE SERVER STAMPS THE REAL
 *     ADDRESS. `POST /api/founder/term-sheets` resolves the peer through the one
 *     hardened resolver (`resolveRateLimitClientIp`) and writes
 *     `serverObservedSignerIp` onto the durable revision — the pattern the
 *     envelope engine (`server/lib/esignatureRoutes.ts:434`) and wave 22's audit
 *     append (`server/adminPlatformStore.ts:3431`) already use correctly. That
 *     value is the one a dispute would rely on, and the client obtains it back
 *     FROM THE SERVER RESPONSE via `resolveSignerAddressFromServerResponse()`.
 *
 * WHY THE FIELD IS NOT SIMPLY DROPPED. An audit record that used to claim an
 * address and now omits it without explanation is its own defect: a reader
 * cannot tell "nothing was captured" from "the field was lost". So the key
 * stays, the value is an explicit sentinel, and every surface that renders the
 * metadata says "not captured" in words rather than showing a blank.
 *
 * WHY THE KEY ITSELF IS NOT REMOVED OR MADE OPTIONAL. `SESSignaturePayload`
 * declares `ipAddress: string` as required, and `verifySES()` re-hashes every
 * key it finds. Dropping the key, or adding one, changes the canonical JSON and
 * would make EVERY SIGNATURE ALREADY WRITTEN fail its own verification. The
 * shape is therefore preserved exactly; only the value changes.
 *
 * R143.1. Nothing in this file edits or replaces an existing literal. The
 * sentences below are NEW copy, appended as siblings by the surfaces that render
 * them.
 */
import {
  EVIDENCE_FIELD_NOT_CAPTURED,
  SIGNER_ADDRESS_NOT_CAPTURED,
  SIGNER_ADDRESS_NOT_CAPTURED_REASON,
  isSignerAddressCaptured,
  normaliseServerObservedAddress,
  signerAddressDisplay,
} from "@shared/wave209SignerAddress";

export {
  EVIDENCE_FIELD_NOT_CAPTURED,
  SIGNER_ADDRESS_NOT_CAPTURED,
  SIGNER_ADDRESS_NOT_CAPTURED_REASON,
  isSignerAddressCaptured,
  signerAddressDisplay,
};

/**
 * The sentence a signer reads where no address was captured. §209.2(b)'s draft
 * text, kept verbatim. Measured against the 240-character `looksHuman` gate by
 * `wave209_signer_metadata.test.ts` rather than assumed — that gate has silently
 * swallowed a message four times on this project.
 */
export const SIGNER_ADDRESS_NOT_CAPTURED_SENTENCE =
  "Capavate did not capture the signer's network address for this signature, so no address is recorded. A field marked not captured is what the record holds; Capavate does not supply a value it does not have.";

/**
 * The sentence a signer reads where the server DID observe the address. Stated
 * as narrowly as it is true: the server reports the peer it saw, which is not
 * necessarily the signer's own device address once proxies are involved.
 */
export const SIGNER_ADDRESS_SERVER_OBSERVED_SENTENCE =
  "Where a network address is shown, Capavate's server recorded the address it observed when the signature was submitted, not an address supplied by the signer's browser.";

/**
 * What a browser is entitled to say about its own network address: nothing.
 *
 * This is a function rather than a bare constant so that the call site reads as
 * a capture step and cannot be mistaken for a default that some other code path
 * might overwrite with a guess.
 */
export function captureClientSignerAddress(): string {
  return SIGNER_ADDRESS_NOT_CAPTURED;
}

/**
 * Read the server-observed address out of a save response, and fall back to the
 * sentinel when the response does not carry one.
 *
 * This is the function §209.2(a) asks for: the client obtains the address FROM
 * THE SERVER RESPONSE for the signature being recorded. It resolves nothing
 * itself — no new resolver is written anywhere in this wave — and it will not
 * accept a non-address token (`"unknown"`, `"0.0.0.0"`, blank) as an address.
 */
export function resolveSignerAddressFromServerResponse(response: unknown): string {
  if (!response || typeof response !== "object") return SIGNER_ADDRESS_NOT_CAPTURED;
  const flat = response as Record<string, unknown>;
  const nested = flat.revision && typeof flat.revision === "object" ? (flat.revision as Record<string, unknown>) : undefined;
  const payload = nested?.payload && typeof nested.payload === "object" ? (nested.payload as Record<string, unknown>) : undefined;
  const candidates = [flat.serverObservedSignerIp, nested?.serverObservedSignerIp, payload?.serverObservedSignerIp];
  for (const candidate of candidates) {
    const normalised = normaliseServerObservedAddress(candidate);
    if (normalised !== null) return normalised;
  }
  return SIGNER_ADDRESS_NOT_CAPTURED;
}
