/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 209 · ITEM A (decision B1; R187.1) — THE ONE VOCABULARY FOR
 * "WE DID NOT CAPTURE THE SIGNER'S NETWORK ADDRESS".
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT THIS EXISTS TO END. `client/src/lib/esign/ses.ts` — a module whose
 * own header cites the ESIGN Act, UETA and eIDAS Article 25 — used to compute
 * the signer's IP address from two character codes of a browser tab identifier,
 * inside the `198.51.100.0/24` block. That block is RFC 5737 DOCUMENTATION
 * SPACE: it is reserved for examples and can never be a real client address, so
 * every value the expression produced was fiction, and the fiction was hashed
 * into the signature. R187.1: *"Either capture the real client IP, or record
 * NOTHING and say so. A field marked 'not captured' is defensible. A field
 * containing a fiction is not."*
 *
 * R143.4, applied to evidence instead of money: *"Capavate will not show a zero
 * total for a figure it does not hold."* An address it does not hold is the same
 * problem wearing a different type.
 *
 * WHY THIS FILE IS IN `shared/` AND NOT IN THE CLIENT MODULE. Two parties need
 * the SAME words: the browser, which must render the absence honestly, and the
 * server route, which must reject a non-address token arriving from the hardened
 * resolver rather than persist it as though it were an address. The client
 * cannot import server code (it would drag the database into the browser
 * bundle), and the server should not import a client module. This is the same
 * layering argument that produced `shared/refusalHeadlineGate.ts`.
 *
 * NOTHING HERE IS COPY. This module defines one machine-readable sentinel and
 * the predicates that recognise it. The sentences a human reads live with the
 * surfaces that render them (`client/src/lib/esign/wave209SignerMetadata.ts`),
 * and no literal anywhere is altered by this file (R143.1).
 */

/**
 * The literal a record carries when no network address was captured.
 *
 * §209.2(b) fixes this string exactly. It is a SENTINEL, not a value: it is
 * never parsed, never compared as an address, and never presented as one. It is
 * deliberately not machine-shaped — no `0.0.0.0`, no empty string, no `null`
 * squeezed into a required `string` field — because the whole class of harm this
 * wave addresses is a reader mistaking a placeholder for an observation.
 */
export const SIGNER_ADDRESS_NOT_CAPTURED = "not captured";

/**
 * The same sentinel under a field-neutral name.
 *
 * POST-BUILD REVIEW PASS (a) FOUND A REAL READABILITY DEFECT AND THIS IS THE
 * FIX. `captureSessionMetadata()` needs the identical words for the USER AGENT
 * when there is no `navigator` to report one, and the first version of that line
 * reached for the address helper to get them. The behaviour was correct and its
 * disarm went red, but a reader of
 *   `userAgent = ... : captureClientSignerAddress()`
 * would reasonably conclude an address was being written into a user-agent
 * field, which is precisely the confusion this wave exists to remove. Same
 * string, honest name — no behaviour change, and the tests pinning the literal
 * still pass because this is an alias, not a second vocabulary. */
export const EVIDENCE_FIELD_NOT_CAPTURED: typeof SIGNER_ADDRESS_NOT_CAPTURED = SIGNER_ADDRESS_NOT_CAPTURED;

/**
 * The machine-readable reason, stored beside the record rather than shown.
 * Mirrors `IP_NOT_CAPTURED_REASON` in `client/src/components/CloseRoundPanel.tsx`,
 * which wave 22 wrote when it removed the identical fabrication from the audit
 * path — the same fix, on one surface, that this wave finally applies to the
 * signature surface.
 */
export const SIGNER_ADDRESS_NOT_CAPTURED_REASON =
  "client-side capture unavailable: a browser cannot observe its own public network address. Where the signature is submitted to the server, the server stamps the peer address it actually observed (serverObservedSignerIp) on the durable record.";

/**
 * Tokens that are NOT addresses, however address-shaped they look.
 *
 * `server/lib/rateLimit.ts:383` can return the literal `"unknown"` when it has
 * no peer to report, and `server/gdprRoutes.ts:220` carries a (dead) `"0.0.0.0"`
 * fallback. Both are honest labels in their own files, but neither may be
 * persisted as a signer address: §209.5 forbids substituting a plausible value,
 * and §5.7 forbids letting a missing value take part in a comparison as though
 * it were a value. Anything in this list is treated as absent, everywhere.
 *
 * RFC 5737 / RFC 3849 documentation prefixes are NOT listed here on purpose. A
 * documentation address is not "an absence spelled oddly" — it is a fabrication,
 * and the fix for a fabrication is to stop generating it, not to filter it at
 * the sink. There is no code path left that can produce one.
 */
export const NON_ADDRESS_TOKENS: readonly string[] = [
  SIGNER_ADDRESS_NOT_CAPTURED,
  "unknown",
  "0.0.0.0",
  "::",
  "n/a",
  "none",
  "null",
  "undefined",
];

/**
 * True only when `value` is something a record may present as an observed
 * network address. Everything else — `null`, `undefined`, a non-string, blank
 * space, the sentinel, or any other non-address token — is an absence.
 *
 * This is the ONLY predicate any caller should use. Nothing in the codebase may
 * ask `value === ""` or `value !== SIGNER_ADDRESS_NOT_CAPTURED` and act on the
 * answer, because that is exactly the shape §5.7 names.
 */
export function isSignerAddressCaptured(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return !NON_ADDRESS_TOKENS.includes(trimmed.toLowerCase());
}

/**
 * What a human reads: the captured address, or the words "not captured".
 *
 * RENDER-ONLY. This never changes what is stored — a record that holds no
 * address keeps holding no address. It exists so that a surface can never show
 * a blank where an address was once claimed, which is the second half of the
 * owner's instruction: do not silently drop the field.
 */
export function signerAddressDisplay(value: unknown): string {
  return isSignerAddressCaptured(value) ? (value as string).trim() : SIGNER_ADDRESS_NOT_CAPTURED;
}

/**
 * Normalise whatever the hardened server-side resolver returned into either a
 * real address or `null`.
 *
 * THIS IS NOT A RESOLVER AND MUST NEVER BECOME ONE. §209.2(a) is explicit:
 * *"Reuse that resolver. Do not write a new one."* The one resolver is
 * `resolveRateLimitClientIp` in `server/lib/rateLimit.ts` — trusted-hop aware,
 * fail-closed to the socket peer, never trusting a raw `x-forwarded-for`. This
 * function reads no request, consults no header and invents no address; it only
 * decides whether that resolver's output is reportable. `null` means the durable
 * record states an absence rather than a guess.
 */
export function normaliseServerObservedAddress(resolved: unknown): string | null {
  return isSignerAddressCaptured(resolved) ? (resolved as string).trim() : null;
}
