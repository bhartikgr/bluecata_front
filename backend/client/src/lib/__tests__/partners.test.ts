import { describe, it, expect } from "vitest";
import { CONSORTIUM_PARTNERS, partnersByRegion, REGIONS_LIST } from "../partners";

describe("Consortium partners directory", () => {
  it("every region has at least 2 named partners", () => {
    for (const region of REGIONS_LIST) {
      const list = partnersByRegion(region);
      expect(list.length, `region ${region} must have ≥ 2 partners`).toBeGreaterThanOrEqual(2);
    }
  });

  it("every partner has region, firmName, type, description, url", () => {
    for (const p of CONSORTIUM_PARTNERS) {
      expect(p.region).toBeTruthy();
      expect(p.firmName.length).toBeGreaterThan(0);
      expect(["law", "accounting", "incubator", "accelerator"]).toContain(p.type);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.url).toMatch(/^https?:\/\//);
      expect(p.regionalSpecialty.length).toBeGreaterThan(0);
      expect(p.slaBusinessDays).toBeGreaterThan(0);
    }
  });

  it("partner IDs are unique", () => {
    const ids = CONSORTIUM_PARTNERS.map(p => p.id);
    expect(new Set(ids).size).toEqual(ids.length);
  });

  it("covers all 9 regions", () => {
    const regions = new Set(CONSORTIUM_PARTNERS.map(p => p.region));
    expect(regions.size).toEqual(9);
  });
});
