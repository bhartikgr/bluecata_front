/**
 * WAVE 1 — AVI-ACCRED evidence: the 412 gate is satisfied from the investor
 * side WITHOUT touching the money core.
 *
 * The money-core gate at captableCommitStore.ts:872 returns 412
 * ACCREDITATION_REQUIRED when `hasAccreditedDeclaration(investorUserId)` is
 * false. This test captures the before/after of that predicate through the
 * existing, migration-0103-backed compliance path (recordAccreditationDeclaration),
 * proving the investor path clears the gate.
 */
import { describe, it, expect, beforeAll } from "vitest";
import "../db/connection"; // ensure inline self-heal has created 0103 tables
import {
  hasAccreditedDeclaration,
  recordAccreditationDeclaration,
  getLatestDeclaration,
} from "../investorComplianceRoutes";
import { ACCREDITATION_CRITERIA } from "@shared/accreditationClause";

const TEST_USER = `u_wave1_accred_${Date.now()}`;

describe("WAVE 1 AVI-ACCRED — 412 gate before/after (investor-side)", () => {
  it("BEFORE: fresh investor has no declaration → gate predicate false (would 412)", () => {
    const before = hasAccreditedDeclaration(TEST_USER);
    // eslint-disable-next-line no-console
    console.log("[WAVE1-ACCRED before] hasAccreditedDeclaration:", before, "declaration:", getLatestDeclaration(TEST_USER));
    expect(before).toBe(false);
  });

  it("AFTER: investor self-declares → predicate true → 412 no longer fires", () => {
    const criterionId = ACCREDITATION_CRITERIA[0]?.id;
    expect(criterionId).toBeTruthy();
    const res = recordAccreditationDeclaration(TEST_USER, {
      signatureName: "Wave One Investor",
      criteria: [criterionId],
      jurisdiction: "United States",
    });
    // eslint-disable-next-line no-console
    console.log("[WAVE1-ACCRED record]", JSON.stringify(res));
    expect(res.ok).toBe(true);
    const after = hasAccreditedDeclaration(TEST_USER);
    // eslint-disable-next-line no-console
    console.log("[WAVE1-ACCRED after] hasAccreditedDeclaration:", after);
    expect(after).toBe(true);
  });

  it("re-declaration is append-only (a second POST writes a new row, still valid)", () => {
    const criterionId = ACCREDITATION_CRITERIA[0]?.id;
    const first = getLatestDeclaration(TEST_USER);
    const res2 = recordAccreditationDeclaration(TEST_USER, {
      signatureName: "Wave One Investor",
      criteria: [criterionId],
      jurisdiction: "United States",
    });
    expect(res2.ok).toBe(true);
    const second = getLatestDeclaration(TEST_USER);
    expect(second).toBeTruthy();
    // append-only: a new row id, still accredited
    if (first && second) expect(second.id).not.toBe(first.id);
    expect(hasAccreditedDeclaration(TEST_USER)).toBe(true);
  });
});
