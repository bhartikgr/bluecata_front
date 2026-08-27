/**
 * WAVE 169 — PER-TYPE ATTESTATION WORDING, PERSISTED, WITH V1 UNTOUCHED
 * (R77, R111 Q11, R44 add-never-substitute).
 *
 * VERIFIED PRE-STATE (this working tree, before the wave):
 *   shared/spvAttestation.ts:26        ATTESTATION_TEXT_V1 — "…authorized to launch
 *                                     this special-purpose vehicle on behalf of…"
 *   server/spvLaunchSignoffStore.ts    recordSignoff() wrote
 *                                     `attestationText: ATTESTATION_TEXT_V1` and
 *                                     `attestationVersion: ATTESTATION_VERSION`
 *                                     unconditionally, for EVERY vehicle type.
 *   server/partnerRoutes.ts   (fund create, wave 150) → same constant
 *   server/spvEngineRoutes.ts (canonical create)      → same constant
 * So a fund, a syndicate and a rolling fund were all recorded as having attested
 * to launching a "special-purpose vehicle". The row IS the evidence of
 * authorization; it named the wrong product.
 *
 * WHAT THIS FILE PINS, AND WHY IT IS NOT VACUOUS.
 *  - RESOLUTION: each of the five shipped types resolves a sentence naming ITSELF
 *    and not another product. Both poles per type.
 *  - IMMUTABILITY OF EVIDENCE: `attestationTextForType("spv")` is
 *    `ATTESTATION_TEXT_V1` byte-for-byte, and a row already persisted with v1's
 *    bytes still reads back byte-identically after the wave — asserted through the
 *    REAL store against a DB copy, never against a hand-built object.
 *  - SINGLE SOURCE: the v2 wording is derived from the v1 bytes, so a drift in v1
 *    propagates rather than diverging; asserted by reconstruction, not by
 *    retyping the sentence.
 *  - PERSISTENCE: the fund route records the fund wording, and the canonical
 *    engine route records the wording of whatever type it was asked to create.
 *
 * NOT MUTATED: `data.db` / `test.db` are never written by this file; it uses the
 * store's own test connection like every other server test in this suite.
 */
import { describe, it, expect } from "vitest";
import {
  ATTESTATION_TEXT_V1,
  ATTESTATION_VERSION,
  ATTESTATION_VERSION_V2,
  ATTESTATION_VEHICLE_NOUNS,
  ATTESTATION_UNKNOWN_TYPE_NOUN,
  attestationTextForType,
  attestationVersionForType,
  resolveAttestation,
} from "@shared/spvAttestation";
import { SPV_TYPES } from "@shared/spvEngine";
import { recordSignoff, listSignoffsForSpv, linkSignoffToSpv } from "../spvLaunchSignoffStore";

const NOUNS: Record<string, string> = {
  spv: "special-purpose vehicle",
  multi_asset: "multi-asset special-purpose vehicle",
  syndicate: "syndicate",
  fund: "fund",
  rolling_fund: "rolling fund",
};

