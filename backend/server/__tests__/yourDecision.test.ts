/**
 * Sprint 10 — Your Decision 10-state machine tests.
 *
 * Verifies:
 *   • Every transition listed in YOUR_DECISION_TRANSITIONS is permitted
 *   • Transitions not in the list are rejected
 *   • Terminal states have no out-transitions
 */
import { describe, it, expect } from "vitest";
import {
  YOUR_DECISION_STATES,
  YOUR_DECISION_TRANSITIONS,
  type YourDecisionState,
} from "../../shared/schema";
import { validateTransition } from "../yourDecisionStore";

describe("YOUR_DECISION_TRANSITIONS — coverage", () => {
  it("declares all 10 states", () => {
    expect(YOUR_DECISION_STATES.length).toBe(10);
  });

  it("permits every declared transition (validateTransition returns null)", () => {
    for (const [from, tos] of Object.entries(YOUR_DECISION_TRANSITIONS) as [YourDecisionState, YourDecisionState[]][]) {
      for (const to of tos) {
        const err = validateTransition(from, to);
        expect(err, `from=${from} to=${to}`).toBeNull();
      }
    }
  });

  it("rejects unlisted transitions (returns error string)", () => {
    const err = validateTransition("pending" as YourDecisionState, "signed" as YourDecisionState);
    expect(err).toMatch(/forbidden_transition/);
  });

  it("terminal states have no out-transitions", () => {
    const terminals: YourDecisionState[] = ["funded", "declined", "expired", "revoked"];
    for (const t of terminals) {
      expect(YOUR_DECISION_TRANSITIONS[t]).toEqual([]);
    }
  });

  it("self-transitions are rejected", () => {
    const err = validateTransition("viewed" as YourDecisionState, "viewed" as YourDecisionState);
    expect(err).toMatch(/noop_transition/);
  });
});
