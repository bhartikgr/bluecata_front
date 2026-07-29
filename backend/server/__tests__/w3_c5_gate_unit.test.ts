/**
 * W3-C — requireCollectiveMember C-5 gate, unit-level.
 *
 * Directly exercises the middleware with a controlled userContext so we can
 * cover the paths that are awkward over HTTP:
 *   - admin bypass (isAdmin=true) — admitted with NO cap-table / accreditation
 *   - accreditation READ THROW — fail-closed deny
 *   - accreditation resolved "none" — deny, with an ACTIONABLE distinct code
 *   - accreditation resolved self_certified/verified — admitted
 *
 * The accreditation read is mocked so we can force a throw deterministically;
 * isOnCapTable is the real implementation seeded via the test seam.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRIAGE (a) STALE TEST — this file encoded a retired contract in THREE ways.
 *
 * 1. WRONG MOCK TARGET. It mocked `hasAccreditedDeclaration`, but
 *    `requireCollectiveMember` imports and calls `getAccreditationGateStatus`
 *    (requireCollectiveMember.ts:44, :184) and never calls
 *    `hasAccreditedDeclaration` at all (0 references). Because `vi.mock`
 *    replaced the whole module with an object that lacked
 *    `getAccreditationGateStatus`, the gate's own call threw a TypeError, hit
 *    the gate's catch, and answered 403 ACCREDITATION_STATUS_UNAVAILABLE. The
 *    "read throws" cases were therefore passing/failing for the wrong reason:
 *    the throw came from the missing stub, not from the seeded failure.
 *
 * 2. RETIRED FEATURE FLAG. The file drove a SOFT/STRICT dual mode via
 *    `COLLECTIVE_C5_ACCRED_ENFORCE`. That flag no longer exists anywhere in
 *    product code — the only surviving mentions in the whole tree were these
 *    tests plus one now-corrected comment in investorComplianceRoutes.ts. The
 *    accreditation sub-check is now unconditional first-sign-on capture.
 *
 * 3. RETIRED ERROR CODE. It expected `ACCREDITATION_NOT_DECLARED`, a string
 *    that exists nowhere in product code. The single old code was deliberately
 *    split into two more specific ones so the client can tell a transient read
 *    failure from a genuine missing declaration:
 *      • ACCREDITATION_STATUS_UNAVAILABLE  (read failed — retry)
 *      • ACCREDITATION_DECLARATION_REQUIRED (none on file — go declare)
 *
 * WHY THE CURRENT PRODUCT BEHAVIOUR IS RIGHT (i.e. this is (a), not (b)):
 * the deny path is not a dead end — it returns `requiresAccreditationDeclaration:
 * true` plus `declarationEndpoint`, and the client implements exactly that
 * handshake: `CollectiveMemberGate.tsx:250` branches on the flag and renders
 * `collective/CollectiveAccreditationBlocker.tsx`, which posts the declaration
 * and re-enters. A whole UI surface exists for this block, and the W3-B
 * declaration-capture route tests in the sibling file all pass. That is a
 * designed first-sign-on capture flow, not a lost feature flag.
 *
 * NO CASE WAS DROPPED. The two stale cases are re-pointed at the real contract
 * (deny-on-throw keeps its deny assertion; the old "SOFT → admitted" case keeps
 * its ADMITTED assertion but earns admission the way the product now allows —
 * with a declaration on file), and one case was ADDED for the resolved-"none"
 * code. 4 cases → 5.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// Mock the accreditation read the gate actually consumes.
vi.mock("../investorComplianceRoutes", () => ({
  getAccreditationGateStatus: vi.fn(() => ({
    status: "none",
    signedCurrent: false,
    declaration: null,
    source: "none",
  })),
  // Retained so any other consumer of this module in the graph still resolves.
  hasAccreditedDeclaration: vi.fn(() => false),
}));

import { requireCollectiveMember } from "../lib/requireCollectiveMember";
import { getAccreditationGateStatus } from "../investorComplianceRoutes";
import { upsertActiveMembership, upsertCapTablePositionForTests } from "../membershipStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

const mockedGateStatus = vi.mocked(getAccreditationGateStatus);

function makeReqRes(ctx: any) {
  const req = { userContext: ctx, headers: {} } as unknown as Request;
  const res = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  } as unknown as Response & { statusCode: number; body: any };
  return { req, res };
}

beforeEach(() => {
  mockedGateStatus.mockReset();
  mockedGateStatus.mockReturnValue({
    status: "none",
    signedCurrent: false,
    declaration: null,
    source: "none",
  } as any);
});

describe("W3-C — C-5 gate unit", () => {
  it("admin bypass: isAdmin=true is admitted with no cap-table and no accreditation", () => {
    const { req, res } = makeReqRes({ userId: "u_admin_bypass", isAdmin: true });
    const next = vi.fn();
    requireCollectiveMember(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect((res as any).statusCode).toBe(0);
    // The accreditation read must not even be consulted for admins. This now
    // asserts against the dependency the gate ACTUALLY calls — previously it
    // asserted `hasAccreditedDeclaration` was not called, which the gate never
    // calls under any circumstances, so the assertion was vacuously true.
    expect(mockedGateStatus).not.toHaveBeenCalled();
  });

  it("accreditation read THROWS → fail-closed 403 ACCREDITATION_STATUS_UNAVAILABLE", () => {
    const uid = "u_readthrow_strict";
    collectiveMembershipStore.activate(uid, "u_admin");
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    mockedGateStatus.mockImplementation(() => { throw new Error("boom"); });

    const { req, res } = makeReqRes({ userId: uid, collective: { status: "active" } });
    const next = vi.fn();
    requireCollectiveMember(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).statusCode).toBe(403);
    // Distinct from the not-declared code: a transient read failure is
    // retryable, so the client must not send the user to the declaration form.
    expect((res as any).body.error).toBe("ACCREDITATION_STATUS_UNAVAILABLE");
    collectiveMembershipStore.deactivate(uid, "u_admin");
  });

  it("accreditation resolves 'none' → 403 ACCREDITATION_DECLARATION_REQUIRED (actionable)", () => {
    const uid = "u_accred_none";
    collectiveMembershipStore.activate(uid, "u_admin");
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    mockedGateStatus.mockReturnValue({
      status: "none",
      signedCurrent: false,
      declaration: null,
      source: "none",
    } as any);

    const { req, res } = makeReqRes({ userId: uid, collective: { status: "active" } });
    const next = vi.fn();
    requireCollectiveMember(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).statusCode).toBe(403);
    expect((res as any).body.error).toBe("ACCREDITATION_DECLARATION_REQUIRED");
    // The block must be resolvable by the user, which is what makes the
    // unconditional enforcement acceptable rather than a lockout.
    expect((res as any).body.requiresAccreditationDeclaration).toBe(true);
    expect((res as any).body.declarationEndpoint).toBe(
      "/api/investor/compliance/accreditation-declaration",
    );
    collectiveMembershipStore.deactivate(uid, "u_admin");
  });

  it("accreditation resolves self_certified → admitted (declaration on file unblocks)", () => {
    const uid = "u_readthrow_soft";
    collectiveMembershipStore.activate(uid, "u_admin");
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    mockedGateStatus.mockReturnValue({
      status: "self_certified",
      signedCurrent: true,
      declaration: null,
      source: "declaration",
    } as any);

    const { req, res } = makeReqRes({ userId: uid, collective: { status: "active" } });
    const next = vi.fn();
    requireCollectiveMember(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((res as any).statusCode).toBe(0);
    collectiveMembershipStore.deactivate(uid, "u_admin");
  });

  it("cap-table hard gate: active member without a cap-table position → 403 not_on_cap_table", () => {
    const uid = "u_unit_nocaptable";
    collectiveMembershipStore.activate(uid, "u_admin");
    upsertActiveMembership(uid);
    // no cap-table position

    const { req, res } = makeReqRes({ userId: uid, collective: { status: "active" } });
    const next = vi.fn();
    requireCollectiveMember(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).statusCode).toBe(403);
    expect((res as any).body.error).toBe("not_on_cap_table");
    collectiveMembershipStore.deactivate(uid, "u_admin");
  });
});
