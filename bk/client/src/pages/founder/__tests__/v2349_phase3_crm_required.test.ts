/**
 * v23.4.9 Phase 3 — CRMNew frontend required-field gating.
 *
 * Shadie (BUGs 007 + 008): "Created New Investor Contact and could save it
 * without any input." Server returns VALIDATION_FAILED (v23.4.5); the frontend
 * must now also block submission, mirroring Company.tsx's missingRequired().
 *
 * Source-grep style assertions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CRM_NEW = readFileSync(
  resolve(__dirname, "..", "CRMNew.tsx"),
  "utf8",
);

describe("v23.4.9 Phase 3 — CRMNew required-field gating", () => {
  it("mirrors the missingRequired() pattern from Company.tsx", () => {
    expect(CRM_NEW).toMatch(/const missingRequired = \(\): string\[\] =>/);
    expect(CRM_NEW).toMatch(/missing\.push\("Firm name"\)/);
    expect(CRM_NEW).toMatch(/missing\.push\("Email"\)/);
  });

  it("computes validity and disables Save until required fields are filled", () => {
    expect(CRM_NEW).toMatch(/const isCrmValid = requiredMissingList\.length === 0/);
    expect(CRM_NEW).toMatch(/disabled=\{saveMut\.isPending \|\| !isCrmValid\}/);
  });

  it("marks the required fields (Firm name, Email) with asterisks", () => {
    expect(CRM_NEW).toMatch(/Firm name <span className="text-rose-500">\*<\/span>/);
    expect(CRM_NEW).toMatch(/Email <span className="text-rose-500">\*<\/span>/);
  });

  it("guards the save mutation against submission when invalid", () => {
    expect(CRM_NEW).toMatch(/title: "Missing required fields"/);
  });
});
