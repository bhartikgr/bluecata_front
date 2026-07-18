/**
 * W-INVEST BUG B (Option 3) — investor shows "Active" on the founder roster when
 * committed/funded on THIS round OR already in the company's committed cap table.
 * These tests exercise the pure row-level predicate (server/lib/rosterActive.ts);
 * the route derives the committed-identity sets from the SACRED committed ledger.
 */
import { describe, it, expect } from "vitest";
import {
  isInvitationActive,
  isSoftCircleActive,
  type CommittedSets,
} from "../lib/rosterActive";

function sets(investorIds: string[], invitationIds: string[]): CommittedSets {
  return {
    committedInvestorIds: new Set(investorIds),
    committedInvitationIds: new Set(invitationIds),
  };
}

describe("W-INVEST BUG B — invitation Active predicate", () => {
  it("Active when committed on THIS round (invitationId in committed ledger)", () => {
    const s = sets([], ["inv-1"]);
    expect(isInvitationActive({ id: "inv-1" }, s)).toBe(true);
  });

  it("Active when the investor already holds a committed cap-table position (prior round)", () => {
    const s = sets(["user-9"], []);
    expect(isInvitationActive({ id: "inv-new", redeemedByUserId: "user-9" }, s)).toBe(true);
  });

  it("NOT Active when neither the invitation nor the investor is committed", () => {
    const s = sets(["user-1"], ["inv-other"]);
    expect(isInvitationActive({ id: "inv-2", redeemedByUserId: "user-2" }, s)).toBe(false);
  });

  it("NOT Active for an un-redeemed invite with no committed position", () => {
    const s = sets([], []);
    expect(isInvitationActive({ id: "inv-3", redeemedByUserId: null }, s)).toBe(false);
  });
});

describe("W-INVEST BUG B — soft-circle Active predicate", () => {
  it("Active when the soft-circle status is committed", () => {
    expect(isSoftCircleActive({ status: "committed" }, sets([], []))).toBe(true);
  });

  it("Active when the soft-circle status is wired", () => {
    expect(isSoftCircleActive({ status: "wired" }, sets([], []))).toBe(true);
  });

  it("Active when the investor is in the committed cap table by investorUserId", () => {
    expect(isSoftCircleActive({ status: "intent", investorUserId: "user-7" }, sets(["user-7"], []))).toBe(true);
  });

  it("Active when the soft-circle's invitation is committed on this round", () => {
    expect(isSoftCircleActive({ status: "intent", invitationId: "inv-5" }, sets([], ["inv-5"]))).toBe(true);
  });

  it("NOT Active for a plain intent with no committed identity", () => {
    expect(isSoftCircleActive({ status: "intent", investorUserId: "user-x", invitationId: "inv-x" }, sets(["user-y"], ["inv-y"]))).toBe(false);
  });
});
