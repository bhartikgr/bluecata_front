/**
 * Sprint 15 D1 — UserContext computation tests.
 *
 * Covers each of the 5 investor states + founder permutations + collective
 * overlay. Pure unit tests against `getUserContextForId` so we don't pay
 * the HTTP round-trip cost.
 */
import { describe, it, expect } from "vitest";
import {
  getUserContextForId,
  computeInvestorState,
  type InvestorState,
} from "../lib/userContext";

describe("Sprint 15 / UserContext — persona resolution", () => {
  it("returns founder context for u_maya_chen with 3 companies + active selection", () => {
    const ctx = getUserContextForId("u_maya_chen");
    expect(ctx.userId).toBe("u_maya_chen");
    expect(ctx.isAuthed).toBe(true);
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.founder.companies.length).toBeGreaterThanOrEqual(2);
    expect(ctx.founder.activeCompanyId).toBeTruthy();
    expect(ctx.investor.capTablePositions.length).toBe(0);
    expect(ctx.investor.state).toBe("NONE");
  });

  it("returns investor context for u_aisha_patel — State 3 (cap-table + active Collective)", () => {
    const ctx = getUserContextForId("u_aisha_patel");
    expect(ctx.investor.capTablePositions.length).toBeGreaterThanOrEqual(2);
    expect(ctx.collective.status).toBe("active");
    expect(ctx.investor.state).toBe("ON_CAP_TABLE_COLLECTIVE_ACTIVE");
  });

  it("returns State 4 (cap-table + lapsed Collective) for u_lapsed_lp", () => {
    const ctx = getUserContextForId("u_lapsed_lp");
    expect(ctx.investor.capTablePositions.length).toBeGreaterThan(0);
    expect(ctx.collective.status).toBe("lapsed");
    expect(ctx.investor.state).toBe("ON_CAP_TABLE_COLLECTIVE_LAPSED");
  });

  it("returns State 1 INVITED_ONLY for u_no_position", () => {
    const ctx = getUserContextForId("u_no_position");
    expect(ctx.investor.capTablePositions.length).toBe(0);
    expect(ctx.investor.invitedRounds.length).toBeGreaterThan(0);
    expect(ctx.investor.state).toBe("INVITED_ONLY");
    expect(ctx.collective.status).toBe("none");
  });

  it("returns admin context for u_admin", () => {
    const ctx = getUserContextForId("u_admin");
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.investor.state).toBe("NONE");
  });

  it("returns isAuthed=false for unknown user id", () => {
    const ctx = getUserContextForId("u_does_not_exist");
    expect(ctx.isAuthed).toBe(false);
    expect(ctx.investor.state).toBe("NONE");
  });
});

describe("Sprint 15 / UserContext — investor state machine", () => {
  const states: { name: InvestorState; args: Parameters<typeof computeInvestorState>[0] }[] = [
    {
      name: "NONE",
      args: { isInvestor: false, invitedRounds: [], capTablePositions: [], collectiveStatus: "none" },
    },
    {
      name: "INVITED_ONLY",
      args: {
        isInvestor: true,
        invitedRounds: [{ invitationId: "i1", roundId: "r1", companyId: "c1", companyName: "C1", roundName: "R", state: "viewed", receivedAt: "x", expiresAt: "y" }],
        capTablePositions: [],
        collectiveStatus: "none",
      },
    },
    {
      name: "ON_CAP_TABLE",
      args: {
        isInvestor: true,
        invitedRounds: [],
        capTablePositions: [{ companyId: "c1", companyName: "C1", ownershipPct: 0.05 }],
        collectiveStatus: "none",
      },
    },
    {
      name: "ON_CAP_TABLE_COLLECTIVE_ACTIVE",
      args: {
        isInvestor: true,
        invitedRounds: [],
        capTablePositions: [{ companyId: "c1", companyName: "C1", ownershipPct: 0.05 }],
        collectiveStatus: "active",
      },
    },
    {
      name: "ON_CAP_TABLE_COLLECTIVE_LAPSED",
      args: {
        isInvestor: true,
        invitedRounds: [],
        capTablePositions: [{ companyId: "c1", companyName: "C1", ownershipPct: 0.05 }],
        collectiveStatus: "lapsed",
      },
    },
  ];

  for (const tc of states) {
    it(`computes ${tc.name}`, () => {
      expect(computeInvestorState(tc.args)).toBe(tc.name);
    });
  }

  it("State 5 — exited cap-table investor with no invitations falls back to NONE", () => {
    expect(
      computeInvestorState({
        isInvestor: true,
        invitedRounds: [],
        capTablePositions: [],
        collectiveStatus: "none",
      }),
    ).toBe("NONE");
  });
});

describe("Sprint 15 / UserContext — collective overlay coherence", () => {
  it("u_aisha_patel has expiresAt populated for active membership", () => {
    const ctx = getUserContextForId("u_aisha_patel");
    expect(ctx.collective.expiresAt).toBeTruthy();
  });

  it("u_no_position has collective.status === 'none' and role === null", () => {
    const ctx = getUserContextForId("u_no_position");
    expect(ctx.collective.status).toBe("none");
    expect(ctx.collective.role).toBeNull();
  });

  it("founder personas have collective.status === 'none' (founder collective is per-company)", () => {
    const ctx = getUserContextForId("u_maya_chen");
    expect(ctx.collective.status).toBe("none");
  });
});
