/**
 * Sprint 11 — multi-company auth tests.
 *
 * Verifies the multi-company store: every founder has at least three
 * companies seeded, exactly one is the active company at boot, and
 * setActiveCompanyId() flips the active company atomically.
 */
import { describe, it, expect } from "vitest";
import {
  getCompaniesForFounder,
  getActiveCompanyId,
  setActiveCompanyId,
  getMockUser,
} from "../multiCompanyStore";

describe("multiCompanyStore", () => {
  it("seeds three companies for the demo founder", () => {
    const companies = getCompaniesForFounder();
    expect(companies.length).toBeGreaterThanOrEqual(3);
    expect(companies.map((c) => c.companyId).sort()).toEqual(
      expect.arrayContaining(["co_novapay", "co_arboreal", "co_kelvin"])
    );
  });

  it("getMockUser returns a stable identity", () => {
    const u = getMockUser();
    expect(u.id).toBeTruthy();
    expect(u.email).toMatch(/@/);
  });

  it("has exactly one active company at any time", () => {
    const id = getActiveCompanyId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    const companies = getCompaniesForFounder();
    expect(companies.find((c) => c.companyId === id)).toBeTruthy();
  });

  it("setActiveCompanyId flips the active company atomically", () => {
    const before = getActiveCompanyId();
    const target = getCompaniesForFounder().find((c) => c.companyId !== before);
    expect(target).toBeTruthy();

    const ok = setActiveCompanyId(target!.companyId);
    expect(ok).toBe(true);

    const after = getActiveCompanyId();
    expect(after).toBe(target!.companyId);

    // Restore for other test ordering
    setActiveCompanyId(before);
  });

  it("setActiveCompanyId rejects an unknown company id", () => {
    expect(setActiveCompanyId("co_nonexistent")).toBe(false);
  });

  it("each company has a billing plan, KPI snapshot, and role", () => {
    for (const c of getCompaniesForFounder()) {
      expect(c.companyName).toBeTruthy();
      expect(c.legalName).toBeTruthy();
      expect(["founder", "co-founder", "operator", "advisor"]).toContain(c.role);
      expect(typeof c.kpi.capTableHolders).toBe("number");
      expect(typeof c.kpi.activeRoundsCount).toBe("number");
      expect(typeof c.kpi.raisedThisYearUsd).toBe("number");
      expect(["Founder Free", "Founder Pro", "Founder Scale"]).toContain(c.billing.plan);
    }
  });
});
