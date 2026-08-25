/**
 * WAVE 134 · CAUSE 1 — PROOF THAT THE ACCREDITATION GATE STILL REFUSES.
 *
 * Wave 134 routed 20 Collective fixtures through one shared helper,
 * `server/__tests__/_fixtures/collectiveInvestorFixture.ts`, so that 121 previously
 * 403-ing (i.e. ABSENT) test blocks actually reach their assertions.
 *
 * The risk that creates is the whole reason this file exists: **a helper that
 * accidentally disabled the W2-A1 accreditation gate would turn 121 failing tests
 * into 121 tests that prove nothing** — far worse than the red we started from.
 * So this file pins, on the live middleware, that:
 *
 *   1. an ACTIVE member with a cap-table position but NO declaration is still
 *      refused 403 `ACCREDITATION_DECLARATION_REQUIRED` (the gate is intact);
 *   2. the same user is admitted ONLY after the shared helper records a real
 *      declaration through the production capture primitive;
 *   3. seating one investor does NOT admit anybody else — the helper acts
 *      per-user and cannot have flipped a global switch;
 *   4. the helper FAILS LOUDLY rather than silently seating a non-compliant
 *      investor (its postcondition is asserted, not assumed);
 *   5. a cap-table-EXEMPT member is still subject to accreditation capture —
 *      `capTableExempt` bypasses step 3 only, never step 4.
 *
 * Rulings: R98 (a stale test is updated to pin the CORRECT behaviour; assertions
 * are strengthened, never weakened) and R99 (root-cause programme).
 * Gate under test: `server/lib/requireCollectiveMember.ts`, step 4.
 * Triage: `build_log/wave133/FAILURE_TRIAGE_v26_23_0.md`, cause 1 (121 blocks).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

import { registerCollectiveRoutes } from "../collectiveRoutes";
import { installV14TestIdentity } from "./_v14TestIdentity";
import {
  seatCompliantInvestor,
  seatCollectiveMemberWithoutDeclaration,
} from "./_fixtures/collectiveInvestorFixture";
import { getAccreditationGateStatus } from "../investorComplianceRoutes";

const GATED_ROUTE = "/api/collective/dashboard";

/** Distinct ids per assertion — the gate is per-user and must be proved so. */
const UNDECLARED = "u_w134_member_undeclared";
const DECLARED = "u_w134_member_declared";
const BYSTANDER = "u_w134_member_bystander";
const EXEMPT_UNDECLARED = "u_w134_exempt_undeclared";

let app: Express;

function callGated(userId: string) {
  return request(app).get(GATED_ROUTE).set("x-user-id", userId).set("x-role", "standard");
}

beforeAll(() => {
  process.env.COLLECTIVE_ENABLED = "1";
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCollectiveRoutes(app);
});

afterAll(() => {
  delete process.env.COLLECTIVE_ENABLED;
});

describe("W134 cause 1 — the accreditation gate is INTACT", () => {
  it("refuses 403 ACCREDITATION_DECLARATION_REQUIRED for an active member with no declaration", async () => {
    seatCollectiveMemberWithoutDeclaration(UNDECLARED);
    expect(getAccreditationGateStatus(UNDECLARED).status).toBe("none");

    const r = await callGated(UNDECLARED);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("ACCREDITATION_DECLARATION_REQUIRED");
    // The refusal must stay client-actionable: the blocker UI reads both fields.
    expect(r.body.requiresAccreditationDeclaration).toBe(true);
    expect(r.body.declarationEndpoint).toBe(
      "/api/investor/compliance/accreditation-declaration",
    );
  });

  it("still refuses a cap-table-EXEMPT member with no declaration (exempt bypasses step 3 ONLY)", async () => {
    seatCollectiveMemberWithoutDeclaration(EXEMPT_UNDECLARED, { capTableExempt: true });

    const r = await callGated(EXEMPT_UNDECLARED);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("ACCREDITATION_DECLARATION_REQUIRED");
  });
});

describe("W134 cause 1 — the shared fixture admits ONLY by satisfying the gate", () => {
  it("admits a member once seatCompliantInvestor records a real declaration", async () => {
    // Before: the exact state every legacy Collective fixture left a member in.
    seatCollectiveMemberWithoutDeclaration(DECLARED);
    const before = await callGated(DECLARED);
    expect(before.status).toBe(403);
    expect(before.body.error).toBe("ACCREDITATION_DECLARATION_REQUIRED");

    // The one change: a genuine declaration via the production capture primitive.
    seatCompliantInvestor(DECLARED);
    expect(getAccreditationGateStatus(DECLARED).status).not.toBe("none");

    const after = await callGated(DECLARED);
    expect(after.status).toBe(200);
    expect(after.body.ok).not.toBe(false);
  });

  it("does NOT admit a different undeclared member — the gate is per-user, not a global switch", async () => {
    seatCompliantInvestor("u_w134_seated_first");
    seatCollectiveMemberWithoutDeclaration(BYSTANDER);

    const r = await callGated(BYSTANDER);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("ACCREDITATION_DECLARATION_REQUIRED");
  });

  it("THROWS rather than silently seating a non-compliant investor (criteria rejected)", () => {
    // A helper that swallowed this refusal would produce vacuous green tests.
    expect(() =>
      seatCompliantInvestor("u_w134_bad_criteria", { criteria: ["not_a_real_criterion"] }),
    ).toThrow(/CRITERIA_REQUIRED/);
    // And the user it failed on must NOT have been admitted by side effect.
    expect(getAccreditationGateStatus("u_w134_bad_criteria").status).toBe("none");
  });

  it("THROWS when the typed legal signature is missing (Rule #13 sign-off is mandatory)", () => {
    expect(() =>
      seatCompliantInvestor("u_w134_bad_signature", { signatureName: "" }),
    ).toThrow(/SIGNATURE_REQUIRED/);
    expect(getAccreditationGateStatus("u_w134_bad_signature").status).toBe("none");
  });
});
