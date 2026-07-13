/**
 * SPINE-0 (Wave 2) — unit tests for the canonical investor ladder + selectors.
 *
 * These lock the Ozan-locked semantics that every surface now depends on:
 *   - normalizeLadderState maps every raw/alias state onto the canonical rung,
 *     fail-closed to "invited" for unknown input (NEVER "funded").
 *   - accepted DOES count as pending (#3).
 *   - FIX #3 (count parity, Option A): the Invitations "Active" tab and the
 *     Dashboard pending badge count the IDENTICAL set = pendingInvitations
 *     (invited + viewed + accepted). isActiveStage stays a broader,
 *     separately-named helper and is NOT the "Active" tab.
 *   - soft_circled/confirmed/signed are visible in the "Soft-circle" tab, so an
 *     accepted invitation is visible in the Active tab and no invitation short
 *     of funded is ever dropped from all tabs.
 *   - eligibility = funded OR admin-granted, not accepted/soft-circled (#5).
 *   - channel unlock = soft_circled → round soft-circle channel, funded →
 *     cap-table channel, accepting alone unlocks nothing (#7).
 *   - a holding is NEVER fabricated from an invitation (#8, fail-closed).
 */
import { describe, it, expect } from "vitest";
import {
  INVESTOR_LADDER,
  normalizeLadderState,
  isLadderStage,
  isPendingStage,
  isActiveStage,
  isSoftCircledStage,
  isFundedStage,
  toSpineInvitations,
  selectPendingInvitations,
  selectActiveInvitations,
  selectSoftCircledInvitations,
  selectDeclinedInvitations,
  selectExpiredInvitations,
  selectHoldings,
  selectHasFundedPosition,
  selectChannelUnlockState,
  computeEligibilitySignals,
  type RawInvitationLike,
} from "../investor/investorSpine";

/* ---------------------------------------------------------------- */
/* normalizeLadderState                                             */
/* ---------------------------------------------------------------- */

describe("normalizeLadderState — canonical mapping per raw state", () => {
  it("maps the 10 YOUR_DECISION_STATES onto the canonical ladder", () => {
    expect(normalizeLadderState("pending")).toBe("invited");
    expect(normalizeLadderState("viewed")).toBe("viewed");
    expect(normalizeLadderState("accepted")).toBe("accepted");
    expect(normalizeLadderState("declined")).toBe("declined");
    expect(normalizeLadderState("soft_circled")).toBe("soft_circled");
    expect(normalizeLadderState("confirmed")).toBe("confirmed");
    expect(normalizeLadderState("signed")).toBe("signed");
    expect(normalizeLadderState("funded")).toBe("funded");
    expect(normalizeLadderState("expired")).toBe("expired");
    expect(normalizeLadderState("revoked")).toBe("revoked");
  });

  it("normalizes common aliases + is case/space tolerant", () => {
    expect(normalizeLadderState("Invited")).toBe("invited");
    expect(normalizeLadderState(" SENT ")).toBe("invited");
    expect(normalizeLadderState("opened")).toBe("viewed");
    expect(normalizeLadderState("soft-circled")).toBe("soft_circled");
    expect(normalizeLadderState("committed")).toBe("soft_circled");
    expect(normalizeLadderState("holding")).toBe("funded");
    expect(normalizeLadderState("wired")).toBe("funded");
    expect(normalizeLadderState("cancelled")).toBe("declined");
    expect(normalizeLadderState("lapsed")).toBe("expired");
  });

  it("fail-closes unknown/empty/nullish to the SAFEST rung (never funded)", () => {
    expect(normalizeLadderState("")).toBe("invited");
    expect(normalizeLadderState(null)).toBe("invited");
    expect(normalizeLadderState(undefined)).toBe("invited");
    expect(normalizeLadderState("garbage-xyz")).toBe("invited");
    // The critical safety invariant: nothing unknown may become a holding.
    expect(normalizeLadderState("garbage-xyz")).not.toBe("funded");
  });
});

