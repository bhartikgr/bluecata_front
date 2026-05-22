/**
 * v13 — Avi's Issue 7: Settings tabs.
 *
 * Avi reported that Settings changes did not persist. The Company tab IS
 * already DB-backed (v11+v12 multiCompanyStore.updateCompanyDetails). The
 * Team / Billing / Notifications tabs do not yet write durably; v13 marks
 * them with "Coming soon" badges so testers don't expect saves to persist
 * before Friday's go-live.
 *
 * This is a source-marker test on client/src/pages/founder/Settings.tsx.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("v13 B-V13-7 — settings 'Coming soon' badges", () => {
  it("Team / Billing / Notifications tabs carry the Coming soon badge", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "client", "src", "pages", "founder", "Settings.tsx"),
      "utf8",
    );
    expect(src).toMatch(/B-V13-7 fix/);
    expect(src).toMatch(/Avi's Issue 7/);
    expect(src).toMatch(/data-testid="badge-team-soon"/);
    expect(src).toMatch(/data-testid="badge-billing-soon"/);
    expect(src).toMatch(/data-testid="badge-notifications-soon"/);
    expect(src).toMatch(/Coming soon/);
  });

  it("Company tab remains durable (no Coming soon on Company)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "client", "src", "pages", "founder", "Settings.tsx"),
      "utf8",
    );
    // Company tab must NOT carry a coming-soon badge (it's already DB-backed).
    const companyLine = src.split("\n").find((l) => l.includes('data-testid="tab-company"')) ?? "";
    expect(companyLine).not.toMatch(/Coming soon/);
  });

  it("multiCompanyStore.updateCompanyDetails is the DB-backed write path", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "multiCompanyStore.ts"),
      "utf8",
    );
    expect(src).toMatch(/export\s+(async\s+)?function\s+updateCompanyDetails|export\s+const\s+updateCompanyDetails/);
  });
});
