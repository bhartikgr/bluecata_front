import { describe, it, expect } from "vitest";
import {
  computeSoftCircleMembers,
  ensureSoftCircleChannel,
  softCircleTransitionReason,
} from "../channels";

const NOW = "2026-04-19T12:00:00Z";
const LATER = "2026-07-15T18:00:00Z";

describe("Sprint 9 — soft-circle channel lifecycle", () => {
  it("includes founder + all soft-circlers (intent, committed, signed)", () => {
    const members = computeSoftCircleMembers({
      roundId: "rnd_x", founderUserId: "u_founder",
      softCircles: [
        { userId: "u_intent", status: "intent" },
        { userId: "u_committed", status: "committed" },
        { userId: "u_signed", status: "signed" },
      ],
    });
    expect(members.sort()).toEqual(["u_committed", "u_founder", "u_intent", "u_signed"].sort());
  });

  it("removes withdrawn soft-circlers (status = cancelled)", () => {
    const members = computeSoftCircleMembers({
      roundId: "rnd_x", founderUserId: "u_founder",
      softCircles: [
        { userId: "u_a", status: "committed" },
        { userId: "u_b", status: "cancelled" },
      ],
    });
    expect(members).toContain("u_a");
    expect(members).not.toContain("u_b");
  });

  it("ensureSoftCircleChannel creates fresh channel with deterministic id + metadata", () => {
    const ch = ensureSoftCircleChannel(undefined, {
      roundId: "rnd_seed", founderUserId: "u_maya",
      softCircles: [{ userId: "u_hydra", status: "committed" }],
    }, NOW);
    expect(ch.id).toBe("softcircle__rnd_seed");
    expect(ch.kind).toBe("soft_circle");
    expect(ch.roundId).toBe("rnd_seed");
    expect(ch.participantUserIds).toEqual(expect.arrayContaining(["u_maya", "u_hydra"]));
    expect(ch.archivedAt).toBeUndefined();
    expect(ch.metadata.founderUserId).toBe("u_maya");
  });

  it("archivedAt is set when round is closed", () => {
    const ch = ensureSoftCircleChannel(undefined, {
      roundId: "rnd_seed", founderUserId: "u_maya",
      softCircles: [{ userId: "u_hydra", status: "signed" }],
      roundClosed: true,
    }, LATER);
    expect(ch.archivedAt).toBe(LATER);
  });

  it("re-running ensure with roundClosed=true preserves an existing archivedAt", () => {
    const opened = ensureSoftCircleChannel(undefined, {
      roundId: "rnd_seed", founderUserId: "u_maya",
      softCircles: [{ userId: "u_hydra", status: "signed" }],
    }, NOW);
    const closed = ensureSoftCircleChannel(opened, {
      roundId: "rnd_seed", founderUserId: "u_maya",
      softCircles: [{ userId: "u_hydra", status: "signed" }],
      roundClosed: true,
    }, LATER);
    expect(closed.archivedAt).toBe(LATER);
    const closedAgain = ensureSoftCircleChannel(closed, {
      roundId: "rnd_seed", founderUserId: "u_maya",
      softCircles: [{ userId: "u_hydra", status: "signed" }],
      roundClosed: true,
    }, "2026-08-01T00:00:00Z");
    expect(closedAgain.archivedAt).toBe(LATER); // preserved
  });

  it("softCircleTransitionReason maps lifecycle events", () => {
    expect(softCircleTransitionReason(undefined, "intent")).toBe("soft_circle_created");
    expect(softCircleTransitionReason("committed", "signed")).toBe("soft_circle_signed");
    expect(softCircleTransitionReason("intent", "cancelled")).toBe("soft_circle_withdrawn");
    expect(softCircleTransitionReason("intent", "intent")).toBe("no_change");
  });
});
