/**
 * Sprint 16 — Track C Tier 2: Soft-circle peer + IOI Pulse.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetCommsTiers,
  __getTelemetry,
  setSoftCirclePeerOptIn,
  setIoiPulse,
  aggregateIoiPulse,
} from "../../commsTiersStore";

describe("Sprint 16 C2 — Tier 2 soft-circle peer + IOI pulse", () => {
  beforeEach(() => __resetCommsTiers());

  it("default opt-OUT: cross-cohort DM is OFF unless explicitly opted in", () => {
    const r = setSoftCirclePeerOptIn({ roundId: "rnd_x", userId: "u_a", optedIn: true });
    expect(r.optedIn).toBe(true);
    expect(r.crossCohortDmOptedIn).toBe(false);
  });

  it("emits opted_in / opted_out telemetry distinctly", () => {
    setSoftCirclePeerOptIn({ roundId: "rnd_x", userId: "u_a", optedIn: true });
    setSoftCirclePeerOptIn({ roundId: "rnd_x", userId: "u_a", optedIn: false });
    const t = __getTelemetry();
    expect(t.some(e => e.kind === "soft_circle.peer.opted_in")).toBe(true);
    expect(t.some(e => e.kind === "soft_circle.peer.opted_out")).toBe(true);
  });

  it("IOI pulse: leaning_yes / need_diligence / pass aggregate correctly", () => {
    setIoiPulse({ roundId: "rnd_y", userId: "u_a", pulse: "leaning_yes" });
    setIoiPulse({ roundId: "rnd_y", userId: "u_b", pulse: "leaning_yes" });
    setIoiPulse({ roundId: "rnd_y", userId: "u_c", pulse: "need_diligence" });
    setIoiPulse({ roundId: "rnd_y", userId: "u_d", pulse: "pass" });
    const a = aggregateIoiPulse("rnd_y");
    expect(a).toEqual({ leaning_yes: 2, need_diligence: 1, pass: 1 });
  });

  it("IOI pulse change emits .changed (not .submitted) when prior exists", () => {
    setIoiPulse({ roundId: "rnd_z", userId: "u_a", pulse: "leaning_yes" });
    setIoiPulse({ roundId: "rnd_z", userId: "u_a", pulse: "pass" });
    const t = __getTelemetry();
    expect(t.filter(e => e.kind === "soft_circle.ioi_pulse.submitted")).toHaveLength(1);
    expect(t.filter(e => e.kind === "soft_circle.ioi_pulse.changed")).toHaveLength(1);
  });

  it("aggregate is roundId-scoped — other rounds do not leak", () => {
    setIoiPulse({ roundId: "rnd_a", userId: "u_1", pulse: "leaning_yes" });
    setIoiPulse({ roundId: "rnd_b", userId: "u_1", pulse: "pass" });
    expect(aggregateIoiPulse("rnd_a")).toEqual({ leaning_yes: 1, need_diligence: 0, pass: 0 });
    expect(aggregateIoiPulse("rnd_b")).toEqual({ leaning_yes: 0, need_diligence: 0, pass: 1 });
  });
});
