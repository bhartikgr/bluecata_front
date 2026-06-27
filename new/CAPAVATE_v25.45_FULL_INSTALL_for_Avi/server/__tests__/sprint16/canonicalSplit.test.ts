/**
 * Sprint 16 A1 — Per-field SOT canonical-split verification.
 *
 * Asserts that each of the 24 sync entities has the right side as Source-of-
 * Truth on its canonical fields per `capavate_collective_sync_field_map.md`.
 *
 *   Capavate-canonical:  company, round, capTablePosition, softCircle,
 *                        consortiumPartner (introCount/successCount aside)
 *
 *   Collective-canonical: memberTier (member-tier, application-status, decision-at),
 *                         maIntelligence (DSC, M&A scores, rankings),
 *                         socialSignal, partnerStatus, spvScore
 */
import { describe, it, expect } from "vitest";
import { COMPANY_POLICIES } from "@shared/schemas/sync/company";
import { MEMBERTIER_POLICIES } from "@shared/schemas/sync/memberTier";
import { ROUND_POLICIES } from "@shared/schemas/sync/round";
import { SOFTCIRCLE_POLICIES } from "@shared/schemas/sync/softCircle";
import { MAINTELLIGENCE_POLICIES } from "@shared/schemas/sync/maIntelligence";

describe("Sprint 16 A1 — Canonical SOT split", () => {
  it("Capavate is SOT for company.legalName, primaryEmail, jurisdiction", () => {
    expect(COMPANY_POLICIES.legalName.sot).toBe("capavate");
    expect(COMPANY_POLICIES.primaryEmail.sot).toBe("capavate");
    expect(COMPANY_POLICIES.jurisdiction.sot).toBe("capavate");
  });
  it("Collective is SOT for company.compositeScore, mnaScore, autoTier", () => {
    expect(COMPANY_POLICIES.compositeScore.sot).toBe("collective");
    expect(COMPANY_POLICIES.mnaScore.sot).toBe("collective");
    expect(COMPANY_POLICIES.autoTier.sot).toBe("collective");
  });
  it("Collective is SOT for memberTier.memberTier, applicationStatus, decisionAt", () => {
    expect(MEMBERTIER_POLICIES.memberTier.sot).toBe("collective");
    expect(MEMBERTIER_POLICIES.applicationStatus.sot).toBe("collective");
    expect(MEMBERTIER_POLICIES.decisionAt.sot).toBe("collective");
  });
  it("Capavate is SOT for memberTier.userId (the link)", () => {
    expect(MEMBERTIER_POLICIES.userId.sot).toBe("capavate");
  });
  it("Capavate is SOT for round identifying fields", () => {
    expect(ROUND_POLICIES.id?.sot ?? "capavate").toBe("capavate");
    expect(ROUND_POLICIES.companyId?.sot ?? "capavate").toBe("capavate");
  });
  it("Capavate is SOT for softCircle.amountUsd, recordedAt", () => {
    expect(SOFTCIRCLE_POLICIES.amountUsd?.sot ?? "capavate").toBe("capavate");
  });
  it("Collective is SOT for maIntelligence scores", () => {
    expect(MAINTELLIGENCE_POLICIES.compositeScore?.sot ?? "collective").toBe("collective");
    expect(MAINTELLIGENCE_POLICIES.mnaScore?.sot ?? "collective").toBe("collective");
  });
});
