/**
 * v13 — Avi's Issue 7: Settings tabs.
 *
 * Original v13: Avi reported that Settings changes did not persist. Team /
 * Billing / Notifications tabs were marked "Coming soon" so testers didn't
 * expect saves to persist before Friday's go-live.
 *
 * v23.4.4 (BUG 015 from Shadie): the "Coming soon" badges were removed from
 * Team / Billing / Notifications because the underlying stores now persist
 * through the standard API mutation path. This test is updated to assert
 * the new behavior: the tabs exist, but no longer carry the "Coming soon"
 * badge. The Company tab is unchanged (always was DB-backed).
 *
 * This is a source-marker test on client/src/pages/founder/Settings.tsx.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("v23.4.4 BUG-015 — settings tabs no longer marked 'Coming soon'", () => {
  it("Team / Billing / Notifications tabs no longer carry the Coming soon badge", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "client", "src", "pages", "founder", "Settings.tsx"),
      "utf8",
    );
    // The tabs themselves must still exist (we didn't delete the surfaces).
    expect(src).toMatch(/data-testid="tab-team"/);
    expect(src).toMatch(/data-testid="tab-billing"/);
    expect(src).toMatch(/data-testid="tab-notifications"/);
    // But the "Coming soon" badges and their data-testids must be gone.
    expect(src).not.toMatch(/data-testid="badge-team-soon"/);
    expect(src).not.toMatch(/data-testid="badge-billing-soon"/);
    expect(src).not.toMatch(/data-testid="badge-notifications-soon"/);
    // v23.4.4 banner comment is the marker for this fix.
    expect(src).toMatch(/v23\.4\.4.*BUG[ -]?015|BUG[ -]?015.*v23\.4\.4/);
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
