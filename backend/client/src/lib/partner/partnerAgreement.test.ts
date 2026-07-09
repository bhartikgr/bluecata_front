/* GROUP E (1b) — display-label unit tests.
 *
 * Guarantees the cosmetic label is decoupled from the stored/enforced version
 * id: no matter what internal id the server returns, the partner sees the
 * professional "Version 1.0" label, while the stored id in
 * shared/consortiumAgreement.ts stays exactly as-is (so nobody is re-signed).
 */
import { describe, it, expect } from "vitest";
import {
  displayAgreementLabel,
  displayAgreementVersion,
  AGREEMENT_DISPLAY_NAME,
  AGREEMENT_DISPLAY_VERSION,
} from "./partnerAgreement";
import { CONSORTIUM_AGREEMENT_VERSION } from "@shared/consortiumAgreement";

describe("partnerAgreement — display labelling (1b)", () => {
  it("maps any stored id to the professional label", () => {
    expect(displayAgreementLabel("CPA-v0.1-DRAFT")).toBe(
      "Consortium Partner Agreement · Version 1.0",
    );
  });

  it("label is stable regardless of the internal id (never leaks the raw id)", () => {
    const a = displayAgreementLabel("CPA-v0.1-DRAFT");
    const b = displayAgreementLabel("something-else");
    const c = displayAgreementLabel(undefined);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).not.toContain("DRAFT");
    expect(a).toContain(AGREEMENT_DISPLAY_NAME);
    expect(a).toContain(AGREEMENT_DISPLAY_VERSION);
  });

  it("compact version token is display-only 'Version 1.0'", () => {
    expect(displayAgreementVersion("CPA-v0.1-DRAFT")).toBe("Version 1.0");
    expect(displayAgreementVersion()).toBe("Version 1.0");
  });

  it("stored/enforced version id is UNCHANGED and independent of the display label", () => {
    // The enforcement id must remain the internal draft tag; the display layer
    // never mutates it. If this ever flips, already-signed partners would be
    // forced to re-sign — which 1b explicitly forbids.
    expect(CONSORTIUM_AGREEMENT_VERSION).toBe("CPA-v0.1-DRAFT");
    expect(displayAgreementLabel(CONSORTIUM_AGREEMENT_VERSION)).not.toContain(
      CONSORTIUM_AGREEMENT_VERSION,
    );
  });
});