describe("W169 A — every shipped type resolves a sentence naming itself", () => {
  it("A1 — the resolver covers exactly the shipped enum, with no type left unnamed", () => {
    expect(SPV_TYPES.length).toBe(5);
    for (const t of SPV_TYPES) {
      expect(Object.prototype.hasOwnProperty.call(ATTESTATION_VEHICLE_NOUNS, t)).toBe(true);
      expect(String(ATTESTATION_VEHICLE_NOUNS[t]).length).toBeGreaterThan(2);
    }
    expect(Object.keys(ATTESTATION_VEHICLE_NOUNS).sort()).toEqual([...SPV_TYPES].sort());
  });

  it("A2 — each type's text names that type and names no other product", () => {
    for (const t of SPV_TYPES) {
      const text = attestationTextForType(t);
      expect(text).toContain(`authorized to launch this ${NOUNS[t]} on behalf of this Consortium Partner`);
      expect(text.startsWith("I certify that I am authorized to launch")).toBe(true);
      expect(text.endsWith("(ESIGN/UETA).")).toBe(true);
      // the wrong-product pole: a fund/syndicate/rolling fund must not claim to be
      // a special-purpose vehicle, and nothing but a fund may say "this fund".
      if (t !== "spv" && t !== "multi_asset") {
        expect(text).not.toContain("special-purpose vehicle");
      }
      if (t !== "fund") expect(text).not.toContain("launch this fund on");
    }
    // and the five sentences are five DISTINCT sentences (not one repeated)
    expect(new Set(SPV_TYPES.map((t) => attestationTextForType(t))).size).toBe(5);
  });

  it("A3 — an unreadable type is attested generically, never as an SPV or a fund", () => {
    for (const bad of ["", "   ", "not_a_type", "FUND", null, undefined]) {
      const text = attestationTextForType(bad as string | null | undefined);
      if (bad === "" || bad === "   " || bad === null || bad === undefined) {
        // blank/absent IS the legacy single-deal path, which has always been v1
        expect(text).toBe(ATTESTATION_TEXT_V1);
      } else {
        expect(text).toContain(`authorized to launch this ${ATTESTATION_UNKNOWN_TYPE_NOUN} on`);
        expect(text).not.toContain("special-purpose vehicle");
        expect(text).not.toContain("this fund on");
      }
      expect(text.endsWith("(ESIGN/UETA).")).toBe(true);
    }
  });
});

