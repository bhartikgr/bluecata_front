/**
 * Sprint 11 \u2014 Founder Investor CRM tests.
 *
 * Verifies the founder-side investor CRM seed data and pipeline shape.
 */
import { describe, it, expect } from "vitest";
import { _testAccessFounderCrm } from "../founderCrmStore";

describe("founderCrmStore", () => {
  it("seeds at least 5 contacts across the pipeline", () => {
    const { contacts } = _testAccessFounderCrm;
    expect(contacts.length).toBeGreaterThanOrEqual(5);
  });

  it("each contact has a stage in the canonical pipeline", () => {
    const validStages = ["lead", "engaged", "soft_circle", "invested", "longterm"];
    for (const c of _testAccessFounderCrm.contacts) {
      expect(validStages).toContain(c.stage);
    }
  });

  it("each contact has a region from the 9-region matrix", () => {
    const valid = ["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU"];
    for (const c of _testAccessFounderCrm.contacts) {
      if (c.region) {
        expect(valid).toContain(c.region);
      }
    }
  });

  it("contacts span multiple pipeline stages (\u22653)", () => {
    const stages = new Set(_testAccessFounderCrm.contacts.map((c) => c.stage));
    expect(stages.size).toBeGreaterThanOrEqual(3);
  });
});
