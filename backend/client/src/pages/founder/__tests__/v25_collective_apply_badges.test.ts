/**
 * v23.5 — C-006-client, C-012, C-014-client regression guards.
 *
 * Static source analysis confirming:
 *
 * C-006-client (Group AC):
 *   - founderApplyToCollective has /mine query
 *   - Status banner with data-testid="banner-application-status"
 *   - Handles all application status types
 *
 * C-012 (Group AD):
 *   - Submit button always enabled (not gated by canSubmit on all fields)
 *   - validateAndSubmit function exists
 *   - fieldErrors state + error summary UI
 *   - Toast shows "N field(s) need attention"
 *
 * C-014-client (Group AC):
 *   - investorApplyToCollective has /mine query
 *   - Status banner for investor application
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FOUNDER_APPLY_SRC = readFileSync(
  resolve(__dirname, "../ApplyToCollective.tsx"),
  "utf8",
);

const INVESTOR_APPLY_SRC = readFileSync(
  resolve(__dirname, "../../investor/ApplyToCollective.tsx"),
  "utf8",
);

describe("v23.5 C-006-client: founder application status badge", () => {
  it("fetches from /api/founder/collective/applications/mine", () => {
    expect(FOUNDER_APPLY_SRC).toContain("/api/founder/collective/applications/mine");
  });

  it("has banner-application-status testid", () => {
    expect(FOUNDER_APPLY_SRC).toContain('data-testid="banner-application-status"');
  });

  it("handles submitted status in banner", () => {
    expect(FOUNDER_APPLY_SRC).toContain("submitted");
    expect(FOUNDER_APPLY_SRC).toContain("under review");
  });

  it("handles rejected status in banner", () => {
    expect(FOUNDER_APPLY_SRC).toContain("Not selected this cycle");
  });

  it("handles invited/accepted status in banner", () => {
    expect(FOUNDER_APPLY_SRC).toContain("Accepted on");
  });

  it("has C-006 v23.5 marker comment", () => {
    expect(FOUNDER_APPLY_SRC).toContain("C-006 v23.5");
  });
});

describe("v23.5 C-012: Path B form validation feedback", () => {
  it("has validateAndSubmit function (C-012)", () => {
    expect(FOUNDER_APPLY_SRC).toContain("validateAndSubmit");
  });

  it("has fieldErrors state", () => {
    expect(FOUNDER_APPLY_SRC).toContain("fieldErrors");
  });

  it("shows error count toast message", () => {
    expect(FOUNDER_APPLY_SRC).toContain("field(s) need attention");
  });

  it("has validation-errors testid for the error summary div", () => {
    expect(FOUNDER_APPLY_SRC).toContain('data-testid="validation-errors"');
  });

  it("submit button calls validateAndSubmit not submitMut.mutate directly", () => {
    expect(FOUNDER_APPLY_SRC).toContain("onClick={validateAndSubmit}");
  });

  it("has C-012 v23.5 marker comment", () => {
    expect(FOUNDER_APPLY_SRC).toContain("C-012 v23.5");
  });

  it("validates asks minimum 20 chars", () => {
    expect(FOUNDER_APPLY_SRC).toContain("asks.length < 20");
  });

  it("validates coverLetter minimum 100 chars", () => {
    expect(FOUNDER_APPLY_SRC).toContain("coverLetter.length < 100");
  });

  it("validates feeAcknowledged checkbox", () => {
    expect(FOUNDER_APPLY_SRC).toContain("feeAcknowledged");
  });
});

describe("v23.5 C-014-client: investor application status badge", () => {
  it("fetches from /api/collective/applications/mine", () => {
    expect(INVESTOR_APPLY_SRC).toContain("/api/collective/applications/mine");
  });

  it("has banner-investor-application-status testid", () => {
    expect(INVESTOR_APPLY_SRC).toContain('data-testid="banner-investor-application-status"');
  });

  it("handles submitted status in investor banner", () => {
    expect(INVESTOR_APPLY_SRC).toContain("Application submitted");
  });

  it("handles accepted status in investor banner", () => {
    expect(INVESTOR_APPLY_SRC).toContain("Accepted");
  });

  it("has C-014 v23.5 marker comment", () => {
    expect(INVESTOR_APPLY_SRC).toContain("C-014 v23.5");
  });
});