describe("W169 B — v1 is evidence and is byte-immutable", () => {
  it("B1 — the single-deal SPV resolves to ATTESTATION_TEXT_V1 byte-for-byte, on version v1", () => {
    expect(attestationTextForType("spv")).toBe(ATTESTATION_TEXT_V1);
    expect(attestationTextForType("spv").length).toBe(ATTESTATION_TEXT_V1.length);
    expect(attestationVersionForType("spv")).toBe(ATTESTATION_VERSION);
    expect(ATTESTATION_VERSION).toBe("v1");
    expect(resolveAttestation("spv")).toEqual({ text: ATTESTATION_TEXT_V1, version: "v1" });
    expect(resolveAttestation(undefined)).toEqual({ text: ATTESTATION_TEXT_V1, version: "v1" });
  });

  it("B2 — every other type records the NEW version, so a row's version identifies its bytes", () => {
    for (const t of SPV_TYPES) {
      const { text, version } = resolveAttestation(t);
      expect(version).toBe(t === "spv" ? ATTESTATION_VERSION : ATTESTATION_VERSION_V2);
      // the pairing is the point: text and version can never disagree
      expect(text).toBe(attestationTextForType(t));
      expect(version).toBe(attestationVersionForType(t));
    }
    expect(ATTESTATION_VERSION_V2).toBe("v2");
    expect(ATTESTATION_VERSION_V2).not.toBe(ATTESTATION_VERSION);
  });

  it("B3 — v2 is DERIVED from v1: substituting the noun back reproduces v1 exactly", () => {
    /* This is the single-source proof. Nothing here retypes the sentence: each
       type's text, with its noun swapped for v1's noun, must be v1's bytes. A
       second hand-written copy of the legal copy would fail. */
    for (const t of SPV_TYPES) {
      const text = attestationTextForType(t);
      const rebuilt = text.replace(
        `this ${NOUNS[t]} on behalf of`,
        "this special-purpose vehicle on behalf of",
      );
      expect(rebuilt).toBe(ATTESTATION_TEXT_V1);
    }
  });

  it("B4 — a row persisted with v1's bytes still reads back byte-identically after the wave", () => {
    /* An already-signed attestation is EVIDENCE. It resolves from its own stored
       column, so this asserts the read path end to end through the real store:
       write v1 (the legacy caller shape — no type at all), read it back. */
    const legacy = recordSignoff({
      partnerId: "ac_w169_legacy",
      spvId: "",
      userId: "u_w169_legacy",
      signerLegalName: "Ada Pre-Wave Signer",
    });
    expect(legacy.attestationText).toBe(ATTESTATION_TEXT_V1);
    expect(legacy.attestationText.length).toBe(ATTESTATION_TEXT_V1.length);
    expect(legacy.attestationVersion).toBe(ATTESTATION_VERSION);
    linkSignoffToSpv(legacy.id, "spv_w169_legacy");
    const readBack = listSignoffsForSpv("ac_w169_legacy", "spv_w169_legacy");
    expect(readBack).toHaveLength(1);
    expect(readBack[0].attestationText).toBe(ATTESTATION_TEXT_V1);
    expect(readBack[0].attestationText.length).toBe(ATTESTATION_TEXT_V1.length);
    expect(readBack[0].attestationVersion).toBe("v1");
    expect(readBack[0].signerLegalName).toBe("Ada Pre-Wave Signer");
  });

  it("B5 — a fund sign-off records the FUND wording, on v2, in the same table", () => {
    const rec = recordSignoff({
      partnerId: "ac_w169_fund",
      spvId: "",
      userId: "u_w169_fund",
      signerLegalName: "Ada Fund Signer",
      spvType: "fund",
    });
    expect(rec.attestationText).toBe(attestationTextForType("fund"));
    expect(rec.attestationText).toContain("authorized to launch this fund on");
    expect(rec.attestationText).not.toContain("special-purpose vehicle");
    expect(rec.attestationVersion).toBe(ATTESTATION_VERSION_V2);
    linkSignoffToSpv(rec.id, "spv_w169_fund");
    const readBack = listSignoffsForSpv("ac_w169_fund", "spv_w169_fund");
    expect(readBack).toHaveLength(1);
    expect(readBack[0].attestationText).toBe(attestationTextForType("fund"));
    expect(readBack[0].attestationVersion).toBe("v2");
    // …and the legacy row written in B4 is untouched by it: two versions coexist.
    expect(readBack[0].attestationText).not.toBe(ATTESTATION_TEXT_V1);
  });

  it("B6 — each of the other three types persists its own wording", () => {
    for (const t of ["syndicate", "rolling_fund", "multi_asset"]) {
      const rec = recordSignoff({
        partnerId: `ac_w169_${t}`,
        spvId: "",
        userId: `u_w169_${t}`,
        signerLegalName: `Ada ${t} Signer`,
        spvType: t,
      });
      linkSignoffToSpv(rec.id, `spv_w169_${t}`);
      const back = listSignoffsForSpv(`ac_w169_${t}`, `spv_w169_${t}`);
      expect(back).toHaveLength(1);
      expect(back[0].attestationText).toContain(`authorized to launch this ${NOUNS[t]} on`);
      expect(back[0].attestationVersion).toBe(ATTESTATION_VERSION_V2);
    }
  });
});

describe("W169 C — the write paths pass the type they are creating", () => {
  it("C1 — the fund route records a FUND, and the canonical route records the submitted type", () => {
    /* Source-level, deliberately: both call sites are HTTP handlers whose whole
       job here is which argument they pass, and a source pin fails loudly if a
       later wave removes the argument and silently reverts to v1 wording. */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const root = path.resolve(__dirname, "../..");
    const partnerRoutes = fs.readFileSync(path.join(root, "server/partnerRoutes.ts"), "utf8");
    const engineRoutes = fs.readFileSync(path.join(root, "server/spvEngineRoutes.ts"), "utf8");
    expect(partnerRoutes).toContain('spvType: "fund",');
    expect(engineRoutes).toContain("spvType: typeof createBody.spvType === \"string\" ? createBody.spvType : null,");
    // and neither writes the attestation text itself — one authority only
    expect(partnerRoutes).not.toContain("attestationText:");
    expect(engineRoutes).not.toContain("attestationText:");
  });
});
