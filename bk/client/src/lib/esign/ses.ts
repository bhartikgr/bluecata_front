/**
 * SES (Simple Electronic Signature) primitive.
 *
 * ESIGN Act / UETA compliant for the United States; eIDAS Article 25 SES
 * tier compliant for the EU and the UK; framework portable to other regions.
 *
 * The signer types their full legal name, agrees to a click-through intent
 * statement, and the system captures IP, user agent, timestamp, session ID,
 * and chains the signature to the previous signature on the same document.
 *
 * We use the engine's stable SHA-256 (cap-table-engine/primitives/hash.ts) so
 * every signature is verifiable on the same hash function the rest of the
 * audit chain uses.
 */
import { sha256 } from "@capavate/cap-table-engine";

export type SESDocumentType = "softcircle" | "termsheet" | "subscription" | "side-letter";
export type SESSignerRole = "founder" | "investor" | "admin";

export interface SESSignaturePayload {
  documentId: string;          // term-sheet hash, soft-circle ID, etc.
  documentType: SESDocumentType;
  signerName: string;          // typed
  signerEmail: string;
  signerRole: SESSignerRole;
  intentText: string;          // the click-through text the signer agreed to
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
 * Best-effort capture of browser session metadata. In server-side contexts
 * the IP is set explicitly by the caller; in the preview the IP is derived
 * client-side from a visible-but-anonymized session token so demos render.
 */
export function captureSessionMetadata(): { ipAddress: string; userAgent: string; sessionId: string; timestamp: string } {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "node";
  // Stable per-tab session id without persistent storage (sandbox-safe).
  const w = (typeof window !== "undefined" ? window : {}) as { __capavateSessionId?: string };
  if (!w.__capavateSessionId) {
    w.__capavateSessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
  // For the preview we surface a non-real but deterministic-per-tab IP marker.
  const ipAddress = `198.51.100.${(((w.__capavateSessionId.charCodeAt(4) + w.__capavateSessionId.charCodeAt(5)) % 250) + 2)}`;
  return { ipAddress, userAgent, sessionId: w.__capavateSessionId, timestamp: new Date().toISOString() };
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
