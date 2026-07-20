/**
 * W-FIX1f (2026-07-19) — SPV education + compliance helpers (SPV-EDU-1 / D6/D1/D7).
 *
 * The tabbed SPV detail page is UI; its jurisdiction-aware, NEVER-blocking logic
 * lives in pure helpers we can lock here:
 *   - investorCountAwareness (D6): US ~100 soft cap; other jurisdictions none.
 *   - formationChecklist (D1) + filingsChecklist (D7): jurisdiction-aware labels.
 *   - SPV_EDU copy exists for every journey step (SPV-EDU-1).
 */
import { describe, it, expect } from "vitest";
import {
  SPV_EDU,
  investorCountAwareness,
  formationChecklist,
  filingsChecklist,
  WIND_DOWN_CHECKLIST,
} from "@/lib/spvEducation";

describe("D6 — investorCountAwareness (jurisdiction-aware, never blocks)", () => {
  it("US / delaware surfaces the ~100 3(c)(1) soft cap", () => {
    const r = investorCountAwareness("delaware");
    expect(r.limit).toBe(100);
    expect(r.label).toMatch(/3\(c\)\(1\)/);
  });

  it("case-insensitive on jurisdiction string", () => {
    expect(investorCountAwareness("United States").limit).toBe(100);
    expect(investorCountAwareness("US").limit).toBe(100);
  });

  it("other jurisdictions assert NO numeric cap (stays silent)", () => {
    expect(investorCountAwareness("cayman").limit).toBeNull();
    expect(investorCountAwareness("bvi").limit).toBeNull();
    expect(investorCountAwareness(null).limit).toBeNull();
  });
});

describe("D1/D7 — jurisdiction-aware voluntary checklists", () => {
  it("US formation uses EIN; Cayman uses registered number; BVI uses company number", () => {
    expect(formationChecklist("delaware").some((s) => /EIN/.test(s))).toBe(true);
    expect(formationChecklist("cayman").some((s) => /Registered number/i.test(s))).toBe(true);
    expect(formationChecklist("bvi").some((s) => /Company number/i.test(s))).toBe(true);
  });

  it("US filings list Form D + blue sky; others defer to counsel", () => {
    const us = filingsChecklist("United States");
    expect(us.some((s) => /Form D/.test(s))).toBe(true);
    const other = filingsChecklist("cayman");
    expect(other.some((s) => /counsel/i.test(s))).toBe(true);
  });

  it("wind-down checklist follows notify → final distribution → dissolution → close", () => {
    expect(WIND_DOWN_CHECKLIST[0]).toMatch(/[Nn]otify/);
    expect(WIND_DOWN_CHECKLIST[WIND_DOWN_CHECKLIST.length - 1]).toMatch(/[Cc]lose/);
  });
});

describe("SPV-EDU-1 — plain-language copy exists for every journey step", () => {
  it("has non-empty copy for each documented step", () => {
    for (const key of [
      "whatIsAnSpv", "nameJurisdiction", "mandate", "fees", "terms", "reviewLaunch",
      "accreditation", "confirmingInvestments", "investorCount", "closing", "deploying",
      "distributions", "reporting", "filings", "windDown", "transfers", "capitalAccounts",
    ] as const) {
      expect(typeof SPV_EDU[key]).toBe("string");
      expect(SPV_EDU[key].length).toBeGreaterThan(20);
    }
  });
});
