/**
 * W-INVEST BUG A — repeat investor can't invest in a new round.
 *
 * A NEW round invitation starts at `pending`. `soft_circle` (and `accept`) both
 * require a prior `viewed` state (pending→soft_circled / pending→accepted are
 * intentionally NOT in YOUR_DECISION_TRANSITIONS). The legacy shortcut endpoints
 * call applyDecisionAction directly with no prior view, so a repeat investor hit
 * a spurious `forbidden_transition:pending->soft_circled`.
 *
 * FIX (locked = auto-advance, keep the strict machine): applyDecisionAction
 * auto-records the implicit view (pending→viewed, audited) then proceeds. The
 * transition map stays strict.
 */
import { describe, it, expect } from "vitest";
import { applyDecisionAction, type DecisionRecord } from "../yourDecisionStore";
import { YOUR_DECISION_TRANSITIONS } from "../../shared/schema";

function makeRecord(invitationId: string, roundId: string): DecisionRecord {
  return {
    invitationId,
    roundId,
    companyId: "co-1",
    state: "pending",
    history: [],
    mim: [],
  };
}

describe("W-INVEST BUG A — auto-view on soft_circle/accept from pending", () => {
  it("keeps the state machine strict: pending→soft_circled is NOT a declared transition", () => {
    expect(YOUR_DECISION_TRANSITIONS.pending).not.toContain("soft_circled");
    expect(YOUR_DECISION_TRANSITIONS.pending).not.toContain("accepted");
  });

  it("soft_circle from pending auto-advances pending→viewed→soft_circled (no forbidden_transition)", () => {
    const rec = makeRecord("inv-1", "round-1");
    const r = applyDecisionAction(rec, {
      action: "soft_circle",
      amount: 50_000,
      currency: "USD",
      softCircleType: "definite",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe("viewed");
      expect(r.to).toBe("soft_circled");
    }
    expect(rec.state).toBe("soft_circled");
    // history shows BOTH transitions, in order, with an audited view line.
    expect(rec.history.map((h) => `${h.from}->${h.to}:${h.action}`)).toEqual([
      "pending->viewed:view",
      "viewed->soft_circled:soft_circle",
    ]);
    expect(rec.viewedAt).toBeTruthy();
  });

  it("accept from pending auto-advances pending→viewed→accepted (shortcut-endpoint path)", () => {
    const rec = makeRecord("inv-2", "round-1");
    const r = applyDecisionAction(rec, { action: "accept" });
    expect(r.ok).toBe(true);
    expect(rec.state).toBe("accepted");
    expect(rec.history.map((h) => `${h.from}->${h.to}:${h.action}`)).toEqual([
      "pending->viewed:view",
      "viewed->accepted:accept",
    ]);
  });

  it("does NOT push a spurious view line when the soft_circle request is invalid", () => {
    const rec = makeRecord("inv-3", "round-1");
    const r = applyDecisionAction(rec, { action: "soft_circle", amount: 0, currency: "USD", softCircleType: "definite" });
    expect(r.ok).toBe(false);
    expect(rec.state).toBe("pending");
    expect(rec.history).toEqual([]);
  });

  it("existing viewed→soft_circled path still works (no auto-view double-push)", () => {
    const rec = makeRecord("inv-4", "round-1");
    rec.state = "viewed";
    const r = applyDecisionAction(rec, { action: "soft_circle", amount: 10_000, currency: "USD", softCircleType: "definite" });
    expect(r.ok).toBe(true);
    expect(rec.state).toBe("soft_circled");
    expect(rec.history.map((h) => `${h.from}->${h.to}:${h.action}`)).toEqual([
      "viewed->soft_circled:soft_circle",
    ]);
  });

  it("a SECOND round for the same investor (new invitationId) can be soft-circled independently", () => {
    const first = makeRecord("inv-A", "round-1");
    const second = makeRecord("inv-B", "round-2");
    expect(applyDecisionAction(first, { action: "soft_circle", amount: 1, currency: "USD", softCircleType: "definite" }).ok).toBe(true);
    // The second round's record is independent and starts fresh at pending.
    const r2 = applyDecisionAction(second, { action: "soft_circle", amount: 2, currency: "USD", softCircleType: "definite" });
    expect(r2.ok).toBe(true);
    expect(second.state).toBe("soft_circled");
  });
});
