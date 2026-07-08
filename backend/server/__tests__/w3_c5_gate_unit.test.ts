/**
 * W3-C — requireCollectiveMember C-5 gate, unit-level.
 *
 * Directly exercises the middleware with a controlled userContext so we can
 * cover the two paths that are awkward over HTTP:
 *   - admin bypass (isAdmin=true) — admitted with NO cap-table / accreditation
 *   - accreditation READ THROW — fail-closed in STRICT (deny), never-blocks in SOFT
 *
 * hasAccreditedDeclaration is mocked so we can force a throw deterministically;
 * isOnCapTable is the real implementation seeded via the test seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

// Mock ONLY the accreditation read the gate consumes.
vi.mock("../investorComplianceRoutes", () => ({
  hasAccreditedDeclaration: vi.fn(() => false),
}));

import { requireCollectiveMember } from "../lib/requireCollectiveMember";
import { hasAccreditedDeclaration } from "../investorComplianceRoutes";
import { upsertActiveMembership, upsertCapTablePositionForTests } from "../membershipStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

const mockedHas = vi.mocked(hasAccreditedDeclaration);

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
  mockedHas.mockReset();
  mockedHas.mockReturnValue(false);
  delete process.env.COLLECTIVE_C5_ACCRED_ENFORCE;
});

afterEach(() => {
  delete process.env.COLLECTIVE_C5_ACCRED_ENFORCE;
});

describe("W3-C — C-5 gate unit", () => {
  it("admin bypass: isAdmin=true is admitted with no cap-table and no accreditation", () => {
    const { req, res } = makeReqRes({ userId: "u_admin_bypass", isAdmin: true });
    const next = vi.fn();
    process.env.COLLECTIVE_C5_ACCRED_ENFORCE = "strict"; // even in strict
    requireCollectiveMember(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect((res as any).statusCode).toBe(0);
    // accreditation read must not even be consulted for admins
    expect(mockedHas).not.toHaveBeenCalled();
  });

  it("accreditation read THROWS + STRICT → fail-closed 403 ACCREDITATION_NOT_DECLARED", () => {
    const uid = "u_readthrow_strict";
    collectiveMembershipStore.activate(uid, "u_admin");
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    mockedHas.mockImplementation(() => { throw new Error("boom"); });
    process.env.COLLECTIVE_C5_ACCRED_ENFORCE = "strict";

    const { req, res } = makeReqRes({ userId: uid, collective: { status: "active" } });
    const next = vi.fn();
    requireCollectiveMember(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).statusCode).toBe(403);
    expect((res as any).body.error).toBe("ACCREDITATION_NOT_DECLARED");
    collectiveMembershipStore.deactivate(uid, "u_admin");
  });

  it("accreditation read THROWS + SOFT (default) → admitted (never blocks admission)", () => {
    const uid = "u_readthrow_soft";
    collectiveMembershipStore.activate(uid, "u_admin");
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    mockedHas.mockImplementation(() => { throw new Error("boom"); });
    // COLLECTIVE_C5_ACCRED_ENFORCE unset → SOFT

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
