/**
 * SES (Simple Electronic Signature) primitive.
 *
 * ESIGN Act / UETA compliant for the United States; eIDAS Article 25 SES
 * tier compliant for the EU and the UK; framework portable to other regions.
 *
 * The signer types their full legal name, agrees to a click-through intent
 * statement, and the system records the user agent, timestamp and session id it
 * can observe in the browser, states plainly that it did NOT observe a network
 * address, and chains the signature to the previous signature on the same
 * document.
 *
 * We use the engine's stable SHA-256 (cap-table-engine/primitives/hash.ts) so
 * every signature is verifiable on the same hash function the rest of the
 * audit chain uses.
 *
 * WAVE 209 · ITEM A (decision B1; R187.1) — THIS MODULE USED TO INVENT THE IP
 * ADDRESS. `captureSessionMetadata()` computed it as
 * `198.51.100.<two char codes of a tab id>` — RFC 5737 documentation space,
 * which can never be a real client address — and `signSES()` sealed that fiction
 * inside the signature hash. The header above used to claim "the system captures
 * IP", which was not true of anything this file did. Both are corrected. See
 * `./wave209SignerMetadata.ts` for the two honest options and which flow gets
 * which; the durable address, where one exists, is stamped SERVER-side by
 * `POST /api/founder/term-sheets` through the one hardened resolver.
 */
import { sha256 } from "@capavate/cap-table-engine";
import { EVIDENCE_FIELD_NOT_CAPTURED, captureClientSignerAddress } from "./wave209SignerMetadata";

export type SESDocumentType = "softcircle" | "termsheet" | "subscription" | "side-letter";
export type SESSignerRole = "founder" | "investor" | "admin";

export interface SESSignaturePayload {
  documentId: string;          // term-sheet hash, soft-circle ID, etc.
  documentType: SESDocumentType;
  signerName: string;          // typed
  signerEmail: string;
  signerRole: SESSignerRole;
  intentText: string;          // the click-through text the signer agreed to
  /* WAVE 209 — STILL A REQUIRED `string`, DELIBERATELY. `verifySES()` re-hashes
   * every key it finds, so dropping this key or making it optional would change
   * the canonical JSON and make EVERY SIGNATURE ALREADY WRITTEN fail its own
   * verification. The key is kept; the value is either a real address stated by
   * a server or the explicit `"not captured"` sentinel. It is never a fiction,
   * and never blank. */
  ipAddress: string;
  userAgent: string;
  timestamp: string;           // ISO 8601
  sessionId: string;
  prevHash: string;            // chain to previous signature in this document
}

export interface SESSignature extends SESSignaturePayload {
  hash: string;                // SHA-256 of canonical JSON of payload
}

/** Canonical JSON: keys are sorted, no whitespace. Stable across hosts. */
function canonical(payload: SESSignaturePayload): string {
  const keys = Object.keys(payload).sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    obj[k] = (payload as unknown as Record<string, unknown>)[k];
  }
  return JSON.stringify(obj);
}

export function signSES(payload: SESSignaturePayload): SESSignature {
  return { ...payload, hash: sha256(canonical(payload)) };
}

export function verifySES(sig: SESSignature): boolean {
  const { hash, ...payload } = sig;
  return sha256(canonical(payload)) === hash;
}

/**
 * Capture the session metadata a BROWSER CAN ACTUALLY OBSERVE, and say so about
 * the one thing it cannot.
 *
 * WAVE 209. The address is the explicit `"not captured"` sentinel on every
 * client path, because a browser cannot observe its own public network address
 * and this platform will not supply a value it does not hold (R143.4, applied to
 * evidence). Where the signature is submitted to the server, the server stamps
 * the peer it observed onto the durable record as `serverObservedSignerIp`; that
 * is the option R187.1 prefers and it is used wherever a durable record exists.
 *
 * The user agent is likewise reported only when there is a `navigator` to report
 * it from. The previous `"node"` fallback was a synthesised user agent inside a
 * signature record — a smaller instance of the same class as the invented
 * address, and removed for the same reason.
 *
 * THE RETURN SHAPE IS UNCHANGED, BY DESIGN. Five call sites read these four keys
 * by name and some build SES payloads from them. Adding a key here (for example
 * the not-captured reason) would change the canonical JSON of any payload built
 * by spreading this object, and therefore its hash. The reason text lives in
 * `./wave209SignerMetadata.ts` as a separate constant instead.
 */
export function captureSessionMetadata(): { ipAddress: string; userAgent: string; sessionId: string; timestamp: string } {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : EVIDENCE_FIELD_NOT_CAPTURED;
  // Stable per-tab session id without persistent storage (sandbox-safe).
  const w = (typeof window !== "undefined" ? window : {}) as { __capavateSessionId?: string };
  if (!w.__capavateSessionId) {
    w.__capavateSessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
  return {
    ipAddress: captureClientSignerAddress(),
    userAgent,
    sessionId: w.__capavateSessionId,
    timestamp: new Date().toISOString(),
  };
}

/** Append a new signature to a chain (oldest-first list). Returns extended chain. */
export function appendToChain(chain: SESSignature[], next: SESSignaturePayload): SESSignature[] {
  const prevHash = chain.length ? chain[chain.length - 1].hash : "0".repeat(64);
  const sig = signSES({ ...next, prevHash });
  return [...chain, sig];
}

/** Verify a chain — every prevHash must match the previous sig hash AND every sig must self-verify. */
export function verifyChain(chain: SESSignature[]): { valid: boolean; brokenAt?: number } {
  for (let i = 0; i < chain.length; i++) {
    const sig = chain[i];
    if (!verifySES(sig)) return { valid: false, brokenAt: i };
    const expectedPrev = i === 0 ? "0".repeat(64) : chain[i - 1].hash;
    if (sig.prevHash !== expectedPrev) return { valid: false, brokenAt: i };
  }
  return { valid: true };
}
