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
  resolveCompanyName,
  resolveRoundName,
  type InvestorState,
} from "../lib/userContext";
import { createRound } from "../roundsStore";

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

// B-509 fix v23.6.1 — invited-round name resolution.
// The investor dashboard previously rendered raw `co_*` ids and the literal
// "Invited Round". buildInvitedRounds now resolves human-readable names via
// these exported helpers (multiCompanyStore.getCompanyNameById +
// roundsStore.getRoundById). These assert real resolution and safe fallbacks.
describe("B-509 — buildInvitedRounds name resolution", () => {
  it("resolves a known company name from the company store (not the raw id)", () => {
    const name = resolveCompanyName("co_novapay");
    expect(name).toBe("NovaPay AI");
    expect(name).not.toBe("co_novapay");
  });

  it("falls back to a truncated company id (never the full raw id) when unknown", () => {
    const unknown = "co_deadbeefdeadbeef";
    const name = resolveCompanyName(unknown);
    expect(name).toBe("Company co_deadb");
    expect(name).not.toBe(unknown);
  });

  it("resolves a real round name from roundsStore.getRoundById", () => {
    const round = createRound({
      companyId: "co_novapay",
      name: "Series B — B-509 resolution test",
      type: "priced",
    });
    const name = resolveRoundName(round.id);
    expect(name).toBe("Series B — B-509 resolution test");
  });

  it("falls back to a truncated round id when the round is unknown", () => {
    const name = resolveRoundName("rnd_unknownxyz");
    expect(name).toBe("Round rnd_unkn");
    expect(name).not.toBe("Invited Round");
  });

  it("uses the literal 'Invited Round' only when roundId is missing", () => {
    expect(resolveRoundName("")).toBe("Invited Round");
  });
});