describe("stage predicates", () => {
  it("isLadderStage excludes terminal states", () => {
    for (const s of INVESTOR_LADDER) expect(isLadderStage(s)).toBe(true);
    expect(isLadderStage("declined")).toBe(false);
    expect(isLadderStage("expired")).toBe(false);
    expect(isLadderStage("revoked")).toBe(false);
  });

  it("isPendingStage = invited + viewed + accepted (accepted DOES count, #3)", () => {
    expect(isPendingStage("invited")).toBe(true);
    expect(isPendingStage("viewed")).toBe(true);
    expect(isPendingStage("accepted")).toBe(true); // #3 core
    expect(isPendingStage("soft_circled")).toBe(false);
    expect(isPendingStage("funded")).toBe(false);
    expect(isPendingStage("declined")).toBe(false);
  });

  it("isActiveStage = full ladder short of funded (broader helper, NOT the Active tab)", () => {
    // FIX #3: isActiveStage is a separately-named "everything short of funded"
    // helper. The Invitations "Active" tab does NOT use it — it uses
    // isPendingStage for count parity with the Dashboard badge.
    expect(isActiveStage("invited")).toBe(true);
    expect(isActiveStage("accepted")).toBe(true);
    expect(isActiveStage("soft_circled")).toBe(true);
    expect(isActiveStage("confirmed")).toBe(true);
    expect(isActiveStage("signed")).toBe(true);
    expect(isActiveStage("funded")).toBe(false);
    expect(isActiveStage("declined")).toBe(false);
  });

  it("isSoftCircledStage = on/past soft-circle, short of funded", () => {
    expect(isSoftCircledStage("accepted")).toBe(false);
    expect(isSoftCircledStage("soft_circled")).toBe(true);
    expect(isSoftCircledStage("confirmed")).toBe(true);
    expect(isSoftCircledStage("signed")).toBe(true);
    expect(isSoftCircledStage("funded")).toBe(false);
  });

  it("isFundedStage only for funded", () => {
    expect(isFundedStage("funded")).toBe(true);
    expect(isFundedStage("signed")).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* Selectors + count parity                                         */
/* ---------------------------------------------------------------- */

function inv(id: string, state: string, roundId?: string): RawInvitationLike {
  return { id, state, round: roundId ? { id: roundId } : undefined };
}

describe("selectors group by spine buckets (single source of truth)", () => {
  // One invitation set exercised by BOTH Dashboard (#3) and Invitations (#4).
  const raw = [
    inv("a", "pending"),
    inv("b", "viewed"),
    inv("c", "accepted"),
    inv("d", "soft_circled", "r1"),
    inv("e", "signed", "r2"),
    inv("f", "funded"),
    inv("g", "declined"),
    inv("h", "expired"),
    inv("i", "revoked"),
  ];
  const spine = toSpineInvitations(raw);

  it("pending count = invited + viewed + accepted = 3 (Dashboard #3)", () => {
    expect(selectPendingInvitations(spine).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("selectActiveInvitations (broader helper) covers full ladder short of funded", () => {
    // This is the broader "everything short of funded" set — NOT the Active tab
    // (see the parity test below). Retained for any surface needing it.
    const active = selectActiveInvitations(spine).map((s) => s.id);
    expect(active).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("soft-circle / declined / expired buckets are exhaustive", () => {
    expect(selectSoftCircledInvitations(spine).map((s) => s.id)).toEqual(["d", "e"]);
    expect(selectDeclinedInvitations(spine).map((s) => s.id)).toEqual(["g"]);
    // expired bucket folds revoked in with expired
    expect(selectExpiredInvitations(spine).map((s) => s.id).sort()).toEqual(["h", "i"]);
  });

  it("FIX #3 PARITY: Dashboard pending badge === Invitations 'Active' tab (identical set)", () => {
    // Dashboard reads spine.pendingInvitations. The Invitations "Active" tab now
    // reads the SAME derivation (isPendingStage) instead of the broader
    // isActiveStage. Both MUST resolve to the identical invited+viewed+accepted
    // set — this is the count-parity gap GPT-5.5 found.
    const dashboardPending = selectPendingInvitations(spine);
    // Mirror the Invitations "Active" (pending) tab membership predicate exactly.
    const invitationsActive = spine.filter((s) => isPendingStage(s.stage));

    // Explicit equality of the counts (the core parity assertion).
    expect(dashboardPending.length).toBe(invitationsActive.length);
    expect(dashboardPending.length).toBe(3);
    // And the identical membership (same ids, same order).
    expect(invitationsActive.map((s) => s.id)).toEqual(dashboardPending.map((s) => s.id));
    expect(invitationsActive.map((s) => s.id)).toEqual(["a", "b", "c"]);

    // accepted is counted by BOTH (the specific mismatch the fix targets).
    expect(dashboardPending.some((s) => s.stage === "accepted")).toBe(true);
    expect(invitationsActive.some((s) => s.stage === "accepted")).toBe(true);

    // No silent drop: soft_circled/signed are NOT in Active, but ARE in the
    // Soft-circle tab (isSoftCircledStage) — every ladder invitation short of
    // funded still lands in exactly one tab.
    const softCircleTab = spine.filter((s) => isSoftCircledStage(s.stage)).map((s) => s.id);
    expect(softCircleTab).toEqual(["d", "e"]); // soft_circled + signed
    const funded = spine.filter((s) => s.stage === "funded").map((s) => s.id);
    // Union of pending + soft-circle tabs = all ladder invitations short of funded.
    const ladderShortOfFunded = spine
      .filter((s) => isActiveStage(s.stage))
      .map((s) => s.id)
      .sort();
    expect([...invitationsActive.map((s) => s.id), ...softCircleTab].sort()).toEqual(ladderShortOfFunded);
    expect(funded).toEqual(["f"]); // funded is a holding, surfaced in Portfolio
  });
});

/* ---------------------------------------------------------------- */
/* Holdings — fail-closed (#8)                                      */
/* ---------------------------------------------------------------- */

describe("holdings are never fabricated from invitations (#8)", () => {
  it("selectHoldings reflects only the server position list", () => {
    expect(selectHoldings(null)).toEqual([]);
    expect(selectHoldings([])).toEqual([]);
    expect(selectHoldings([{ companyId: "c1" }])).toEqual([{ companyId: "c1" }]);
  });

  it("a funded INVITATION alone does not create a holding", () => {
    // funded invitation present, but ZERO positions → no holding.
    expect(selectHasFundedPosition([])).toBe(false);
    expect(selectHasFundedPosition([{ companyId: "c1" }])).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/* Channel unlock (#7)                                              */
/* ---------------------------------------------------------------- */

describe("channel unlock semantics (#7)", () => {
  it("accepting alone unlocks NOTHING", () => {
    const spine = toSpineInvitations([inv("a", "accepted", "r1")]);
    const ch = selectChannelUnlockState(spine, []);
    expect(ch.hasSoftCircleChannel).toBe(false);
    expect(ch.hasCapTableChannel).toBe(false);
    expect(ch.softCircleRoundIds).toEqual([]);
  });

  it("soft_circled → that round's soft-circle channel", () => {
    const spine = toSpineInvitations([inv("a", "soft_circled", "r1"), inv("b", "signed", "r2")]);
    const ch = selectChannelUnlockState(spine, []);
    expect(ch.hasSoftCircleChannel).toBe(true);
    expect(ch.softCircleRoundIds.sort()).toEqual(["r1", "r2"]);
    expect(ch.hasCapTableChannel).toBe(false);
  });

  it("funded position → cap-table channel", () => {
    const spine = toSpineInvitations([inv("a", "accepted", "r1")]);
    const ch = selectChannelUnlockState(spine, [{ companyId: "c1" }]);
    expect(ch.hasCapTableChannel).toBe(true);
    expect(ch.capTableCompanyIds).toEqual(["c1"]);
  });
});

/* ---------------------------------------------------------------- */
/* Eligibility (#5) = funded OR admin-granted                       */
/* ---------------------------------------------------------------- */

describe("computeEligibilitySignals — funded OR admin-granted (#5)", () => {
  it("neither funded nor admin → NOT eligible", () => {
    const e = computeEligibilitySignals({ hasFundedPosition: false, adminGranted: false });
    expect(e.eligible).toBe(false);
    expect(e.reasons.some((r) => /funded cap-table position is required/i.test(r))).toBe(true);
  });

  it("funded position → eligible", () => {
    const e = computeEligibilitySignals({ hasFundedPosition: true, adminGranted: false });
    expect(e.eligible).toBe(true);
    expect(e.reasons.some((r) => /Funded position/i.test(r))).toBe(true);
  });

  it("admin-granted alone → eligible (operator grant path)", () => {
    const e = computeEligibilitySignals({ hasFundedPosition: false, adminGranted: true });
    expect(e.eligible).toBe(true);
    expect(e.reasons.some((r) => /operator/i.test(r))).toBe(true);
  });

  it("accepted/soft-circled alone does NOT satisfy eligibility", () => {
    // The spine models eligibility from funded/admin only — an accepted or
    // soft-circled invitation feeds neither input, so eligible stays false.
    const e = computeEligibilitySignals({ hasFundedPosition: false, adminGranted: false });
    expect(e.eligible).toBe(false);
  });
});
