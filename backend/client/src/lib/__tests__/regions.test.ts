/**
 * Sprint 11 \u2014 9-region coverage test.
 *
 * Locks the canonical region list at 9: US, CA, UK, SG, HK, CN, IN, JP, AU.
 * Every region dropdown / partner table / term-sheet template must reference
 * this list. The test guards against silent regressions where someone
 * truncates the list.
 */
import { describe, it, expect } from "vitest";
import { REGION_CODES, REGIONS_ALL, REGION_NAME, isRegion9 } from "../regions";

describe("regions \u2014 9-region constant", () => {
  it("includes exactly the 9 canonical region codes", () => {
    expect(REGION_CODES.length).toBe(9);
    expect([...REGION_CODES].sort()).toEqual(["AU", "CA", "CN", "HK", "IN", "JP", "SG", "UK", "US"]);
  });

  it("REGIONS_ALL has a label for every code", () => {
    for (const code of REGION_CODES) {
      const found = REGIONS_ALL.find((r) => r.code === code);
      expect(found).toBeTruthy();
      expect(found!.name).toBeTruthy();
    }
  });

  it("REGION_NAME map covers every code", () => {
    for (const code of REGION_CODES) {
      expect(REGION_NAME[code]).toBeTruthy();
    }
  });

  it("isRegion9 accepts all 9 and rejects unknowns", () => {
    for (const code of REGION_CODES) {
      expect(isRegion9(code)).toBe(true);
    }
    expect(isRegion9("DE")).toBe(false);
    expect(isRegion9("FR")).toBe(false);
    expect(isRegion9("")).toBe(false);
    expect(isRegion9("us")).toBe(false); // case-sensitive
  });
});
