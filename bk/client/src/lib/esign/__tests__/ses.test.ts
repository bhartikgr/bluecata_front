import { describe, it, expect } from "vitest";
import { signSES, verifySES, appendToChain, verifyChain, type SESSignaturePayload } from "../ses";

const base: SESSignaturePayload = {
  documentId: "doc_abc",
  documentType: "termsheet",
  signerName: "Avi Founder",
  signerEmail: "avi@example.com",
  signerRole: "founder",
  intentText: "I agree to the term sheet draft.",
  ipAddress: "198.51.100.4",
  userAgent: "Mozilla/5.0 (Test)",
  timestamp: "2026-08-01T12:00:00.000Z",
  sessionId: "ses_test_1",
  prevHash: "0".repeat(64),
};

describe("SES e-signature", () => {
  it("produces a deterministic hash for the same payload", () => {
    const a = signSES(base);
    const b = signSES(base);
    expect(a.hash).toEqual(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies an unmodified signature", () => {
    const sig = signSES(base);
    expect(verifySES(sig)).toBe(true);
  });

  it("fails verification when any field is mutated", () => {
    const sig = signSES(base);
    expect(verifySES({ ...sig, signerName: "Mallory" })).toBe(false);
    expect(verifySES({ ...sig, ipAddress: "1.2.3.4" })).toBe(false);
    expect(verifySES({ ...sig, timestamp: "2030-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("hash chains: each signature references the previous hash", () => {
    let chain = appendToChain([], { ...base, signerName: "First" });
    chain = appendToChain(chain, { ...base, signerName: "Second" });
    chain = appendToChain(chain, { ...base, signerName: "Third" });
    expect(chain).toHaveLength(3);
    expect(chain[0].prevHash).toEqual("0".repeat(64));
    expect(chain[1].prevHash).toEqual(chain[0].hash);
    expect(chain[2].prevHash).toEqual(chain[1].hash);
    expect(verifyChain(chain)).toEqual({ valid: true });
  });

  it("detects chain tampering", () => {
    let chain = appendToChain([], { ...base, signerName: "A" });
    chain = appendToChain(chain, { ...base, signerName: "B" });
    const tampered: typeof chain = [{ ...chain[0], signerName: "Mallory" }, chain[1]];
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toEqual(0);
  });

  it("documentType discriminates payloads (different doc -> different hash)", () => {
    const a = signSES(base);
    const b = signSES({ ...base, documentType: "softcircle" });
    expect(a.hash).not.toEqual(b.hash);
  });
});
