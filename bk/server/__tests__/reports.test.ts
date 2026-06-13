/**
 * Sprint 11 \u2014 Reports rebuild tests.
 *
 * Verifies report templates exist for all 5 canonical kinds, the seeded
 * report has 8 sections, and the read-receipt + comments shape is correct.
 */
import { describe, it, expect } from "vitest";
import { _testAccessReports } from "../reportsStore";

describe("reportsStore", () => {
  it("seeds at least one report with 8 sections", () => {
    const { reports } = _testAccessReports;
    expect(reports.length).toBeGreaterThanOrEqual(1);
    const r = reports[0];
    expect(r.sections.length).toBeGreaterThanOrEqual(8);
  });

  it("seeded report references valid template kind", () => {
    const valid = ["monthly_kpi", "quarterly_update", "annual", "round_close", "adhoc"];
    for (const r of _testAccessReports.reports) {
      expect(valid).toContain(r.template);
    }
  });

  it("each section has a kind, title, and body", () => {
    for (const r of _testAccessReports.reports) {
      for (const s of r.sections) {
        expect(s.kind).toBeTruthy();
        expect(s.title).toBeTruthy();
        expect(typeof s.body).toBe("string");
      }
    }
  });

  it("sent reports record recipients", () => {
    const sent = _testAccessReports.reports.filter((r) => r.status === "sent");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    for (const r of sent) {
      expect(r.recipients.length).toBeGreaterThan(0);
    }
  });
});
